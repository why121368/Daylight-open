/** Pure presentation helpers. Parcel codes stay in the browser. */
export const MAP_CATEGORIES = [
  { id: 'teaching', name: '教学', short: '教', color: '#547ea8' },
  { id: 'research', name: '学院', short: '研', color: '#7d6aac' },
  { id: 'dining', name: '餐饮', short: '食', color: '#bf7a3a' },
  { id: 'service', name: '服务', short: '服', color: '#43897f' },
  { id: 'sports', name: '运动', short: '动', color: '#6d9254' },
  { id: 'residence', name: '住宿', short: '住', color: '#a56f7c' },
  { id: 'gate', name: '校门', short: '门', color: '#667586' },
  { id: 'transit', name: '交通', short: '行', color: '#897c57' },
  { id: 'parking', name: '停车', short: '停', color: '#617a9b' },
];

const LABEL_PRIORITY = { teaching: 90, dining: 75, gate: 70, sports: 60, service: 55, research: 45, residence: 25, transit: 20, parking: 10 };

export function mapLabelText(item) {
  const name = String(item.name || '');
  return item.selected ? name : item.category === 'gate' ? name.replace(/^上海科技大学/, '').replace(/[（(].*$/, '') || name : name;
}

export function mapMarkerPriority(item) {
  return (item.selected ? 10000 : 0) + (item.eventCount ? 1000 : 0)
    + (LABEL_PRIORITY[item.category] || 0) + (item.hasOutline ? 15 : 0);
}

/** Keep cluster anchors fixed so a chain of neighbours cannot swallow the whole map. */
export function clusterMapMarkers(items, radius = 34) {
  const ordered = items.filter(item => Number.isFinite(item.x) && Number.isFinite(item.y))
    .slice().sort((a, b) => mapMarkerPriority(b) - mapMarkerPriority(a) || String(a.id).localeCompare(String(b.id)));
  const clusters = [];
  for (const item of ordered) {
    let nearest, distance = radius;
    for (const cluster of clusters) {
      const next = Math.hypot(item.x - cluster.x, item.y - cluster.y);
      if (next < distance) { nearest = cluster; distance = next; }
    }
    if (nearest) nearest.members.push(item);
    else clusters.push({ ...item, members: [item] });
  }
  return clusters;
}

const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

/** Screen-pixel label placement, independent of the map engine and geographic zoom scale. */
export function layoutMapLabels(items, { width, height, zoom = 17, enabled = true, reserved = [] } = {}) {
  if (!(width > 0 && height > 0)) return [];
  const visible = items.filter(item => item.x >= 0 && item.x <= width && item.y >= 0 && item.y <= height);
  const obstacles = visible.map(item => {
    const radius = item.radius || 12;
    return { id: item.id, left: item.x - radius, right: item.x + radius, top: item.y - radius, bottom: item.y + radius };
  });
  const density = zoom < 17 ? 42000 : zoom < 18 ? 30000 : zoom < 19 ? 21000 : 14000;
  const budget = Math.max(2, Math.min(45, Math.floor(width * height / density)));
  const placed = [], occupied = reserved.slice();
  const ordered = visible.slice().sort((a, b) => mapMarkerPriority(b) - mapMarkerPriority(a) || String(a.id).localeCompare(String(b.id)));
  for (const item of ordered) {
    if (!item.selected && (!enabled || placed.length >= budget)) continue;
    const w = Math.min(item.labelWidth || 100, width - 16), h = item.labelHeight || 22, gap = (item.radius || 12) + 6;
    const options = [
      { left: item.x - w / 2, top: item.y + gap },
      { left: item.x - w / 2, top: item.y - gap - h },
      { left: item.x + gap, top: item.y - h / 2 },
      { left: item.x - gap - w, top: item.y - h / 2 },
    ].map(point => ({ ...point, right: point.left + w, bottom: point.top + h }));
    const inside = rect => rect.left >= 8 && rect.right <= width - 8 && rect.top >= 8 && rect.bottom <= height - 8;
    let rect = options.find(rect => inside(rect) && !occupied.some(other => intersects(rect, other, 5)) && !obstacles.some(other => intersects(rect, other, 3)));
    // The selected name remains available even with labels disabled or a very small viewport.
    if (!rect && item.selected) {
      rect = options.find(rect => inside(rect) && !reserved.some(other => intersects(rect, other, 3)));
    }
    if (!rect) continue;
    occupied.push(rect); placed.push({ id: item.id, ...rect });
  }
  return placed;
}

export function mapCoordinate(value) {
  if (!value || value.lat === null || value.lng === null || value.lat === '' || value.lng === '') return null;
  const lat = Number(value.lat), lng = Number(value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function geoDistance(a, b) {
  a = mapCoordinate(a); b = mapCoordinate(b);
  if (!a || !b) return 0;
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routePlaybackPoint(points, progress) {
  const valid = (Array.isArray(points) ? points : []).map(mapCoordinate).filter(Boolean);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];
  const lengths = valid.slice(1).map((point, index) => geoDistance(valid[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!total) return valid[0];
  let remaining = total * Math.min(1, Math.max(0, Number(progress) || 0));
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] ? Math.min(1, remaining / lengths[index]) : 0;
      return { lat: valid[index].lat + (valid[index + 1].lat - valid[index].lat) * ratio, lng: valid[index].lng + (valid[index + 1].lng - valid[index].lng) * ratio };
    }
    remaining -= lengths[index];
  }
  return valid.at(-1);
}

export function mapProjection(points, center, width = 1000, height = 700) {
  const valid = (Array.isArray(points) ? points : []).map(mapCoordinate).filter(Boolean);
  if (!valid.length) valid.push(mapCoordinate(center) || { lat: 31.176, lng: 121.59 });
  const latitudes = valid.map(point => point.lat), longitudes = valid.map(point => point.lng);
  const midLat = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const midLng = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const longitudeScale = Math.max(0.05, Math.cos(midLat * Math.PI / 180));
  const spanLng = Math.max(0.001, Math.max(...longitudes) - Math.min(...longitudes)) * longitudeScale;
  const spanLat = Math.max(0.001, Math.max(...latitudes) - Math.min(...latitudes));
  const scale = Math.min((width - 180) / spanLng, (height - 180) / spanLat);
  const project = point => {
    const validPoint = mapCoordinate(point);
    return validPoint ? { x: width / 2 + (validPoint.lng - midLng) * longitudeScale * scale, y: height / 2 - (validPoint.lat - midLat) * scale } : null;
  };
  project.invert = point => Number.isFinite(point?.x) && Number.isFinite(point?.y)
    ? mapCoordinate({ lat: midLat - (point.y - height / 2) / scale, lng: midLng + (point.x - width / 2) / (longitudeScale * scale) }) : null;
  return project;
}

const normalizeCode = value => String(value ?? '').normalize('NFKC').trim().replace(/[‐‑–—−]/g, '-').replace(/\s+/g, '').toLowerCase();

/** Match only configured shelf identifiers/prefixes. Never guess missing shelves. */
export function findParcelShelf(station, input) {
  const code = normalizeCode(input);
  if (!code) return { status: 'empty', matches: [] };
  if (code.length > 100) return { status: 'invalid', matches: [], message: '取件码过长，请核对货架号。' };
  const shelves = Array.isArray(station?.shelves) ? station.shelves : [];
  const tokens = code.split(/[-#:/]/).filter(Boolean);
  const prefix = tokens[0];
  const aliases = shelf => [shelf.id, shelf.label, ...(shelf.aliases || []), ...(shelf.prefixes || [])].map(normalizeCode).filter(Boolean);
  const exact = shelves.filter(shelf => aliases(shelf).includes(code));
  const matches = exact.length ? exact : shelves.filter(shelf => aliases(shelf).some(alias => alias === prefix || alias.replace(/(?:号)?货架$/, '').replace(/^货架/, '') === prefix));
  const level = !exact.length && tokens.length >= 3 && /^\d+$/.test(tokens[1]) ? Number(tokens[1]) : null;
  if (!matches.length) return { status: 'missing', matches: [], message: '当前平面图没有这个货架，请向站点工作人员核对。' };
  if (matches.length > 1) return { status: 'ambiguous', matches, level, message: '找到多个可能的货架，请选择并核对。' };
  if (level !== null && (level < 1 || level > Number(matches[0].levels || 5))) return { status: 'invalid-level', matches, level, message: '货架已找到，但层号超出已记录范围，请现场核对。' };
  return { status: 'found', matches, level };
}
