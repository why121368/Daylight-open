import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Maximize2, Minimize2, Moon, Pause, Play, RotateCcw, Share2, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ShareButton } from './share-dialog';
import { CampusMap } from './campus-map';
import { clock, dayLabel } from '@/lib/campus-guide-client';
import { cn } from '@/lib/utils';
import { REPLAY_MINUTES, advanceReplayMinute, busiestReplayStart, formatShanghaiDateTime, parseShanghaiDateTime, replayFrame, replayInitialState } from '../../../shared/campus-time-machine.js';

export function TimeMachine({ catalog, onFrame }) {
  const [initial] = useState(() => replayInitialState(new URLSearchParams(location.search).get('time')));
  const [expanded, setExpanded] = useState(initial.expanded), [fullscreen, setFullscreen] = useState(false);
  const [start, setStart] = useState(initial.start), [playback, setPlayback] = useState({ minute: initial.minute, playing: false });
  const [draftStart, setDraftStart] = useState(() => formatShanghaiDateTime(initial.start)), [timeError, setTimeError] = useState('');
  const [speed, setSpeed] = useState(5), [smart, setSmart] = useState(true), [loop, setLoop] = useState(false), [follow, setFollow] = useState(true);
  const frame = useMemo(() => replayFrame(catalog.events, start, playback.minute), [catalog.events, start, playback.minute]);
  const { timestamp, activeEvents } = frame;

  useEffect(() => { setDraftStart(formatShanghaiDateTime(start)); }, [start]);
  useEffect(() => {
    onFrame?.(expanded ? { ...frame, placeId: follow ? activeEvents[0]?.placeId : undefined } : null);
  }, [frame, follow, expanded, onFrame]);
  useEffect(() => () => onFrame?.(null), [onFrame]);
  useEffect(() => {
    if (!playback.playing || !expanded) return undefined;
    const timer = setInterval(() => setPlayback(current => advanceReplayMinute({ ...current, speed, smart, loop, events: catalog.events, start })), 300);
    return () => clearInterval(timer);
  }, [playback.playing, expanded, speed, smart, loop, start, catalog.events]);

  useEffect(() => {
    if (!expanded) return undefined;
    function handleKey(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"]')) return;
      const dialog = target?.closest?.('[role="dialog"]');
      if (dialog && !dialog.hasAttribute('data-campus-replay-fullscreen')) return;
      if (event.key === 'Escape') { event.preventDefault(); if (fullscreen) setFullscreen(false); else collapse(); return; }
      if (target?.closest?.('button,a,[role="button"]')) return;
      if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); togglePlay(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPlayback(current => ({ minute: Math.min(REPLAY_MINUTES, Math.max(0, current.minute + (event.key === 'ArrowRight' ? 5 : -5))), playing: false })); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded, fullscreen]);

  function togglePlay() { setPlayback(current => ({ minute: current.minute >= REPLAY_MINUTES ? 0 : current.minute, playing: !current.playing })); }
  function setWindow(timestamp) { setStart(timestamp); setPlayback({ minute: 0, playing: false }); setTimeError(''); }
  function shift(days) { setWindow(start + days * 86400000); }
  function applyTime(event) {
    event.preventDefault(); const value = parseShanghaiDateTime(draftStart);
    if (value === null) { setTimeError('请选择有效的北京时间，格式为年月日和小时分钟。'); return; }
    setWindow(value);
  }
  function busiest() { const value = busiestReplayStart(catalog.events); if (value !== null) setWindow(value); }
  function collapse() { setExpanded(false); setFullscreen(false); setPlayback(current => ({ ...current, playing: false })); }

  const controls = <div className="rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
    <div className="flex items-center gap-2">
      <button className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left text-sm font-semibold" onClick={() => expanded ? collapse() : setExpanded(true)} aria-expanded={expanded} aria-label="48 小时活动时光机"><span className="flex items-center gap-2"><Clock className="size-4 shrink-0" />48 小时活动时光机</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{expanded ? '收起' : '展开回放'}</span></button>
      {expanded && <Button size="icon-sm" variant="ghost" onClick={() => setFullscreen(value => !value)} aria-label={fullscreen ? '退出时光机全屏' : '全屏活动回放'}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</Button>}
    </div>
    {expanded && <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-sm font-medium">{dayLabel(timestamp)} {clock(timestamp)}<span className="ml-2 text-[10px] font-normal text-amber-700 dark:text-amber-400">回放时钟 · 北京时间</span></p>
        <div className="flex items-center gap-1"><Badge variant="secondary" className="gap-1 text-[10px]">{frame.night ? <Moon className="size-3" /> : <Sun className="size-3" />}{frame.night ? '夜间回放' : '白天回放'}</Badge><ShareButton size="icon" variant="ghost" url={`${location.origin}/campus?tab=events&time=${Math.round(timestamp)}`} title="Daylight 活动时光机"><Share2 className="size-3.5" /></ShareButton></div>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={applyTime}>
        <label className="min-w-0 flex-1 space-y-1 text-[11px] text-muted-foreground"><span>48 小时窗口开始 · 北京时间</span><Input type="datetime-local" value={draftStart} onChange={event => setDraftStart(event.target.value)} aria-label="回放开始时间（北京时间）" className="h-8 min-w-0 w-full text-xs" required /></label><Button type="submit" size="sm" variant="outline">应用</Button>
      </form>
      {timeError && <p role="alert" className="text-xs text-destructive">{timeError}</p>}
      <input type="range" className="w-full accent-amber-600" min="0" max={REPLAY_MINUTES} step="1" value={Math.round(playback.minute)} onChange={event => setPlayback({ minute: Number(event.target.value), playing: false })} aria-label="时光机进度" />
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{dayLabel(start)} {clock(start)}</span><span>{Math.floor(frame.minute / 60)}小时 {Math.floor(frame.minute % 60)}分 / 48小时</span><span>{dayLabel(start + 48 * 3600000)} {clock(start + 48 * 3600000)}</span></div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="时光机前一天" onClick={() => shift(-1)}><ChevronLeft /></Button><Button size="icon-sm" variant="outline" aria-label={playback.playing ? '暂停时光机' : '播放时光机'} onClick={togglePlay}>{playback.playing ? <Pause /> : <Play />}</Button><Button size="icon-sm" variant="ghost" aria-label="从头回放" onClick={() => setPlayback({ minute: 0, playing: false })}><RotateCcw /></Button><Button size="icon-sm" variant="ghost" aria-label="时光机后一天" onClick={() => shift(1)}><ChevronRight /></Button>
        <select aria-label="回放速度" className="h-8 rounded-md border bg-background px-1 text-xs" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[1, 5, 15, 60].map(value => <option key={value} value={value}>{value} 分钟 / 帧</option>)}</select><Button size="sm" variant="ghost" onClick={busiest} disabled={!catalog.events.some(event => !event.hidden && event.status !== 'cancelled')}>活动最多时段</Button><Button size="sm" variant="ghost" onClick={() => setWindow(Math.floor(Date.now() / 60000) * 60000)}>此刻</Button>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><label className="flex gap-1"><input type="checkbox" checked={smart} onChange={event => setSmart(event.target.checked)} />空档快进</label><label className="flex gap-1"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />镜头跟随</label><label className="flex gap-1"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />循环</label></div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]"><span>此刻活动 {activeEvents.length} 场</span><Badge variant="outline" className="text-[10px]">长期展览 {frame.longExhibitionCount} 场</Badge><span className="text-muted-foreground">展览标题或标签匹配，且持续 ≥24 小时</span></div>
      <div className="max-h-28 space-y-1 overflow-y-auto text-xs" aria-label="回放时刻的活动">{activeEvents.length ? activeEvents.map(event => <p key={event.id}>{clock(event.start)} · {event.title}</p>) : <p className="text-muted-foreground">这个时刻没有已收录的活动。</p>}</div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">空格播放/暂停，← → 前后 5 分钟，Esc 退出；输入时不触发。昼夜按北京时间 06:00–18:00 示意，不代表日出日落或现场亮度。</p>
    </div>}
  </div>;

  return <>
    {!fullscreen && controls}
    <Dialog open={fullscreen} onOpenChange={setFullscreen}><DialogContent showCloseButton={false} data-campus-replay-fullscreen="" className="inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none" onEscapeKeyDown={event => { event.preventDefault(); if (!document.activeElement?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"]')) setFullscreen(false); }}>
      <DialogTitle className="sr-only">48 小时校园活动全屏回放</DialogTitle><DialogDescription className="sr-only">使用模拟时钟浏览已收录活动；此画面中的时刻不会改变真实日程。</DialogDescription>
      <div className="absolute inset-0 isolate"><CampusMap catalog={catalog} eventMarkers={activeEvents} followPlaceId={follow ? activeEvents[0]?.placeId : ''} /><div className={cn('pointer-events-none absolute inset-0 z-[400] transition-colors duration-500 motion-reduce:transition-none', frame.night ? 'bg-slate-950/30' : 'bg-amber-50/5')} aria-hidden="true" /></div>
      <div className="pointer-events-none absolute top-4 left-4 z-[500] max-w-[calc(100%-6rem)] rounded-md border bg-background/90 px-2 py-1 text-xs">48 小时回放 · {catalog.meta?.isDemo ? '示例活动，非实时' : '已收录活动，非实时'}</div>
      <div className="absolute right-3 bottom-3 left-3 z-[500] mx-auto max-h-[75dvh] max-w-2xl overflow-y-auto rounded-xl">{controls}</div>
    </DialogContent></Dialog>
  </>;
}
