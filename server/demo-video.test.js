import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chapterAtTime, chapterById, videoClock } from '../shared/demo-video.js';
import { mp4Info } from '../scripts/competition-video-assets.mjs';

const root = new URL('../', import.meta.url);
const json = await readFile(new URL('shared/demo-chapters.json', root), 'utf8');
const catalog = JSON.parse(json);
const original = JSON.parse(await readFile(new URL('docs/competition-2026-11-03/evidence/video-manifest.json', root), 'utf8'));

test('video chapter timeline covers the original frames, captions and duration without gaps', () => {
  assert.equal(catalog.chapters.length, original.scenes.length);
  assert.equal(catalog.chapters[0].start, 0);
  assert.equal(new Set(catalog.chapters.map(row => row.id)).size, catalog.chapters.length);
  for (const [index, chapter] of catalog.chapters.entries()) {
    assert.equal(chapter.end - chapter.start, original.scenes[index].seconds);
    assert.deepEqual(chapter.captions, original.scenes[index].captions);
    if (index) assert.equal(chapter.start, catalog.chapters[index - 1].end);
    assert.ok(chapter.evidence.href.startsWith('/'));
  }
  assert.equal(catalog.chapters.at(-1).end, catalog.durationSeconds);
});

test('seeking uses half-open boundaries and handles the final encoded frame', () => {
  for (const chapter of catalog.chapters) {
    assert.equal(chapterAtTime(catalog.chapters, chapter.start).id, chapter.id);
    assert.equal(chapterAtTime(catalog.chapters, chapter.end - .001).id, chapter.id);
  }
  assert.equal(chapterAtTime(catalog.chapters, catalog.encodedDurationSeconds).id, 'performance');
  assert.equal(chapterAtTime(catalog.chapters, 180).id, 'performance');
  for (const time of [-1, NaN, Infinity]) assert.equal(chapterAtTime(catalog.chapters, time).id, 'overview');
});

test('shared chapter lookup handles valid links and malformed parameters', () => {
  assert.equal(chapterById(catalog.chapters, 'architecture').start, 135);
  for (const id of ['', null, 'missing', '__proto__', '<script>']) assert.equal(chapterById(catalog.chapters, id).id, 'overview');
  assert.equal(videoClock(135), '02:15');
  assert.equal(videoClock(NaN), '00:00');
});

test('public player catalog exactly matches the bundled catalog', async () => {
  assert.equal(await readFile(new URL('public/competition/demo-chapters.json', root), 'utf8'), json);
});

test('subtitles and native chapter track use the same chapter intervals and text', async () => {
  for (const [filename, text] of [['demo-zh.vtt', row => row.captions.join('\n')], ['demo-chapters.vtt', row => row.title]]) {
    const vtt = await readFile(new URL(`public/competition/${filename}`, root), 'utf8');
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    const cues = vtt.slice(8).trim().split('\n\n');
    assert.equal(cues.length, catalog.chapters.length);
    for (const [index, cue] of cues.entries()) {
      const row = catalog.chapters[index];
      const end = filename === 'demo-zh.vtt' ? `${videoClock(row.end - 1)}.999` : `${videoClock(row.end)}.000`;
      assert.equal(cue, `${row.id}\n00:${videoClock(row.start)}.000 --> 00:${end}\n${text(row)}`);
    }
  }
});

test('encoded MP4 matches the catalog digest, duration and fast-start layout', async () => {
  const bytes = await readFile(new URL('public/competition/demo.mp4', root));
  const info = mp4Info(bytes);
  assert.equal(info.fastStart, true);
  assert.equal(info.durationSeconds, catalog.encodedDurationSeconds);
  assert.ok(Math.abs(info.durationSeconds - catalog.durationSeconds) < .15);
  assert.equal(bytes.length, catalog.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), catalog.sha256);
});

test('downloadable transcript preserves every caption and chapter link', async () => {
  const text = await readFile(new URL('public/competition/demo-transcript.txt', root), 'utf8');
  const markdown = await readFile(new URL('docs/competition-video-2026-11-04/transcript.md', root), 'utf8');
  for (const chapter of catalog.chapters) {
    for (const line of chapter.captions) { assert.ok(text.includes(line)); assert.ok(markdown.includes(line)); }
    assert.ok(markdown.includes(`/demo?chapter=${chapter.id}`));
  }
});
