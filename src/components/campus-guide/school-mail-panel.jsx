import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGuide } from './guide-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authRequest } from '@/lib/auth-api';
import { clock, dayLabel } from '@/lib/campus-guide-client';
import { filterCampusEvents } from '../../../shared/campus-guide-ui';

export function SchoolMailPanel({ showEvents = false }) {
  const { user, schoolCalendar, schoolError, refreshSchoolCalendar, run, busy, startRoute, eventFilters, minuteClock } = useGuide();
  const [syncStatus, setSyncStatus] = useState('');
  if (!user) return <div className="rounded-xl border bg-muted/30 p-3 text-xs"><Button asChild variant="link" size="sm"><Link to="/login" state={{ from: { pathname: '/campus', search: '?tab=day' } }}>登录后同步上科大邮箱安排</Link></Button></div>;
  const events = showEvents ? filterCampusEvents((schoolCalendar?.items || []).map(item => ({ ...item, status: 'published', category: 'community', sourceKind: 'school-mail' })), { ...eventFilters, sourceKind: '' }, minuteClock) : [];
  return <section className="space-y-3 rounded-xl border p-4" aria-label="上科大邮箱自动同步">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">上科大邮箱 · 自动同步</h2><Badge variant="secondary">仅本人可见</Badge></div>
    {schoolError ? <p role="status" className="text-xs text-amber-700">读取失败：{schoolError}</p> : !schoolCalendar ? <p className="text-xs text-muted-foreground">正在读取本人邮箱安排…</p> : !schoolCalendar.mailboxes.length ? <p className="text-xs text-muted-foreground">在设置中绑定 @shanghaitech.edu.cn 邮箱并配置模型，后台识别的新日程会自动出现在这里。</p> : <>
      <p className="text-xs text-muted-foreground">已读取 {schoolCalendar.items.length} 项邮件安排，每分钟刷新，改期和取消随原日历更新。{!schoolCalendar.modelReady && '模型未配置，新邮件暂不能自动提取。'}</p>
      {schoolCalendar.mailboxes.map(box => <div key={box.id} className="space-y-1 text-xs"><p className="break-all">{box.email}{!box.ready && ' · 收信配置待完善'}</p><Button size="sm" variant="outline" disabled={!!busy || !box.ready || !schoolCalendar.modelReady} onClick={() => run('同步校园邮箱', async () => { const result = await authRequest('/sync/mailbox', 'POST', { mailboxId: box.id }); setSyncStatus(result.job ? '同步任务已提交，后台处理完成后自动更新。' : '本轮同步已结束，已刷新安排；失败邮件可到工作区日志查看。'); await refreshSchoolCalendar(); })}>立即同步邮件</Button><p className="text-[11px] text-muted-foreground">同步使用本人邮箱与模型配置，可能产生模型费用；云端任务排队后完成时自动刷新。</p></div>)}
    </>}
    {syncStatus && <p role="status" className="text-xs text-muted-foreground">{syncStatus}</p>}
    <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="ghost"><Link to="/app/settings">邮箱与模型设置</Link></Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run('刷新校园安排', refreshSchoolCalendar)}>刷新安排</Button></div>
    {showEvents && events.map(event => <article key={event.id} className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">{event.title}</h3><p className="text-xs text-muted-foreground">{dayLabel(event.start)} · {event.allDay ? '全天' : `${clock(event.start)}–${clock(event.end)}`} · {event.location || '地点待确认'}</p>{event.placeId && <Button size="sm" variant="outline" onClick={() => startRoute(event.placeId)}>去这里</Button>}</article>)}
    {showEvents && schoolCalendar?.mailboxes.length > 0 && !events.length && <p className="text-xs text-muted-foreground">当前筛选范围没有本人邮箱活动。</p>}
  </section>;
}
