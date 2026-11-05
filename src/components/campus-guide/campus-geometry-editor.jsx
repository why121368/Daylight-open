import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, MapPin, MousePointer2, Plus, Redo2, Route, Save, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { guideRequest } from '@/lib/campus-guide-client';
import { geometryBounds, geometryProjection } from '../../../shared/campus-geometry';
import { distanceBetween, validateCatalog } from '../../../shared/campus-guide';
import { insertRoadWithIntersections, snapEntranceToWall } from '../../../shared/campus-geometry-actions';
import { CampusGeometryTools } from './campus-geometry-tools';
import { useGuide } from './guide-context';
import { discardGeometryDraft, geometryDraftKey, geometryDraftSnapshot, readGeometryDrafts, restoreGeometryDraft, writeGeometryDraft } from '../../../shared/campus-geometry-draft';

const clone = value => structuredClone(value);
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const selectClass = 'h-9 min-w-0 rounded-md border bg-background px-2 text-sm';
const nodeKinds = { junction: '路口', entrance: '入口', stairs: '楼梯', elevator: '电梯', ramp: '坡道', crossing: '人行横道' };
const edgeKinds = { walkway: '步行路', vehicle: '车行路', stairs: '楼梯', elevator: '电梯', ramp: '坡道', crossing: '人行横道', connector: '接驳段' };
const initialHistory = catalog => ({ past: [], present: clone(catalog), future: [], base: clone(catalog) });
const draftTime = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '时间未知';
const geometrySignature = catalog => { try { return JSON.stringify(geometryDraftSnapshot(validateCatalog(catalog))); } catch { return JSON.stringify(geometryDraftSnapshot(catalog)); } };

/** All map edits stay in a local draft until the explicit CAS-protected publish action. */
export function CampusGeometryEditor({ catalog, onCatalogChange, busy = false }) {
  const { user, isAdmin } = useGuide() || {};
  if (!isAdmin || !user?.id) return <p className="text-sm text-muted-foreground">请以管理员账号登录后编辑地图。</p>;
  return <CampusGeometryEditorSession key={user.id} ownerId={user.id} catalog={catalog} onCatalogChange={onCatalogChange} busy={busy} />;
}

function CampusGeometryEditorSession({ ownerId, catalog, onCatalogChange, busy }) {
  const [history, setHistory] = useState(() => initialHistory(catalog));
  const [mode, setMode] = useState('select'), [placeId, setPlaceId] = useState(catalog.places[0]?.id || ''), [nodeId, setNodeId] = useState(''), [edgeId, setEdgeId] = useState(''), [polygonId, setPolygonId] = useState(''), [polygonPoints, setPolygonPoints] = useState([]), [roadStart, setRoadStart] = useState(''), [entranceName, setEntranceName] = useState('入口'), [kind, setKind] = useState('walkway'), [covered, setCovered] = useState(false), [level, setLevel] = useState('ground'), [saving, setSaving] = useState(false), [drag, setDrag] = useState(null), [pointer, setPointer] = useState(null);
  const [autoJunction, setAutoJunction] = useState(true), [wallSnap, setWallSnap] = useState(true), [wallThreshold, setWallThreshold] = useState('15'), [entranceKind, setEntranceKind] = useState('main'), [entranceAccessible, setEntranceAccessible] = useState(true);
  const [savedDrafts, setSavedDrafts] = useState([]), [localError, setLocalError] = useState(''), [confirmation, setConfirmation] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refreshLocalDrafts = useCallback(() => {
    try { setSavedDrafts(readGeometryDrafts(window.localStorage, ownerId)); setLocalError(''); }
    catch (error) { setSavedDrafts([]); setLocalError(error.message || '无法读取本机草稿，请导出文件留存。'); }
  }, [ownerId]);
  useEffect(() => { refreshLocalDrafts(); }, [refreshLocalDrafts, catalog.meta.revision]);
  useEffect(() => {
    const prefix = geometryDraftKey(ownerId, 0).slice(0, -1), changed = event => { if (event.key === null || event.key?.startsWith(prefix)) refreshLocalDrafts(); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [ownerId, refreshLocalDrafts]);
  const currentSignature = useMemo(() => geometrySignature(history.present), [history.present]), baseSignature = useMemo(() => geometrySignature(history.base), [history.base]);
  const dirty = currentSignature !== baseSignature, versionConflict = history.base.meta.revision !== catalog.meta.revision;
  const matchingDraft = savedDrafts.find(record => record.baseRevision === catalog.meta.revision), oldDrafts = savedDrafts.filter(record => record.baseRevision !== catalog.meta.revision);
  const savedCurrent = savedDrafts.find(record => record.baseRevision === history.base.meta.revision)?.document;
  const locallySaved = Boolean(savedCurrent && JSON.stringify(savedCurrent.geometry) === currentSignature);
  useEffect(() => {
    if (versionConflict && !dirty && !polygonPoints.length && !roadStart && !drag) { setHistory(initialHistory(catalog)); setNodeId(''); setEdgeId(''); setPolygonId(''); }
  }, [catalog, versionConflict, dirty, polygonPoints.length, roadStart, drag]);
  useEffect(() => {
    if (!(dirty && !locallySaved) && !polygonPoints.length) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, locallySaved, polygonPoints.length]);
  const draft = history.present, selectedPlace = draft.places.find(place => place.id === placeId), selectedNode = draft.nodes.find(node => node.id === nodeId), selectedEdge = draft.edges.find(edge => edge.id === edgeId), selectedPolygon = selectedPlace?.polygons?.find(polygon => polygon.id === polygonId);
  const projection = useMemo(() => geometryProjection(geometryBounds(history.base)), [history.base]);
  const nodeMap = useMemo(() => new Map(draft.nodes.map(node => [node.id, node])), [draft.nodes]);
  const edit = change => { if (saving || busy || versionConflict) return; setHistory(previous => { const next = clone(previous.present); change(next); return { ...previous, past: [...previous.past.slice(-29), previous.present], present: next, future: [] }; }); };
  const undo = () => setHistory(previous => !previous.past.length ? previous : ({ ...previous, past: previous.past.slice(0, -1), present: previous.past.at(-1), future: [previous.present, ...previous.future] }));
  const redo = () => setHistory(previous => !previous.future.length ? previous : ({ ...previous, past: [...previous.past, previous.present], present: previous.future[0], future: previous.future.slice(1) }));
  const eventPoint = event => { const svg = event.currentTarget.ownerSVGElement || event.currentTarget, rect = svg.getBoundingClientRect(); return projection.unproject({ x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 600 }); };
  const addRoad = target => {
    if (saving || busy || versionConflict) return;
    if (!roadStart) { setRoadStart(target); setNodeId(target); return; }
    if (target === roadStart) return toast.error('请选择不同的终点节点。');
    const from = nodeMap.get(roadStart), to = nodeMap.get(target);
    if (!from || !to) { setRoadStart(''); return toast.error('所选节点已改变，请重新选择道路起终点。'); }
    const edge = { id: uid('road'), from: from.id, to: to.id, distanceMeters: Math.max(1, Math.round(distanceBetween(from, to))), covered, accessible: kind !== 'stairs', bidirectional: true, walkable: kind !== 'vehicle', closed: false, kind, level, description: '管理员绘制草稿；请按现场道路复测长度与通行情况。', isDemo: false };
    try {
      if (autoJunction) { const result = insertRoadWithIntersections(draft, edge); edit(next => Object.assign(next, result.catalog)); setEdgeId(result.edgeIds[0]); toast.success(`道路已加入草稿，新增 ${result.junctionsAdded} 个路口、切分 ${result.edgesSplit} 条道路`); }
      else { edit(next => next.edges.push(edge)); setEdgeId(edge.id); }
      setNodeId(target); setRoadStart('');
    } catch (error) { toast.error(error.message); }
  };
  const canvasClick = event => {
    if (saving || busy || versionConflict) return;
    if (event.target !== event.currentTarget && event.target.dataset?.canvas !== 'true') return;
    const point = eventPoint(event);
    if (mode === 'polygon') { if (!selectedPlace) return toast.error('先选择一处建筑。'); setPolygonPoints(previous => [...previous, point]); }
    if (mode === 'entrance') { if (!selectedPlace) return toast.error('先选择入口所属地点。'); let position = point; if (wallSnap) { try { const snapped = snapEntranceToWall(selectedPlace, point, { maxMeters: Number(wallThreshold) }); position = snapped.point; if (snapped.snapped) toast.message(`已投影到轮廓墙边，移动 ${snapped.distanceMeters.toFixed(1)} 米`); else toast.message(`${snapped.reason} 已保留点击位置。`); } catch (error) { return toast.error(error.message); } } const entrance = { id: uid('entrance'), name: entranceName.trim() || '入口', ...position, nodeId, accessible: entranceKind === 'accessible' || entranceAccessible, kind: entranceKind }; edit(next => { const place = next.places.find(row => row.id === placeId); place.entrances ||= []; place.entrances.push(entrance); }); }
    if (mode === 'node') { const node = { id: uid('node'), ...point, level, kind: 'junction', isDemo: false }; edit(next => next.nodes.push(node)); setNodeId(node.id); }
  };
  const finishPolygon = () => { if (!selectedPlace || polygonPoints.length < 3) return toast.error('轮廓至少需要三个顶点。'); const polygon = { id: uid('building'), points: polygonPoints }; edit(next => { const place = next.places.find(row => row.id === placeId); place.polygons ||= []; place.polygons.push(polygon); }); setPolygonId(polygon.id); setPolygonPoints([]); setMode('select'); };
  const endDrag = event => {
    if (!drag || saving || busy || versionConflict) { setDrag(null); setPointer(null); return; } const point = eventPoint(event);
    edit(next => { if (drag.type === 'node') Object.assign(next.nodes.find(node => node.id === drag.id), point); if (drag.type === 'polygon') Object.assign(next.places.find(place => place.id === drag.placeId).polygons.find(polygon => polygon.id === drag.id).points[drag.index], point); }); setDrag(null); setPointer(null);
  };
  const exportData = (data, filename) => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const exportDraft = () => exportData(draft, 'daylight-campus-map-draft.json');
  const saveLocal = () => {
    if (saving || busy || drag || polygonPoints.length) return;
    try { writeGeometryDraft(window.localStorage, ownerId, history.base, draft); refreshLocalDrafts(); toast.success('地图几何草稿已保存到当前浏览器，尚未发布'); }
    catch (error) { setLocalError(error.message || '本机保存失败，请导出草稿文件留存。'); toast.error(error.message || '本机保存失败'); }
  };
  const performConfirmation = () => {
    if (!confirmation || saving || busy) return;
    try {
      if (confirmation.kind === 'restore') { const restored = restoreGeometryDraft(confirmation.record.document, ownerId, catalog); setHistory({ ...initialHistory(catalog), past: [clone(catalog)], present: restored }); }
      if (confirmation.kind === 'discard') { discardGeometryDraft(window.localStorage, ownerId, confirmation.record.baseRevision); refreshLocalDrafts(); }
      if (confirmation.kind === 'latest') setHistory(initialHistory(catalog));
      if (confirmation.kind !== 'discard') { setPolygonPoints([]); setRoadStart(''); setNodeId(''); setEdgeId(''); setPolygonId(''); setDrag(null); setPointer(null); setPlaceId(catalog.places[0]?.id || ''); }
      if (confirmation.kind === 'restore') toast.success('已恢复本机草稿，可继续修改或撤销；尚未发布');
      if (confirmation.kind === 'discard') toast.success('已丢弃这份本机记录，本页编辑和公共目录保留');
      setConfirmation(null);
    } catch (error) { setLocalError(error.message || '草稿操作失败，请导出文件留存。'); toast.error(error.message || '草稿操作失败'); }
  };
  const save = async () => {
    if (saving || busy || drag || versionConflict) return;
    try {
      setSaving(true);
      const geometry = geometryDraftSnapshot(validateCatalog(draft)), latest = await guideRequest('/admin/catalog');
      if (!mounted.current) return;
      if (latest.meta.revision !== history.base.meta.revision) { onCatalogChange?.(latest); throw new Error('公共目录版本已改变，草稿仍保留；请先保存本机或导出，再载入最新目录重新核对。'); }
      // Refresh non-geometric administrator data before writing the geometry so
      // the initial anonymous projection can never erase hidden events/notes.
      const checked = restoreGeometryDraft({ schemaVersion: 1, ownerId, baseRevision: history.base.meta.revision, savedAt: new Date().toISOString(), geometry }, ownerId, latest), next = await guideRequest('/admin/catalog', 'PUT', checked);
      if (!mounted.current) return;
      setHistory(initialHistory(next)); onCatalogChange?.(next);
      try { discardGeometryDraft(window.localStorage, ownerId, history.base.meta.revision); refreshLocalDrafts(); }
      catch { setLocalError('公共目录已保存，但本机草稿未能清理；可稍后手动丢弃旧记录。'); }
      toast.success('地图修改已保存到公共目录');
    } catch (error) { if (mounted.current) toast.error(error.message || '保存失败，请刷新目录后重试。'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const editNode = patch => edit(next => Object.assign(next.nodes.find(node => node.id === nodeId), patch));
  const editEdge = patch => edit(next => Object.assign(next.edges.find(edge => edge.id === edgeId), patch));
  return <section className="space-y-4">
    <div className="space-y-3 rounded-xl border p-3" aria-label="本机地图草稿">
      <div className="space-y-1"><p className="text-sm font-medium">本机地图草稿 · 基于公共目录修订 {history.base.meta.revision}</p><p className="text-xs leading-relaxed text-muted-foreground">点击“保存本机草稿”后可刷新续编，仅在当前浏览器按账号和目录版本保留地图几何；不跨设备，也未保存到服务器。未完成的轮廓点需先完成或取消。本机记录不加密，共用设备请用后丢弃。</p></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!dirty || saving || busy || Boolean(drag) || polygonPoints.length > 0} onClick={saveLocal}><Save className="size-3.5" />保存本机草稿</Button><Button size="sm" variant="outline" disabled={saving || busy} onClick={exportDraft}><Download className="size-3.5" />导出当前草稿</Button></div>
      <p className="text-xs text-muted-foreground" role="status">{polygonPoints.length ? '轮廓尚未完成，这些顶点尚未保存在本机。' : dirty ? locallySaved ? `当前几何修改已保存在本机（北京时间 ${draftTime(savedCurrent.savedAt)}），尚未发布。` : '当前修改尚未保存在本机或公共目录；刷新前请保存本机草稿或导出。' : '本页没有待发布的地图修改。'}</p>
      {localError && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs leading-relaxed text-destructive">{localError}</p>}
      {matchingDraft && <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs"><p>{matchingDraft.error || `发现当前账号基于修订 ${matchingDraft.baseRevision} 的本机草稿，保存于北京时间 ${draftTime(matchingDraft.savedAt)}。恢复会替换本页编辑，公共目录保持当前版本。`}</p><div className="flex flex-wrap gap-2">{matchingDraft.document && <Button size="sm" variant="outline" disabled={saving || busy} onClick={() => setConfirmation({ kind: 'restore', record: matchingDraft })}>恢复本机草稿继续编辑</Button>}<Button size="sm" variant="ghost" disabled={saving || busy} onClick={() => setConfirmation({ kind: 'discard', record: matchingDraft })}>丢弃本机草稿</Button></div></div>}
      {oldDrafts.length > 0 && <details className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-medium">其他目录版本的本机草稿（{oldDrafts.length}）</summary><p className="mt-2 leading-relaxed text-muted-foreground">这些记录与当前公共目录版本不同，只能导出或丢弃，不能直接恢复覆盖。</p><div className="mt-3 space-y-3">{oldDrafts.map(record => <div key={record.key} className="space-y-2 border-t pt-2"><p>修订 {record.baseRevision} · {record.error || `北京时间 ${draftTime(record.savedAt)}`}</p><div className="flex flex-wrap gap-2">{record.document && <Button size="sm" variant="outline" onClick={() => exportData(record.document, `daylight-campus-map-geometry-r${record.baseRevision}.json`)}>导出旧版几何草稿</Button>}<Button size="sm" variant="ghost" disabled={saving || busy} onClick={() => setConfirmation({ kind: 'discard', record })}>丢弃此版本</Button></div></div>)}</div></details>}
    </div>
    {versionConflict && <div role="alert" className="space-y-3 rounded-xl border border-amber-400/60 bg-amber-50/50 p-3 text-xs dark:bg-amber-950/20"><p className="leading-relaxed">公共目录已更新到修订 {catalog.meta.revision}，本页草稿仍基于修订 {history.base.meta.revision}。已暂停编辑和发布，草稿保留；请先保存本机或导出，再载入最新版并重新核对修改。</p><Button size="sm" variant="outline" disabled={saving || busy} onClick={() => setConfirmation({ kind: 'latest' })}>载入最新公共目录</Button></div>}
    <fieldset disabled={saving || busy || versionConflict} className="min-w-0 space-y-4">
    <div className="space-y-1"><h2 className="text-base font-semibold">地图可视维护</h2><p className="text-sm text-muted-foreground">选择建筑绘制轮廓与入口，或编辑道路节点和连线。图中位置由目录坐标投影，全部修改先保留为本页草稿。</p></div>
    <div className="flex flex-wrap gap-2">{[['select', MousePointer2, '选择 / 拖动'], ['polygon', Plus, '画建筑轮廓'], ['entrance', MapPin, '添加入口'], ['node', Plus, '添加路网节点'], ['road', Route, '连接道路']].map(([value, Icon, label]) => <Button key={value} size="sm" variant={mode === value ? 'default' : 'outline'} onClick={() => { setMode(value); setRoadStart(''); }}><Icon className="size-3.5" />{label}</Button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-xs">建筑 / 地点<select aria-label="编辑建筑" className={selectClass} value={placeId} onChange={event => { setPlaceId(event.target.value); setPolygonId(''); }}><option value="">选择地点</option>{draft.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label><label className="grid min-w-0 gap-1 text-xs">入口关联 / 当前道路节点<select aria-label="编辑道路节点" className={selectClass} value={nodeId} onChange={event => setNodeId(event.target.value)}><option value="">尚不关联</option>{draft.nodes.map(node => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label></div>
    {mode === 'polygon' && <div className="flex flex-wrap items-center gap-2 text-xs"><span>在画布依次点选轮廓顶点 · 已选 {polygonPoints.length} 点</span><Button size="sm" onClick={finishPolygon} disabled={polygonPoints.length < 3}>完成轮廓</Button><Button size="sm" variant="ghost" onClick={() => setPolygonPoints(points => points.slice(0, -1))}>撤回顶点</Button><Button size="sm" variant="ghost" onClick={() => setPolygonPoints([])}>取消绘制</Button></div>}
    {mode === 'entrance' && <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><Input aria-label="入口名称" value={entranceName} onChange={event => setEntranceName(event.target.value)} placeholder="入口名称" /><select className={selectClass} aria-label="入口类型" value={entranceKind} onChange={event => setEntranceKind(event.target.value)}>{Object.entries({ main: '主入口', side: '侧门', accessible: '无障碍入口', service: '服务入口' }).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div><div className="flex flex-wrap items-center gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={wallSnap} onChange={event => setWallSnap(event.target.checked)} />投影吸附最近墙边</label><label className="flex items-center gap-1.5">阈值（米）<Input type="number" min="0" max="100" value={wallThreshold} onChange={event => setWallThreshold(event.target.value)} className="h-8 w-20" aria-label="入口墙边吸附阈值" /></label><label className="flex items-center gap-1.5"><input type="checkbox" checked={entranceAccessible} onChange={event => setEntranceAccessible(event.target.checked)} />无障碍入口</label></div><p className="text-xs text-muted-foreground">点击画布添加入口；无轮廓或超阈值时保留点击坐标并提示。路网关联使用上方明确选中的节点。</p></div>}
    {mode === 'road' && <label className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-xs"><input type="checkbox" checked={autoJunction} onChange={event => setAutoJunction(event.target.checked)} />同层交叉自动切分为路口（不同楼层不连接，需核对现场交通）</label>}
    {(mode === 'node' || mode === 'road') && <div className="flex flex-wrap items-center gap-3 text-xs"><select aria-label="绘制道路层级" className={selectClass} value={level} onChange={event => setLevel(event.target.value)}><option value="ground">地面</option><option value="underground">地下</option></select>{mode === 'road' && <><select aria-label="绘制道路类型" className={selectClass} value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(edgeKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="flex gap-1.5"><input type="checkbox" checked={covered} onChange={event => setCovered(event.target.checked)} />有遮蔽</label><span>{roadStart ? `已选起点 ${roadStart}，再点另一节点` : '依次点击两个路网节点'}</span></>}</div>}
    <div className="relative overflow-hidden rounded-xl border bg-slate-50 dark:bg-slate-950"><svg role="img" aria-label="校园地图维护画布" viewBox="0 0 1000 600" className="aspect-[5/3] w-full touch-none" style={{ pointerEvents: saving || busy || versionConflict ? 'none' : undefined }} onClick={canvasClick} onPointerMove={event => drag && setPointer(eventPoint(event))} onPointerUp={endDrag} onPointerCancel={() => { setDrag(null); setPointer(null); }}>
      <defs><pattern id="campus-editor-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth=".4" /></pattern></defs><rect data-canvas="true" width="1000" height="600" fill="url(#campus-editor-grid)" className="text-slate-300 dark:text-slate-700" />
      {draft.places.flatMap(place => (place.polygons || []).map(polygon => <polygon key={`${place.id}-${polygon.id}`} points={polygon.points.map(point => { const p = projection.project(point); return `${p.x},${p.y}`; }).join(' ')} fill={place.id === placeId ? '#60a5fa55' : '#94a3b844'} stroke={place.id === placeId ? '#2563eb' : '#64748b'} strokeWidth="2" onClick={event => { event.stopPropagation(); setPlaceId(place.id); setPolygonId(polygon.id); }} />))}
      {draft.edges.map(edge => { const from = nodeMap.get(edge.from), to = nodeMap.get(edge.to); if (!from || !to) return null; const a = projection.project(from), b = projection.project(to); return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.id === edgeId ? '#dc2626' : edge.closed ? '#cbd5e1' : edge.covered ? '#16a34a' : '#64748b'} strokeWidth={edge.id === edgeId ? 7 : 5} strokeDasharray={edge.level === 'underground' || edge.walkable === false ? '10 7' : undefined} onClick={event => { event.stopPropagation(); setEdgeId(edge.id); }}><title>{edge.id} · {edgeKinds[edge.kind] || '步行路'} · {Math.round(edge.distanceMeters)} 米</title></line>; })}
      {draft.places.map(place => { const point = projection.project(place); return <g key={place.id} onClick={event => { event.stopPropagation(); setPlaceId(place.id); }}><circle cx={point.x} cy={point.y} r="7" fill={place.id === placeId ? '#1d4ed8' : '#0f766e'} /><text x={point.x + 11} y={point.y - 10} fontSize="14" fill="currentColor">{place.name}</text></g>; })}
      {draft.places.flatMap(place => (place.entrances || []).map(entrance => { const point = projection.project(entrance); return <g key={`${place.id}-${entrance.id}`}><rect x={point.x - 5} y={point.y - 5} width="10" height="10" fill="#f59e0b" stroke="white" /><title>{entrance.name} · {entrance.nodeId || '尚未连接路网'}</title></g>; }))}
      {draft.nodes.map(node => { const point = projection.project(drag?.type === 'node' && drag.id === node.id && pointer ? pointer : node); return <circle key={node.id} data-node-id={node.id} cx={point.x} cy={point.y} r={node.id === nodeId || node.id === roadStart ? 8 : 5} fill={node.id === roadStart ? '#dc2626' : node.level === 'underground' ? '#9333ea' : '#2563eb'} stroke="white" strokeWidth="2" onClick={event => { event.stopPropagation(); mode === 'road' ? addRoad(node.id) : setNodeId(node.id); }} onPointerDown={event => { if (mode !== 'select' || saving || busy) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setNodeId(node.id); setDrag({ type: 'node', id: node.id }); }}><title>{node.id} · {nodeKinds[node.kind] || '路口'}</title></circle>; })}
      {selectedPolygon?.points.map((point, index) => { const position = projection.project(drag?.type === 'polygon' && drag.index === index && pointer ? pointer : point); return <circle key={index} cx={position.x} cy={position.y} r="7" fill="#f97316" stroke="white" strokeWidth="2" onPointerDown={event => { if (mode !== 'select' || saving || busy) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ type: 'polygon', id: selectedPolygon.id, placeId, index }); }}><title>轮廓顶点 {index + 1}，可拖动调整</title></circle>; })}
      {!!polygonPoints.length && <polyline points={polygonPoints.map(point => { const p = projection.project(point); return `${p.x},${p.y}`; }).join(' ')} fill="none" stroke="#f97316" strokeWidth="3" strokeDasharray="6 3" />}
    </svg><Badge className="absolute top-2 left-2" variant="secondary">{draft.meta.isDemo ? '自制校园示意图' : '目录坐标编辑'} · 未经现场核验请勿标为实测</Badge></div>
    {selectedPlace && <div className="space-y-2 rounded-lg border p-3"><p className="text-sm font-medium">{selectedPlace.name} · {selectedPlace.polygons?.length || 0} 处轮廓 / {selectedPlace.entrances?.length || 0} 个入口</p><div className="flex flex-wrap items-center gap-2"><select className={selectClass} aria-label="选择建筑轮廓" value={polygonId} onChange={event => setPolygonId(event.target.value)}><option value="">选择轮廓</option>{(selectedPlace.polygons || []).map((polygon, i) => <option key={polygon.id} value={polygon.id}>轮廓 {i + 1} · {polygon.points.length} 顶点</option>)}</select>{selectedPolygon && <Button variant="ghost" size="sm" onClick={() => { edit(next => { const place = next.places.find(p => p.id === placeId); place.polygons = place.polygons.filter(p => p.id !== polygonId); }); setPolygonId(''); }}><Trash2 className="size-3.5" />删除轮廓</Button>}<Button variant="outline" size="sm" disabled={!nodeId} onClick={() => edit(next => { next.places.find(place => place.id === placeId).nodeId = nodeId; })}>将地点关联到当前节点</Button></div>{(selectedPlace.entrances || []).map(entrance => <div key={entrance.id} className="flex items-center justify-between gap-2 text-xs"><span>{entrance.name} · {entrance.kind} · {entrance.nodeId || '未关联路网'}</span><Button size="icon-sm" variant="ghost" aria-label={`删除入口${entrance.name}`} onClick={() => edit(next => { const place = next.places.find(p => p.id === placeId); place.entrances = place.entrances.filter(item => item.id !== entrance.id); })}><Trash2 className="size-3.5" /></Button></div>)}</div>}
    {selectedNode && <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><p className="truncate text-xs sm:col-span-3">节点 {selectedNode.id}；拖动位置后，请重新核对相邻道路的实际长度。</p><label className="grid gap-1 text-xs">纬度<Input type="number" step="0.0000001" value={selectedNode.lat} onChange={event => event.target.value && editNode({ lat: Number(event.target.value) })} /></label><label className="grid gap-1 text-xs">经度<Input type="number" step="0.0000001" value={selectedNode.lng} onChange={event => event.target.value && editNode({ lng: Number(event.target.value) })} /></label><label className="grid gap-1 text-xs">类型<select className={selectClass} value={selectedNode.kind || 'junction'} onChange={event => editNode({ kind: event.target.value })}>{Object.entries(nodeKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button size="sm" variant="outline" onClick={() => { const referenced = draft.edges.some(e => e.from === nodeId || e.to === nodeId) || draft.places.some(p => p.nodeId === nodeId || p.entrances?.some(e => e.nodeId === nodeId)); if (referenced) return toast.error('节点仍被道路、地点或入口引用，请先解除关联。'); edit(next => { next.nodes = next.nodes.filter(node => node.id !== nodeId); }); setNodeId(''); }}><Trash2 className="size-3.5" />删除无引用节点</Button></div>}
    {selectedEdge && <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"><p className="truncate text-xs sm:col-span-3">道路 {selectedEdge.id}</p><label className="grid gap-1 text-xs">实际长度（米）<Input type="number" min="1" value={selectedEdge.distanceMeters} onChange={event => event.target.value && editEdge({ distanceMeters: Number(event.target.value) })} /></label><label className="grid gap-1 text-xs">道路类型<select className={selectClass} value={selectedEdge.kind || 'walkway'} onChange={event => editEdge({ kind: event.target.value, walkable: event.target.value !== 'vehicle', accessible: event.target.value !== 'stairs' })}>{Object.entries(edgeKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 text-xs">层级<select className={selectClass} value={selectedEdge.level || 'ground'} onChange={event => editEdge({ level: event.target.value })}><option value="ground">地面</option><option value="underground">地下</option></select></label>{[['covered', '有遮蔽'], ['accessible', '无障碍'], ['walkable', '可步行'], ['bidirectional', '双向通行'], ['closed', '暂时封闭']].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(selectedEdge[key])} onChange={event => editEdge({ [key]: event.target.checked })} />{label}</label>)}<Button size="sm" variant="outline" onClick={() => { edit(next => { next.edges = next.edges.filter(edge => edge.id !== edgeId); }); setEdgeId(''); }}><Trash2 className="size-3.5" />删除道路</Button></div>}
    <CampusGeometryTools draft={draft} placeId={placeId} nodeId={nodeId} edgeId={edgeId} disabled={saving || busy || versionConflict || Boolean(drag)} applyDraft={next => edit(current => Object.assign(current, next))} />
    <div className="flex flex-wrap gap-2 border-t pt-3"><Button size="sm" variant="outline" disabled={!history.past.length || busy || saving} onClick={undo}><Undo2 className="size-3.5" />撤销</Button><Button size="sm" variant="outline" disabled={!history.future.length || busy || saving} onClick={redo}><Redo2 className="size-3.5" />重做</Button><Button size="sm" variant="outline" onClick={exportDraft}><Download className="size-3.5" />导出草稿</Button><Button size="sm" disabled={!dirty || busy || saving || Boolean(drag) || polygonPoints.length > 0} onClick={save}><Save className="size-3.5" />{saving ? '保存中…' : '保存到公共目录'}</Button></div>
    </fieldset>
    <Dialog open={Boolean(confirmation)} onOpenChange={open => !open && setConfirmation(null)}><DialogContent><DialogHeader><DialogTitle>{confirmation?.kind === 'restore' ? '恢复本机地图草稿' : confirmation?.kind === 'latest' ? '载入最新公共目录' : '丢弃本机草稿记录'}</DialogTitle><DialogDescription>{confirmation?.kind === 'restore' ? `将恢复当前账号基于修订 ${confirmation.record.baseRevision} 的地图几何，替换本页编辑。恢复后仍未发布，可撤销回公共目录；此前未保留的本页修改将丢失。` : confirmation?.kind === 'latest' ? '将用最新版公共目录替换本页编辑，未保存到本机或导出的修改将丢失。已经保存的旧版本机记录保留，可导出后重新核对。' : `将删除当前账号基于修订 ${confirmation?.record.baseRevision} 的这份浏览器记录，无法撤销。当前页面和公共目录不会因此改变。`}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>取消</Button><Button disabled={saving || busy} onClick={performConfirmation}>{confirmation?.kind === 'restore' ? '确认恢复' : confirmation?.kind === 'latest' ? '确认载入最新版' : '确认丢弃记录'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
