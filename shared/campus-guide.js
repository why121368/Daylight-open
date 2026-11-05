/** Public campus guide contract. No private mailbox or account data belongs here. */
export const PLACE_CATEGORIES = [
  { id: 'teaching', label: '教学楼 / 教室' }, { id: 'research', label: '科研 / 实验室' },
  { id: 'dining', label: '食堂 / 餐饮' }, { id: 'service', label: '校园服务' },
  { id: 'sports', label: '体育设施' }, { id: 'residence', label: '宿舍' },
  { id: 'gate', label: '校门' }, { id: 'transit', label: '交通' }, { id: 'parking', label: '停车场' },
];
export const EVENT_CATEGORIES = [
  { id: 'academic', label: '学术讲座' }, { id: 'arts', label: '文化艺术' },
  { id: 'sports', label: '体育运动' }, { id: 'career', label: '生涯发展' },
  { id: 'community', label: '社团 / 校园' }, { id: 'conference', label: '会议研讨' }, { id: 'workshop', label: '工作坊' }, { id: 'competition', label: '竞赛' }, { id: 'volunteer', label: '志愿公益' }, { id: 'exhibition', label: '展览展示' },
];
export const QUEUE_LEVELS = [
  { id: 'empty', label: '无需排队', waitMinutes: 0 }, { id: 'short', label: '约 5 分钟', waitMinutes: 5 },
  { id: 'medium', label: '约 15 分钟', waitMinutes: 15 }, { id: 'long', label: '约 25 分钟以上', waitMinutes: 25 },
];
export const QUEUE_TTL_MINUTES = 30;
export const GUIDE_COLLECTIONS = ['places', 'nodes', 'edges', 'events', 'venues', 'menus', 'indoorPlans', 'parcelStations', 'streetViews'];
export const guideError = (message, status = 400, code = 'CAMPUS_GUIDE_INVALID') => Object.assign(new Error(message), { status, code });
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw guideError(message); };
const text = (value, max = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const required = (value, label, max = 120) => { assert(typeof value === 'string', `${label}应为文字。`); const result = text(value, max); assert(result, `请填写${label}。`); return result; };
const identifier = (value, label = '编号') => { assert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value), `${label}格式无效。`); return value; };
const number = (value, min, max, label) => { assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${label}无效。`); return value; };
const list = (value, max, label) => { assert(Array.isArray(value) && value.length <= max, `${label}应为最多 ${max} 项的数组。`); return value; };
const strings = (value = [], max = 40) => [...new Set(list(value, max, '标签').map(v => required(v, '标签', 100)))];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export function validDate(value) { return typeof value === 'string' && datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
const date = (value, label) => { assert(validDate(value), `${label}应为有效的 YYYY-MM-DD 日期。`); return value; };
const time = (value, label) => { assert(timePattern.test(value), `${label}应为 HH:MM。`); return value; };
const iso = (value, label) => { assert(typeof value === 'string' && isoPattern.test(value) && Number.isFinite(Date.parse(value)) && validDate(value.slice(0, 10)), `${label}应为带时区的有效日期时间。`); return value; };
const optionalIso = (value, label) => value ? iso(value, label) : '';
const boundedOptionalText = (value, label, max) => { if (value === undefined || value === null) return ''; assert(typeof value === 'string' && value.length <= max, `${label}应为不超过 ${max} 字符的文字。`); return value.replace(/\u0000/g, '').trim(); };
export function validateEventEnglishContent(input) { return { englishSummary: boundedOptionalText(input.englishSummary, '活动英文简介', 1000), englishDescription: boundedOptionalText(input.englishDescription, '活动英文详情', 15000) }; }
function url(value) { if (!value) return ''; assert(typeof value === 'string' && value.length <= 2000, '链接过长。'); let parsed; try { parsed = new URL(value); } catch { throw guideError('链接格式无效。'); } assert(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, '链接仅支持 HTTP(S)，且不得包含凭据。'); return parsed.href; }
function tileUrl(value) { if (!value) return ''; const result = url(value); return result.replace(/%7B([zxy])%7D/gi, '{$1}'); }
function mapImage(value) {
  if (value === undefined || value === null) return null;
  assert(isObject(value) && isObject(value.bounds), '校园底图需要图片与地理边界。');
  const local = typeof value.url === 'string' && /^\/campus-maps\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|webp|jpg)$/.test(value.url);
  const imageUrl = local ? value.url : url(value.url);
  assert(imageUrl, '校园底图需要图片地址。');
  const bounds = { south: number(value.bounds.south, -85, 85, '底图南界'), west: number(value.bounds.west, -180, 180, '底图西界'), north: number(value.bounds.north, -85, 85, '底图北界'), east: number(value.bounds.east, -180, 180, '底图东界') };
  assert(bounds.south < bounds.north && bounds.west < bounds.east, '校园底图边界顺序无效。');
  assert(value.coordinates === 'WGS84', '校园底图须转换为 WGS84，并按 Web Mercator 栅格对齐。');
  assert(['BD-09', 'GCJ-02', 'WGS84'].includes(value.sourceCoordinates), '校园底图来源坐标系无效。');
  return { url: imageUrl, bounds, attribution: required(value.attribution, '底图署名', 500), sourceUrl: url(value.sourceUrl), importedAt: optionalIso(value.importedAt, '底图导入时间'), sourceCoordinates: value.sourceCoordinates, coordinates: 'WGS84' };
}
const bool = (value, fallback = false) => { assert(value === undefined || typeof value === 'boolean', '布尔字段无效。'); return value ?? fallback; };
function days(value = [1, 2, 3, 4, 5, 6, 7]) { return [...new Set(list(value, 7, '星期').map(d => { assert(Number.isInteger(d) && d >= 1 && d <= 7, '星期应为 1（周一）至 7（周日）。'); return d; }))]; }
function hours(value = []) { return list(value, 40, '开放时段').map(row => { assert(isObject(row), '开放时段无效。'); return { days: days(row.days), start: time(row.start, '开放时间'), end: time(row.end, '关闭时间') }; }); }
function coordinate(row) { assert(isObject(row), '坐标应为包含纬度和经度的对象。'); return { lat: number(row.lat, -90, 90, '纬度'), lng: number(row.lng, -180, 180, '经度') }; }
function rows(value, max, label, fn) {
  const seen = new Set();
  return list(value, max, label).map(input => { assert(isObject(input), `${label}项应为对象。`); const row = fn(input); assert(!seen.has(row.id), `${label}存在重复编号 ${row.id}。`); seen.add(row.id); return row; });
}
export function emptyCatalog() {
  return { meta: { schemaVersion: 1, revision: 0, title: 'Daylight 校园一图通', description: '', timezone: 'Asia/Shanghai', dataSource: '', notice: '', isDemo: false, updatedAt: '', center: { lat: 31.176, lng: 121.590 }, zoom: 16 }, places: [], nodes: [], edges: [], events: [], venues: [], menus: [], indoorPlans: [], parcelStations: [], streetViews: [] };
}
function level(value) { const result = value || 'ground'; assert(['ground', 'underground'].includes(result), '道路层级无效。'); return result; }
function geometryKind(value, options, fallback) { const result = value || fallback; assert(options.includes(result), '几何元素类型无效。'); return result; }
function menuImageUrl(value) { if (typeof value === 'string' && /^\/campus-menus\/\d{4}-\d{2}-\d{2}\/\d+\.jpg$/.test(value)) return value; return url(value); }
function diningFields(row) { return { unit: text(row.unit, 80), operator: text(row.operator, 200), menuImageUrl: menuImageUrl(row.menuImageUrl), orderStopped: bool(row.orderStopped), temporarilyClosed: bool(row.temporarilyClosed), closureUntil: optionalIso(row.closureUntil, '临时停业截止'), closureReason: text(row.closureReason, 1000), adminNote: text(row.adminNote, 10000) }; }
function rectangle(row, width, height) { const result = { x: number(row.x, 0, width, '横坐标'), y: number(row.y, 0, height, '纵坐标'), width: number(row.width, 0.1, width, '宽度'), height: number(row.height, 0.1, height, '高度') }; assert(result.x + result.width <= width && result.y + result.height <= height, '室内元素超出平面图边界。'); return result; }

/** Strict projection: discard unrecognized fields rather than publishing imported secrets. */
export function validateCatalog(input) {
  assert(isObject(input) && isObject(input.meta), '请提供 meta 与六个目录数组。');
  const meta = input.meta;
  assert(meta.schemaVersion === undefined || meta.schemaVersion === 1, '不支持的目录版本。');
  const result = { meta: { schemaVersion: 1, revision: Number.isSafeInteger(meta.revision) && meta.revision >= 0 ? meta.revision : 0,
    supplements: strings(meta.supplements || []), title: required(meta.title || 'Daylight 校园一图通', '目录标题'), description: text(meta.description, 3000), timezone: 'Asia/Shanghai',
    dataSource: text(meta.dataSource, 1000), notice: text(meta.notice, 3000), isDemo: bool(meta.isDemo), updatedAt: optionalIso(meta.updatedAt, '更新时间'),
    center: coordinate(meta.center || emptyCatalog().meta.center), zoom: number(meta.zoom ?? 16, 1, 22, '缩放级别'), mapImage: mapImage(meta.mapImage), mapTileUrl: tileUrl(meta.mapTileUrl), mapAttribution: text(meta.mapAttribution, 1000), satelliteTileUrl: tileUrl(meta.satelliteTileUrl), satelliteAttribution: text(meta.satelliteAttribution, 1000) },
    places: rows(input.places, 5000, '地点', row => {
      assert(PLACE_CATEGORIES.some(c => c.id === row.category), '地点分类无效。');
      return { id: identifier(row.id), name: required(row.name, '地点名称'), englishName: text(row.englishName, 200), occupants: strings(row.occupants || [], 100), groupId: row.groupId ? identifier(row.groupId) : '', groupName: text(row.groupName, 200), aliases: strings(row.aliases), category: row.category, description: text(row.description, 5000), address: text(row.address, 300), building: text(row.building, 100), floor: text(row.floor, 40), room: text(row.room, 80), ...coordinate(row), nodeId: row.nodeId ? identifier(row.nodeId, '道路节点') : '', tags: strings(row.tags), openHours: hours(row.openHours), accessible: bool(row.accessible, true), sourceUrl: url(row.sourceUrl), isDemo: bool(row.isDemo),
        polygons: rows(row.polygons || [], 30, '建筑轮廓', polygon => { const points = list(polygon.points, 500, '轮廓坐标').map(coordinate); assert(points.length >= 3, '建筑轮廓至少需要三个点。'); return { id: identifier(polygon.id), points }; }),
        entrances: rows(row.entrances || [], 60, '出入口', entrance => ({ id: identifier(entrance.id), name: required(entrance.name || '入口', '入口名称', 100), ...coordinate(entrance), nodeId: entrance.nodeId ? identifier(entrance.nodeId) : '', accessible: bool(entrance.accessible, true), kind: geometryKind(entrance.kind, ['main', 'side', 'accessible', 'service'], 'main') })) };
    }),
    nodes: rows(input.nodes, 30000, '路网节点', row => ({ id: identifier(row.id), ...coordinate(row), level: level(row.level), kind: geometryKind(row.kind, ['junction', 'entrance', 'stairs', 'elevator', 'ramp', 'crossing'], 'junction'), isDemo: bool(row.isDemo) })),
    edges: rows(input.edges, 60000, '道路', row => ({ id: identifier(row.id), from: identifier(row.from), to: identifier(row.to), distanceMeters: number(row.distanceMeters, 0.1, 100000, '道路距离'), covered: bool(row.covered), accessible: bool(row.accessible, row.kind !== 'stairs'), bidirectional: bool(row.bidirectional, true), description: text(row.description, 1000), level: level(row.level), kind: geometryKind(row.kind, ['walkway', 'vehicle', 'stairs', 'elevator', 'ramp', 'crossing', 'connector'], 'walkway'), walkable: bool(row.walkable, row.kind !== 'vehicle'), closed: bool(row.closed), sceneImageUrl: url(row.sceneImageUrl), isDemo: bool(row.isDemo) })),
    events: rows(input.events, 3000, '活动', row => {
      assert(EVENT_CATEGORIES.some(c => c.id === row.category), '活动分类无效。');
      const start = iso(row.start, '活动开始'), end = iso(row.end, '活动结束'); assert(Date.parse(end) > Date.parse(start), '活动结束必须晚于开始。');
      const deadline = optionalIso(row.registrationDeadline, '报名截止'); assert(!deadline || Date.parse(deadline) <= Date.parse(end), '报名截止不得晚于活动结束。');
      const status = row.status || 'published'; assert(['published', 'cancelled'].includes(status), '活动状态无效。');
      const allDay = bool(row.allDay); if (allDay) for (const value of [start, end]) assert(Date.parse(value) === Date.parse(`${shanghaiDate(value)}T00:00:00+08:00`), '全天活动的开始与次日结束应为北京时间零点。');
      return { id: identifier(row.id), title: required(row.title, '活动名称'), englishTitle: text(row.englishTitle, 300), ...validateEventEnglishContent(row), speaker: text(row.speaker, 500), room: text(row.room, 100), locationText: text(row.locationText, 500), allDay, sortOrder: number(row.sortOrder ?? 0, -100000, 100000, '活动排序'), summary: text(row.summary, 1000), description: text(row.description, 15000), category: row.category, placeId: identifier(row.placeId, '活动地点'), start, end, registrationDeadline: deadline, organizer: text(row.organizer, 300), registrationUrl: url(row.registrationUrl), status, tags: strings(row.tags), isDemo: bool(row.isDemo), imageUrl: url(row.imageUrl), sourceUrl: url(row.sourceUrl), sourceId: text(row.sourceId, 100), sourceKind: text(row.sourceKind, 30), sourceUpdatedAt: optionalIso(row.sourceUpdatedAt, '来源更新时间'), pinned: bool(row.pinned), hidden: bool(row.hidden), manualOverride: bool(row.manualOverride), capacity: row.capacity === undefined || row.capacity === null ? null : number(row.capacity, 0, 1000000, '活动容量'), fee: row.fee === undefined || row.fee === null ? null : number(row.fee, 0, 1000000, '费用') };
    }),
    venues: rows(input.venues, 500, '餐厅', row => ({ id: identifier(row.id), placeId: identifier(row.placeId), name: required(row.name, '餐厅名称'), ...diningFields(row), floor: text(row.floor, 40), cuisine: text(row.cuisine, 200), tags: strings(row.tags), windows: rows(row.windows || [], 100, '餐饮窗口', win => ({ id: identifier(win.id), name: required(win.name, '窗口名称'), ...diningFields(win), cuisine: text(win.cuisine, 200), tags: strings(win.tags), openHours: hours(win.openHours) })), openHours: hours(row.openHours), isDemo: bool(row.isDemo) })),
    menus: rows(input.menus, 10000, '菜单', row => {
      const meal = row.meal || 'all'; assert(['breakfast', 'lunch', 'dinner', 'all'].includes(meal), '餐次无效。');
      const validFrom = row.validFrom ? date(row.validFrom, '菜单生效日期') : '', validUntil = row.validUntil ? date(row.validUntil, '菜单失效日期') : ''; assert(!validFrom || !validUntil || validUntil >= validFrom, '菜单生效期顺序无效。');
      return { id: identifier(row.id), venueId: identifier(row.venueId), windowId: row.windowId ? identifier(row.windowId) : '', name: required(row.name, '菜品名称'), price: row.price === null || row.price === undefined ? null : number(row.price, 0, 10000, '价格'), pricePending: bool(row.pricePending, row.price === null || row.price === undefined), ...diningFields(row), tags: strings(row.tags), flavor: text(row.flavor, 200), availableDays: days(row.availableDays), meal, isDemo: bool(row.isDemo), description: text(row.description, 3000), imageUrl: url(row.imageUrl), updatedAt: optionalIso(row.updatedAt, '菜单更新日期'), portion: text(row.portion, 100), specs: list(row.specs || [], 30, '菜品规格').map(spec => ({ name: required(spec.name, '规格名称', 80), price: spec.price === null || spec.price === undefined ? null : number(spec.price, 0, 10000, '规格价格'), unit: text(spec.unit, 80), pricePending: bool(spec.pricePending, spec.price === null || spec.price === undefined) })), validFrom, validUntil, soldOut: bool(row.soldOut) };
    }),
    indoorPlans: rows(input.indoorPlans || input.floorPlans || [], 1000, '楼层平面图', row => {
      const width = number(row.width ?? 1000, 10, 10000, '平面图宽度'), height = number(row.height ?? 600, 10, 10000, '平面图高度');
      return { id: identifier(row.id), placeId: identifier(row.placeId), name: required(row.name || row.title, '楼层图名称'), title: text(row.title || row.name, 120), floor: required(String(row.floor ?? ''), '楼层', 40), width, height, imageUrl: url(row.imageUrl), sourceUrl: url(row.sourceUrl), isDemo: bool(row.isDemo),
        rooms: rows(row.rooms || [], 1000, '房间', room => ({ id: identifier(room.id), name: required(room.name, '房间名称'), number: text(room.number, 50), ...rectangle(room, width, height), type: text(room.type || room.kind || 'room', 50), kind: text(room.kind || room.type || 'room', 50) })),
        paths: list(row.paths || [], 1000, '室内走廊').map(p => ({ points: list(p.points || [], 1000, '走廊坐标').map(v => ({ x: number(v.x, 0, width, '横坐标'), y: number(v.y, 0, height, '纵坐标') })) })) };
    }),
    parcelStations: rows(input.parcelStations || [], 100, '快递站', row => {
      const width = number(row.width ?? 1000, 10, 10000, '快递站图宽度'), height = number(row.height ?? 600, 10, 10000, '快递站图高度');
      return { id: identifier(row.id), placeId: identifier(row.placeId), name: required(row.name, '快递站名称'), notice: text(row.notice, 3000), sourceUrl: url(row.sourceUrl), width, height, isDemo: bool(row.isDemo),
        shelves: rows(row.shelves || [], 1000, '货架', shelf => ({ id: identifier(shelf.id), label: required(shelf.label, '货架名称'), aliases: strings(shelf.aliases), prefixes: strings(shelf.prefixes), ...rectangle(shelf, width, height), levels: number(shelf.levels ?? 5, 1, 20, '货架层数') })),
        facilities: rows(row.facilities || [], 100, '快递站设施', facility => ({ id: identifier(facility.id), name: required(facility.name, '设施名称'), type: text(facility.type, 50), x: number(facility.x, 0, width, '横坐标'), y: number(facility.y, 0, height, '纵坐标') })) };
    }),
    streetViews: rows(input.streetViews || [], 3000, '道路实景', row => ({ id: identifier(row.id), sourceFilename: text(row.sourceFilename, 200), edgeId: row.edgeId ? identifier(row.edgeId) : '', offsetMeters: row.offsetMeters === undefined || row.offsetMeters === null ? null : number(row.offsetMeters, 0, 100000, '实景沿路距离'), ...(row.lat === undefined && row.lng === undefined ? {} : coordinate(row)), nodeId: row.nodeId ? identifier(row.nodeId) : '', placeId: row.placeId ? identifier(row.placeId) : '', imageUrl: url(row.imageUrl), description: text(row.description, 3000), sourceUrl: url(row.sourceUrl), isDemo: bool(row.isDemo) })),
  };
  const nodeIds = new Set(result.nodes.map(n => n.id)), placeIds = new Set(result.places.map(p => p.id));
  assert(!result.meta.mapTileUrl || result.meta.mapAttribution, '地图瓦片需要填写署名。'); assert(!result.meta.satelliteTileUrl || result.meta.satelliteAttribution, '卫星瓦片需要填写署名。');
  for (const p of result.places) assert(!p.nodeId || nodeIds.has(p.nodeId), `地点 ${p.id} 的道路节点不存在。`);
  for (const place of result.places) for (const entrance of place.entrances) assert(!entrance.nodeId || nodeIds.has(entrance.nodeId), `地点 ${place.id} 的入口节点不存在。`);
  for (const e of result.edges) { assert(nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to, `道路 ${e.id} 的端点无效。`); }
  for (const e of result.events) assert(placeIds.has(e.placeId), `活动 ${e.id} 的地点不存在。`);
  for (const v of result.venues) assert(placeIds.has(v.placeId), `餐厅 ${v.id} 的地点不存在。`);
  for (const m of result.menus) { const venue = result.venues.find(v => v.id === m.venueId); assert(venue && (!m.windowId || venue.windows.some(w => w.id === m.windowId)), `菜单 ${m.id} 的餐厅或窗口不存在。`); }
  for (const row of [...result.indoorPlans, ...result.parcelStations]) assert(placeIds.has(row.placeId), `平面图 ${row.id} 的地点不存在。`);
  for (const view of result.streetViews) { const edge = result.edges.find(edge => edge.id === view.edgeId); assert(Boolean(view.nodeId || view.placeId || view.edgeId) && (!view.nodeId || nodeIds.has(view.nodeId)) && (!view.placeId || placeIds.has(view.placeId)) && (!view.edgeId || edge) && (view.offsetMeters === null || edge && view.offsetMeters <= edge.distanceMeters), `实景 ${view.id} 的位置无效。`); assert(view.imageUrl, '实景图需要图片链接。'); }
  result.meta.isDemo = GUIDE_COLLECTIONS.some(key => result[key].some(row => row.isDemo));
  return result;
}

/** Remove demo content and all references to removed rows. Custom data is preserved. */
export function withoutDemo(input) {
  const result = clone(input);
  for (const key of GUIDE_COLLECTIONS) result[key] = result[key].filter(row => !row.isDemo);
  const nodes = new Set(result.nodes.map(n => n.id)), places = new Set(result.places.map(p => p.id));
  result.edges = result.edges.filter(e => nodes.has(e.from) && nodes.has(e.to));
  result.places = result.places.map(p => ({ ...p, nodeId: nodes.has(p.nodeId) ? p.nodeId : '', entrances: (p.entrances || []).map(entrance => ({ ...entrance, nodeId: nodes.has(entrance.nodeId) ? entrance.nodeId : '' })) }));
  result.events = result.events.filter(e => places.has(e.placeId));
  result.venues = result.venues.filter(v => places.has(v.placeId));
  const venues = new Set(result.venues.map(v => v.id)); result.menus = result.menus.filter(m => venues.has(m.venueId));
  result.indoorPlans = result.indoorPlans.filter(row => places.has(row.placeId)); result.parcelStations = result.parcelStations.filter(row => places.has(row.placeId));
  const edges = new Set(result.edges.map(edge => edge.id)); result.streetViews = result.streetViews.filter(row => (!row.nodeId || nodes.has(row.nodeId)) && (!row.placeId || places.has(row.placeId)) && (!row.edgeId || edges.has(row.edgeId)));
  result.meta.isDemo = false;
  if (!result.places.length) { result.meta.dataSource = ''; result.meta.notice = '目录为空，请由管理员导入已获授权的校园资料。'; }
  return validateCatalog(result);
}

/** One public projection used by catalog and dining; administration notes stay private. */
export function publicCampusCatalog(input, { admin = false } = {}) {
  const catalog = validateCatalog(input);
  if (admin) return catalog;
  catalog.events = catalog.events.filter(event => !event.hidden);
  const strip = row => { const result = { ...row }; delete result.adminNote; return result; };
  catalog.venues = catalog.venues.map(venue => ({ ...strip(venue), windows: venue.windows.map(strip) }));
  catalog.menus = catalog.menus.map(strip);
  return catalog;
}

const normalized = value => text(value, 1000).toLowerCase().replace(/[\s\-_·]/g, '');
export function searchPlaces(catalog, query = '', { category = '' } = {}) {
  const needle = normalized(query);
  return catalog.places.filter(place => (!category || place.category === category) && (!needle || normalized([place.name, place.englishName || '', place.groupName || '', ...(place.occupants || []), ...(place.aliases || []), place.building, place.floor, place.room, ...(place.tags || []), place.address].join(' ')).includes(needle)));
}
export function shanghaiDate(value = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(value)); }
export function isOpenNow(openHours, value = new Date()) {
  if (!openHours?.length) return null;
  const instant = new Date(value), day = shanghaiDate(instant), weekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
  return openHours.some(row => row.start < row.end
    ? row.days.includes(weekday) && clock >= row.start && clock < row.end
    : (row.days.includes(weekday) && clock >= row.start) || (row.days.includes(weekday === 1 ? 7 : weekday - 1) && clock < row.end));
}
export function eventsInRange(catalog, { category = '', from, to, query = '', now = new Date() } = {}) {
  const lower = from ? Date.parse(from) : new Date(now).getTime(), upper = to ? Date.parse(to) : Infinity, needle = normalized(query);
  return catalog.events.filter(event => !event.hidden && event.status !== 'cancelled' && (!category || event.category === category) && Date.parse(event.end) > lower && Date.parse(event.start) < upper && (!needle || normalized(`${event.title} ${event.englishTitle || ''} ${event.speaker || ''} ${event.locationText || ''} ${event.summary} ${event.organizer}`).includes(needle))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(a.start) - Date.parse(b.start) || (a.sortOrder || 0) - (b.sortOrder || 0) || a.title.localeCompare(b.title, 'zh-CN'));
}
export function menuMatches(menu, { query = '', maxPrice, flavor, meal, at = new Date() } = {}) {
  const needle = normalized(query), weekday = new Date(`${shanghaiDate(at)}T00:00:00Z`).getUTCDay() || 7;
  const day = shanghaiDate(at); return (!menu.validFrom || day >= menu.validFrom) && (!menu.validUntil || day <= menu.validUntil) && (!needle || normalized(`${menu.name} ${menu.flavor} ${menu.tags.join(' ')}`).includes(needle)) && (maxPrice === undefined || Number.isFinite(menu.price) && !menu.pricePending && menu.price <= maxPrice) && (!flavor || normalized(`${menu.flavor} ${menu.tags.join(' ')}`).includes(normalized(flavor))) && (!meal || menu.meal === 'all' || menu.meal === meal) && menu.availableDays.includes(weekday);
}
export function distanceBetween(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
class MinHeap {
  items = [];
  push(value) { let index = this.items.length; this.items.push(value); while (index) { const parent = (index - 1) >> 1; if (this.items[parent].cost <= value.cost) break; this.items[index] = this.items[parent]; index = parent; } this.items[index] = value; }
  pop() { const first = this.items[0], last = this.items.pop(); if (this.items.length) { let index = 0; while (index * 2 + 1 < this.items.length) { let next = index * 2 + 1; if (next + 1 < this.items.length && this.items[next + 1].cost < this.items[next].cost) next++; if (this.items[next].cost >= last.cost) break; this.items[index] = this.items[next]; index = next; } this.items[index] = last; } return first; }
  get length() { return this.items.length; }
}

const MAX_COORDINATE_ACCESS_METERS = 250;

/** Dijkstra on supplied roads. A coordinate may identify a nearby surface entry, never a new road. */
export function findRoute(catalog, { from, to, avoidRain = false, accessible = false, mode = 'all' } = {}) {
  assert(typeof avoidRain === 'boolean' && typeof accessible === 'boolean', '路线偏好无效。');
  assert(['all', 'ground', 'underground'].includes(mode), '路线模式无效。');
  const nodes = new Map(catalog.nodes.map(n => [n.id, n]));
  const neighbors = new Map(catalog.nodes.map(n => [n.id, []])), incoming = new Set();
  for (const edge of catalog.edges) {
    if (edge.closed || edge.walkable === false || (edge.kind === 'vehicle' && edge.walkable !== true) || (accessible && (!edge.accessible || edge.kind === 'stairs')) || (mode !== 'all' && (edge.level || 'ground') !== mode)) continue;
    neighbors.get(edge.from)?.push({ edge, next: edge.to });
    incoming.add(edge.to);
    if (edge.bidirectional) { neighbors.get(edge.to)?.push({ edge, next: edge.from }); incoming.add(edge.from); }
  }
  function endpoint(value, side) {
    if (typeof value === 'string') {
      const place = catalog.places.find(p => p.id === value);
      if (!place) throw guideError('请选择目录中的起点和终点。', 404, 'CAMPUS_GUIDE_PLACE_NOT_FOUND');
      return { ...place, coordinateEndpoint: false };
    }
    assert(isObject(value), '起点和终点应为地点编号或有效坐标。');
    const point = coordinate(value), name = text(value.name || (side === 'from' ? '地图起点' : '地图终点'), 120);
    // GPS gives no floor. Snap only to a connected ground node, even for an underground route.
    let nearest, nearestDistance = Infinity;
    for (const node of catalog.nodes) {
      if ((node.level || 'ground') !== 'ground' || (side === 'from' ? !neighbors.get(node.id)?.length : !incoming.has(node.id))) continue;
      const distance = distanceBetween(point, node);
      if (distance < nearestDistance || distance === nearestDistance && node.id < nearest.id) { nearest = node; nearestDistance = distance; }
    }
    if (!nearest || nearestDistance > MAX_COORDINATE_ACCESS_METERS) throw guideError(`这个位置距可用地面路网入口超过 ${MAX_COORDINATE_ACCESS_METERS} 米，无法安全接入。请在已收录地点或道路入口附近选择位置。`, 422, 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
    return { ...point, name, id: '', nodeId: nearest.id, isDemo: Boolean(nearest.isDemo), coordinateEndpoint: true, accessDistance: nearestDistance };
  }
  const origin = endpoint(from, 'from'), destination = endpoint(to, 'to');
  const publishedEndpoint = point => point.coordinateEndpoint ? { ...coordinate(point), name: point.name } : point.id;
  const base = { from: publishedEndpoint(origin), to: publishedEndpoint(destination), fromName: origin.name, toName: destination.name, avoidRain, accessible, mode, isDemo: Boolean(origin.isDemo || destination.isDemo), notice: catalog.meta.notice };
  if (typeof from === 'string' && from === to) return { ...base, points: [{ ...coordinate(origin), placeId: origin.id }], distanceMeters: 0, networkDistanceMeters: 0, durationMinutes: 0, uncoveredMeters: 0, accessConnections: [], steps: [] };
  if (!nodes.has(origin.nodeId) || !nodes.has(destination.nodeId)) throw guideError('该地点尚未连接经过核验的道路，暂不能规划路线。', 422, 'CAMPUS_GUIDE_ROUTE_UNAVAILABLE');
  const costs = new Map([[origin.nodeId, 0]]), previous = new Map(), heap = new MinHeap(); heap.push({ node: origin.nodeId, cost: 0 });
  while (heap.length) {
    const current = heap.pop(); if (current.cost !== costs.get(current.node)) continue;
    if (current.node === destination.nodeId) break;
    for (const candidate of neighbors.get(current.node) || []) {
      const cost = current.cost + candidate.edge.distanceMeters * (avoidRain && !candidate.edge.covered ? 3 : 1);
      if (cost < (costs.get(candidate.next) ?? Infinity)) { costs.set(candidate.next, cost); previous.set(candidate.next, { from: current.node, edge: candidate.edge }); heap.push({ node: candidate.next, cost }); }
    }
  }
  if (!costs.has(destination.nodeId)) throw guideError('当前路网无法连通这两个地点，请调整起终点或路线偏好。', 422, 'CAMPUS_GUIDE_ROUTE_UNREACHABLE');
  const legs = []; let cursor = destination.nodeId;
  while (cursor !== origin.nodeId) { const leg = previous.get(cursor); legs.unshift({ ...leg, to: cursor }); cursor = leg.from; }
  const connectorStart = distanceBetween(origin, nodes.get(origin.nodeId)), connectorEnd = distanceBetween(destination, nodes.get(destination.nodeId));
  let distance = connectorStart + connectorEnd, uncovered = connectorStart + connectorEnd;
  const steps = legs.map((leg, index) => { distance += leg.edge.distanceMeters; if (!leg.edge.covered) uncovered += leg.edge.distanceMeters; return { id: leg.edge.id, from: leg.from, to: leg.to, distanceMeters: Math.round(leg.edge.distanceMeters), covered: leg.edge.covered, level: leg.edge.level || 'ground', sceneImageUrl: leg.edge.sceneImageUrl || '', description: leg.edge.description || `沿校园道路前行 ${Math.round(leg.edge.distanceMeters)} 米`, order: index + 1 }; });
  const points = [...(origin.coordinateEndpoint ? [] : [{ ...coordinate(origin), placeId: origin.id }]), { ...coordinate(nodes.get(origin.nodeId)), nodeId: origin.nodeId }, ...legs.map(leg => ({ ...coordinate(nodes.get(leg.to)), nodeId: leg.to })), ...(destination.coordinateEndpoint ? [] : [{ ...coordinate(destination), placeId: destination.id }])];
  const accessConnections = [[origin, 'from'], [destination, 'to']].filter(([point]) => point.coordinateEndpoint).map(([point, side]) => {
    const node = nodes.get(point.nodeId), meters = Math.round(point.accessDistance);
    return { side, point: { ...coordinate(point), name: point.name }, nodeId: point.nodeId, node: coordinate(node), distanceMeters: meters, distanceLowerBoundMeters: meters, durationMinutesEstimate: meters ? Math.max(1, Math.ceil(meters / 75)) : 0, verified: false, covered: false, accessible: null, notice: `坐标与地面路网入口相距直线约 ${meters} 米，仅为接驳距离下限；请沿现场允许通行的道路${side === 'from' ? '前往入口' : '到达目的地'}，未核验路段不在地图上连线。` };
  });
  for (const access of accessConnections) {
    const step = { id: `coordinate-access-${access.side}`, kind: 'access', from: access.side === 'from' ? 'coordinate' : access.nodeId, to: access.side === 'to' ? 'coordinate' : access.nodeId, distanceMeters: access.distanceMeters, covered: false, level: 'unknown', verified: false, description: access.notice };
    if (access.side === 'from') steps.unshift(step); else steps.push(step);
  }
  steps.forEach((step, index) => step.order = index + 1);
  const accessNotice = accessConnections.length ? '坐标接驳未经通行核验；总距离和分钟包含按直线距离估计的接驳下限，实际可能更远。避雨与无障碍偏好只适用于已录入道路。' : '';
  return { ...base, isDemo: base.isDemo || legs.some(leg => leg.edge.isDemo), notice: [base.notice, accessNotice].filter(Boolean).join(' '), accessNotice, accessConnections, networkDistanceMeters: Math.round(legs.reduce((sum, leg) => sum + leg.edge.distanceMeters, 0)), points: points.filter((p, i) => !i || p.lat !== points[i - 1].lat || p.lng !== points[i - 1].lng), distanceMeters: Math.round(distance), durationMinutes: distance ? Math.max(1, Math.ceil(distance / 75)) : 0, uncoveredMeters: Math.round(uncovered), steps,
    preferenceNote: (avoidRain ? '优先选择有遮蔽的路段；未标注或出入口连接路段按露天计。' : '按已录入道路距离选择步行路线。') + (accessNotice ? ` ${accessNotice}` : '') };
}

export function emptyPersonal() { return { revision: 0, favorites: [], homePlaceId: '', labPlaceId: '', courses: [], schedule: [], registrations: [], checkins: [] }; }
export function validatePersonal(input, catalog, previous = emptyPersonal()) {
  assert(isObject(input), '个人安排应为对象。');
  const knownPlaces = new Set(catalog.places.map(p => p.id)), oldPlaces = new Set([...(previous.favorites || []), previous.homePlaceId, previous.labPlaceId, ...(previous.courses || []).map(c => c.placeId), ...(previous.schedule || []).map(s => s.placeId)]);
  const place = value => { if (!value) return ''; identifier(value); assert(knownPlaces.has(value) || oldPlaces.has(value), `地点 ${value} 已移除，请刷新目录。`); return value; };
  const source = { ...previous, ...input };
  const result = { revision: previous.revision, favorites: [...new Set(list(source.favorites, 300, '收藏地点').map(place))].filter(Boolean), homePlaceId: place(source.homePlaceId), labPlaceId: place(source.labPlaceId),
    courses: rows(source.courses, 200, '课程', row => {
      const startDate = date(row.startDate, '课程开始日期'), endDate = date(row.endDate, '课程结束日期'), startTime = time(row.startTime, '课程开始时间'), endTime = time(row.endTime, '课程结束时间');
      assert(endDate >= startDate && endTime > startTime, '课程日期或时间顺序无效。'); assert(Number.isInteger(row.weekday) && row.weekday >= 1 && row.weekday <= 7, '课程星期无效。');
      const weeks = [...new Set(list(row.weeks || [], 60, '上课周次').map(w => { assert(Number.isInteger(w) && w >= 1 && w <= 60, '上课周次无效。'); return w; }))];
      return { id: identifier(row.id), title: required(row.title, '课程名称'), teacher: text(row.teacher, 200), placeId: place(row.placeId), weekday: row.weekday, startTime, endTime, startDate, endDate, weeks };
    }),
    schedule: rows(source.schedule, 1000, '安排', row => {
      const start = iso(row.start, '安排开始'), end = iso(row.end, '安排结束'), kind = row.kind || 'personal'; assert(Date.parse(end) > Date.parse(start), '安排结束必须晚于开始。'); assert(['personal', 'course', 'event'].includes(kind), '安排类型无效。');
      const allDay = bool(row.allDay); if (allDay) for (const value of [start, end]) assert(Date.parse(value) === Date.parse(`${shanghaiDate(value)}T00:00:00+08:00`), '全天安排开始与结束必须为北京时间零点，结束为最后一天的次日零点。');
      return { id: identifier(row.id), title: required(row.title, '安排标题'), placeId: place(row.placeId), start, end, allDay, kind, notes: text(row.notes, 3000) };
    }), registrations: [...new Set(list(source.registrations, 1000, '关注活动').map(id => identifier(id)))], checkins: clone(previous.checkins || []),
  };
  for (const id of result.registrations) { const event = catalog.events.find(e => e.id === id); assert(event || previous.registrations.includes(id), `活动 ${id} 不存在。`); }
  return result;
}

export function planStops(catalog, { stops = [], avoidRain = false, accessible = false, mode = 'all' } = {}) {
  list(stops, 30, '行程地点'); stops.forEach(id => assert(catalog.places.some(p => p.id === id), `行程地点 ${id} 不存在。`));
  const legs = [], unroutable = [];
  for (let i = 1; i < stops.length; i++) { try { legs.push(findRoute(catalog, { from: stops[i - 1], to: stops[i], avoidRain, accessible, mode })); } catch (error) { if (error.status !== 422) throw error; unroutable.push({ from: stops[i - 1], to: stops[i], message: error.message }); } }
  return { stops: [...stops], legs, unroutable, complete: unroutable.length === 0, distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), durationMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0) };
}
export function dailyItems(catalog, personal, day) {
  date(day, '行程日期'); const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7, start = Date.parse(`${day}T00:00:00+08:00`), end = start + 86400000;
  const schedule = personal.schedule.filter(item => Date.parse(item.start) < end && Date.parse(item.end) > start).map(item => ({ ...item }));
  for (const course of personal.courses) {
    const anchorDate = new Date(`${course.startDate}T00:00:00Z`), anchorMonday = anchorDate.getTime() - ((anchorDate.getUTCDay() || 7) - 1) * 86400000;
    const week = Math.floor((Date.parse(`${day}T00:00:00Z`) - anchorMonday) / 604800000) + 1;
    if (course.weekday === weekday && day >= course.startDate && day <= course.endDate && (!course.weeks.length || course.weeks.includes(week))) schedule.push({ id: `${course.id}:${day}`, title: course.title, teacher: course.teacher || '', placeId: course.placeId, start: `${day}T${course.startTime}:00+08:00`, end: `${day}T${course.endTime}:00+08:00`, kind: 'course' });
  }
  for (const eventId of personal.registrations) { const event = catalog.events.find(e => e.id === eventId); if (event && event.status !== 'cancelled' && Date.parse(event.start) < end && Date.parse(event.end) > start) schedule.push({ id: event.id, title: event.title, placeId: event.placeId, start: event.start, end: event.end, kind: 'event', allDay: event.allDay, isDemo: event.isDemo }); }
  return schedule.map(item => ({ ...item, location: item.location || catalog.places.find(p => p.id === item.placeId)?.name || '地点已移除 / 未设置' })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}
export function planDay(catalog, personal, day, { avoidRain = false, accessible = false, returnHome = false, mode = 'all' } = {}) {
  const items = dailyItems(catalog, personal, day), originPlaceId = personal.homePlaceId || personal.labPlaceId || '', legs = [], conflicts = [], unroutable = [];
  let previousPlaceId = catalog.places.some(p => p.id === originPlaceId) ? originPlaceId : '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i], previous = items[i - 1]; let leg;
    if (previousPlaceId && item.placeId && previousPlaceId !== item.placeId) {
      try { leg = { ...findRoute(catalog, { from: previousPlaceId, to: item.placeId, avoidRain, accessible, mode }), toItemId: item.id, ...(previous ? { fromItemId: previous.id } : {}) }; legs.push(leg); }
      catch (error) { if (![404, 422].includes(error.status)) throw error; unroutable.push({ from: previousPlaceId, to: item.placeId, toItemId: item.id, message: error.message }); }
    }
    // Check every still-running event, so a long event spanning two shorter events is retained.
    for (let j = 0; j < i; j++) if (Date.parse(items[j].end) > Date.parse(item.start)) conflicts.push({ kind: 'overlap', fromId: items[j].id, toId: item.id, message: `「${items[j].title}」与「${item.title}」时间重叠。` });
    if (previous && leg) { const availableMinutes = (Date.parse(item.start) - Date.parse(previous.end)) / 60000; if (availableMinutes >= 0 && availableMinutes < leg.durationMinutes) conflicts.push({ kind: 'travel', fromId: previous.id, toId: item.id, neededMinutes: leg.durationMinutes, availableMinutes, message: `前往「${item.location}」预计需 ${leg.durationMinutes} 分钟，当前间隔 ${Math.floor(availableMinutes)} 分钟。` }); }
    previousPlaceId = item.placeId || '';
  }
  if (returnHome && previousPlaceId && originPlaceId && previousPlaceId !== originPlaceId) { try { legs.push({ ...findRoute(catalog, { from: previousPlaceId, to: originPlaceId, avoidRain, accessible, mode }), returningHome: true }); } catch (error) { if (![404, 422].includes(error.status)) throw error; unroutable.push({ from: previousPlaceId, to: originPlaceId, message: error.message }); } }
  return { date: day, items, legs, originPlaceId, conflicts, unroutable, complete: !unroutable.length, distanceMeters: legs.reduce((n, leg) => n + leg.distanceMeters, 0), durationMinutes: legs.reduce((n, leg) => n + leg.durationMinutes, 0) };
}

export function queueSummaries(reports, now = new Date()) {
  const instant = new Date(now).getTime(), groups = new Map();
  for (const report of reports) { if (Date.parse(report.expiresAt) <= instant || Date.parse(report.reportedAt) > instant) continue; const rows = groups.get(report.venueId) || []; rows.push(report); groups.set(report.venueId, rows); }
  return [...groups].map(([venueId, entries]) => { entries.sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt)); const latest = entries[0], levels = entries.map(r => QUEUE_LEVELS.findIndex(l => l.id === r.level)).filter(n => n >= 0).sort((a, b) => a - b), level = QUEUE_LEVELS[levels[Math.floor(levels.length / 2)]]; return { venueId, level: level.id, waitMinutes: level.waitMinutes, reportedAt: latest.reportedAt, expiresAt: latest.expiresAt, reportCount: entries.length }; });
}

/** iCalendar output escapes untrusted text and folds by UTF-8 octets (RFC 5545). */
export function calendarExport(items, now = new Date()) {
  const escape = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const timestamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fold = line => { const lines = []; let current = '', count = 0; for (const char of line) { const size = new TextEncoder().encode(char).length; if (count + size > 75) { lines.push(current); current = ' '; count = 1; } current += char; count += size; } lines.push(current); return lines.join('\r\n'); };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daylight//Campus Guide//ZH-CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Daylight 校园安排', 'X-WR-TIMEZONE:Asia/Shanghai'];
  for (const item of items) lines.push('BEGIN:VEVENT', `UID:${escape(item.id)}@campus.daylight`, `DTSTAMP:${timestamp(now)}`, ...(item.allDay ? [`DTSTART;VALUE=DATE:${shanghaiDate(item.start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${shanghaiDate(item.end).replace(/-/g, '')}`] : [`DTSTART:${timestamp(item.start)}`, `DTEND:${timestamp(item.end)}`]), `SUMMARY:${escape(item.title)}`, `LOCATION:${escape(item.location)}`, `DESCRIPTION:${escape(item.notes || (item.isDemo ? '示例活动，请勿作为真实报名凭证。' : '由 Daylight 校园个人安排导出。'))}`, 'END:VEVENT');
  lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
