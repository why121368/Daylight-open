import { distanceBetween, guideError } from './campus-guide.js';

const clone = value => structuredClone(value);
const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const fail = message => { throw guideError(message, 422, 'CAMPUS_GEOMETRY_OPERATION_INVALID'); };
const walkable = edge => !edge.closed && edge.walkable !== false && (edge.kind !== 'vehicle' || edge.walkable === true);
const coordinate = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const rounded = point => ({ lat: Math.round(point.lat * 1e8) / 1e8, lng: Math.round(point.lng * 1e8) / 1e8 });

class DistanceHeap {
  items = [];
  push(value) { let index = this.items.length; this.items.push(value); while (index) { const parent = (index - 1) >> 1; if (this.items[parent].distance <= value.distance) break; this.items[index] = this.items[parent]; index = parent; } this.items[index] = value; }
  pop() { const first = this.items[0], last = this.items.pop(); if (this.items.length) { let index = 0; while (index * 2 + 1 < this.items.length) { let next = index * 2 + 1; if (next + 1 < this.items.length && this.items[next + 1].distance < this.items[next].distance) next++; if (this.items[next].distance >= last.distance) break; this.items[index] = this.items[next]; index = next; } this.items[index] = last; } return first; }
  get length() { return this.items.length; }
}

export function projectToSegment(point, from, to) {
  if (![point, from, to].every(coordinate)) fail('投影坐标无效。');
  const cosine = Math.max(0.01, Math.cos((from.lat + to.lat) / 2 * Math.PI / 180));
  const dx = (to.lng - from.lng) * cosine, dy = to.lat - from.lat, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.lng - from.lng) * cosine * dx + (point.lat - from.lat) * dy) / length)) : 0;
  const projected = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  return { ...rounded(projected), t, distanceMeters: distanceBetween(point, projected) };
}

export function snapEntranceToWall(place, point, { maxMeters = 15 } = {}) {
  if (!Number.isFinite(maxMeters) || maxMeters < 0 || maxMeters > 100) fail('墙边吸附阈值应为 0 至 100 米。');
  let nearest;
  for (const polygon of place?.polygons || []) for (let index = 0; index < polygon.points.length; index++) {
    const projection = projectToSegment(point, polygon.points[index], polygon.points[(index + 1) % polygon.points.length]);
    if (!nearest || projection.distanceMeters < nearest.distanceMeters) nearest = { ...projection, polygonId: polygon.id, sideIndex: index };
  }
  return nearest && nearest.distanceMeters <= maxMeters ? { point: { lat: nearest.lat, lng: nearest.lng }, snapped: true, ...nearest } : { point: rounded(point), snapped: false, distanceMeters: nearest?.distanceMeters ?? null, reason: nearest ? '位置超出墙边吸附阈值。' : '当前建筑还没有轮廓。' };
}

export function bindEntrancesByDistance(input, { maxMeters = 15, placeId = '', replace = false, level = 'ground' } = {}) {
  if (!Number.isFinite(maxMeters) || maxMeters < 0 || maxMeters > 100) fail('入口绑定阈值应为 0 至 100 米。');
  const catalog = clone(input), connected = new Set(catalog.edges.filter(walkable).flatMap(edge => [edge.from, edge.to]));
  const nodes = catalog.nodes.filter(node => (node.level || 'ground') === level && connected.has(node.id));
  const bound = [], unmatched = [], retained = [];
  for (const place of catalog.places.filter(row => !placeId || row.id === placeId)) for (const entrance of place.entrances || []) {
    if (entrance.nodeId && !replace) { retained.push(entrance.id); continue; }
    let nearest, meters = Infinity;
    for (const node of nodes) { const distance = distanceBetween(entrance, node); if (distance < meters || distance === meters && node.id < nearest.id) { nearest = node; meters = distance; } }
    if (nearest && meters <= maxMeters) { entrance.nodeId = nearest.id; bound.push({ placeId: place.id, entranceId: entrance.id, nodeId: nearest.id, distanceMeters: Math.round(meters * 10) / 10 }); }
    else unmatched.push({ placeId: place.id, entranceId: entrance.id, retainedNodeId: entrance.nodeId || '', distanceMeters: Number.isFinite(meters) ? Math.round(meters) : null });
  }
  return { catalog, bound, unmatched, retained };
}

function segmentIntersection(a, b, c, d) {
  const rx = b.lng - a.lng, ry = b.lat - a.lat, sx = d.lng - c.lng, sy = d.lat - c.lat;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-16) return null;
  const qx = c.lng - a.lng, qy = c.lat - a.lat, t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
  if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
  return { point: rounded({ lng: a.lng + Math.max(0, Math.min(1, t)) * rx, lat: a.lat + Math.max(0, Math.min(1, t)) * ry }), t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
}

function overlappingSegments(a, b, c, d) {
  const cosine = Math.max(0.01, Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
  const dx = (b.lng - a.lng) * cosine, dy = b.lat - a.lat, squared = dx * dx + dy * dy;
  const along = point => ((point.lng - a.lng) * cosine * dx + (point.lat - a.lat) * dy) / squared;
  const away = point => Math.abs((point.lng - a.lng) * cosine * dy - (point.lat - a.lat) * dx) / Math.sqrt(squared) * 111195;
  if (away(c) > 0.05 || away(d) > 0.05) return false;
  return (Math.min(1, Math.max(along(c), along(d))) - Math.max(0, Math.min(along(c), along(d)))) * distanceBetween(a, b) > 0.1;
}

/** A new administrator-drawn edge splits same-level crossings; no cross-floor joins are inferred. */
export function insertRoadWithIntersections(input, road, { idFactory = uid, snapMeters = 0.5 } = {}) {
  const catalog = clone(input), nodes = new Map(catalog.nodes.map(node => [node.id, node])), a = nodes.get(road.from), b = nodes.get(road.to);
  if (!a || !b || a.id === b.id || distanceBetween(a, b) < 0.2 || !Number.isFinite(road.distanceMeters) || road.distanceMeters <= 0) fail('道路需要两个不同的节点及有效长度。');
  if (catalog.edges.some(edge => edge.id === road.id || (edge.level || 'ground') === (road.level || 'ground') && (edge.from === road.from && edge.to === road.to || edge.from === road.to && edge.to === road.from))) fail('相同端点已有道路，请选择该道路编辑。');
  const cuts = new Map([[road.id, [{ t: 0, node: a }, { t: 1, node: b }]]]), originals = new Map([[road.id, road]]);
  let junctionsAdded = 0;
  const nodeAt = point => {
    const existing = catalog.nodes.find(node => (node.level || 'ground') === (road.level || 'ground') && distanceBetween(node, point) <= snapMeters);
    if (existing) return existing;
    const created = { id: idFactory('junction'), ...point, level: road.level || 'ground', kind: 'junction', isDemo: Boolean(road.isDemo) };
    catalog.nodes.push(created); nodes.set(created.id, created); junctionsAdded++; return created;
  };
  const addCut = (edge, t, node) => {
    originals.set(edge.id, edge); const list = cuts.get(edge.id) || [{ t: 0, node: nodes.get(edge.from) }, { t: 1, node: nodes.get(edge.to) }];
    if (t > 1e-6 && t < 1 - 1e-6 && !list.some(cut => cut.node.id === node.id || Math.abs(cut.t - t) < 1e-6)) list.push({ t, node });
    cuts.set(edge.id, list);
  };
  for (const edge of input.edges) {
    if ((edge.level || 'ground') !== (road.level || 'ground')) continue;
    const c = nodes.get(edge.from), d = nodes.get(edge.to); if (!c || !d) continue;
    if (overlappingSegments(a, b, c, d)) fail('新增道路与已有同层道路重叠，请使用已有路段或调整端点。');
    const crossing = segmentIntersection(a, b, c, d);
    if (crossing) {
      const node = crossing.t <= 1e-6 ? a : crossing.t >= 1 - 1e-6 ? b : crossing.u <= 1e-6 ? c : crossing.u >= 1 - 1e-6 ? d : nodeAt(crossing.point);
      addCut(road, crossing.t, node); addCut(edge, crossing.u, node);
    }
    // Also split a T junction where a road endpoint lies exactly on a collinear segment.
    for (const [point, t, other] of [[a, 0, edge], [b, 1, edge], [c, null, road], [d, null, road]]) {
      const from = nodes.get(other.from), to = nodes.get(other.to), projected = projectToSegment(point, from, to);
      if (projected.distanceMeters <= 0.05 && projected.t > 1e-6 && projected.t < 1 - 1e-6) { addCut(other, projected.t, point); if (t === null) addCut(road, projectToSegment(point, a, b).t, point); }
    }
  }
  const segmentsByOriginal = new Map(), replacements = [];
  for (const [id, values] of cuts) {
    const edge = originals.get(id), ordered = values.sort((left, right) => left.t - right.t), segments = [];
    for (let index = 1; index < ordered.length; index++) {
      const left = ordered[index - 1], right = ordered[index]; if (left.node.id === right.node.id) continue;
      if (edge.distanceMeters * (right.t - left.t) < 0.1) fail('交点过于靠近端点，会生成不足 0.1 米的路段；请先合并邻近节点。');
      const segment = { ...edge, id: index === 1 ? edge.id : idFactory('road'), from: left.node.id, to: right.node.id, distanceMeters: edge.distanceMeters * (right.t - left.t), ...(index > 1 ? { sceneImageUrl: '' } : {}) };
      segments.push({ edge: segment, start: edge.distanceMeters * left.t, end: edge.distanceMeters * right.t }); replacements.push(segment);
    }
    segmentsByOriginal.set(id, segments);
  }
  catalog.edges = [...catalog.edges.filter(edge => !cuts.has(edge.id)), ...replacements];
  for (const scene of catalog.streetViews || []) {
    const segments = segmentsByOriginal.get(scene.edgeId); if (!segments?.length || !Number.isFinite(scene.offsetMeters)) continue;
    const segment = segments.find(value => scene.offsetMeters <= value.end + 1e-6) || segments.at(-1);
    scene.edgeId = segment.edge.id; scene.offsetMeters = Math.max(0, Math.min(segment.edge.distanceMeters, scene.offsetMeters - segment.start));
  }
  return { catalog, junctionsAdded, edgesSplit: [...cuts.values()].filter(list => list.length > 2).length, edgeIds: segmentsByOriginal.get(road.id).map(segment => segment.edge.id) };
}

/** Collapse a straight, unreferenced degree-two node while preserving direction and recorded length. */
export function removeIntermediateNode(input, nodeId, { idFactory = uid, toleranceMeters = 1 } = {}) {
  const catalog = clone(input), center = catalog.nodes.find(node => node.id === nodeId), edges = catalog.edges.filter(edge => edge.from === nodeId || edge.to === nodeId);
  if (!center || edges.length !== 2) fail('只可连接恰好有两条道路的中间节点。');
  if (catalog.places.some(place => place.nodeId === nodeId || place.entrances?.some(entrance => entrance.nodeId === nodeId)) || catalog.streetViews.some(scene => scene.nodeId === nodeId)) fail('该节点仍被地点、入口或街景引用，请先处理关联。');
  const [first, second] = edges, other = edge => catalog.nodes.find(node => node.id === (edge.from === nodeId ? edge.to : edge.from)), a = other(first), b = other(second);
  if (!a || !b || a.id === b.id) fail('中间节点两侧需要不同的有效节点。');
  for (const key of ['level', 'kind', 'covered', 'accessible', 'walkable', 'closed', 'isDemo']) if (first[key] !== second[key]) fail('两侧道路属性不同，请保留这个分界节点。');
  const projected = projectToSegment(center, a, b);
  if (projected.distanceMeters > toleranceMeters || projected.t <= 0 || projected.t >= 1) fail('该节点是转弯或折返；删除会改变通路形状，请保留。');
  const allows = (edge, from, to) => edge.from === from && edge.to === to || edge.bidirectional && edge.from === to && edge.to === from;
  const forward = allows(first, a.id, nodeId) && allows(second, nodeId, b.id), backward = allows(second, b.id, nodeId) && allows(first, nodeId, a.id);
  if (!forward && !backward) fail('两侧单向限制无法连接，不能合并。');
  const from = forward ? a : b, to = forward ? b : a, leading = forward ? first : second;
  const merged = { ...first, id: idFactory('road'), from: from.id, to: to.id, distanceMeters: first.distanceMeters + second.distanceMeters, bidirectional: Boolean(forward && backward), description: [...new Set(edges.map(edge => edge.description).filter(Boolean))].join('；'), sceneImageUrl: '' };
  const position = new Map([[from.id, 0], [nodeId, leading.distanceMeters], [to.id, merged.distanceMeters]]);
  for (const scene of catalog.streetViews) {
    const edge = edges.find(row => row.id === scene.edgeId); if (!edge) continue;
    scene.offsetMeters = Number.isFinite(scene.offsetMeters) ? position.get(edge.from) + (position.get(edge.to) > position.get(edge.from) ? scene.offsetMeters : -scene.offsetMeters) : null; scene.edgeId = merged.id;
  }
  for (const edge of edges.filter(row => row.sceneImageUrl)) catalog.streetViews.push({ id: idFactory('scene'), edgeId: merged.id, offsetMeters: null, imageUrl: edge.sceneImageUrl, description: edge.description || '保留的道路图片（具体里程未记录）', isDemo: Boolean(edge.isDemo) });
  catalog.nodes = catalog.nodes.filter(node => node.id !== nodeId); catalog.edges = [...catalog.edges.filter(edge => !edges.includes(edge)), merged];
  return { catalog, mergedEdge: merged, removedNodeId: nodeId };
}

export function findUndergroundVehicleCandidate(catalog, { fromNodeId, toNodeId } = {}) {
  const nodes = new Map(catalog.nodes.map(node => [node.id, node])), edges = catalog.edges.filter(edge => edge.kind === 'vehicle' && edge.level === 'underground' && !edge.closed);
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId) || fromNodeId === toNodeId) fail('请选择两个不同的地下车辆路网节点。');
  const adjacency = new Map(catalog.nodes.map(node => [node.id, []]));
  for (const edge of edges) { adjacency.get(edge.from)?.push({ edge, next: edge.to }); if (edge.bidirectional) adjacency.get(edge.to)?.push({ edge, next: edge.from }); }
  const distances = new Map([[fromNodeId, 0]]), previous = new Map(), queue = new DistanceHeap(); queue.push({ node: fromNodeId, distance: 0 });
  while (queue.length) {
    const current = queue.pop(); if (current.distance !== distances.get(current.node)) continue; if (current.node === toNodeId) break;
    for (const next of adjacency.get(current.node) || []) { const distance = current.distance + next.edge.distanceMeters; if (distance < (distances.get(next.next) ?? Infinity)) { distances.set(next.next, distance); previous.set(next.next, { node: current.node, edge: next.edge }); queue.push({ node: next.next, distance }); } }
  }
  if (!distances.has(toNodeId)) fail('当前目录没有连通的地下车辆候选路段，不能生成候选路径。');
  const steps = []; let cursor = toNodeId;
  while (cursor !== fromNodeId) { const item = previous.get(cursor); steps.unshift({ id: item.edge.id, from: item.node, to: cursor, distanceMeters: item.edge.distanceMeters, description: item.edge.description || '目录地下车辆路段', level: 'underground' }); cursor = item.node; }
  const byId = new Map(edges.map(edge => [edge.id, edge]));
  return { kind: 'vehicle-candidate', candidate: true, isNavigation: false, distanceMeters: Math.round(distances.get(toNodeId)), steps, points: [fromNodeId, ...steps.map(step => step.to)].map(id => ({ ...nodes.get(id), nodeId: id })), isDemo: steps.some(step => byId.get(step.id)?.isDemo), notice: '仅按目录车行路段生成核查候选，不提供真实驾车导航、限高限宽、车流、坡度或道路开放保证；请遵守现场交通标志。' };
}

function streetViewImageUrl(value, mediaOrigin = '') {
  let url, origin = '';
  try { url = new URL(value); } catch { fail('图片使用有效的授权 HTTPS 地址或本站已上传媒体地址。'); }
  if (url.username || url.password) fail('图片地址不能包含访问凭据。');
  if (mediaOrigin) {
    try { const configured = new URL(mediaOrigin); if (['http:', 'https:'].includes(configured.protocol) && !configured.username && !configured.password && !configured.search && !configured.hash && configured.pathname === '/') origin = configured.origin; } catch {}
  }
  const sameOrigin = Boolean(origin && url.origin === origin), mediaPath = /^\/api\/campus-guide\/media\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(url.pathname);
  const ownMedia = sameOrigin && mediaPath && !url.search && !url.hash && !/[?#]/.test(String(value));
  if (sameOrigin && url.pathname.startsWith('/api/campus-guide/media/') && !ownMedia) fail('本站媒体地址必须是完整媒体 ID，不能包含查询参数或片段。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ownMedia)) fail('外部图片仅接受授权 HTTPS 地址；HTTP 仅支持明确同源的本站已上传媒体。');
  return url;
}

export function parseStreetViewManifest(text, { mediaOrigin = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean); if (!lines.length || lines.length > 50) fail('每批提供 1 至 50 行文件名与授权图片 URL。');
  const seen = new Set();
  return lines.map(line => {
    const match = /^([^\t|,]+)[\t|,]\s*(https?:\/\/\S+)$/i.exec(line); if (!match) fail('每行使用 文件名 | 授权 HTTPS 图片地址或本站已上传媒体地址。');
    const filename = match[1].trim(), base = filename.split(/[\\/]/).at(-1), sequence = Number((/^(\d+)/.exec(base) || /(\d+)(?=\.[^.]+$)/.exec(base))?.[1]);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 50 || filename.length > 200) fail('图片文件名需包含 1 至 50 的开头或结尾序号，如 01-scene.jpg 或 scene-01.jpg。');
    const url = streetViewImageUrl(match[2], mediaOrigin);
    if (seen.has(sequence)) fail('同一批图片序号不能重复。'); seen.add(sequence);
    return { filename, sequence, imageUrl: url.href };
  }).sort((a, b) => a.sequence - b.sequence);
}

export function buildStreetViewBatch(input, { edgeIds, images, startMeters = 0, endMeters, sourceUrl = '', mediaOrigin = '', idFactory = uid } = {}) {
  if (!Array.isArray(edgeIds) || !edgeIds.length || edgeIds.length > 100 || new Set(edgeIds).size !== edgeIds.length) fail('请选择最多 100 条不重复的连续路段。');
  if (!Array.isArray(images) || !images.length || images.length > 50) fail('每批需要 1 至 50 张授权图片。');
  if (sourceUrl) { const source = new URL(sourceUrl); if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) fail('来源需为不含凭据的公开网页地址。'); }
  const catalog = clone(input), nodes = new Map(catalog.nodes.map(node => [node.id, node])), edges = edgeIds.map(id => catalog.edges.find(edge => edge.id === id));
  if (edges.some(edge => !edge)) fail('部分路段不存在，请刷新后重试。');
  const chain = []; let cursor = edges[0].from;
  if (edges.length > 1 && ![edges[1].from, edges[1].to].includes(edges[0].to) && [edges[1].from, edges[1].to].includes(edges[0].from)) cursor = edges[0].to;
  for (const edge of edges) { if (edge.from !== cursor && edge.to !== cursor) fail('所选路段必须按连续顺序排列。'); const reverse = edge.to === cursor; const next = reverse ? edge.from : edge.to; chain.push({ edge, from: nodes.get(cursor), to: nodes.get(next), reverse }); cursor = next; }
  const totalMeters = edges.reduce((sum, edge) => sum + edge.distanceMeters, 0), end = endMeters === undefined || endMeters === '' ? totalMeters : Number(endMeters);
  if (!Number.isFinite(startMeters) || !Number.isFinite(end) || startMeters < 0 || end > totalMeters || end < startMeters) fail('街景起止里程需位于所选路段总长度范围内。');
  const generated = [], skipped = [];
  images.forEach((image, index) => {
    const url = streetViewImageUrl(image.imageUrl, mediaOrigin);
    let remaining = startMeters + (images.length === 1 ? 0 : (end - startMeters) * index / (images.length - 1)), segment = chain.at(-1);
    for (const item of chain) { if (remaining <= item.edge.distanceMeters + 1e-6) { segment = item; break; } remaining -= item.edge.distanceMeters; }
    const ratio = Math.min(1, Math.max(0, remaining / segment.edge.distanceMeters)), offsetMeters = segment.reverse ? segment.edge.distanceMeters - remaining : remaining;
    if (catalog.streetViews.some(scene => scene.edgeId === segment.edge.id && scene.imageUrl === url.href && Math.abs((scene.offsetMeters || 0) - offsetMeters) < 0.1)) { skipped.push(image.filename); return; }
    const scene = { id: idFactory('scene'), edgeId: segment.edge.id, offsetMeters: Math.max(0, Math.min(segment.edge.distanceMeters, offsetMeters)), ...rounded({ lat: segment.from.lat + (segment.to.lat - segment.from.lat) * ratio, lng: segment.from.lng + (segment.to.lng - segment.from.lng) * ratio }), imageUrl: url.href, sourceUrl, sourceFilename: image.filename || '', description: `${image.filename || '街景'} · 沿目录路段约 ${Math.round(offsetMeters)} 米（待现场核验）`, isDemo: Boolean(segment.edge.isDemo) };
    catalog.streetViews.push(scene); generated.push(scene);
  });
  if (catalog.streetViews.length > 3000) fail('街景记录总数不能超过 3000，请先整理目录后重试。');
  return { catalog, generated, skipped, totalMeters };
}

/** Order authorized scenes by the actual traversal direction and recorded edge mileage. */
export function routeStreetViews(catalog, route, placeId = '') {
  const edges = new Map((catalog.edges || []).map(edge => [edge.id, edge])), steps = (route?.steps || []).filter(step => edges.has(step.id));
  const traversals = new Map(), nodeMeters = new Map(); let total = 0;
  for (const step of steps) {
    const edge = edges.get(step.id), meters = edge.distanceMeters;
    traversals.set(step.id, { step, edge, start: total }); nodeMeters.set(step.from, total); total += meters; nodeMeters.set(step.to, total);
  }
  const placeNodes = new Map((catalog.places || []).map(place => [place.id, place.nodeId]));
  const selectedPlaceNode = placeId ? placeNodes.get(placeId) : '';
  const scenes = [];
  for (const scene of catalog.streetViews || []) {
    const traversal = traversals.get(scene.edgeId), nodePosition = nodeMeters.get(scene.nodeId || placeNodes.get(scene.placeId));
    if (steps.length && (scene.edgeId ? !traversal : nodePosition === undefined)) continue;
    if (!steps.length && placeId && scene.placeId !== placeId && !(selectedPlaceNode && selectedPlaceNode === scene.nodeId)) continue;
    const hasOffset = Number.isFinite(scene.offsetMeters), offset = traversal && hasOffset ? Math.max(0, Math.min(traversal.edge.distanceMeters, scene.offsetMeters)) : 0;
    const routeMeters = traversal ? hasOffset ? traversal.start + (traversal.step.from === traversal.edge.from ? offset : traversal.edge.distanceMeters - offset) : undefined : nodePosition;
    scenes.push({ ...scene, ...(routeMeters === undefined ? {} : { routeMeters }), routeTotalMeters: total, _orderMeters: routeMeters ?? traversal?.start ?? nodePosition ?? Infinity });
  }
  for (const { step, edge, start } of traversals.values()) if ((step.sceneImageUrl || edge.sceneImageUrl) && !scenes.some(scene => scene.edgeId === edge.id && scene.imageUrl === (step.sceneImageUrl || edge.sceneImageUrl))) scenes.push({ id: `edge-scene-${edge.id}`, edgeId: edge.id, imageUrl: step.sceneImageUrl || edge.sceneImageUrl, description: step.description || edge.description, isDemo: Boolean(edge.isDemo), routeTotalMeters: total, _orderMeters: start });
  return scenes.sort((a, b) => a._orderMeters - b._orderMeters || (a.offsetMeters ?? 0) - (b.offsetMeters ?? 0) || a.id.localeCompare(b.id)).map(scene => { const { _orderMeters, ...result } = scene; return result; });
}

/** Hints are derived from existing public notices; never inserted into the surveyed floor plan. */
export function inferredRooms(catalog, placeId) {
  const hints = new Map(), place = catalog?.places?.find(row => row.id === placeId); if (!place) return [];
  const known = new Set((catalog.indoorPlans || []).filter(plan => plan.placeId === placeId).flatMap(plan => plan.rooms.map(room => String(room.number).toUpperCase())));
  for (const event of (catalog.events || []).filter(row => row.placeId === placeId && !row.hidden && row.status !== 'cancelled')) {
    const location = [event.room, event.locationText].filter(Boolean).join(' '), prose = [event.title, event.summary, event.description].filter(Boolean).join(' ');
    const matches = [...location.matchAll(/(?:^|[^\d])((?:B\d?[- ]?)?\d{3,4})(?:\s*(?:室|教室|会议室|报告厅)|\b)/gi), ...prose.matchAll(/(?:^|[^\d])((?:B\d?[- ]?)?\d{3,4})\s*(?:室|教室|会议室|报告厅)/gi), ...prose.matchAll(/(?:教室|会议室|房间|报告厅)\s*((?:B\d?[- ]?)?\d{3,4})(?:\b|\s|$)/gi)];
    for (const match of matches) {
      const room = match[1].replace(/\s+/g, '').toUpperCase(); if (/^(?:19|20)\d{2}$/.test(room) || known.has(room) || hints.has(room)) continue;
      const explicit = /(?:B\s*([1-9])\s*(?:层|F)|地下\s*([一二三四五六七八九\d])\s*层|(?:^|[^\d])([1-9]\d?)\s*(?:楼|层|F))/i.exec(event.locationText || event.room || '');
      const floor = explicit ? explicit[1] ? `B${explicit[1]}` : explicit[2] ? `B${'一二三四五六七八九'.includes(explicit[2]) ? '一二三四五六七八九'.indexOf(explicit[2]) + 1 : explicit[2]}` : explicit[3] : room.startsWith('B') ? room.match(/^B(\d)/)?.[0] || 'B1' : room.length >= 3 ? room.slice(0, -2) : '';
      hints.set(room, { room, floor, inferred: true, sourceEventId: event.id, sourceTitle: event.title, sourceUrl: event.sourceUrl || '', notice: '由活动房号推测，未核验楼层、房间位置或可达性。' });
    }
  }
  return [...hints.values()].slice(0, 100).sort((a, b) => a.room.localeCompare(b.room));
}

export function placeGroups(places) {
  const groups = new Map();
  for (const place of places) { const key = place.groupId || place.building || ''; if (!key) continue; const group = groups.get(key) || { id: key, name: place.groupName || place.building || key, places: [] }; group.places.push(place); groups.set(key, group); }
  return [...groups.values()].filter(group => group.places.length > 1);
}

export function searchParcelFacilities(station, query) {
  const text = String(query || '').normalize('NFKC').trim().toLowerCase();
  return (station?.facilities || []).filter(facility => !text || `${facility.name} ${facility.type}`.normalize('NFKC').toLowerCase().includes(text));
}
