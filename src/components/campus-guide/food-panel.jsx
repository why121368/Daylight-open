import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { guideRequest, QUEUE_LABELS, clock, dayLabel, shanghaiDate, matches, safeExternal } from '@/lib/campus-guide-client';
import { isOpenNow } from '../../../shared/campus-guide';
import { activeMenu, matchesFoodQuery, parseFoodQuery } from '../../../shared/campus-guide-ui';
import { diningAvailability } from '../../../shared/campus-dining';
import { useGuide } from './guide-context';
import { PanelHeading } from './guide-panels';

const priceLabel = menu => Number.isFinite(menu.price) ? `¥${menu.price.toFixed(2)}` : '价格待确认';
function QueueStatus({ queue }) {
  if (!queue) return <p className="text-xs text-muted-foreground">暂时没有可用的等待信息。</p>;
  if (queue.source === 'closed') return <p className="text-xs text-muted-foreground">{queue.notice || '当前不在已记录营业时段'}</p>;
  return <p className="text-xs leading-relaxed">{queue.source === 'guess' ? <><Badge variant="outline" className="mr-1 text-[10px]">时段估算</Badge>约 {queue.waitMinutes} 分钟 · 无现场反馈，请到店核对</> : <><Badge variant="outline" className="mr-1 text-[10px]">访客反馈</Badge>{QUEUE_LABELS[queue.level]} · 约 {queue.waitMinutes} 分钟 · {queue.reportCount} 人 · {clock(queue.lastReportedAt || queue.reportedAt)} 更新</>}</p>;
}

export function FoodPanel() {
  const { catalog, queues, setQueues, user, run, busy, selectPlace, startRoute, setTab, minuteClock, setCommunityFilter } = useGuide();
  const [menuDate, setMenuDate] = useState(shanghaiDate()), [mealFilter, setMealFilter] = useState('all');
  const [query, setQuery] = useState(''), [venueId, setVenueId] = useState(''), [maxPrice, setMaxPrice] = useState(''), [flavor, setFlavor] = useState('');
  const [sort, setSort] = useState('default'), [onlyOpen, setOnlyOpen] = useState(false), [windowId, setWindowId] = useState(''), [dining, setDining] = useState(null);
  const [detail, setDetail] = useState(null), [reportRating, setReportRating] = useState(''), [reportSoldOut, setReportSoldOut] = useState(''), [error, setError] = useState('');
  const [queueTargets, setQueueTargets] = useState({});
  const refreshDining = async () => { const result = await guideRequest('/dining'); setDining(result); setError(''); return result; };
  useEffect(() => {
    let active = true;
    guideRequest('/dining').then(data => { if (active) { setDining(data); setError(''); } }).catch(error => active && setError(error.message));
    return () => { active = false; };
  }, [catalog.meta.revision, user?.id, minuteClock]);
  const menus = catalog.menus.map(menu => ({ ...menu, ...(dining?.menus.find(item => item.id === menu.id) || {}) }));
  const venues = catalog.venues.map(venue => ({ ...venue, ...(dining?.venues?.find(item => item.id === venue.id) || {}) }));
  const parsed = parseFoodQuery(query), budget = Math.min(parsed.maxPrice, maxPrice === '' ? Infinity : Number(maxPrice));
  const filtered = menus.filter(menu => {
    const venue = venues.find(item => item.id === menu.venueId), win = venue?.windows.find(item => item.id === menu.windowId);
    const flavorMatches = !flavor || (flavor === '辣' ? !menu.tags.includes('不辣') && matches(`${menu.tags.join(' ')} ${menu.flavor}`, '辣') : matches(`${menu.tags.join(' ')} ${menu.flavor}`, flavor));
    const day = new Date(`${menuDate}T12:00:00+08:00`).getUTCDay() || 7;
    return (!menu.validFrom || menu.validFrom <= menuDate) && (!menu.validUntil || menu.validUntil >= menuDate) && menu.availableDays.includes(day) && (mealFilter === 'all' || menu.meal === 'all' || menu.meal === mealFilter) && (!venueId || menu.venueId === venueId) && (!windowId || menu.windowId === windowId) && matchesFoodQuery(menu, venue, { ...parsed, maxPrice: budget }) && flavorMatches && (!onlyOpen || (isOpenNow(win?.openHours?.length ? win.openHours : venue?.openHours, minuteClock) === true && activeMenu(menu, venue, minuteClock)));
  }).sort((a, b) => ['asc', 'desc'].includes(sort) ? (Number.isFinite(a.price) ? 0 : 1) - (Number.isFinite(b.price) ? 0 : 1) || (sort === 'asc' ? a.price - b.price : b.price - a.price) : sort === 'rating' ? (b.ratingAverage || 0) - (a.ratingAverage || 0) : a.name.localeCompare(b.name, 'zh-CN'));
  const selectedMenu = detail ? menus.find(menu => menu.id === detail) : null;
  const selectedVenue = selectedMenu && venues.find(venue => venue.id === selectedMenu.venueId), selectedWindow = selectedVenue?.windows.find(window => window.id === selectedMenu.windowId);
  const selectedAvailability = selectedMenu && diningAvailability(selectedVenue, selectedWindow, selectedMenu, minuteClock);
  function openMenu(menu) { setDetail(menu.id); setReportRating(menu.myRating ? String(menu.myRating) : ''); setReportSoldOut(''); }
  return <>
    <PanelHeading eyebrow="A TASTE OF CAMPUS" title="今天，吃点什么？" description="先找到想吃的，再找到窗口。价格和营业时间以现场为准。" />
    <div className="grid grid-cols-2 gap-2"><Input type="date" aria-label="菜单日期" value={menuDate} onChange={event => event.target.value && setMenuDate(event.target.value)} /><select aria-label="菜单餐次" className="h-10 rounded-md border bg-background px-2 text-sm" value={mealFilter} onChange={event => setMealFilter(event.target.value)}><option value="all">全部餐次</option><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option></select></div><p className="text-xs text-muted-foreground">已录入 2026.11.2–11.15 三处食堂、六个档口的菜单。11.9–11.15 经资料提供者确认沿用前一周菜单，原图日期保留。按日期和餐次查看，实际供应以窗口公示为准。</p>
    <Input aria-label="搜索菜品" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜菜名、口味，或「15元以内的牛肉」" />
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant={!venueId ? 'secondary' : 'outline'} onClick={() => { setVenueId(''); setWindowId(''); }}>全部食堂</Button>
      {catalog.venues.map(venue => <Button key={venue.id} size="sm" variant={venueId === venue.id ? 'secondary' : 'outline'} onClick={() => { setVenueId(venue.id === venueId ? '' : venue.id); setWindowId(''); }}>{venue.name}</Button>)}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <select className="h-10 min-w-0 rounded-md border bg-background px-2 text-sm" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} aria-label="价格筛选"><option value="">不限价格</option>{[10, 15, 20, 30].map(price => <option key={price} value={price}>{price} 元以内</option>)}</select>
      <select className="h-10 min-w-0 rounded-md border bg-background px-2 text-sm" value={sort} onChange={event => setSort(event.target.value)} aria-label="菜品排序"><option value="default">综合排序</option><option value="asc">价格从低到高</option><option value="desc">价格从高到低</option><option value="rating">评分从高到低</option></select>
    </div>
    <div className="flex flex-wrap gap-2">
      {['不辣', '辣', '素食', '面食', '米饭', '饮品'].map(tag => <Button key={tag} variant={flavor === tag ? 'secondary' : 'ghost'} size="sm" onClick={() => setFlavor(flavor === tag ? '' : tag)}>{tag}</Button>)}
      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyOpen} onChange={event => setOnlyOpen(event.target.checked)} />当前供餐</label>
    </div>
    {error && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">评分与库存反馈读取失败：{error}。目录菜品仍可查看。</p>}
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">食堂与排队反馈</h2>
      {venues.filter(venue => !venueId || venueId === venue.id).map(venue => {
        const overview = queues.venues?.find(report => report.venueId === venue.id), target = queueTargets[venue.id] || '', queue = target ? overview?.windows?.find(row => row.windowId === target) : overview || queues.reports?.find(report => report.venueId === venue.id), availability = diningAvailability(venue, null, null, minuteClock), open = availability.open;
        return <Card key={venue.id}><CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2"><button onClick={() => selectPlace(venue.placeId)} className="min-w-0 text-left"><h3 className="font-semibold">{venue.name}</h3><p className="mt-1 text-xs text-muted-foreground">{venue.floor} · {availability.temporarilyClosed ? '临时停业' : availability.orderStopped ? '停止点餐' : open === null ? '营业时间待核实' : open ? '供餐时段内' : '不在已记录供餐时段'}</p></button><Button variant="outline" size="sm" onClick={() => startRoute(venue.placeId)}>到这去</Button></div>
          {availability.closureReason && <p className="text-xs text-muted-foreground">{availability.closureReason}{availability.closureUntil ? ` · 至 ${dayLabel(availability.closureUntil)} ${clock(availability.closureUntil)}` : ''}</p>}
          <div className="flex flex-wrap gap-1.5">{venue.windows.map(window => <Button key={window.id} variant={windowId === window.id ? 'secondary' : 'outline'} size="sm" onClick={() => { setVenueId(venue.id); setWindowId(windowId === window.id ? '' : window.id); }}>{window.name}</Button>)}</div>
          <label className="grid gap-1.5 text-xs"><span>查看和反馈排队</span><select aria-label={`${venue.name}排队反馈范围`} className="h-9 min-w-0 rounded-md border bg-background px-2" value={target} onChange={event => setQueueTargets(previous => ({ ...previous, [venue.id]: event.target.value }))}><option value="">整个食堂</option>{venue.windows.map(window => <option key={window.id} value={window.id}>{window.name}</option>)}</select></label>
          <QueueStatus queue={queue} />
          <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs text-muted-foreground">我在现场</span>{Object.entries(QUEUE_LABELS).map(([level, title]) => <Button key={level} variant="ghost" size="sm" disabled={!!busy} onClick={() => run('更新排队反馈', async () => { await guideRequest('/queue-reports', 'POST', { venueId: venue.id, windowId: target, level }); setQueues(await guideRequest('/queues')); toast.success('反馈已更新，30 分钟后失效。'); })}>{title}</Button>)}</div>
          <p className="text-[11px] text-muted-foreground">游客也可反馈；仅反映最近 30 分钟体验，同一窗口每分钟可更新一次。</p>
        </CardContent></Card>;
      })}
    </section>
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">{filtered.length} 道菜 · 供餐按营业时间、餐次与菜单生效期筛选 · 记录值不代表实时库存</p>
      {!filtered.length && <p className="p-6 text-center text-sm text-muted-foreground">没有匹配菜品，试试调整筛选。</p>}
      {filtered.map(menu => {
        const venue = venues.find(item => item.id === menu.venueId), window = venue?.windows.find(item => item.id === menu.windowId), outdated = menu.validUntil && menu.validUntil < shanghaiDate(), availability = diningAvailability(venue, window, menu, minuteClock);
        return <button key={menu.id} className="flex w-full items-start gap-3 rounded-xl border p-4 text-left hover:bg-muted/40" onClick={() => openMenu(menu)}>
          {menu.imageUrl && <img src={safeExternal(menu.imageUrl)} loading="lazy" className="size-14 rounded-lg object-cover" alt={menu.name} />}
          <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{menu.name} {menu.isDemo && <span className="text-[10px] font-normal text-muted-foreground">示例</span>}</h3><p className="mt-1 text-xs text-muted-foreground">{venue?.name} · {window?.name || '窗口待补充'}</p><p className="mt-2 text-xs text-muted-foreground">{menu.tags.join(' · ')}</p><p className="mt-2 text-[11px] text-muted-foreground">{menu.ratingCount ? `★ ${menu.ratingAverage} · ${menu.ratingCount} 人` : '暂无评分'}{menu.myRating ? ` · 我评 ${menu.myRating} 星` : ''}</p>{(menu.soldOut || outdated || availability.temporarilyClosed || availability.orderStopped) && <Badge variant="outline" className="mt-2 text-[10px]">{availability.temporarilyClosed ? '临时停业' : availability.orderStopped ? '停止点餐' : menu.soldOut ? '已报售罄' : '历史菜单'}</Badge>}</div>
          <div className="max-w-24 shrink-0 text-right"><p className="font-semibold">{priceLabel(menu)}</p><p className="mt-2 text-[10px] text-muted-foreground">{menu.unit ? `每${menu.unit}` : menu.portion || '参考价'}{menu.pricePending && Number.isFinite(menu.price) ? ' · 待确认' : ''}</p></div>
        </button>;
      })}
    </section>
    <Dialog open={!!selectedMenu} onOpenChange={open => !open && setDetail(null)}><DialogContent className="max-h-[90svh] overflow-y-auto">
      {selectedMenu && <>
        <DialogHeader><DialogTitle>{selectedMenu.name}</DialogTitle><DialogDescription>菜单资料与现场反馈供参考，实际供应和价格请向窗口核对。</DialogDescription></DialogHeader>
        {selectedMenu.imageUrl && <img src={safeExternal(selectedMenu.imageUrl)} className="max-h-60 w-full rounded-xl object-contain" alt={selectedMenu.name} />}
        <p className="text-lg font-semibold">{priceLabel(selectedMenu)} <span className="text-xs font-normal text-muted-foreground">{selectedMenu.unit ? `每${selectedMenu.unit}` : selectedMenu.portion || '参考价'}{selectedMenu.pricePending && Number.isFinite(selectedMenu.price) ? ' · 价格待确认' : ''}</span></p>
        {(selectedMenu.menuImageUrl || selectedWindow?.menuImageUrl || selectedVenue?.menuImageUrl) && <a className="text-xs underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={safeExternal(selectedMenu.menuImageUrl || selectedWindow?.menuImageUrl || selectedVenue?.menuImageUrl)}>查看已收录的菜单原图</a>}
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedMenu.description || selectedMenu.tags.join(' · ')}</p>
        {selectedMenu.specs?.length > 0 && <ul className="space-y-1 text-sm">{selectedMenu.specs.map(spec => <li key={spec.name}>{spec.name} · {Number.isFinite(spec.price) ? `¥${spec.price.toFixed(2)}` : '价格待确认'}{spec.unit && ` / ${spec.unit}`}</li>)}</ul>}
        <p className="text-xs text-muted-foreground">生效日期 {selectedMenu.validFrom || '未记录'} 至 {selectedMenu.validUntil || '未记录'} · {({ all: '原图未区分餐次', breakfast: '早餐', lunch: '午餐', dinner: '晚餐' })[selectedMenu.meal]}{selectedMenu.updatedAt && ` · 更新于 ${dayLabel(selectedMenu.updatedAt)}`}</p>
        {(selectedAvailability.temporarilyClosed || selectedAvailability.orderStopped) && <p className="text-xs text-amber-700 dark:text-amber-400">{selectedAvailability.temporarilyClosed ? '临时停业' : '已停止点餐'}{selectedAvailability.closureReason && ` · ${selectedAvailability.closureReason}`}</p>}
        {selectedMenu.menuImageUrl && <a className="text-xs underline" target="_blank" rel="noopener noreferrer" href={selectedMenu.menuImageUrl}>查看本周菜单原图</a>}
        {selectedMenu.sourceUrl && <a className="text-xs underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={safeExternal(selectedMenu.sourceUrl)}>核对菜单来源</a>}
        <p className="text-xs">{selectedMenu.ratingCount ? `平均 ${selectedMenu.ratingAverage} 星，${selectedMenu.ratingCount} 人评价` : '还没有评分'}{selectedMenu.myRating ? `；我评 ${selectedMenu.myRating} 星` : ''}</p>
        <p className="text-xs text-muted-foreground">{selectedMenu.availabilityReportedAt ? `${clock(selectedMenu.availabilityReportedAt)} 用户反馈${selectedMenu.soldOut ? '售罄' : '有售'}，${clock(selectedMenu.availabilityExpiresAt)} 失效` : selectedMenu.soldOut ? '维护者已标记售罄，实际以窗口为准' : '当前库存未知'}</p>
        {user ? <form className="space-y-3 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); run('提交菜品评价', async () => { await guideRequest('/menu-reports', 'POST', { menuId: selectedMenu.id, ...(reportRating ? { rating: Number(reportRating) } : {}), ...(reportSoldOut ? { soldOut: reportSoldOut === 'yes' } : {}) }); await refreshDining(); toast.success('评价已更新；售罄反馈 3 小时有效。'); }); }}>
          <h3 className="text-sm font-medium">我的现场评价</h3>
          <div className="grid grid-cols-2 gap-2"><select aria-label="菜品星级" className="h-10 min-w-0 rounded border bg-background px-2 text-sm" value={reportRating} onChange={event => setReportRating(event.target.value)}><option value="">不更新评分</option>{[1, 2, 3, 4, 5].map(rating => <option key={rating} value={rating}>{rating} 星</option>)}</select><select aria-label="菜品库存反馈" className="h-10 min-w-0 rounded border bg-background px-2 text-sm" value={reportSoldOut} onChange={event => setReportSoldOut(event.target.value)}><option value="">不更新库存</option><option value="yes">刚看到售罄</option><option value="no">刚看到有售</option></select></div>
          <Button type="submit" size="sm" disabled={!!busy || (!reportRating && !reportSoldOut)}>提交评价</Button><p className="text-[11px] text-muted-foreground">每人每道菜保留一份评分；每分钟可更新一次。</p>
        </form> : <Button asChild variant="outline"><Link to="/login" state={{ from: { pathname: '/campus', search: '?tab=food' } }}>登录后评分和反馈售罄</Link></Button>}
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setDetail(null); startRoute(selectedVenue?.placeId); }}>导航到窗口</Button><Button size="sm" variant="outline" onClick={() => { setDetail(null); setCommunityFilter({ board: 'food', venueId: selectedMenu.venueId, windowId: selectedMenu.windowId, placeId: '', eventId: '' }); setTab('community'); }}>到校园食味圈聊聊</Button></div>
      </>}
    </DialogContent></Dialog>
  </>;
}
