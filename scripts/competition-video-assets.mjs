#!/usr/bin/env node
/** Derive the player, transcript and WebVTT files from the original video manifest. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { videoClock } from '../shared/demo-video.js';

const root = new URL('../', import.meta.url);
const documentRoot = 'docs/competition-video-2026-11-04/';
const chapterIds = ['overview', 'invitation', 'conflict', 'reschedule', 'duplicate', 'validation', 'retry', 'cancel', 'tools', 'architecture', 'dataflow', 'performance'];
const evidence = [
  ['/competition/value-report.html', '用户价值与对照方法'],
  ['/experience', '打开七步交互体验'], ['/experience', '查看冲突处理'],
  ['/competition/report.html', '改期与来源记录'], ['/competition/report.html', '去重与工具记录'],
  ['/competition/report.html', '整封校验与异常恢复'], ['/competition/report.html', '重试与状态恢复'],
  ['/competition/report.html', '取消记录与待办保留'],
  ['/competition/reply-review-report.html', '执行记录与回复审核'],
  ['/competition/capacity-design.html', '架构、容量与容错实测'],
  ['/competition/report.html#真实模型回归', '真实模型逐例回归'],
  ['/competition/performance-report.html', '优化前后原始测量'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function mp4Info(bytes) {
  const boxes = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length, 'Supported complete MP4 boxes');
    boxes.push({ type: bytes.toString('ascii', offset + 4, offset + 8), offset, size });
    offset += size;
  }
  const moov = boxes.find(box => box.type === 'moov');
  assert.ok(moov, 'MP4 movie header');
  let movie;
  for (let offset = moov.offset + 8; offset + 8 < moov.offset + moov.size;) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= moov.offset + moov.size, 'Complete movie child');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'mvhd') {
      const version = bytes[offset + 8];
      assert.equal(version, 0, 'Video uses MP4 v0 timescale');
      movie = { timescale: bytes.readUInt32BE(offset + 20), durationUnits: bytes.readUInt32BE(offset + 24) };
    }
    offset += size;
  }
  assert.ok(movie?.timescale > 0, 'Valid movie duration');
  return { durationSeconds: movie.durationUnits / movie.timescale, fastStart: moov.offset < boxes.find(box => box.type === 'mdat')?.offset, boxes };
}

export async function buildVideoAssets() {
  const manifestBytes = await readFile(new URL('docs/competition-2026-11-03/evidence/video-manifest.json', root));
  const manifest = JSON.parse(manifestBytes);
  const videoBytes = await readFile(new URL('public/competition/demo.mp4', root));
  const movie = mp4Info(videoBytes);
  assert.ok(Math.abs(movie.durationSeconds - manifest.durationSeconds) < .15, 'Timeline matches encoded duration within two frames at 12fps');
  assert.ok(movie.fastStart, 'Fast start movie header precedes video samples');
  assert.equal(manifest.scenes.length, chapterIds.length);
  let start = 0;
  const chapters = manifest.scenes.map((scene, index) => {
    assert.ok(scene.seconds > 0 && scene.captions.length && scene.captions.every(line => typeof line === 'string' && !line.includes('-->')));
    const end = start + scene.seconds;
    const item = { id: chapterIds[index], title: scene.title.replace(/\s+/g, ' '), start, end, captions: scene.captions, evidence: { href: evidence[index][0], label: evidence[index][1] } };
    start = end;
    return item;
  });
  assert.equal(start, manifest.durationSeconds);
  const source = await loadImage(fileURLToPath(new URL(`${documentRoot}assets/poster-source.png`, root)));
  const canvas = createCanvas(1200, 675);
  canvas.getContext('2d').drawImage(source, 0, 0, 1200, 675);
  const poster = await canvas.encode('jpeg', 80);
  await writeFile(new URL('public/competition/demo-poster.jpg', root), poster);
  const catalog = { version: 1, title: '从邮件到下一步', durationSeconds: manifest.durationSeconds, encodedDurationSeconds: movie.durationSeconds, resolution: manifest.resolution, silent: true, video: '/competition/demo.mp4', poster: '/competition/demo-poster.jpg', bytes: videoBytes.length, sha256: sha(videoBytes), manifestSha256: sha(manifestBytes), chapters };
  const json = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(new URL('shared/demo-chapters.json', root), json);
  await writeFile(new URL('public/competition/demo-chapters.json', root), json);
  const stamp = seconds => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
  };
  for (const [filename, content] of [['demo-zh.vtt', chapter => chapter.captions.join('\n')], ['demo-chapters.vtt', chapter => chapter.title]]) {
    // A 1ms subtitle gap prevents adjacent cues from stacking at a paused seek boundary.
    const vtt = `WEBVTT\n\n${chapters.map(chapter => `${chapter.id}\n${stamp(chapter.start)} --> ${stamp(chapter.end - (filename === 'demo-zh.vtt' ? .001 : 0))}\n${content(chapter)}\n`).join('\n')}`;
    await writeFile(new URL(`public/competition/${filename}`, root), vtt);
  }
  const transcript = chapters.map(chapter => `${videoClock(chapter.start)}–${videoClock(chapter.end)} ${chapter.title}\n${chapter.captions.join('\n')}\n证据：${chapter.evidence.label} https://daylight.yunforis.com${chapter.evidence.href}\n`).join('\n');
  await writeFile(new URL('public/competition/demo-transcript.txt', root), `Daylight · 三分钟分章讲解\n实际页面截图与工程图 · 中文字幕 · 无音轨\n\n${transcript}`);
  const markdown = `# 三分钟视频完整讲稿\n\n[打开分章播放器](/demo) · [下载文字稿](/competition/demo-transcript.txt)\n\n实际页面截图与工程图，中文字幕，无音轨。七步体验使用原创邮件、预置提取结果与实时工具执行。\n\n${chapters.map(chapter => `## ${videoClock(chapter.start)} ${chapter.title}\n\n${chapter.captions.join('\n\n')}\n\n[定位视频这一章](/demo?chapter=${chapter.id}) · [${chapter.evidence.label}](${chapter.evidence.href})\n`).join('\n')}`;
  await writeFile(new URL(`${documentRoot}transcript.md`, root), markdown);
  const result = { videoBytes: videoBytes.length, posterBytes: poster.length, chapters: chapters.length, encodedDurationSeconds: movie.durationSeconds, manifestDurationSeconds: manifest.durationSeconds, fastStart: movie.fastStart, sha256: sha(videoBytes), posterSha256: sha(poster), movieBoxes: movie.boxes, modelCalls: 0, imageCalls: 0 };
  await writeFile(new URL(`${documentRoot}evidence/media-inventory.json`, root), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) console.log(JSON.stringify(await buildVideoAssets(), null, 2));
