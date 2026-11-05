import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarDays, Clock, Compass, LoaderCircle, MapPin, Send, Sparkles, Utensils } from 'lucide-react';
import { useGuide } from './guide-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { guideRequest, clock, dayLabel, offsetDate, shanghaiDate } from '@/lib/campus-guide-client';

function starterTasks() {
  const tomorrow = offsetDate(shanghaiDate(), 1), [, month, day] = tomorrow.split('-');
  return [
    { icon: Utensils, title: '按预算吃好一餐', text: '我最近在控糖，帮我推荐一份晚餐，预算10到25元' },
    { icon: CalendarDays, title: '查日程与地点', text: `${Number(month)}月${Number(day)}日有什么日程？分别在哪些地点？` },
    { icon: MapPin, title: '下一项安排怎么去', text: '今天下一项安排在哪里？帮我规划过去的步行路线' },
    { icon: Clock, title: '找一段自习时间', text: '明天14:00到18:00，我有没有至少60分钟的空档可以自习？' },
    { icon: Compass, title: '找不冲突的讲座', text: '明天有哪些讲座与我的课表和日程不冲突？告诉我时间和地点' },
    { icon: MapPin, title: '问路与出行偏好', text: '从南门到图书馆怎么走？尽量避雨' },
  ];
}

export function CampusAssistant() {
  const { user, schoolCalendar, gpsPosition, setRoute, setRouteForm, setTab, selectPlace, startRoute } = useGuide();
  const [open, setOpen] = useState(false), [message, setMessage] = useState(''), [messages, setMessages] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [showGuide, setShowGuide] = useState(true);
  const inputRef = useRef(null), guideRef = useRef(null), endRef = useRef(null), identity = useRef(user?.id);
  identity.current = user?.id;
  useEffect(() => { setMessages([]); setMessage(''); setError(''); setBusy(false); setShowGuide(true); }, [user?.id]);
  useEffect(() => { if (!showGuide) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, showGuide]);
  async function send(value) {
    const text = value.trim(); if (!text || busy) return;
    const owner = user?.id;
    setBusy(true); setError(''); setMessage(''); setShowGuide(false);
    const history = messages.flatMap(row => [{ role: 'user', content: row.question }, { role: 'assistant', content: JSON.stringify({ reply: row.answer.reply, cards: row.answer.cards?.map(({ title, placeId, start, end, price, menus }) => ({ title, placeId, start, end, price, menus: menus?.map(({ name, price }) => ({ name, price })) })) }) }]).slice(-6);
    try { const answer = await guideRequest('/assistant', 'POST', { message: text, history, position: gpsPosition }); if (owner === identity.current) setMessages(previous => [...previous.slice(-9), { question: text, answer }]); }
    catch (e) { if (owner === identity.current) { setError(e.message); setMessage(text); } }
    finally { if (owner === identity.current) setBusy(false); }
  }
  return <>
    {!open && <Button className="fixed right-4 bottom-5 z-[1100] rounded-full shadow-lg" onClick={() => setOpen(true)}><Bot className="size-5" />小 D 助手</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[90svh] w-[calc(100%-1rem)] max-w-xl flex-col gap-3 p-4 sm:p-6">
      <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2 pr-6"><Bot className="size-5" /><span className="text-base">小 D · 校园助手</span><Button size="sm" variant={showGuide ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" aria-expanded={showGuide} aria-controls="campus-assistant-guide" onClick={() => { setShowGuide(value => !value); requestAnimationFrame(() => guideRef.current?.scrollIntoView({ block: 'start' })); }}>能做什么</Button></DialogTitle><DialogDescription>吃什么、去哪儿、怎么安排，一句话交给小 D。</DialogDescription></DialogHeader>
      <p className="text-xs leading-relaxed text-muted-foreground">{user ? schoolCalendar?.modelReady ? '默认使用本人模型，支持连续追问；会发送问题和最近对话，可能产生费用。' : '配置本人模型后默认使用；未配置时提供基础查询。' : '游客可查询公开菜单、活动和地点。登录并配置模型后可连续追问、查询本人安排。'} <Link className="underline underline-offset-2" to={user ? '/app/settings?tab=model' : '/login'}>{user ? '模型设置' : '登录'}</Link></p>
      <div className="min-h-36 flex-1 space-y-4 overflow-y-auto overscroll-contain" aria-live="polite">
        {showGuide && <section id="campus-assistant-guide" ref={guideRef} className="space-y-3 rounded-xl border bg-muted/30 p-3"><div><h2 className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles className="size-3.5" />从一句话开始</h2><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">点一个场景填入问题，修改日期、预算或地点后发送。也可以继续问“换成午餐”“那怎么过去”。</p></div><div className="grid gap-2 sm:grid-cols-2">{starterTasks().map(task => <Button key={task.title} className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal p-3 text-left" variant="outline" disabled={busy} onClick={() => { setMessage(task.text); setShowGuide(false); inputRef.current?.focus(); }}><span className="flex items-center gap-1.5 text-xs font-medium"><task.icon className="size-3.5 shrink-0" />{task.title}</span><span className="text-xs font-normal leading-relaxed text-muted-foreground">{task.text}</span></Button>)}</div><p className="text-[11px] leading-relaxed text-muted-foreground">本人安排来自校园课表、个人日程和已同步的学校邮箱。小 D 会查询资料、检查冲突并规划路线，结果中可查看处理依据。</p></section>}
        {messages.map((row, index) => <div key={index} className="space-y-3"><p className="ml-8 rounded-xl bg-muted p-3 text-sm">{row.question}</p><div className="space-y-3 rounded-xl border p-3"><p className="whitespace-pre-wrap text-sm leading-relaxed">{row.answer.reply}</p>
          {row.answer.cards?.map((card, i) => <div key={i} className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs"><h3 className="text-sm font-medium">{card.title}</h3>
            {card.type === 'meal' && <><ul className="space-y-1">{card.menus.map(menu => <li key={menu.id}>{menu.name} · ¥{menu.price} · {menu.window}{menu.portion && ` · ${menu.portion}`}</li>)}</ul><p>菜品合计 ¥{card.price.toFixed(2)}（主食另计）</p>{card.menus[0]?.image && <a className="underline" href={card.menus[0].image} target="_blank" rel="noopener noreferrer">核对菜单原图</a>}</>}
            {card.type === 'event' && <p>{dayLabel(card.start)} {card.allDay ? '全天' : `${clock(card.start)}–${clock(card.end)}`} · {card.location || '地点待确认'}{card.private && ' · 仅本人可见'}</p>}
            {card.type === 'slot' && <p>{dayLabel(card.start)} {clock(card.start)}–{clock(card.end)}</p>}
            <div className="flex flex-wrap gap-2">{card.type === 'route' && <><Button size="sm" variant="outline" onClick={() => { setRouteForm({ from: card.route.from || '', to: card.route.to, mode: 'ground', avoidRain: Boolean(card.route.avoidRain), accessible: Boolean(card.route.accessible) }); setRoute(card.route); selectPlace(card.placeId); setTab('map'); setOpen(false); }}>在地图查看</Button>{card.route.externalNavigationUrl && <Button asChild size="sm"><a href={card.route.externalNavigationUrl} target="_blank" rel="noopener noreferrer">腾讯步行导航</a></Button>}</>}{card.type === 'place' && <Button size="sm" variant="outline" onClick={() => { selectPlace(card.id); setTab('map'); setOpen(false); }}>选择地点</Button>}{card.placeId && card.type !== 'route' && <Button size="sm" variant="outline" onClick={() => { setOpen(false); startRoute(card.placeId); }}>去这里</Button>}</div>
          </div>)}
          <details className="text-[11px] text-muted-foreground"><summary>处理依据 · {row.answer.mode === 'model' ? '模型理解' : '规则理解'}</summary>{row.answer.trace?.map((step, i) => <p key={i} className="mt-1">{step.summary}</p>)}</details>
          {row.answer.notice && <p className="text-[11px] text-muted-foreground">{row.answer.notice}</p>}
        </div></div>)}
        {busy && <p role="status" className="flex items-center gap-2 p-3 text-sm"><LoaderCircle className="size-4 animate-spin" />小 D 正在查询…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div ref={endRef} />
      </div>
      <form className="flex shrink-0 gap-2" onSubmit={e => { e.preventDefault(); send(message); }}><Input ref={inputRef} className="min-w-0" aria-label="问小D" placeholder="说说你的预算、时间或目的地…" maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} /><Button className="shrink-0" type="submit" size="icon" aria-label="发送给小D" disabled={busy || !message.trim()}><Send className="size-4" /></Button></form>
      <p className="text-[10px] text-muted-foreground">定位仅用于你发起的问路。路线和菜单以现场为准，饮食建议不提供营养测量或医疗判断。</p>
    </DialogContent></Dialog>
  </>;
}
