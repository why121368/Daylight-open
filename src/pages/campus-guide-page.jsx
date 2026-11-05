import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Compass, LoaderCircle, Map, MessageSquare, Settings2, Share2, Sun, UserRound, Utensils } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthUser } from '@/lib/auth-session';
import { guideRequest, emptyProfile } from '@/lib/campus-guide-client';
import { BrandMark } from '@/components/brand-mark';
import { PublicThemeControls } from '@/components/public-theme-controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CampusAssistant } from '@/components/campus-guide/campus-assistant';
import { usableGps } from '../../shared/campus-navigation';
import { CampusMap } from '@/components/campus-guide/campus-map';
import { GuideContext } from '@/components/campus-guide/guide-context';
import { MapPanel, EventsPanel, EventDetails } from '@/components/campus-guide/guide-panels';
import { FoodPanel } from '@/components/campus-guide/food-panel';
import { PersonalPanel, DayPanel } from '@/components/campus-guide/personal-panel';
import { CommunityPanel } from '@/components/campus-guide/community-panel';
import { MaintenancePanel } from '@/components/campus-guide/maintenance-panel';
import { ShareButton } from '@/components/campus-guide/share-dialog';
import { TimeMachine } from '@/components/campus-guide/time-machine';
import { cn } from '@/lib/utils';
import { dailyItems, distanceBetween, validatePersonal } from '../../shared/campus-guide';
import { filterCampusEvents, parseRouteEndpoint } from '../../shared/campus-guide-ui';

const GUEST_KEY = 'daylight-campus-visitor-v1';
function guestProfile() { try { return { ...emptyProfile(), ...JSON.parse(localStorage.getItem(GUEST_KEY) || '{}') }; } catch { return emptyProfile(); } }
const TABS = [{ id: 'map', title: '地图', icon: Map }, { id: 'day', title: '日程', icon: CalendarDays }, { id: 'events', title: '活动', icon: Compass }, { id: 'food', title: '美食', icon: Utensils }, { id: 'community', title: '交流', icon: MessageSquare }, { id: 'me', title: '我的', icon: UserRound }];

export default function CampusGuidePage() {
  const { user, loading: authLoading, isAdmin } = useAuthUser();
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState(null);
  const [profile, setProfile] = useState(null);
  const [schoolState, setSchoolState] = useState(null), [schoolError, setSchoolError] = useState('');
  const [profileOwner, setProfileOwner] = useState('');
  const [queues, setQueues] = useState({ reports: [] });
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [route, setRoute] = useState(null);
  const routeRequest = useRef(0);
  const [routeForm, setRouteForm] = useState({ from: '', to: '', avoidRain: false, accessible: false, mode: 'ground' });
  const updateRouteForm = useCallback(next => { routeRequest.current += 1; setRouteForm(next); setRoute(null); }, []);
  const [mapPoint, setMapPoint] = useState(null), [gpsPosition, setGpsPosition] = useState(null), [navigationStatus, setNavigationStatus] = useState('');
  const [eventFilters, setEventFilters] = useState({ range: 'week', category: '', query: '', placeId: '', sourceKind: '' });
  const [communityFilter, setCommunityFilter] = useState({ board: '', placeId: '', eventId: '', venueId: '', windowId: '' });
  const [mapScope, setMapScope] = useState('all'), [mapDate, setMapDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
  const [minuteClock, setMinuteClock] = useState(Date.now());
  const lastGpsPlan = useRef({ at: 0, point: null, running: false });
  const sharedRouteLoaded = useRef(false);
  const routeState = useRef({}); routeState.current = { routeForm, route, catalog };
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [playback, setPlayback] = useState(null);
  const identity = useRef(user?.id || 'guest');
  identity.current = user?.id || 'guest';
  const currentProfile = profileOwner === identity.current ? profile : null;
  const schoolCalendar = schoolState?.owner === identity.current ? schoolState.data : null;
  const planningProfile = useMemo(() => currentProfile ? { ...currentProfile, schedule: [...currentProfile.schedule.filter(item => !schoolCalendar?.items.some(mail => item.id === `mail-${mail.mailboxId}-${mail.sourceEventId}`)), ...(schoolCalendar?.items || [])] } : null, [currentProfile, schoolCalendar]);
  const refreshSchoolCalendar = useCallback(async () => {
    if (!user) return; const owner = user.id;
    try { const data = await guideRequest('/school-calendar'); if (identity.current === owner) { setSchoolState({ owner, data }); setSchoolError(''); } return data; }
    catch (error) { if (identity.current === owner) setSchoolError(error.message); throw error; }
  }, [user?.id]);
  useEffect(() => {
    setSchoolState(null); setSchoolError(''); if (authLoading || !user) return;
    let active = true; const refresh = () => active && refreshSchoolCalendar().catch(() => {}); refresh();
    const timer = setInterval(refresh, 60000); window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [user?.id, authLoading, refreshSchoolCalendar]);
  const selectedPlaceId = params.get('place') || '';
  const selectedRoomId = params.get('room') || '';
  const tab = (isAdmin ? [...TABS, { id: 'admin' }] : TABS).some(item => item.id === params.get('tab')) ? params.get('tab') : 'map';
  const setTab = useCallback(next => setParams(previous => { const copy = new URLSearchParams(previous); copy.set('tab', next); return copy; }, { replace: true }), [setParams]);
  const selectPlace = useCallback(id => setParams(previous => { const copy = new URLSearchParams(previous); if (copy.get('place') !== id) copy.delete('room'); if (id) copy.set('place', id); else copy.delete('place'); return copy; }, { replace: true }), [setParams]);
  const selectRoom = useCallback(id => setParams(previous => { const copy = new URLSearchParams(previous); if (id) copy.set('room', id); else copy.delete('room'); return copy; }, { replace: true }), [setParams]);
  const run = useCallback(async (label, fn) => { setBusy(label); try { return await fn(); } catch (error) { toast.error(error.message || '操作失败，请重试'); return null; } finally { setBusy(''); } }, []);
  const reload = useCallback(async () => {
    const [data, queueData] = await Promise.all([guideRequest('/catalog'), guideRequest('/queues')]);
    setCatalog(data); setQueues(queueData); setLoadError(''); return data;
  }, []);
  useEffect(() => { let active = true; reload().catch(error => active && setLoadError(error.message)); return () => { active = false; }; }, [reload]);
  useEffect(() => {
    if (authLoading) return;
    routeRequest.current += 1;
    setRoute(null); setRouteForm({ from: '', to: '', avoidRain: false, accessible: false, mode: 'ground' });
    setMapPoint(null); setGpsPosition(null); setNavigationStatus('');
    lastGpsPlan.current = { at: 0, point: null, running: false };
    sharedRouteLoaded.current = false;
    let active = true; setProfile(null); setProfileOwner('');
    if (user) guideRequest('/me').then(data => { if (active) { setProfile({ ...emptyProfile(), ...data }); setProfileOwner(user.id); } }).catch(error => active && toast.error(error.message));
    else { setProfile(guestProfile()); setProfileOwner('guest'); }
    return () => { active = false; };
  }, [user?.id, authLoading]);
  useEffect(() => {
    const timer = setInterval(() => guideRequest('/queues').then(setQueues).catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { const timer = setInterval(() => setMinuteClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (catalog && params.get('event')) setSelectedEvent(catalog.events.find(event => event.id === params.get('event')) || null); }, [catalog, params.get('event')]);
  useEffect(() => {
    if (authLoading || !catalog || sharedRouteLoaded.current) return;
    sharedRouteLoaded.current = true;
    const from = parseRouteEndpoint(params.get('from')), to = parseRouteEndpoint(params.get('to'));
    if (!to) return;
    const form = { from, to, mode: 'ground', avoidRain: params.get('rain') === '1', accessible: params.get('accessible') === '1' };
    setRouteForm(form);
    if (from) {
      const owner = identity.current, request = ++routeRequest.current;
      run('读取分享路线', async () => { const result = await guideRequest('/navigation', 'POST', form); if (owner === identity.current && request === routeRequest.current) setRoute(result); });
    }
  }, [catalog, params, run, authLoading, user?.id]);
  const saveProfile = useCallback(async patch => {
    if (!profile || profileOwner !== identity.current) throw new Error('个人资料仍在加载，请稍后重试。');
    const owner = identity.current;
    const next = { ...validatePersonal({ ...profile, ...patch }, catalog, profile), revision: profile.revision };
    if (user) {
      let saved;
      try { saved = await guideRequest('/me', 'PUT', next); }
      catch (error) { if (/版本|revision|其他设备|更新后/.test(error.message)) { const latest = await guideRequest('/me'); if (identity.current === owner) setProfile({ ...emptyProfile(), ...latest }); } throw error; }
      if (identity.current === owner) setProfile({ ...emptyProfile(), ...saved });
      return saved;
    }
    localStorage.setItem(GUEST_KEY, JSON.stringify(next)); setProfile(next); return next;
  }, [profile, profileOwner, user, catalog]);
  const refreshProfile = useCallback(async () => { const owner = identity.current; if (!user) return; const data = await guideRequest('/me'); if (identity.current === owner) setProfile({ ...emptyProfile(), ...data }); return data; }, [user]);
  const startRoute = useCallback(async (destination, origin) => {
    const owner = identity.current, request = ++routeRequest.current;
    const next = { ...routeForm, to: destination || routeForm.to, mode: 'ground', from: origin || (usableGps(gpsPosition) ? { ...gpsPosition, name: '我的实时位置', source: 'gps' } : routeForm.from || currentProfile?.homePlaceId || '') };
    setRouteForm(next); setTab('map');
    if (!next.to) { toast.message('请选择起点和终点。'); return; }
    return run('规划步行路线', async () => { const data = await guideRequest('/navigation', 'POST', next); if (owner === identity.current && request === routeRequest.current) setRoute(data); return data; });
  }, [routeForm, currentProfile, gpsPosition, run, setTab]);
  const handleLocation = useCallback(async point => {
    setGpsPosition(point);
    if (!usableGps(point)) {
      routeRequest.current += 1;
      if (routeState.current.routeForm.from?.source === 'gps') { setRouteForm(previous => ({ ...previous, from: '' })); setRoute(null); }
      setNavigationStatus(point ? '定位精度不足，请到开阔处重试；可手动选择起点。' : '定位已关闭。'); return;
    }
    const { routeForm: form, route: planned, catalog: data } = routeState.current;
    if (form.from?.source !== 'gps' || !form.to || !planned || planned.externalOnly || !data) return;
    const target = typeof form.to === 'string' ? data.places.find(place => place.id === form.to) : form.to;
    if (target && distanceBetween(point, target) <= Math.max(20, Math.min(point.accuracy || 0, 40))) { setNavigationStatus('接近目的地，请核对入口和现场标识。'); return; }
    const last = lastGpsPlan.current, instant = Date.now();
    if (last.running || instant - last.at < 10000 || (last.point && distanceBetween(last.point, point) < Math.max(25, point.accuracy || 0))) return;
    lastGpsPlan.current = { running: true, at: instant, point };
    const owner = identity.current, request = ++routeRequest.current;
    try {
      const next = { ...form, from: { ...point, name: '我的实时位置', source: 'gps' } }, result = await guideRequest('/navigation', 'POST', next);
      if (owner === identity.current && request === routeRequest.current && routeState.current.routeForm.from?.source === 'gps') { setRouteForm(next); setRoute(result); setNavigationStatus('已按更新的位置重新规划，接入路网前请自行核对安全通路。'); }
    } catch (error) { if (owner === identity.current && request === routeRequest.current) setNavigationStatus(`定位已更新，路线未更新：${error.message}`); }
    finally { if (owner === identity.current) lastGpsPlan.current.running = false; }
  }, []);
  const visibleEvents = useMemo(() => catalog ? filterCampusEvents(catalog.events, eventFilters, minuteClock) : [], [catalog, eventFilters, minuteClock]);
  const mapCatalog = useMemo(() => {
    if (!catalog || mapScope === 'all' || !currentProfile) return catalog;
    const ids = new Set([...currentProfile.favorites, currentProfile.homePlaceId, currentProfile.labPlaceId]);
    for (let day = 0; day < (mapScope === 'week' ? 7 : 1); day++) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.parse(`${mapDate}T12:00:00+08:00`) + day * 86400000));
      for (const item of dailyItems(catalog, planningProfile, date)) if (item.placeId) ids.add(item.placeId);
    }
    if (selectedPlaceId) ids.add(selectedPlaceId);
    return { ...catalog, places: catalog.places.filter(place => ids.has(place.id)) };
  }, [catalog, mapScope, mapDate, currentProfile, planningProfile, selectedPlaceId]);
  const selectedPlace = catalog?.places.find(item => item.id === selectedPlaceId);
  const context = { schoolCalendar, schoolError, refreshSchoolCalendar, planningProfile, catalog, profile: currentProfile, user, isAdmin, saveProfile, refreshProfile, queues, setQueues, busy, run, reload, setCatalog, selectPlace, selectedPlaceId, selectedPlace, selectedRoomId, selectRoom, selectedEvent, setSelectedEvent, setTab, route, setRoute, routeForm, setRouteForm: updateRouteForm, startRoute, mapPoint, setMapPoint, gpsPosition, navigationStatus, eventFilters, setEventFilters, visibleEvents, mapScope, setMapScope, mapDate, setMapDate, minuteClock, communityFilter, setCommunityFilter };
  const shareUrl = `${window.location.origin}/campus${window.location.search}`;

  return <GuideContext.Provider value={context}>
    <div className="flex min-h-svh flex-col bg-background text-foreground lg:h-svh lg:overflow-hidden">
      <header className="z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5"><BrandMark className="size-8 shrink-0" /><span className="min-w-0"><strong className="block whitespace-nowrap text-base leading-tight">Daylight <span className="hidden font-normal text-muted-foreground sm:inline">校园生活</span></strong><span className="block text-[10px] tracking-wide text-muted-foreground sm:hidden">校园生活</span><span className="hidden text-[11px] tracking-wide text-muted-foreground sm:block">找到去处，把一天安排好</span></span></Link>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <PublicThemeControls className="hidden sm:flex" />
          <Popover><PopoverTrigger asChild><Button className="sm:hidden" size="icon" variant="ghost" aria-label="主题和语言"><Settings2 className="size-4" /></Button></PopoverTrigger><PopoverContent align="end" className="w-auto p-2"><PublicThemeControls /></PopoverContent></Popover>
          <ShareButton url={shareUrl} title="Daylight 校园生活" size="sm" variant="outline" aria-label="扫码分享校园页面"><Share2 className="size-4" /><span className="hidden sm:inline">扫码分享</span></ShareButton>
          <Button asChild size="sm" variant="ghost"><Link to={user ? '/app' : '/login'} state={{ from: { pathname: '/campus', search: window.location.search } }}>{user ? '工作区' : '登录'}</Link></Button>
        </div>
      </header>
      {loadError ? <div className="m-auto max-w-lg space-y-4 p-6"><h1 className="text-xl font-semibold">校园资料暂时无法读取</h1><p className="text-sm text-muted-foreground">{loadError}</p><Button onClick={() => reload().catch(error => setLoadError(error.message))}>重新连接</Button><Button asChild variant="ghost"><Link to="/">返回首页</Link></Button></div> : !catalog ? <div className="m-auto flex items-center gap-3 p-8"><LoaderCircle className="size-5 animate-spin" />正在打开校园地图…</div> : <>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav className="z-20 flex shrink-0 gap-1 overflow-x-auto border-b bg-background p-2 lg:w-20 lg:flex-col lg:items-center lg:overflow-x-hidden lg:border-r lg:border-b-0 lg:py-5" aria-label="校园功能">
            {[...TABS, ...(isAdmin ? [{ id: 'admin', title: '维护', icon: Settings2 }] : [])].map(item => <Button key={item.id} variant={tab === item.id ? 'secondary' : 'ghost'} className={cn('h-12 shrink-0 gap-1.5 px-3 text-xs lg:h-16 lg:w-16 lg:flex-col', tab === item.id && 'bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100')} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><item.icon className="size-4 lg:size-5" />{item.title}</Button>)}
          </nav>
          <section className={cn('relative isolate z-0 min-w-0 shrink-0 border-b lg:flex-1 lg:border-r lg:border-b-0', tab === 'map' ? 'h-[42svh] min-h-72 lg:h-auto' : tab === 'events' ? 'h-auto' : 'h-56 lg:h-auto')} aria-label="校园地图">
            <div className={cn('relative', tab === 'events' ? 'h-56 lg:h-full' : 'h-full')}>
            <CampusMap key={user?.id || 'guest'} catalog={mapCatalog} selectedPlaceId={selectedPlaceId || playback?.placeId} onSelectPlace={selectPlace} route={route} eventMarkers={tab === 'events' ? (playback ? playback.activeEvents : visibleEvents) : []} followPlaceId={playback?.placeId} mode={routeForm.mode} onRouteEndpoint={point => { setMapPoint(point); setTab('map'); }} onLocation={point => { if (identity.current === (user?.id || 'guest')) handleLocation(point); }} />
            {playback?.night && <div className="pointer-events-none absolute inset-0 z-[420] bg-slate-950/25" aria-hidden="true" />}
            <div className="pointer-events-none absolute top-3 left-3 z-[500] flex max-w-[calc(100%-7rem)] flex-wrap gap-2">
              <Badge className="bg-background/95 text-foreground shadow-sm">{catalog.meta.title || '校园导览'}</Badge>
              {catalog.meta.isDemo && <Badge variant="outline" className="bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">示例目录 · 非实景导航</Badge>}
            </div>
            </div>
            {tab === 'events' && <div className="relative z-[500] p-3 pt-0 lg:absolute lg:right-3 lg:bottom-7 lg:left-3 lg:max-h-[calc(100%-4rem)] lg:overflow-y-auto lg:rounded-xl lg:p-0"><TimeMachine catalog={catalog} onFrame={setPlayback} /></div>}
          </section>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background pb-8 lg:w-[440px] lg:max-w-[46vw] lg:flex-none xl:w-[490px]" id="campus-panel">
            <div className="space-y-5 p-4 sm:p-6">
              {catalog.meta.notice && <Alert className="border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"><Sun className="size-4" /><AlertDescription className="text-xs leading-relaxed">{catalog.meta.notice}</AlertDescription></Alert>}
              {tab === 'map' && <MapPanel />}{tab === 'day' && <DayPanel key={user?.id || 'guest'} />}{tab === 'events' && <EventsPanel />}{tab === 'food' && <FoodPanel key={user?.id || 'guest'} />}{tab === 'community' && <CommunityPanel key={user?.id || 'guest'} />}{tab === 'me' && <PersonalPanel key={user?.id || 'guest'} />}{tab === 'admin' && isAdmin && <MaintenancePanel key={user.id} />}
              <footer className="border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">{catalog.meta.dataSource} · 北京时间<br />目录更新 {catalog.meta.updatedAt ? new Date(catalog.meta.updatedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '待维护'} · <button className="underline underline-offset-2" onClick={() => setTab('map')}>查看地点与反馈</button></footer>
            </div>
          </main>
        </div>
        <EventDetails />
        <CampusAssistant key={user?.id || 'guest'} />
      </>}
      {busy && <div role="status" className="fixed right-4 bottom-4 z-[1200] flex items-center gap-2 rounded-xl border bg-background px-4 py-3 text-sm shadow-lg"><LoaderCircle className="size-4 animate-spin" />{busy}…</div>}
    </div>
  </GuideContext.Provider>;
}
