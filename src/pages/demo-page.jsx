import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, FileText, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExperienceShell } from '@/components/experience-shell';
import catalog from '../../shared/demo-chapters.json';
import { chapterAtTime, chapterById, videoClock } from '../../shared/demo-video.js';

export default function DemoPage() {
  const [search, setSearch] = useSearchParams();
  const selected = chapterById(catalog.chapters, search.get('chapter'));
  const video = useRef(null);
  const pendingSeek = useRef(selected.start);
  const [current, setCurrent] = useState(selected);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const chapterHeading = useRef(null);

  useEffect(() => {
    const title = document.title;
    document.title = '三分钟分章讲解 · Daylight';
    return () => { if (document.title === '三分钟分章讲解 · Daylight') document.title = title; };
  }, []);

  function seek(chapter) {
    pendingSeek.current = chapter.start;
    setCurrent(chapter);
    const player = video.current;
    if (player?.readyState >= 1) {
      player.currentTime = Math.min(chapter.start, player.duration || catalog.durationSeconds);
      pendingSeek.current = null;
    }
  }

  // Browser history and shared links restore their chapter after metadata is available.
  useEffect(() => { seek(selected); }, [selected.id]);

  function choose(chapter) {
    setSearch(previous => { const next = new URLSearchParams(previous); next.set('chapter', chapter.id); return next; }, { preventScrollReset: true });
    seek(chapter);
    setNotice('');
    chapterHeading.current?.focus({ preventScroll: true });
    chapterHeading.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  function loaded() {
    if (pendingSeek.current !== null && video.current) {
      video.current.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    }
  }

  async function togglePlayback() {
    const player = video.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    setNotice('');
    try { await player.play(); } catch { setNotice('请点视频画面中的播放按钮，或先阅读下方讲稿。'); }
  }

  function retry() {
    pendingSeek.current = current.start;
    setError(''); setNotice('');
    video.current?.load();
  }

  return <ExperienceShell active="demo">
    <div className="max-w-3xl">
      <p className="text-xs font-semibold tracking-[.2em] text-emerald-700 dark:text-emerald-300">三分钟 · 十二章 · 随画面阅读</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">从邮件到下一步。</h1>
      <p id="demo-description" className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">实际页面截图与工程图，配中文字幕和同步讲稿。无音轨，可直接选章查看场景、工具、架构和性能。</p>
    </div>
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0" aria-label="视频与当前讲解">
        <div className="overflow-hidden rounded-2xl border bg-black">
          <video ref={video} controls playsInline preload="metadata" poster={catalog.poster} aria-label="Daylight 三分钟字幕讲解视频" aria-describedby="demo-description" className="aspect-video w-full" onLoadedMetadata={loaded} onTimeUpdate={() => { if (pendingSeek.current === null && video.current) setCurrent(chapterAtTime(catalog.chapters, video.current.currentTime)); }} onPlay={() => { setPlaying(true); setNotice(''); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setError('视频加载失败，请重试加载或下载 MP4。完整讲稿可继续阅读。'); }}>
            <source src={catalog.video} type="video/mp4" />
            <track kind="subtitles" src="/competition/demo-zh.vtt" srcLang="zh-CN" label="中文讲解" />
            <track kind="chapters" src="/competition/demo-chapters.vtt" srcLang="zh-CN" label="十二章" default />
            你的浏览器可通过下方链接下载视频和讲稿。
          </video>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button className="min-h-11" onClick={togglePlayback} disabled={!!error}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? '暂停视频' : '播放视频'}</Button>
          <Button asChild variant="ghost" className="min-h-11"><a href={catalog.video} download="Daylight-3-Minute-Demo.mp4"><Download className="size-4" />下载 MP4 · {(catalog.bytes / 1000000).toFixed(1)} MB</a></Button>
        </div>
        <div className="mt-3 lg:hidden"><label htmlFor="demo-chapter" className="text-xs text-muted-foreground">跳转章节</label><select id="demo-chapter" className="mt-1 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm text-foreground" value={current.id} onChange={event => choose(chapterById(catalog.chapters, event.target.value))}>{catalog.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{videoClock(chapter.start)} · {chapter.title}</option>)}</select></div>
        {error && <div role="alert" className="mt-3 rounded-xl border border-destructive/40 p-4"><p className="text-sm leading-7">{error}</p><Button variant="outline" className="mt-2 min-h-11" onClick={retry}><RotateCcw className="size-4" />重试加载</Button></div>}
        {notice && <p role="status" className="mt-3 text-sm leading-7 text-muted-foreground">{notice}</p>}
        <div className="mt-5 rounded-2xl border bg-muted/20 p-4 sm:p-6" data-testid="current-chapter">
          <p className="text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-300">当前讲解 · {videoClock(current.start)}–{videoClock(current.end)}</p>
          <h2 ref={chapterHeading} tabIndex={-1} className="mt-2 scroll-mt-4 text-lg font-semibold leading-7 outline-none sm:text-xl">{current.title}</h2>
          <div className="mt-3 space-y-2 text-sm leading-7 sm:text-base">{current.captions.map(line => <p key={line}>{line}</p>)}</div>
          <div className="mt-4 flex flex-wrap gap-2"><Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal text-left"><a href={current.evidence.href}>{current.evidence.label}<ArrowRight className="size-4 shrink-0" /></a></Button><Button asChild variant="ghost" className="min-h-11"><Link to={`/demo?chapter=${current.id}`}>本章直达链接</Link></Button></div>
        </div>
      </section>
      <nav aria-label="视频章节" className="hidden min-w-0 rounded-2xl border p-3 sm:p-4 lg:block">
        <h2 className="px-2 py-2 text-base font-semibold">章节目录 <span className="ml-1 text-xs font-normal text-muted-foreground">12 章 · 点击定位</span></h2>
        <ol className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">{catalog.chapters.map(chapter => <li key={chapter.id}><Button variant={current.id === chapter.id ? 'secondary' : 'ghost'} className="h-auto min-h-12 w-full justify-start whitespace-normal px-3 py-3 text-left leading-6" aria-current={current.id === chapter.id ? 'step' : undefined} onClick={() => choose(chapter)}><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{videoClock(chapter.start)}</span><span>{chapter.title}</span></Button></li>)}</ol>
      </nav>
    </div>
    <div className="mt-8 flex flex-wrap gap-3"><Button asChild className="min-h-11"><Link to="/experience">浏览三分钟功能导览<ArrowRight className="size-4" /></Link></Button><Button asChild variant="outline" className="min-h-11"><a href="/competition/demo-transcript.html"><FileText className="size-4" />阅读完整讲稿</a></Button><Button asChild variant="ghost" className="min-h-11"><a href="/competition/demo-transcript.txt" download="Daylight-Demo-Transcript.txt"><Download className="size-4" />下载文字稿</a></Button></div>
  </ExperienceShell>;
}
