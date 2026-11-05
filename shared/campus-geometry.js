import { distanceBetween } from './campus-guide.js';

/** Coordinates remain WGS84. The editor's SVG projection is local and reversible. */
export function geometryBounds(catalog) {
  const points = [...catalog.nodes, ...catalog.places, ...catalog.places.flatMap(place => [...(place.polygons || []).flatMap(polygon => polygon.points), ...(place.entrances || [])])];
  const center = catalog.meta.center || { lat: 31.176, lng: 121.590 };
  if (!points.length) return { minLat: center.lat - 0.003, maxLat: center.lat + 0.003, minLng: center.lng - 0.004, maxLng: center.lng + 0.004 };
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const point of points) { minLat = Math.min(minLat, point.lat); maxLat = Math.max(maxLat, point.lat); minLng = Math.min(minLng, point.lng); maxLng = Math.max(maxLng, point.lng); }
  const latPad = Math.max((maxLat - minLat) * 0.08, 0.0003), lngPad = Math.max((maxLng - minLng) * 0.08, 0.0003);
  return { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad };
}
export function geometryProjection(bounds, { width = 1000, height = 600, padding = 24 } = {}) {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2, longitudeScale = Math.max(0.01, Math.cos(centerLat * Math.PI / 180)), spanX = Math.max(1e-8, (bounds.maxLng - bounds.minLng) * longitudeScale), spanY = Math.max(1e-8, bounds.maxLat - bounds.minLat), scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY), offsetX = (width - spanX * scale) / 2, offsetY = (height - spanY * scale) / 2;
  return {
    project: point => ({ x: offsetX + (point.lng - bounds.minLng) * longitudeScale * scale, y: height - offsetY - (point.lat - bounds.minLat) * scale }),
    unproject: point => ({ lat: Math.round((bounds.minLat + (height - offsetY - point.y) / scale) * 1e7) / 1e7, lng: Math.round((bounds.minLng + (point.x - offsetX) / (longitudeScale * scale)) * 1e7) / 1e7 }),
  };
}
const isWalkable = edge => edge.walkable !== false && (edge.kind !== 'vehicle' || edge.walkable === true) && !edge.closed;
const cross = (a, b, c) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
function intersects(a, b, c, d) {
  const epsilon = 1e-16, aa = cross(a, b, c), bb = cross(a, b, d), cc = cross(c, d, a), dd = cross(c, d, b);
  const opposite = (left, right) => left > epsilon && right < -epsilon || left < -epsilon && right > epsilon;
  const onSegment = (point, from, to) => point.lat >= Math.min(from.lat, to.lat) - epsilon && point.lat <= Math.max(from.lat, to.lat) + epsilon && point.lng >= Math.min(from.lng, to.lng) - epsilon && point.lng <= Math.max(from.lng, to.lng) + epsilon;
  return opposite(aa, bb) && opposite(cc, dd) || Math.abs(aa) <= epsilon && onSegment(c, a, b) || Math.abs(bb) <= epsilon && onSegment(d, a, b) || Math.abs(cc) <= epsilon && onSegment(a, c, d) || Math.abs(dd) <= epsilon && onSegment(b, c, d);
}
export function inspectPolygon(points) {
  if (points.length > 1 && points[0].lat === points.at(-1).lat && points[0].lng === points.at(-1).lng) points = points.slice(0, -1);
  const issues = [], unique = new Set(points.map(point => `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`));
  if (unique.size < 3) issues.push({ kind: 'degenerate', message: '轮廓少于三个不同顶点。' });
  let area = 0; for (let i = 1; i + 1 < points.length; i++) area += cross(points[0], points[i], points[i + 1]);
  if (Math.abs(area) < 1e-14 && unique.size >= 3) issues.push({ kind: 'zero_area', message: '轮廓顶点共线或面积为零。' });
  outer: for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) { if (i === 0 && j === points.length - 1) continue; if (intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) { issues.push({ kind: 'self_intersection', message: '轮廓边线自相交，请调整顶点顺序。' }); break outer; } }
  return issues;
}
function network(catalog, accessible = false) {
  const adjacency = new Map(catalog.nodes.map(node => [node.id, new Set()]));
  const placesByNode = new Map();
  for (const place of catalog.places) { const ids = placesByNode.get(place.nodeId) || []; ids.push(place.id); placesByNode.set(place.nodeId, ids); }
  const edges = catalog.edges.filter(edge => isWalkable(edge) && (!accessible || (edge.accessible !== false && edge.kind !== 'stairs')) && adjacency.has(edge.from) && adjacency.has(edge.to));
  for (const edge of edges) { adjacency.get(edge.from).add(edge.to); adjacency.get(edge.to).add(edge.from); }
  const visited = new Set(), components = [];
  for (const node of catalog.nodes) { if (visited.has(node.id)) continue; const ids = [], queue = [node.id]; visited.add(node.id); for (let cursor = 0; cursor < queue.length; cursor++) { const current = queue[cursor]; ids.push(current); for (const neighbor of adjacency.get(current)) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } } components.push({ id: `component-${components.length + 1}`, nodeIds: ids, placeIds: ids.flatMap(id => placesByNode.get(id) || []) }); }
  return { adjacency, components, edges };
}

/** Diagnostics explain missing survey data; they never create an automatic connecting road. */
export function diagnoseCampusNetwork(catalog, { nearMeters = 15, maxIssues = 2000 } = {}) {
  const nodes = new Map(catalog.nodes.map(node => [node.id, node])), normal = network(catalog), accessible = network(catalog, true), isolatedNodeIds = [...normal.adjacency].filter(([, set]) => !set.size).map(([id]) => id), deadEndNodeIds = [...normal.adjacency].filter(([, set]) => set.size === 1).map(([id]) => id), edgeIssues = [], polygonIssues = [], seenEdges = new Set();
  let truncated = false;
  for (const edge of catalog.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to); if (edgeIssues.length >= maxIssues) { truncated = true; break; }
    if (!from || !to) { edgeIssues.push({ edgeId: edge.id, kind: 'missing_endpoint', message: '道路端点不存在。' }); continue; }
    const straight = distanceBetween(from, to); if (edge.distanceMeters + 5 < straight * 0.9) edgeIssues.push({ edgeId: edge.id, kind: 'distance_shorter_than_straight_line', message: `录入 ${Math.round(edge.distanceMeters)} 米，小于端点直线约 ${Math.round(straight)} 米，请复测。` });
    const key = `${[edge.from, edge.to].sort().join('\0')}\0${edge.level || 'ground'}`; if (seenEdges.has(key)) edgeIssues.push({ edgeId: edge.id, kind: 'duplicate_link', message: '相同层级存在重复端点连线，请确认是否为不同道路。' }); seenEdges.add(key);
    if (edge.kind === 'stairs' && edge.accessible) edgeIssues.push({ edgeId: edge.id, kind: 'stairs_accessible', message: '楼梯被标记为无障碍，请核对是否另有坡道或电梯。' });
  }
  let inspectedVertices = 0;
  polygonScan: for (const place of catalog.places) for (const polygon of place.polygons || []) { inspectedVertices += polygon.points.length; if (polygonIssues.length >= maxIssues || inspectedVertices > 20000) { truncated = true; break polygonScan; } for (const issue of inspectPolygon(polygon.points)) polygonIssues.push({ placeId: place.id, polygonId: polygon.id, ...issue }); }
  const unconnectedPlaces = catalog.places.filter(place => !place.nodeId || !nodes.has(place.nodeId) || !(normal.adjacency.get(place.nodeId)?.size)).map(place => ({ id: place.id, name: place.name, reason: !place.nodeId ? '尚未指定道路节点。' : !nodes.has(place.nodeId) ? '关联节点不存在。' : '关联节点没有可通行步行道路。' }));
  const nearMisses = [], grid = new Map(), cosine = Math.max(0.01, Math.cos(catalog.meta.center.lat * Math.PI / 180)), cell = Math.max(1, nearMeters), location = node => [Math.floor(node.lng * 111320 * cosine / cell), Math.floor(node.lat * 111320 / cell)];
  let comparisons = 0;
  nearScan: for (const node of catalog.nodes) { const [x, y] = location(node); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const other of grid.get(`${x + dx},${y + dy}`) || []) { if (++comparisons > 250000) { truncated = true; break nearScan; } if ((node.level || 'ground') !== (other.level || 'ground') || normal.adjacency.get(node.id)?.has(other.id)) continue; const distance = distanceBetween(node, other); if (distance <= nearMeters) { if (nearMisses.length < maxIssues) nearMisses.push({ from: other.id, to: node.id, distanceMeters: Math.round(distance * 10) / 10 }); else truncated = true; } } const key = `${x},${y}`; const bucket = grid.get(key) || []; bucket.push(node); grid.set(key, bucket); }
  return { summary: { nodes: catalog.nodes.length, edges: catalog.edges.length, walkableEdges: normal.edges.length, closedEdges: catalog.edges.filter(edge => edge.closed).length, places: catalog.places.length, connectedComponents: normal.components.length, isolatedNodes: isolatedNodeIds.length, deadEnds: deadEndNodeIds.length, unconnectedPlaces: unconnectedPlaces.length, nearMisses: nearMisses.length, edgeIssues: edgeIssues.length, polygonIssues: polygonIssues.length }, components: normal.components, isolatedNodeIds, deadEndNodeIds, unconnectedPlaces, nearMisses, edgeIssues, polygonIssues, accessible: { connectedComponents: accessible.components.length, unconnectedPlaceIds: catalog.places.filter(place => !place.nodeId || !accessible.adjacency.get(place.nodeId)?.size).map(place => place.id) }, truncated };
}
