import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Car, ChevronDown, ChevronLeft, ChevronRight, House, Layers, LocateFixed, Navigation, Package, Pause, Play, RotateCcw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MAP_CATEGORIES, clusterMapMarkers, findParcelShelf, geoDistance, layoutMapLabels, mapCoordinate, mapLabelText, mapProjection, routePlaybackPoint } from '../../../shared/campus-map-ui.js';
import { findUndergroundVehicleCandidate, inferredRooms, placeGroups, routeStreetViews, searchParcelFacilities } from '../../../shared/campus-geometry-actions.js';
import { streetViewMileage, streetViewPosition, streetViewRoutePoints } from '../../../shared/campus-street-view.js';
import 'leaflet/dist/leaflet.css';
import './campus-map.css';

const EMPTY = [];
const CATEGORY_MAP = Object.fromEntries(MAP_CATEGORIES.map(category => [category.id, category]));
const DEFAULT_CENTER = { lat: 31.176, lng: 121.59 };
const OSM_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const latLng = point => [point.lat, point.lng];
const activate = action => event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } };

function plainLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

// Convert administrator-provided attribution to text. No imported HTML is executed.
function attributionText(value) { return String(value || '').replace(/<[^>]*>/g, '').slice(0, 500); }

function DemoNotice({ demo, children }) {
  return <p className={cn('rounded-lg border px-3 py-2 text-xs leading-relaxed', demo ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'bg-muted/30 text-muted-foreground')}>{demo ? '示例示意图 · 不对应真实建筑或货架，不能用于实际找教室或取件。' : children}</p>;
}

function DiagramMap({ catalog, places, selectedPlaceId, onSelectPlace, onRouteEndpoint, routePoints, eventCounts, labels, progress, location, zoom, mode, groups = EMPTY, onExpandGroup }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 1000, height: 700 });
  const [activeId, setActiveId] = useState('');
  const [nearby, setNearby] = useState(null);
  const svgRef = useRef(null);
  const dragging = useRef(null), suppressClick = useRef(false);
  const allCoordinates = useMemo(() => [...(catalog.places || EMPTY), ...(catalog.nodes || EMPTY), ...(catalog.places || EMPTY).flatMap(place => [...(place.polygons || EMPTY).flatMap(polygon => polygon.points || EMPTY), ...(place.entrances || EMPTY)]), ...routePoints], [catalog, routePoints]);
  const project = useMemo(() => mapProjection(allCoordinates, catalog.meta?.center), [allCoordinates, catalog.meta?.center]);
  const nodes = useMemo(() => new globalThis.Map((catalog.nodes || EMPTY).map(node => [node.id, node])), [catalog.nodes]);
  const simulation = routePlaybackPoint(routePoints, progress);
  const routeLine = routePoints.map(project).filter(Boolean).map(point => `${point.x},${point.y}`).join(' ');
  const side = 1000 / zoom, tall = 700 / zoom;
  const left = (1000 - side) / 2 + pan.x, top = (700 - tall) / 2 + pan.y;
  const scale = Math.max(0.01, Math.min(viewport.width / side, viewport.height / tall));
  const insetX = (viewport.width - side * scale) / 2, insetY = (viewport.height - tall * scale) / 2;
  useEffect(() => {
    const element = svgRef.current; if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setNearby(null), [places, groups, zoom]);
  const markerItems = [
    ...places.map(place => ({ ...place, selected: place.id === selectedPlaceId, eventCount: eventCounts[place.id] || 0, hasOutline: Boolean(place.polygons?.length) })),
    ...groups.map(group => ({ ...group, id: `group:${group.id}`, category: group.places[0]?.category, buildingGroup: group, hasOutline: true, eventCount: group.places.reduce((sum, place) => sum + (eventCounts[place.id] || 0), 0) })),
  ].map(item => { const point = project(item); return { ...item, point, x: (point.x - left) * scale + insetX, y: (point.y - top) * scale + insetY }; });
  const markers = clusterMapMarkers(markerItems.filter(item => item.x >= -30 && item.y >= -30 && item.x <= viewport.width + 30 && item.y <= viewport.height + 30));
  const candidates = markers.map(item => {
    const fullName = item.selected || activeId === item.id;
    const displayName = mapLabelText({ ...item, selected: fullName });
    const name = fullName || displayName.length <= 12 ? displayName : `${displayName.slice(0, 11)}…`;
    const textWidth = [...name].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 11 : 6.5), 0);
    const labelWidth = Math.min(viewport.width - 16, fullName ? 240 : 144, textWidth + 14);
    return { ...item, selected: fullName, labelText: name, radius: item.selected || item.members.length > 1 ? 16 : 12, labelWidth, labelHeight: fullName ? Math.max(22, Math.ceil((textWidth + 14) / labelWidth) * 16 + 6) : 22 };
  });
  const labelLayouts = layoutMapLabels(candidates, { width: viewport.width, height: viewport.height, zoom: 17 + Math.log2(zoom), enabled: labels, reserved: [{ left: viewport.width - 58, top: 0, right: viewport.width, bottom: 265 }, { left: 0, top: viewport.height - 24, right: viewport.width, bottom: viewport.height }] });
  const labelItems = new globalThis.Map(candidates.map(item => [item.id, item]));
  function openItem(item) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (item.members?.length > 1) { setNearby(item); return; }
    if (item.buildingGroup) onExpandGroup?.(item.buildingGroup.id); else onSelectPlace?.(item.id);
  }
  function beginPan(event) {
    if (event.button !== 0 || event.target.closest?.('[role="button"]')) return;
    const transform = event.currentTarget.getScreenCTM(); if (!transform) return;
    const inverse = transform.inverse(), point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    dragging.current = { pointerId: event.pointerId, origin: point, pan, inverse, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event) {
    const active = dragging.current; if (!active || active.pointerId !== event.pointerId) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(active.inverse), dx = point.x - active.origin.x, dy = point.y - active.origin.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) active.moved = true;
    if (active.moved) { setNearby(null); setPan({ x: Math.max(-1500, Math.min(1500, active.pan.x - dx)), y: Math.max(-1050, Math.min(1050, active.pan.y - dy)) }); }
  }
  function endPan(event) {
    const active = dragging.current; if (!active || active.pointerId !== event.pointerId) return;
    suppressClick.current = active.moved; dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function selectPoint(event) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (!onRouteEndpoint || event.target.closest?.('[role="button"]')) return;
    const transform = event.currentTarget.getScreenCTM(); if (!transform) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const point = project.invert(local); if (point) onRouteEndpoint({ ...point, name: '地图上的位置' });
  }
  return <><svg ref={svgRef} className="size-full touch-none cursor-grab active:cursor-grabbing" viewBox={`${left} ${top} ${side} ${tall}`} role="group" aria-label={catalog.meta?.isDemo ? 'Daylight 原创校园示例位置图，非实景导航' : '按目录坐标绘制的位置示意图'} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onClick={selectPoint}>
    <defs><pattern id="campus-diagram-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 H 0 V 50" fill="none" stroke="#dfe7dc" strokeWidth="1" /></pattern></defs>
    <rect width="1000" height="700" fill={mode === 'underground' ? '#efedf3' : '#f0f4ed'} /><rect width="1000" height="700" fill="url(#campus-diagram-grid)" />
    <path d="M 80 90 Q 230 150 180 320 T 200 650" stroke="#d8e6d4" strokeWidth="56" fill="none" />
    <path d="M 900 75 Q 780 250 840 440 T 820 660" stroke="#d8e6d4" strokeWidth="42" fill="none" />
    {places.flatMap(place => (place.polygons || EMPTY).map(polygon => <polygon key={`${place.id}-${polygon.id}`} points={(polygon.points || EMPTY).map(project).filter(Boolean).map(point => `${point.x},${point.y}`).join(' ')} fill={CATEGORY_MAP[place.category]?.color || '#43897f'} fillOpacity={place.id === selectedPlaceId ? '.2' : '.1'} stroke={place.id === selectedPlaceId ? '#c58d22' : '#799581'} strokeWidth={place.id === selectedPlaceId ? 3 : 1.5} role="button" tabIndex={0} aria-label={`${place.name}建筑轮廓`} onClick={() => onSelectPlace?.(place.id)} onKeyDown={activate(() => onSelectPlace?.(place.id))} className="cursor-pointer"><title>{place.name} · 目录登记轮廓</title></polygon>))}
    {(catalog.edges || EMPTY).filter(edge => mode === 'all' || (edge.level || 'ground') === (mode === 'surface' ? 'ground' : mode)).map(edge => {
      const from = project(nodes.get(edge.from)), to = project(nodes.get(edge.to));
      const blocked = edge.closed || edge.walkable === false;
      return from && to ? <g key={edge.id}><title>{edge.closed ? '道路已关闭，不参与路线规划' : edge.walkable === false ? '非步行道路，不参与路线规划' : edge.description || '已收录道路'}</title><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#fff" strokeWidth="15" /><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={blocked ? '#cba191' : edge.level === 'underground' ? '#a695bd' : edge.covered ? '#b4c6c1' : '#d5dbd0'} strokeWidth="7" strokeDasharray={blocked ? '4 6' : edge.level === 'underground' ? '9 7' : undefined} /></g> : null;
    })}
    {routeLine && <polyline points={routeLine} fill="none" stroke="#267b6c" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />}
    {routePoints.length > 1 && [[routePoints[0], '起点'], [routePoints.at(-1), '终点']].map(([value, label]) => { const point = project(value); return point ? <g key={label} transform={`translate(${point.x},${point.y})`}><circle r="9" fill={label === '起点' ? '#fff' : '#267b6c'} stroke={label === '起点' ? '#267b6c' : '#fff'} strokeWidth="3" /><text x="13" y="5" fontSize="13" fill="#264b3e">{label}</text></g> : null; })}
    {places.flatMap(place => (place.entrances || EMPTY).map(entrance => {
      const point = project(entrance); if (!point) return null;
      return <g key={`${place.id}-${entrance.id}`} transform={`translate(${point.x},${point.y})`} role="button" tabIndex={0} aria-label={`${place.name} · ${entrance.name}${entrance.accessible ? ' · 无障碍入口' : ''}`} onClick={() => onSelectPlace?.(place.id)} onKeyDown={activate(() => onSelectPlace?.(place.id))} className="cursor-pointer"><title>{place.name} · {entrance.name}{entrance.accessible ? ' · 无障碍入口' : ''}</title><circle r="6" fill={entrance.accessible ? '#317b64' : '#99794f'} stroke="#fff" strokeWidth="2" />{labels && place.id === selectedPlaceId && <text y="-12" textAnchor="middle" fontSize="11" fill="#31483c">{entrance.name}</text>}</g>;
    }))}
    {markers.map(item => {
      const category = CATEGORY_MAP[item.category] || CATEGORY_MAP.service, multiple = item.members.length > 1;
      const count = item.members.reduce((sum, member) => sum + (member.buildingGroup?.places.length || 1), 0);
      const events = item.members.reduce((sum, member) => sum + member.eventCount, 0);
      return <g key={item.id} transform={`translate(${item.point.x},${item.point.y}) scale(${1 / scale})`} role="button" tabIndex={0} aria-pressed={item.selected} aria-label={`${item.name}${multiple ? `附近，${count} 个地点，点击查看` : item.buildingGroup ? `，展开 ${count} 个地点` : ''}${events ? `，${events} 场活动` : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId('')} onFocus={() => setActiveId(item.id)} onBlur={() => setActiveId('')} onClick={() => openItem(item)} onKeyDown={activate(() => openItem(item))} className="cursor-pointer">
        <title>{item.name}</title>
        {item.selected && <circle r="19" fill="none" stroke="#e0b04a" strokeWidth="3" />}
        <circle r={item.selected || multiple ? 14 : 11} fill={multiple && !item.selected ? '#fff' : category.color} stroke={multiple && !item.selected ? '#75968b' : '#fff'} strokeWidth="2" />
        <text textAnchor="middle" y="4" fill={multiple && !item.selected ? '#315e50' : '#fff'} fontSize="11" fontWeight="600">{item.selected ? category.short : multiple || item.buildingGroup ? count : category.short}</text>
        {events > 0 && <><circle cx="15" cy="-14" r="9" fill="#bc7e26" stroke="#fff" strokeWidth="2" /><text x="15" y="-11" textAnchor="middle" fill="white" fontSize="9">{events}</text></>}
      </g>;
    })}
    {labelLayouts.map(rect => {
      const item = labelItems.get(rect.id);
      return <foreignObject key={`label-${item.id}`} x={left + (rect.left - insetX) / scale} y={top + (rect.top - insetY) / scale} width={(rect.right - rect.left) / scale} height={(rect.bottom - rect.top) / scale} pointerEvents="none"><div style={{ width: rect.right - rect.left, transform: `scale(${1 / scale})`, transformOrigin: 'top left' }}><span className={cn('campus-map-label', item.selected && 'is-selected')} style={{ maxWidth: rect.right - rect.left }}>{item.labelText}</span></div></foreignObject>;
    })}
    {simulation && progress > 0 && (() => { const point = project(simulation); return <g transform={`translate(${point.x},${point.y})`} aria-label="路线模拟位置"><circle r="15" fill="#287464" opacity=".2" /><circle r="7" fill="#287464" stroke="#fff" strokeWidth="3" /></g>; })()}
    {location && (() => { const point = project(location); if (!point || point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 700) return null; return <g transform={`translate(${point.x},${point.y})`}><circle r="15" fill="#4286d1" opacity=".15" /><circle r="6" fill="#4286d1" stroke="#fff" strokeWidth="2" /></g>; })()}
    <g transform="translate(925,70)" fill="#6b7b70"><path d="M0 -20 L-7 0 H7 Z" /><text y="18" textAnchor="middle" fontSize="13">北</text></g>
    <text x="35" y="666" fill="#788479" fontSize="12">Daylight 位置示意 · 按目录坐标绘制 · 无实景底图</text>
  </svg>{nearby && <div role="dialog" aria-label="附近地点" className="absolute bottom-7 left-3 z-[420] w-64 max-w-[calc(100%-5rem)] rounded-xl border bg-background p-3 shadow-lg"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">附近地点</h3><Button size="xs" variant="ghost" onClick={() => setNearby(null)}>关闭</Button></div><div className="max-h-44 space-y-1 overflow-y-auto">{nearby.members.map(item => <Button key={item.id} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs" onClick={() => { setNearby(null); if (item.buildingGroup) onExpandGroup?.(item.buildingGroup.id); else onSelectPlace?.(item.id); }}>{item.name}{item.buildingGroup && ` · 展开 ${item.places.length} 个地点`}</Button>)}</div></div>}</>;
}

/** A coordinate-driven map with an explicit offline diagram and optional licensed basemaps. */
export function CampusMap({ catalog, selectedPlaceId = '', onSelectPlace, route, eventMarkers = EMPTY, followPlaceId = '', mode = 'all', layer, onRouteEndpoint, onLocation, height, className }) {
  const [mapLayer, setMapLayer] = useState(layer || (catalog.meta?.mapImage ? 'campus' : catalog.meta?.isDemo ? 'diagram' : 'map'));
  const [showLabels, setShowLabels] = useState(true);
  const [categories, setCategories] = useState(() => MAP_CATEGORIES.map(category => category.id));
  const [level, setLevel] = useState(mode === 'surface' ? 'ground' : mode);
  const [mapReady, setMapReady] = useState(0);
  const [mapError, setMapError] = useState('');
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [diagramHomeKey, setDiagramHomeKey] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState([]);
  const host = useRef(null), mapRef = useRef(null), leafletRef = useRef(null), drawing = useRef(null), simulationMarker = useRef(null), locationLayers = useRef(null), watcher = useRef(null);
  const latest = useRef({}); latest.current = { catalog, onSelectPlace, onRouteEndpoint, onLocation };
  const routePoints = useMemo(() => (route?.points || EMPTY).map(mapCoordinate).filter(Boolean), [route?.points]);
  const filteredPlaces = useMemo(() => (catalog.places || EMPTY).filter(place => mapCoordinate(place) && categories.includes(place.category)), [catalog.places, categories]);
  const buildingGroups = useMemo(() => placeGroups(filteredPlaces), [filteredPlaces]);
  const collapsedGroups = useMemo(() => buildingGroups.filter(group => !expandedGroups.includes(group.id)).map(group => ({ ...group, lat: group.places.reduce((sum, place) => sum + place.lat, 0) / group.places.length, lng: group.places.reduce((sum, place) => sum + place.lng, 0) / group.places.length })), [buildingGroups, expandedGroups]);
  const places = useMemo(() => { const hidden = new Set(collapsedGroups.flatMap(group => group.places.map(place => place.id))); return filteredPlaces.filter(place => !hidden.has(place.id)); }, [filteredPlaces, collapsedGroups]);
  const expandGroup = id => setExpandedGroups(value => value.includes(id) ? value : [...value, id]);
  const eventCounts = useMemo(() => {
    const counts = {}; for (const event of eventMarkers || EMPTY) if (event.placeId && event.status !== 'cancelled') counts[event.placeId] = (counts[event.placeId] || 0) + 1; return counts;
  }, [eventMarkers]);
  const tileUrl = mapLayer === 'satellite' ? catalog.meta?.satelliteTileUrl : catalog.meta?.mapTileUrl || OSM_TILE;
  const tileAttribution = mapLayer === 'satellite' ? catalog.meta?.satelliteAttribution : catalog.meta?.mapAttribution || OSM_ATTRIBUTION;
  const hasSatellite = Boolean(catalog.meta?.satelliteTileUrl && catalog.meta?.satelliteAttribution);
  const campusImage = catalog.meta?.mapImage;
  const imageIdentity = JSON.stringify(campusImage || null);
  const routeIdentity = routePoints.map(point => `${point.lat},${point.lng}`).join(';');

  useEffect(() => { if (layer) setMapLayer(layer); }, [layer]);
  useEffect(() => { if (!layer) setMapLayer(current => campusImage ? 'campus' : current === 'campus' ? 'diagram' : current); }, [imageIdentity, layer]);
  useEffect(() => { setLevel(mode === 'surface' ? 'ground' : mode); }, [mode]);
  useEffect(() => { const group = buildingGroups.find(item => item.places.some(place => place.id === (followPlaceId || selectedPlaceId))); if (group) setExpandedGroups(value => value.includes(group.id) ? value : [...value, group.id]); }, [buildingGroups, followPlaceId, selectedPlaceId]);
  useEffect(() => { setProgress(0); setPlaying(false); }, [routeIdentity]);
  useEffect(() => {
    if (!playing || routePoints.length < 2) return undefined;
    // This is a compressed visual demonstration, never a live position.
    const duration = Math.max(8000, Math.min(45000, routePoints.reduce((sum, point, index) => sum + (index ? geoDistance(routePoints[index - 1], point) : 0), 0) * 18));
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), advance = (now - previous) / duration; previous = now;
      setProgress(value => Math.min(1, value + advance));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, routeIdentity]);
  useEffect(() => { if (playing && progress >= 1) setPlaying(false); }, [playing, progress]);

  useEffect(() => {
    if (mapLayer === 'diagram' || !host.current) return undefined;
    let disposed = false, currentMap, observer;
    setMapError('');
    import('leaflet').then(module => {
      if (disposed || !host.current) return;
      const L = module.default || module; leafletRef.current = L;
      currentMap = L.map(host.current, { zoomControl: false, attributionControl: false, preferCanvas: true, scrollWheelZoom: false, maxZoom: 21, zoomSnap: 0.25 });
      mapRef.current = currentMap;
      const attribution = L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(currentMap);
      const span = document.createElement('span'); span.textContent = attributionText(mapLayer === 'campus' ? campusImage?.attribution : tileAttribution);
      if (mapLayer === 'campus' && plainLink(campusImage?.sourceUrl)) {
        const anchor = document.createElement('a'); anchor.href = plainLink(campusImage.sourceUrl); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = attributionText(campusImage.attribution); span.replaceChildren(anchor);
      } else if ((tileUrl || '').includes('openstreetmap.org')) {
        const anchor = document.createElement('a'); anchor.href = 'https://www.openstreetmap.org/copyright'; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = OSM_ATTRIBUTION; span.replaceChildren(anchor);
      }
      attribution.addAttribution(span.innerHTML);
      const url = String(tileUrl || '');
      if (mapLayer === 'campus' && campusImage) {
        const { bounds } = campusImage;
        L.imageOverlay(campusImage.url, [[bounds.south, bounds.west], [bounds.north, bounds.east]], { interactive: false, alt: '上海科技大学校园地图，来源于学校公开地图' }).on('error', () => { if (!disposed) setMapError('校园底图图片暂时无法加载，已导入的地点仍可查看。'); }).addTo(currentMap);
      } else if (!/^https?:\/\//i.test(url) || !tileAttribution) { setMapError('底图地址或署名尚未配置，请使用位置示意图。'); }
      else {
        let failures = 0, loads = 0;
        L.tileLayer(url, { maxZoom: 21, maxNativeZoom: 19, crossOrigin: true }).on('tileload', () => { loads += 1; }).on('tileerror', () => { failures += 1; if (failures >= 3 && !loads && !disposed) setMapError('外部底图暂时无法加载，位置和路线仍可用。'); }).addTo(currentMap);
      }
      const center = mapCoordinate(latest.current.catalog.meta?.center) || DEFAULT_CENTER;
      currentMap.setView(latLng(center), Number(latest.current.catalog.meta?.zoom || 16));
      const valid = (latest.current.catalog.places || EMPTY).map(mapCoordinate).filter(Boolean);
      if (valid.length > 1) currentMap.fitBounds(valid.map(latLng), { padding: [55, 55], maxZoom: 17 });
      currentMap.on('click', event => latest.current.onRouteEndpoint?.({ lat: event.latlng.lat, lng: event.latlng.lng, name: '地图上的位置' }));
      observer = new ResizeObserver(() => currentMap.invalidateSize({ pan: false })); observer.observe(host.current);
      setMapReady(value => value + 1);
    }).catch(() => !disposed && setMapError('地图引擎暂时无法打开，请切换位置示意图。'));
    return () => { disposed = true; observer?.disconnect(); drawing.current = null; simulationMarker.current = null; locationLayers.current = null; if (mapRef.current === currentMap) mapRef.current = null; currentMap?.remove(); };
  }, [mapLayer, tileUrl, tileAttribution, imageIdentity]);

  useEffect(() => {
    const map = mapRef.current, L = leafletRef.current;
    if (!map || !L || mapLayer === 'diagram') return;
    drawing.current?.remove();
    const group = L.layerGroup().addTo(map); drawing.current = group;
    const selectedId = followPlaceId || selectedPlaceId;
    const nodes = new globalThis.Map((catalog.nodes || EMPTY).map(node => [node.id, node]));
    for (const edge of catalog.edges || EMPTY) {
      if (level !== 'all' && (edge.level || 'ground') !== level) continue;
      const from = mapCoordinate(nodes.get(edge.from)), to = mapCoordinate(nodes.get(edge.to)); if (!from || !to) continue;
      const blocked = edge.closed || edge.walkable === false;
      L.polyline([latLng(from), latLng(to)], { color: blocked ? '#b87960' : edge.level === 'underground' ? '#8d6bac' : edge.covered ? '#7ca897' : '#b3bbae', weight: edge.level === 'underground' ? 4 : 3, opacity: 0.7, dashArray: blocked ? '4 6' : edge.level === 'underground' ? '8 7' : undefined, interactive: false }).addTo(group);
    }
    for (const place of places) {
      const category = CATEGORY_MAP[place.category] || CATEGORY_MAP.service;
      for (const polygon of place.polygons || EMPTY) {
        const points = (polygon.points || EMPTY).map(mapCoordinate).filter(Boolean); if (points.length < 3) continue;
        const shape = L.polygon(points.map(latLng), { color: place.id === selectedId ? '#c58d22' : category.color, weight: place.id === selectedId ? 3 : 1.5, fillColor: category.color, fillOpacity: place.id === selectedId ? 0.2 : 0.1, bubblingMouseEvents: false }).addTo(group);
        shape.on('click', () => latest.current.onSelectPlace?.(place.id));
      }
      for (const entrance of place.entrances || EMPTY) {
        if (!mapCoordinate(entrance)) continue;
        const label = document.createElement('span'); label.textContent = `${place.name} · ${entrance.name}${entrance.accessible ? ' · 无障碍入口' : ''}`;
        L.circleMarker(latLng(entrance), { radius: 5, color: '#fff', weight: 2, fillColor: entrance.accessible ? '#317b64' : '#99794f', fillOpacity: 1, bubblingMouseEvents: false }).bindTooltip(label).on('click', () => latest.current.onSelectPlace?.(place.id)).addTo(group);
      }
    }

    const markerLayer = L.layerGroup().addTo(group), labelLayer = L.layerGroup().addTo(group);
    const measure = document.createElement('div'); measure.className = 'campus-label-measure'; map.getContainer().append(measure);
    const entries = [
      ...places.map(place => ({ ...place, selected: place.id === selectedId, eventCount: eventCounts[place.id] || 0, hasOutline: Boolean(place.polygons?.length), place })),
      ...collapsedGroups.map(item => ({ ...item, id: `group:${item.id}`, category: item.places[0]?.category, eventCount: item.places.reduce((sum, place) => sum + (eventCounts[place.id] || 0), 0), hasOutline: true, buildingGroup: item })),
    ];
    let nearbyPopup;
    function renderMarkers() {
      markerLayer.clearLayers(); labelLayer.clearLayers(); measure.replaceChildren();
      const size = map.getSize(), zoom = map.getZoom();
      const projected = entries.map(item => ({ ...item, ...map.latLngToContainerPoint(latLng(item)) }))
        .filter(item => item.x >= -35 && item.y >= -35 && item.x <= size.x + 35 && item.y <= size.y + 35);
      const clusters = clusterMapMarkers(projected, zoom < 18 ? 36 : 32);
      for (const item of clusters) {
        const nearby = item.members.length > 1, buildingGroup = item.buildingGroup;
        const count = item.members.reduce((sum, member) => sum + (member.buildingGroup?.places.length || 1), 0);
        const eventCount = item.members.reduce((sum, member) => sum + member.eventCount, 0);
        const category = CATEGORY_MAP[item.category] || CATEGORY_MAP.service;
        const diameter = item.selected ? 28 : nearby ? 30 : buildingGroup ? 28 : 22;
        item.radius = diameter / 2 + (eventCount ? 5 : 0);
        const content = document.createElement('div');
        content.className = `campus-marker${nearby ? ' campus-marker-cluster' : buildingGroup ? ' campus-building-group' : ''}${item.selected ? ' is-selected' : ''}`;
        content.style.setProperty('--marker-size', `${diameter}px`);
        content.style.background = nearby && !item.selected ? '' : category.color;
        content.textContent = item.selected ? category.short : nearby || buildingGroup ? String(count) : category.short;
        if (nearby && item.selected) { const badge = document.createElement('span'); badge.className = 'campus-nearby-count'; badge.textContent = String(count); content.append(badge); }
        if (eventCount) { const badge = document.createElement('span'); badge.className = 'campus-event-count'; badge.textContent = String(eventCount); content.append(badge); }
        const title = nearby ? `${item.name}附近 · ${count} 个地点，点击查看` : buildingGroup ? `${item.name} · 展开 ${count} 个地点` : item.name;
        const marker = L.marker(latLng(item), { title, alt: title, keyboard: true, icon: L.divIcon({ className: 'campus-marker-anchor', html: content, iconSize: [diameter, diameter], iconAnchor: [diameter / 2, diameter / 2] }), zIndexOffset: item.selected ? 1200 : 0 }).addTo(markerLayer);
        marker.getElement()?.setAttribute('aria-label', `${title}${eventCount ? `，${eventCount} 场活动` : ''}`);
        if (item.selected) marker.getElement()?.setAttribute('aria-pressed', 'true');
        else {
          const tooltip = document.createElement('span'); tooltip.textContent = title;
          marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -diameter / 2 - 3], className: 'campus-map-detail', opacity: 1 });
        }
        if (nearby) {
          const popup = document.createElement('div'); popup.className = 'campus-nearby-list';
          const heading = document.createElement('p'); heading.className = 'campus-nearby-heading'; heading.textContent = `附近 ${count} 个地点`; popup.append(heading);
          const list = document.createElement('div'); list.className = 'campus-nearby-items'; popup.append(list);
          for (const member of item.members) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'campus-nearby-place';
            const dot = document.createElement('span'); dot.className = 'campus-nearby-dot'; dot.style.background = (CATEGORY_MAP[member.category] || CATEGORY_MAP.service).color;
            const name = document.createElement('span'); name.textContent = member.buildingGroup ? `${member.name} · 展开 ${member.places.length} 个地点` : member.name;
            button.append(dot, name);
            if (member.selected) button.setAttribute('aria-current', 'location');
            button.addEventListener('click', () => { map.closePopup(); if (member.buildingGroup) expandGroup(member.buildingGroup.id); else latest.current.onSelectPlace?.(member.id); });
            list.append(button);
          }
          if (item.members.some(member => geoDistance(item, member) > 3) && zoom < 21) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'campus-nearby-zoom'; button.textContent = '放大此区域';
            button.addEventListener('click', () => { map.closePopup(); map.fitBounds(item.members.map(latLng), { paddingTopLeft: [35, 35], paddingBottomRight: [65, 35], maxZoom: Math.min(21, zoom + 2) }); }); popup.append(button);
          }
          marker.on('click', () => {
            nearbyPopup = L.popup({ maxWidth: 280, minWidth: Math.min(200, size.x - 80), className: 'campus-nearby-popup', autoPanPaddingTopLeft: [20, 20], autoPanPaddingBottomRight: [60, 35] }).setLatLng(latLng(item)).setContent(popup).openOn(map);
          });
        } else marker.on('click', () => buildingGroup ? expandGroup(buildingGroup.id) : latest.current.onSelectPlace?.(item.id));

        const label = document.createElement('span'); label.className = `campus-map-label${item.selected ? ' is-selected' : ''}`; label.textContent = mapLabelText(item);
        label.style.maxWidth = `${Math.min(item.selected ? 240 : 132, size.x - 16)}px`;
        measure.append(label); const bounds = label.getBoundingClientRect();
        item.labelWidth = Math.ceil(bounds.width); item.labelHeight = Math.ceil(bounds.height); item.label = label;
      }
      const reserved = [{ left: size.x - 58, top: 0, right: size.x, bottom: 265 }, { left: 0, top: size.y - (routePoints.length > 1 ? 85 : 24), right: size.x, bottom: size.y }];
      const layouts = layoutMapLabels(clusters, { width: size.x, height: size.y, zoom, enabled: showLabels, reserved });
      const byId = new globalThis.Map(clusters.map(item => [item.id, item]));
      for (const rect of layouts) {
        const item = byId.get(rect.id);
        L.marker(latLng(item), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'campus-label-anchor', html: item.label, iconSize: [rect.right - rect.left, rect.bottom - rect.top], iconAnchor: [item.x - rect.left, item.y - rect.top] }), zIndexOffset: item.selected ? 1500 : -500 }).addTo(labelLayer);
      }
      measure.replaceChildren();
    }
    let frame;
    const scheduleLayout = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(renderMarkers); };
    map.on('moveend zoomend resize', scheduleLayout);
    renderMarkers();
    if (routePoints.length > 1) {
      L.polyline(routePoints.map(latLng), { color: '#fff', weight: 10, opacity: 0.9, interactive: false }).addTo(group);
      L.polyline(routePoints.map(latLng), { color: '#27796a', weight: 5, lineJoin: 'round', interactive: false }).addTo(group);
      for (const [index, name] of [[0, '起点'], [routePoints.length - 1, '终点']]) {
        L.circleMarker(latLng(routePoints[index]), { radius: 7, fillColor: index ? '#27796a' : '#fff', fillOpacity: 1, color: index ? '#fff' : '#27796a', weight: 3 }).bindTooltip(name).addTo(group);
      }
    }
    return () => { cancelAnimationFrame(frame); map.off('moveend zoomend resize', scheduleLayout); nearbyPopup?.remove(); measure.remove(); group.remove(); };
  }, [mapReady, catalog, places, collapsedGroups, followPlaceId, selectedPlaceId, showLabels, eventCounts, routeIdentity, level, mapLayer]);

  useEffect(() => {
    if (mapLayer === 'diagram' || !mapRef.current) return;
    const id = followPlaceId || selectedPlaceId, point = (catalog.places || EMPTY).find(place => place.id === id);
    if (point && mapCoordinate(point)) mapRef.current.flyTo([point.lat, point.lng], Math.max(17, mapRef.current.getZoom()), { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.5 });
  }, [followPlaceId, selectedPlaceId, mapReady, mapLayer]);

  useEffect(() => {
    if (mapLayer !== 'diagram' && mapRef.current && routePoints.length > 1) mapRef.current.fitBounds(routePoints.map(latLng), { padding: [65, 65], maxZoom: 18 });
  }, [routeIdentity, mapReady, mapLayer]);

  useEffect(() => {
    const map = mapRef.current, L = leafletRef.current; if (!map || !L || mapLayer === 'diagram') return;
    const point = routePlaybackPoint(routePoints, progress);
    if (!point || !progress) { simulationMarker.current?.remove(); simulationMarker.current = null; return; }
    if (!simulationMarker.current) simulationMarker.current = L.marker(latLng(point), { interactive: false, icon: L.divIcon({ className: '', html: '<div class="campus-simulation-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1800 }).addTo(map);
    simulationMarker.current.setLatLng(latLng(point));
  }, [progress, routeIdentity, mapReady, mapLayer]);

  useEffect(() => {
    const map = mapRef.current, L = leafletRef.current; if (!map || !L || mapLayer === 'diagram') return;
    locationLayers.current?.remove(); locationLayers.current = null;
    if (location) {
      const group = L.layerGroup().addTo(map); locationLayers.current = group;
      L.circle(latLng(location), { radius: Math.min(location.accuracy || 20, 10000), color: '#4286d1', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(group);
      L.circleMarker(latLng(location), { radius: 6, color: '#fff', weight: 2, fillColor: '#4286d1', fillOpacity: 1 }).bindTooltip('我的位置').addTo(group);
    }
  }, [location, mapReady, mapLayer]);

  useEffect(() => () => { if (watcher.current !== null) navigator.geolocation?.clearWatch(watcher.current); }, []);
  function locate() {
    if (watcher.current !== null) { navigator.geolocation?.clearWatch(watcher.current); watcher.current = null; setLocating(false); setLocation(null); latest.current.onLocation?.(null); setLocationStatus('已关闭定位。'); return; }
    if (!navigator.geolocation) { setLocationStatus('当前浏览器不支持定位。'); return; }
    if (!window.isSecureContext) { setLocationStatus('请通过 HTTPS 或本机地址打开页面后使用定位。'); return; }
    setLocating(true); setLocationStatus('正在申请定位权限…');
    let firstFix = true;
    watcher.current = navigator.geolocation.watchPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp };
      setLocation(point); if (firstFix) { mapRef.current?.setView([point.lat, point.lng], 18); firstFix = false; } setLocationStatus(`定位精度约 ${Math.round(point.accuracy)} 米${catalog.meta?.isDemo ? '；当前为示例目录，请勿据此实地导航。' : '；路线按目录路网估算。'}`);
      latest.current.onLocation?.(point);
    }, error => {
      setLocationStatus(error.code === 1 ? '定位权限未开启，请在微信/系统的位置权限中允许；也可从微信右上角菜单在系统浏览器打开后重试。' : error.code === 2 ? '暂时无法取得位置，请到开阔处再试。' : '定位超时，请重试。');
      if (watcher.current !== null) navigator.geolocation.clearWatch(watcher.current); watcher.current = null; setLocating(false); setLocation(null); latest.current.onLocation?.(null);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }
  function home() {
    setDiagramZoom(1); setDiagramHomeKey(value => value + 1);
    const map = mapRef.current; if (!map) return;
    const points = (catalog.places || EMPTY).map(mapCoordinate).filter(Boolean);
    if (points.length > 1) map.fitBounds(points.map(latLng), { padding: [55, 55], maxZoom: 17 }); else map.setView(latLng(mapCoordinate(catalog.meta?.center) || DEFAULT_CENTER), catalog.meta?.zoom || 16);
  }
  const currentPosition = routePlaybackPoint(routePoints, progress);
  const hasUnderground = (catalog.nodes || EMPTY).some(node => node.level === 'underground');
  return <div data-campus-map-overview tabIndex={-1} aria-label="校园地图" className={cn('campus-guide-map relative isolate size-full min-h-56 overflow-hidden bg-[#edf2e9]', className)} style={height ? { height } : undefined}>
    {mapLayer === 'diagram' ? <DiagramMap key={diagramHomeKey} catalog={catalog} places={places} groups={collapsedGroups} onExpandGroup={expandGroup} selectedPlaceId={followPlaceId || selectedPlaceId} onSelectPlace={onSelectPlace} onRouteEndpoint={onRouteEndpoint} routePoints={routePoints} eventCounts={eventCounts} labels={showLabels} progress={progress} location={location} zoom={diagramZoom} mode={level} /> : <div ref={host} className="absolute inset-0 z-0" aria-label="地理底图与校园位置" />}
    <div className="absolute top-3 right-3 z-[450] flex flex-col items-end gap-1.5">
      <Popover><PopoverTrigger asChild><Button variant="outline" size="icon" className="bg-background/95 shadow-sm" aria-label="地图图层和标签"><Layers /></Button></PopoverTrigger><PopoverContent align="end" className="w-64 space-y-4 p-4">
        <div className="space-y-2"><h3 className="text-sm font-medium">地图图层</h3><div className="flex flex-wrap gap-1">{campusImage && <Button size="sm" variant={mapLayer === 'campus' ? 'default' : 'outline'} onClick={() => setMapLayer('campus')}>上科大地图</Button>}<Button size="sm" variant={mapLayer === 'diagram' ? 'default' : 'outline'} onClick={() => setMapLayer('diagram')}>位置示意</Button><Button size="sm" variant={mapLayer === 'map' ? 'default' : 'outline'} onClick={() => setMapLayer('map')}>地理底图</Button>{hasSatellite && <Button size="sm" variant={mapLayer === 'satellite' ? 'default' : 'outline'} onClick={() => setMapLayer('satellite')}>卫星</Button>}</div><p className="text-[11px] leading-relaxed text-muted-foreground">{campusImage ? '上科大地图为学校公开地图的本地快照，可离线查看；地点和通行状态以现场为准。' : '示意图可离线显示。'}地理底图由外部地图服务提供{!hasSatellite ? '；卫星图需维护者配置有授权的图源。' : '。'}</p></div>
        <div className="space-y-2"><Button size="sm" className="w-full justify-between" variant="outline" aria-pressed={showLabels} onClick={() => setShowLabels(value => !value)}>智能地点标注<span className="text-xs text-muted-foreground">{showLabels ? '已开启' : '已关闭'}</span></Button><p className="text-[11px] leading-relaxed text-muted-foreground">放大后显示更多名称；靠近的地点合并显示数量，点击可查看。悬停、键盘聚焦或选中地点可查看全名。</p></div>
        <div className="space-y-2"><h3 className="text-sm font-medium">地点分类</h3><div className="grid grid-cols-2 gap-1.5">{MAP_CATEGORIES.map(category => <Button key={category.id} size="sm" variant={categories.includes(category.id) ? 'secondary' : 'ghost'} aria-pressed={categories.includes(category.id)} onClick={() => setCategories(value => value.includes(category.id) ? value.filter(id => id !== category.id) : [...value, category.id])}><span className="size-2 rounded-full" style={{ background: category.color }} />{category.name}</Button>)}</div><Button size="xs" variant="ghost" onClick={() => setCategories(categories.length ? [] : MAP_CATEGORIES.map(category => category.id))}>{categories.length ? '全部隐藏' : '全部显示'}</Button></div>
        {hasUnderground && <div className="space-y-2"><h3 className="text-sm font-medium">道路层级</h3><div className="flex gap-1">{[['all', '全部'], ['ground', '地上'], ['underground', '地下']].map(([id, label]) => <Button key={id} size="sm" variant={level === id ? 'secondary' : 'ghost'} onClick={() => setLevel(id)} aria-pressed={level === id}>{label}</Button>)}</div></div>}
        {!!buildingGroups.length && <div className="space-y-2"><h3 className="text-sm font-medium">建筑楼群</h3>{buildingGroups.map(group => <div key={group.id} className="space-y-1"><Button size="xs" variant="outline" className="w-full justify-between" aria-expanded={expandedGroups.includes(group.id)} onClick={() => setExpandedGroups(value => value.includes(group.id) ? value.filter(id => id !== group.id) : [...value, group.id])}>{group.name} · {group.places.length}<ChevronDown className={cn('size-3 transition-transform', expandedGroups.includes(group.id) && 'rotate-180')} /></Button>{expandedGroups.includes(group.id) && <div className="flex flex-wrap gap-1">{group.places.map(place => <Button key={place.id} size="xs" variant="ghost" onClick={() => onSelectPlace?.(place.id)}>{place.name}</Button>)}</div>}</div>)}</div>}
      </PopoverContent></Popover>
      <Button variant="outline" size="icon" className="bg-background/95 shadow-sm" onClick={home} aria-label="回到全校视野"><House /></Button>
      <Button variant="outline" size="icon" className="bg-background/95 shadow-sm" onClick={locate} aria-label={locating ? '关闭定位' : '显示我的位置'} aria-pressed={locating}><LocateFixed className={locating ? 'text-emerald-700' : ''} /></Button>
      <div className="mt-1 overflow-hidden rounded-md border bg-background/95 shadow-sm"><Button variant="ghost" size="icon" className="block rounded-none border-b" aria-label="放大地图" onClick={() => mapLayer === 'diagram' ? setDiagramZoom(value => Math.min(2.5, value + 0.25)) : mapRef.current?.zoomIn()}><ZoomIn /></Button><Button variant="ghost" size="icon" className="block rounded-none" aria-label="缩小地图" onClick={() => mapLayer === 'diagram' ? setDiagramZoom(value => Math.max(0.75, value - 0.25)) : mapRef.current?.zoomOut()}><ZoomOut /></Button></div>
    </div>
    {(mapError || locationStatus) && <div className="absolute top-16 left-3 z-[440] max-w-[calc(100%-5rem)] rounded-lg border bg-background/95 p-2.5 text-xs leading-relaxed shadow-sm" role="status">{mapError && <p>{mapError} <button className="font-medium underline" onClick={() => setMapLayer('diagram')}>切换位置示意</button></p>}{locationStatus && <p className={mapError ? 'mt-1.5' : ''}>{locationStatus}</p>}</div>}
    {routePoints.length > 1 && <div className="absolute right-3 bottom-7 left-3 z-[430] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 shadow-sm">
      <Badge variant="secondary" className="text-[10px]">模拟行走</Badge><Button size="icon-sm" variant="ghost" aria-label={playing ? '暂停模拟行走' : '播放模拟行走'} onClick={() => { if (progress >= 1) setProgress(0); setPlaying(value => !value); }}>{playing ? <Pause /> : <Play />}</Button><Button size="icon-sm" variant="ghost" aria-label="重置模拟行走" onClick={() => { setProgress(0); setPlaying(false); }}><RotateCcw /></Button>
      <input type="range" min="0" max="100" value={Math.round(progress * 100)} onChange={event => setProgress(Number(event.target.value) / 100)} aria-label="模拟行走进度" className="w-20 accent-emerald-700 sm:w-28" />
      <span className="text-[10px] text-muted-foreground">{Math.round(progress * 100)}% · 非实时位置</span>
      {onLocation && currentPosition && <span className="sr-only">模拟不会触发定位或重新规划。</span>}
    </div>}
    {mapLayer === 'diagram' && <div className="pointer-events-none absolute bottom-1 left-3 text-[9px] text-[#6e7d70]">原创位置示意图 · 非卫星影像</div>}
  </div>;
}

export function CampusVehicleCandidates({ catalog }) {
  const overview = useRef(null);
  const vehicleNodes = useMemo(() => { const ids = new Set((catalog.edges || EMPTY).filter(edge => edge.kind === 'vehicle' && edge.level === 'underground' && !edge.closed).flatMap(edge => [edge.from, edge.to])); return (catalog.nodes || EMPTY).filter(node => ids.has(node.id)); }, [catalog]);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [candidate, setCandidate] = useState(null), [error, setError] = useState('');
  const fromId = vehicleNodes.some(node => node.id === from) ? from : vehicleNodes[0]?.id || '';
  const toId = vehicleNodes.some(node => node.id === to) ? to : vehicleNodes.at(-1)?.id || '';
  const label = node => { const place = (catalog.places || EMPTY).find(place => place.nodeId === node.id || place.entrances?.some(entrance => entrance.nodeId === node.id)); return place?.name || node.name || `${node.kind === 'entrance' ? '出入口' : '车辆节点'} ${vehicleNodes.findIndex(item => item.id === node.id) + 1}`; };
  useEffect(() => { setCandidate(null); setError(''); }, [catalog, fromId, toId]);
  function calculate(event) { event.preventDefault(); try { setCandidate(findUndergroundVehicleCandidate(catalog, { fromNodeId: fromId, toNodeId: toId })); setError(''); } catch (reason) { setCandidate(null); setError(reason.message); } }
  return <Dialog><DialogTrigger asChild><Button variant="outline" size="sm"><Car className="size-4" />地下车辆候选</Button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>地下车辆候选路径</DialogTitle><DialogDescription>按已收录的地下车行路段核查连接情况。候选图不提供实际驾车导航或预计到达时间。</DialogDescription></DialogHeader>{vehicleNodes.length < 2 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">当前目录尚未收录连通的地下车辆路网，请由维护者核验后补充。</p> : <><form onSubmit={calculate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div className="space-y-1"><span className="text-xs text-muted-foreground">车辆起点</span><Select value={fromId} onValueChange={setFrom}><SelectTrigger className="w-full" aria-label="车辆候选起点"><SelectValue /></SelectTrigger><SelectContent>{vehicleNodes.map(node => <SelectItem key={node.id} value={node.id}>{label(node)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><span className="text-xs text-muted-foreground">车辆终点</span><Select value={toId} onValueChange={setTo}><SelectTrigger className="w-full" aria-label="车辆候选终点"><SelectValue /></SelectTrigger><SelectContent>{vehicleNodes.map(node => <SelectItem key={node.id} value={node.id}>{label(node)}</SelectItem>)}</SelectContent></Select></div><Button type="submit" className="self-end">查看候选</Button></form>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{candidate && <div className="space-y-3"><p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{candidate.isDemo ? '示例车行路网，不能用于真实驾驶。' : ''}{candidate.notice}</p><p className="text-sm font-medium">目录总长约 {candidate.distanceMeters} 米 · {candidate.steps.length} 段</p><div ref={overview} tabIndex={-1} aria-label="地下车辆候选路线图" className="campus-guide-map h-72 overflow-hidden rounded-lg border"><DiagramMap catalog={catalog} places={EMPTY} routePoints={candidate.points} eventCounts={{}} labels progress={0} zoom={1} mode="underground" /></div><ol className="space-y-2 text-xs text-muted-foreground">{candidate.steps.map((step, index) => <li key={step.id}>{index + 1}. {step.description} · 约 {Math.round(step.distanceMeters)} 米</li>)}</ol><CampusStreetView catalog={catalog} route={candidate} onReturnToMap={() => focusMapOverview(overview.current)} /></div>}</>}</DialogContent></Dialog>;
}

export function CampusIndoorMap({ catalog, placeId, plans, selectedRoomId, onSelectRoom }) {
  const available = useMemo(() => (plans || catalog?.indoorPlans || catalog?.floorPlans || EMPTY).filter(plan => !placeId || plan.placeId === placeId), [plans, catalog?.indoorPlans, catalog?.floorPlans, placeId]);
  const [planId, setPlanId] = useState(''), [query, setQuery] = useState(''), [roomId, setRoomId] = useState('');
  const sharedRoomPlan = selectedRoomId ? available.find(item => (item.rooms || EMPTY).some(room => room.id === selectedRoomId)) : null;
  const plan = sharedRoomPlan || available.find(item => item.id === planId) || available[0];
  const currentRoom = selectedRoomId || roomId;
  useEffect(() => { setRoomId(''); setQuery(''); }, [placeId]);
  useEffect(() => { if (sharedRoomPlan) { setPlanId(sharedRoomPlan.id); setQuery(''); } }, [sharedRoomPlan?.id, selectedRoomId]);
  const hints = useMemo(() => inferredRooms(catalog || {}, placeId), [catalog, placeId]);
  const matchingHints = hints.filter(hint => !query.trim() || `${hint.room} ${hint.floor} ${hint.sourceTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  const rooms = (plan?.rooms || EMPTY).filter(room => !query.trim() || `${room.name} ${room.number} ${room.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  const select = room => { setRoomId(room.id); onSelectRoom?.(room, plan); };
  return <section className="space-y-3" aria-label="楼内楼层与房间">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">楼内平面图与房间</h3>{plan && <Select value={plan.id} onValueChange={value => { const next = available.find(item => item.id === value); setPlanId(value); setRoomId(''); onSelectRoom?.(null, next); }}><SelectTrigger size="sm" className="max-w-full" aria-label="选择楼层"><SelectValue /></SelectTrigger><SelectContent>{available.map(item => <SelectItem key={item.id} value={item.id}>{item.floor} · {item.name}</SelectItem>)}</SelectContent></Select>}</div>
    {selectedRoomId && !sharedRoomPlan && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">分享链接中的房间尚未收录在这个地点的楼层资料中，请核对房号或联系维护者。</p>}
    {plan ? <DemoNotice demo={plan.isDemo}>{plan.sourceUrl ? '房间位置来自已收录的楼层资料，请以现场标识为准。' : '平面图由目录维护者提供，请以现场标识为准。'}</DemoNotice> : <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">这个地点还没有收录有授权的楼层平面图。</p>}
    <div className="relative"><Search className="absolute top-2.5 left-3 size-3.5 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜房间号、教室、卫生间…" aria-label="搜索楼内房间" className="pl-8" /></div>
    {plan && <><div className="overflow-hidden rounded-lg border bg-[#f3f5f0]"><svg className="campus-indoor-diagram aspect-[5/3] w-full" viewBox={`0 0 ${plan.width || 1000} ${plan.height || 600}`} role="group" aria-label={`${plan.name}，${plan.isDemo ? '示例' : '已收录'}平面图`}>
      <rect width={plan.width || 1000} height={plan.height || 600} fill="#f3f5f0" />
      {plainLink(plan.imageUrl) && <image href={plainLink(plan.imageUrl)} width={plan.width || 1000} height={plan.height || 600} preserveAspectRatio="xMidYMid meet" />}
      {(plan.paths || EMPTY).map((path, index) => <polyline key={index} points={(path.points || EMPTY).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#e0e7dc" strokeWidth="30" strokeLinecap="round" />)}
      {(plan.rooms || EMPTY).map(room => {
        const selected = room.id === currentRoom, matched = !query || rooms.some(item => item.id === room.id);
        return <g key={room.id} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${room.number || ''} ${room.name}`} onClick={() => select(room)} onKeyDown={activate(() => select(room))} style={{ opacity: matched ? 1 : 0.25 }} className="cursor-pointer"><title>{room.number} {room.name}</title><rect x={room.x} y={room.y} width={room.width} height={room.height} rx="9" fill={selected ? '#e8c575' : room.type === 'toilet' ? '#c1dbd3' : '#d6e1cf'} stroke={selected ? '#b98424' : '#a4b69c'} strokeWidth={selected ? 5 : 2} /><text x={room.x + room.width / 2} y={room.y + room.height / 2 - 3} textAnchor="middle" fill="#334b3b" fontSize="17" fontWeight="600">{room.number || room.name}</text>{room.number && <text x={room.x + room.width / 2} y={room.y + room.height / 2 + 20} textAnchor="middle" fill="#54664e" fontSize="13">{room.name.slice(0, Math.max(2, Math.floor(room.width / 15)))}</text>}</g>;
      })}
    </svg></div>
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" aria-label="房间列表">{rooms.map(room => <Button key={room.id} size="xs" variant={currentRoom === room.id ? 'default' : 'outline'} aria-pressed={currentRoom === room.id} onClick={() => select(room)}>{room.number} {room.name}</Button>)}{!rooms.length && <p className="text-xs text-muted-foreground">没有找到这个房间，请核对楼层或房间号。</p>}</div>
    {plan.sourceUrl && plainLink(plan.sourceUrl) && <a href={plainLink(plan.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">查看平面图来源</a>}</>}
    {!!hints.length && <div className="space-y-2 rounded-lg border border-dashed p-3"><h4 className="text-xs font-medium">活动中提到的房间 <Badge variant="secondary" className="text-[10px]">推测，未核验</Badge></h4><p className="text-[11px] leading-relaxed text-muted-foreground">房号来自已收录活动；楼层由通知文字或房号前缀推测。提示不会补入平面图，也不能证明房间位置或可达性。</p>{matchingHints.length ? <ul className="max-h-40 space-y-2 overflow-y-auto">{matchingHints.map(hint => <li key={hint.room} className="text-xs"><span className="font-medium">{hint.room} 室{hint.floor ? ` · 推测 ${hint.floor} 层` : ''}</span><p className="mt-0.5 text-[11px] text-muted-foreground">依据：{hint.sourceTitle}{plainLink(hint.sourceUrl) && <> · <a href={plainLink(hint.sourceUrl)} target="_blank" rel="noopener noreferrer" className="underline">查看活动来源</a></>}</p></li>)}</ul> : <p className="text-xs text-muted-foreground">没有匹配的推测房间。</p>}</div>}
  </section>;
}

export function CampusParcelMap({ catalog, stationId, placeId, stations }) {
  const available = useMemo(() => (stations || catalog?.parcelStations || EMPTY).filter(station => !placeId || station.placeId === placeId), [stations, catalog?.parcelStations, placeId]);
  const [chosen, setChosen] = useState(''), [code, setCode] = useState(''), [submitted, setSubmitted] = useState(''), [manualId, setManualId] = useState(''), [facilityQuery, setFacilityQuery] = useState(''), [facilityId, setFacilityId] = useState('');
  const station = available.find(item => item.id === (stationId || chosen)) || available[0];
  useEffect(() => { setCode(''); setSubmitted(''); setManualId(''); setFacilityQuery(''); setFacilityId(''); }, [station?.id]);
  const match = useMemo(() => findParcelShelf(station, submitted), [station, submitted]);
  const facilities = useMemo(() => searchParcelFacilities(station, facilityQuery), [station, facilityQuery]);
  const selectedFacility = station?.facilities?.find(facility => facility.id === facilityId);
  const highlighted = manualId ? [manualId] : match.matches.map(shelf => shelf.id);
  if (!station) return <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">当前目录还没有收录快递站货架图。</p>;
  return <section className="space-y-3" aria-label="快递站找货架">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><Package className="size-4" />快递站找货架</h3>{available.length > 1 && <Select value={station.id} onValueChange={setChosen}><SelectTrigger size="sm" aria-label="选择快递站"><SelectValue /></SelectTrigger><SelectContent>{available.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>}</div>
    <DemoNotice demo={station.isDemo}>{station.notice || '货架位置由站点资料提供，请以现场标识为准。'}</DemoNotice>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setSubmitted(code); setManualId(''); }}><Input value={code} onChange={event => setCode(event.target.value)} placeholder={`取件码或货架号${station.shelves?.[0]?.prefixes?.[0] ? `，如 ${station.shelves[0].prefixes[0]}-3-2045` : ''}`} aria-label="取件码或货架号" maxLength={100} autoComplete="off" /><Button size="sm" className="h-9" type="submit">找货架</Button></form>
    <p className="text-[11px] leading-relaxed text-muted-foreground">仅在本页解析，不上传或保存取件码。按站点登记的前缀匹配，不能查询物流或验证包裹。</p>
    {submitted && <p role="status" className={cn('rounded-md px-3 py-2 text-xs', match.status === 'found' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : 'bg-muted text-muted-foreground')}>{match.status === 'found' ? `已标出 ${match.matches[0].label}${match.level ? ` · 第 ${match.level} 层` : ''}${station.isDemo ? '（示例匹配结果）' : ''}` : match.message}</p>}
    {!!station.facilities?.length && <div className="space-y-2"><Input value={facilityQuery} onChange={event => { setFacilityQuery(event.target.value); setFacilityId(''); }} placeholder="搜索服务台、智能柜、出入口…" aria-label="搜索快递站设施" maxLength={100} /><div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">{facilities.map(facility => <Button key={facility.id} size="xs" variant={facility.id === facilityId ? 'default' : 'outline'} aria-pressed={facility.id === facilityId} onClick={() => setFacilityId(facility.id)}>{facility.name}</Button>)}{!facilities.length && <p role="status" className="text-xs text-muted-foreground">未找到这个设施，请核对名称或联系站点工作人员。</p>}</div>{selectedFacility && <p role="status" className="text-xs text-muted-foreground">已标出站内设施：{selectedFacility.name}。请以现场标识为准。</p>}</div>}
    <div className="overflow-hidden rounded-lg border bg-[#f3f5f0]"><svg className="campus-indoor-diagram aspect-[5/3] w-full" viewBox={`0 0 ${station.width || 1000} ${station.height || 600}`} role="group" aria-label={`${station.name}${station.isDemo ? '示例' : ''}货架平面图`}>
      <rect width={station.width || 1000} height={station.height || 600} fill="#f3f5f0" />
      {(station.shelves || EMPTY).map(shelf => <g key={shelf.id} role="button" tabIndex={0} aria-pressed={highlighted.includes(shelf.id)} aria-label={shelf.label} onClick={() => setManualId(shelf.id)} onKeyDown={activate(() => setManualId(shelf.id))} className="cursor-pointer"><title>{shelf.label}</title><rect x={shelf.x} y={shelf.y} width={shelf.width} height={shelf.height} rx="7" fill={highlighted.includes(shelf.id) ? '#da8f57' : '#d6e1cf'} stroke={highlighted.includes(shelf.id) ? '#a75125' : '#a1b397'} strokeWidth={highlighted.includes(shelf.id) ? 5 : 2} /><text x={shelf.x + shelf.width / 2} y={shelf.y + shelf.height / 2 + 6} textAnchor="middle" fill={highlighted.includes(shelf.id) ? '#fff' : '#41583c'} fontWeight="600" fontSize="18">{shelf.label}</text></g>)}
      {(station.facilities || EMPTY).map(facility => { const selected = facility.id === facilityId, matched = !facilityQuery.trim() || facilities.some(item => item.id === facility.id); return <g key={facility.id} transform={`translate(${facility.x},${facility.y})`} role="button" tabIndex={0} aria-label={`站内设施：${facility.name}`} aria-pressed={selected} onClick={() => setFacilityId(facility.id)} onKeyDown={activate(() => setFacilityId(facility.id))} className="cursor-pointer" opacity={matched ? 1 : 0.25}><title>{facility.name}</title>{selected && <circle r="19" fill="#e8c575" stroke="#b98424" strokeWidth="3" />}<circle r="8" fill={selected ? '#a66b20' : '#6d8e89'} /><text y="32" textAnchor="middle" fontSize="15" fill="#415a52" fontWeight={selected ? '700' : '400'}>{facility.name}</text></g>; })}
    </svg></div>
    <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">{(station.shelves || EMPTY).map(shelf => <Button key={shelf.id} size="xs" variant={highlighted.includes(shelf.id) ? 'default' : 'outline'} aria-pressed={highlighted.includes(shelf.id)} onClick={() => setManualId(shelf.id)}>{shelf.label}</Button>)}</div>
    {plainLink(station.sourceUrl) && <a href={plainLink(station.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">查看站点图来源</a>}
  </section>;
}

/** Only display images explicitly supplied with the catalog; never borrow reference-site street views. */
function focusMapOverview(element) {
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element?.focus({ preventScroll: true });
}

function StreetViewOverview({ catalog, route, scenes, index, onSelect }) {
  const points = useMemo(() => streetViewRoutePoints(catalog, route), [catalog, route]);
  const positions = useMemo(() => scenes.map(scene => streetViewPosition(catalog, scene)), [catalog, scenes]);
  const project = useMemo(() => mapProjection([...points, ...positions.map(position => position?.point).filter(Boolean)], catalog?.meta?.center, 1000, 440), [catalog?.meta?.center, points, positions]);
  const current = positions[index];
  if (!points.length && !positions.some(Boolean)) return <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">这些图片没有已记录的图上位置，暂时无法显示路线小图。</p>;
  return <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
    <p className="px-1 text-[11px] text-muted-foreground">路线小图 · 点击图中序号切换图片</p>
    <svg viewBox="0 0 1000 440" className="h-40 w-full rounded bg-[#eef3ed]" role="group" aria-label={`街景路线小图，当前第 ${index + 1} 张图片${current ? '，高亮点为图片记录位置' : '，当前图片位置未记录'}`}>
      {points.length > 1 && <polyline points={points.map(project).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#8cae9e" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />}
      {points.length > 1 && [[points[0], '起点'], [points.at(-1), '终点']].map(([value, label]) => { const point = project(value); return <g key={label} transform={`translate(${point.x},${point.y})`}><circle r="12" fill={label === '起点' ? '#fff' : '#315c4b'} stroke="#315c4b" strokeWidth="3" /><text y="-23" textAnchor="middle" fill="#315c4b" fontSize="24">{label}</text></g>; })}
      {positions.map((position, sceneIndex) => {
        if (!position) return null;
        const point = project(position.point), selected = sceneIndex === index;
        return <g key={scenes[sceneIndex].id} transform={`translate(${point.x},${point.y})`} role="button" tabIndex={0} aria-pressed={selected} aria-label={`选择第 ${sceneIndex + 1} 张街景图片${selected ? '，当前图片' : ''}`} onClick={() => onSelect(sceneIndex)} onKeyDown={activate(() => onSelect(sceneIndex))} className="cursor-pointer">
          <title>{`第 ${sceneIndex + 1} 张 · ${scenes[sceneIndex].description || '已记录图片位置'}`}</title>
          {selected && <circle r="34" fill="#d18b2c" fillOpacity=".2" />}
          <circle r={selected ? 23 : 19} fill={selected ? '#a96218' : '#fff'} stroke={selected ? '#fff' : '#547c69'} strokeWidth="4" />
          <text textAnchor="middle" y="7" fontSize="22" fontWeight="600" fill={selected ? '#fff' : '#315c4b'}>{sceneIndex + 1}</text>
        </g>;
      })}
    </svg>
    <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">{current ? current.basis === 'edge' ? '高亮点由图片记录的道路里程插值，仅表示图片位置。' : '高亮点来自图片记录的坐标或节点，仅表示图片位置。' : '当前图片未记录坐标、节点或道路里程，小图不猜测它的位置。'} 图上点位不会跟踪你的实时位置。</p>
  </div>;
}

export function CampusStreetView({ catalog, route, placeId, onReturnToMap }) {
  const scenes = useMemo(() => routeStreetViews(catalog || {}, route, placeId).filter(scene => plainLink(scene.imageUrl)), [catalog, route, placeId]);
  const [index, setIndex] = useState(0), [failed, setFailed] = useState(false), [completed, setCompleted] = useState(false), [collapsed, setCollapsed] = useState(false);
  const sceneIndex = Math.min(index, Math.max(0, scenes.length - 1)), scene = scenes[sceneIndex];
  const mileage = streetViewMileage(scene), last = sceneIndex === scenes.length - 1;
  useEffect(() => { setIndex(0); setFailed(false); setCompleted(false); setCollapsed(false); }, [route, placeId]);
  useEffect(() => { setIndex(value => Math.min(value, Math.max(0, scenes.length - 1))); setCompleted(false); }, [scenes.length]);
  useEffect(() => { setFailed(false); }, [scene?.id, scene?.imageUrl]);
  function select(next) { setIndex(Math.max(0, Math.min(scenes.length - 1, next))); setCompleted(false); }
  function returnToMap() { setCollapsed(true); if (onReturnToMap) onReturnToMap(); else focusMapOverview(document.querySelector('[data-campus-map-overview]')); }
  if (!scene) return <p className="rounded-lg border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">当前路线没有收录有授权的街景图片。地下路线仅展示目录中的路网，请以现场指示为准。</p>;
  if (collapsed) return <section className="space-y-2 rounded-lg border p-3" aria-label="路线街景预览"><p className="text-xs text-muted-foreground">{completed ? '图片预览已完成，' : ''}已返回地图。图片预览不会判断是否到达现场。</p><Button size="sm" variant="outline" onClick={() => { setCollapsed(false); setCompleted(false); }}>继续查看街景</Button></section>;
  return <section className="space-y-3" aria-label="路线街景预览">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><Navigation className="size-4" />路线街景 · {sceneIndex + 1}/{scenes.length}</h3><Button size="xs" variant="ghost" onClick={returnToMap}>返回地图</Button></div>
    <DemoNotice demo={scene.isDemo}>图片由目录维护者收录，请以现场指示为准。</DemoNotice>
    <p className="text-xs leading-relaxed text-muted-foreground">地下 GPS 可能不可用。请按现场标志手动切换图片；图片点位与预览完成均不会判断你是否到达。</p>
    <StreetViewOverview catalog={catalog} route={route} scenes={scenes} index={sceneIndex} onSelect={select} />
    <div className="overflow-hidden rounded-lg border bg-muted">{failed ? <p className="p-8 text-sm text-muted-foreground" role="status">街景图片暂时无法读取。</p> : <img key={scene.id} src={plainLink(scene.imageUrl)} alt={scene.description || '路线街景'} className="max-h-80 w-full object-contain" onError={() => setFailed(true)} loading="lazy" />}</div>
    <div aria-live="polite"><p className="text-xs text-muted-foreground">{scene.description}</p>{mileage && <p className="mt-1 text-[11px] text-muted-foreground">沿当前行进方向，图片距路网起点约 {Math.round(mileage.meters)} 米 / 全程约 {Math.round(mileage.totalMeters)} 米。图片位置由目录里程记录，仍需现场核验。</p>}</div>
    {scenes.length > 1 && <input type="range" min="0" max={scenes.length - 1} step="1" value={sceneIndex} onChange={event => select(Number(event.target.value))} aria-label="沿路线选择街景图片" className="w-full accent-emerald-700" />}
    <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={sceneIndex === 0} onClick={() => select(sceneIndex - 1)}><ChevronLeft />后退</Button><span className="text-xs text-muted-foreground">手动图片预览</span>{last ? <Button size="sm" variant="outline" disabled={completed} onClick={() => setCompleted(true)}>完成图片预览</Button> : <Button size="sm" variant="outline" onClick={() => select(sceneIndex + 1)}>前进<ChevronRight /></Button>}</div>
    {last && <p className="text-[11px] leading-relaxed text-muted-foreground">已到最后一张图片。{mileage ? mileage.remainingMeters > 0.5 ? `按目录里程，图片距路网终点仍约 ${Math.round(mileage.remainingMeters)} 米。` : '图片记录位置在路网终点附近。' : '图片序列结束不代表路网终点。'}请核对现场标志。</p>}
    {completed && <div className="space-y-2 rounded-lg border bg-emerald-50 p-3 text-xs text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" role="status"><p>已完成图片预览。是否抵达目的地仍需你在现场确认。</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={returnToMap}>返回地图</Button><Button size="sm" variant="outline" onClick={() => select(0)}>从头预览</Button></div></div>}
    {plainLink(scene.sourceUrl) && <a href={plainLink(scene.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-xs underline">查看图片来源</a>}
  </section>;
}
