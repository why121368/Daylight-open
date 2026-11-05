#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { validateCatalog, emptyCatalog } from '../shared/campus-guide.js';
import { bd09ToWgs84, wgs84ToBd09, campusBd09Mercator, webMercator, fromWebMercator } from '../shared/campus-coordinates.js';

const root = path.resolve(import.meta.dirname, '..');
const origin = 'https://map.shanghaitech.edu.cn';
const output = path.join(root, 'server/campus-guide/catalogs/shanghaitech-map.json');
const assetDir = path.join(root, 'public/campus-maps/shanghaitech');
const cache = path.join(root, 'work/shanghaitech-map-import');
const args = process.argv.slice(2);
if (args.some(arg => !['--cached', '--check'].includes(arg))) throw new Error('参数仅支持 --cached（复用本次抓取缓存）或 --check（离线校验）。');
if (args.includes('--check')) {
  const catalog = validateCatalog(JSON.parse(await fs.readFile(output, 'utf8')));
  const image = await fs.readFile(path.join(assetDir, 'map.webp'));
  const manifest = JSON.parse(await fs.readFile(path.join(assetDir, 'source.json'), 'utf8'));
  if (manifest.imageSha256 !== createHash('sha256').update(image).digest('hex')) throw new Error('地图图片校验和不一致。');
  console.log(JSON.stringify({ ok: true, places: catalog.places.length, footprints: catalog.places.filter(row => row.polygons.length).length, source: origin, imageBytes: image.length }));
  process.exit(0);
}
await fs.mkdir(cache, { recursive: true });

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`学校公开地图读取失败：HTTP ${response.status}（${new URL(url).pathname}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Error('学校地图单项响应超过 5 MiB。');
  return { response, bytes };
}
async function query(kind, params = {}) {
  const filename = path.join(cache, `official-${kind}.json`);
  let raw;
  if (args.includes('--cached')) raw = await fs.readFile(filename, 'utf8');
  else {
    const endpoint = kind === 'campuses' ? 'campus' : kind;
    const { bytes } = await request(`${origin}/gis-service/sys/${endpoint}/queryListByWhere`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ pageSize: '500', ...params }) });
    raw = bytes.toString('utf8'); await fs.writeFile(filename, raw);
  }
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')), page = parsed.value?.[0];
  if (!parsed.status || !Array.isArray(page?.list) || Number(page.total) !== page.list.length) throw new Error(`学校地图 ${kind} 数据不完整，停止导入。`);
  return page.list;
}
const campuses = await query('campuses');
const campus = campuses.find(row => row.name === '上海科技大学浦东校区');
if (!campus) throw new Error('未找到上海科技大学浦东校区。');
const buildings = await query('archite_entity', { cid: campus.id });
const categories = await query('archite_category');
const services = await query('service_info', { cid: campus.id });
const categoryNames = new Map(categories.map(row => [row.id, row.name]));
const parsePosition = raw => { const data = typeof raw === 'string' ? JSON.parse(raw) : raw; const points = Array.isArray(data) ? data : [data]; if (!points.length || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.lat < 31.17 || p.lat > 31.20 || p.lng < 121.58 || p.lng > 121.62)) throw new Error('学校地图包含范围外或无效的坐标。'); return points; };
const center = points => ({ lat: (Math.min(...points.map(p => p.lat)) + Math.max(...points.map(p => p.lat))) / 2, lng: (Math.min(...points.map(p => p.lng)) + Math.max(...points.map(p => p.lng))) / 2 });
const rounded = point => Object.fromEntries(Object.entries(point).map(([key, value]) => [key, Number(value.toFixed(8))]));
function category(name, type) {
  if (/校门|大学[东西南北]+门/.test(name)) return 'gate';
  if (/餐|咖啡|KFC|全家/.test(name) || /餐饮/.test(type)) return 'dining';
  if (/公寓|宿舍/.test(name + type)) return 'residence';
  if (/体育|球场|游泳|健身|运动/.test(name + type)) return 'sports';
  if (/交通|班车|公交/.test(name + type)) return 'transit';
  if (/车库|停车/.test(name + type)) return 'parking';
  if (/教学中心|报告厅/.test(name)) return 'teaching';
  return type === '教学研究' ? 'research' : 'service';
}
const locations = new Map(), places = [];
for (const row of buildings.filter(row => row.cid === campus.id)) {
  const points = parsePosition(row.position), type = categoryNames.get(row.acid) || '';
  locations.set(row.id, center(points));
  places.push({ id: `sht-building-${row.id}`, name: row.name, ...rounded(bd09ToWgs84(center(points))), category: category(row.name, type), aliases: row.name.split(/[,，/]/).filter(name => name !== row.name), tags: ['学校地图', type].filter(Boolean), building: row.name,
    description: '来源：上海科技大学校园地图。点位取建筑轮廓中心，不代表出入口；开放时间、无障碍和步行接驳尚待现场核验。', sourceUrl: `${origin}/?id=${row.id}typebuilding|${campus.id}`, accessible: false, isDemo: false,
    polygons: points.length >= 3 ? [{ id: `sht-outline-${row.id}`, points: points.map(point => rounded(bd09ToWgs84(point))) }] : [], entrances: [], openHours: [], nodeId: '' });
}
const skipped = [];
for (const row of services.filter(row => row.cid === campus.id)) {
  const position = row.position ? parsePosition(row.position)[0] : locations.get(row.aeid);
  if (!position) { skipped.push({ name: row.name, reason: '没有独立坐标或可关联建筑' }); continue; }
  const type = row.serviceCategory?.name || '', inherited = !row.position;
  places.push({ id: `sht-service-${row.id}`, name: row.name, ...rounded(bd09ToWgs84(position)), category: category(row.name, type), tags: ['学校地图', type, ...(inherited ? ['建筑中心位置'] : [])].filter(Boolean), building: buildings.find(b => b.id === row.aeid)?.name || '',
    description: `来源：上海科技大学校园地图。${inherited ? '原站关联至建筑，显示建筑中心，具体楼层和服务入口待核对。' : '沿用原站服务点坐标。'}营业时间与服务状态待核验。`, sourceUrl: origin, accessible: false, isDemo: false, nodeId: '', openHours: [] });
}

// Fetch a finite campus rectangle only; never load the Baidu JS SDK or a third-party API key.
const bdBounds = { west: 121.594318, east: 121.608583, south: 31.178998, north: 31.187115 };
const sw = bd09ToWgs84({ lng: bdBounds.west, lat: bdBounds.south }), ne = bd09ToWgs84({ lng: bdBounds.east, lat: bdBounds.north });
const bounds = { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
const lower = campusBd09Mercator({ lng: bdBounds.west - 0.0001, lat: bdBounds.south - 0.0001 }), upper = campusBd09Mercator({ lng: bdBounds.east + 0.0001, lat: bdBounds.north + 0.0001 });
const zoom = 19, units = 2 ** (18 - zoom), tileSize = 256;
const minX = Math.floor(lower.x / (tileSize * units)), maxX = Math.floor(upper.x / (tileSize * units));
const minY = Math.floor(lower.y / (tileSize * units)), maxY = Math.floor(upper.y / (tileSize * units));
const mosaic = createCanvas((maxX - minX + 1) * tileSize, (maxY - minY + 1) * tileSize), ctx = mosaic.getContext('2d');
const tiles = [];
for (let y = maxY; y >= minY; y--) for (let x = minX; x <= maxX; x++) tiles.push({ x, y });
let missing = 0, next = 0, loaded = 0;
async function fetchTiles() {
  while (next < tiles.length) {
    const { x, y } = tiles[next++], url = `${origin}/tiles/${zoom}/tile${x}_${y}.png`, file = path.join(cache, `tile-${zoom}-${x}-${y}.png`);
    let bytes;
    try { bytes = await fs.readFile(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { const result = await request(url); if (!/image\/png/.test(result.response.headers.get('content-type') || '')) throw new Error('地图瓦片不是 PNG。'); bytes = result.bytes; await fs.writeFile(file, bytes); }
      catch (error) { if (/HTTP 404/.test(error.message)) { missing++; continue; } throw error; }
    }
    const tile = await loadImage(bytes);
    if (tile.width !== 256 || tile.height !== 256) throw new Error('地图瓦片尺寸不一致。');
    ctx.drawImage(tile, (x - minX) * tileSize, (maxY - y) * tileSize); loaded++;
  }
}
await Promise.all([fetchTiles(), fetchTiles(), fetchTiles(), fetchTiles()]);
if (!loaded) throw new Error('没有读取到学校地图图片，停止导入。');
const width = 3200, bottom = webMercator(sw), top = webMercator(ne), height = Math.round(width * (top.y - bottom.y) / (top.x - bottom.x));
const raster = createCanvas(width, height), targetContext = raster.getContext('2d'), target = targetContext.createImageData(width, height);
const source = ctx.getImageData(0, 0, mosaic.width, mosaic.height).data;
let visiblePixels = 0;
// Reproject pixels into EPSG:3857, matching Leaflet imageOverlay and WGS84 markers.
for (let y = 0; y < height; y++) {
  const mercY = top.y - (y + 0.5) / height * (top.y - bottom.y);
  for (let x = 0; x < width; x++) {
    const wgs = fromWebMercator({ x: bottom.x + (x + 0.5) / width * (top.x - bottom.x), y: mercY });
    const mc = campusBd09Mercator(wgs84ToBd09(wgs));
    const sx = Math.floor(mc.x / units - minX * tileSize), sy = Math.floor((maxY + 1) * tileSize - mc.y / units);
    if (sx < 0 || sy < 0 || sx >= mosaic.width || sy >= mosaic.height) continue;
    const si = (sy * mosaic.width + sx) * 4, ti = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++) target.data[ti + channel] = source[si + channel];
    if (target.data[ti + 3] > 0) visiblePixels++;
  }
}
if (visiblePixels / (width * height) < 0.1) throw new Error('学校底图为空或投影范围不匹配，停止写入。');
targetContext.putImageData(target, 0, 0);
const image = await raster.encode('webp', 92), importedAt = new Date().toISOString();
const catalog = validateCatalog({ ...emptyCatalog(), meta: { ...emptyCatalog().meta, title: '上海科技大学校园地图', description: '上海科技大学浦东校区 · 建筑与校园服务', center: rounded(bd09ToWgs84(center(parsePosition(campus.position)))), zoom: 17,
  dataSource: `上海科技大学校园地图 ${origin}；公开建筑与服务点数据，BD-09 转 WGS84。`, notice: '已导入学校地图的建筑轮廓与服务点。数据为抓取快照，部分原始记录更新于 2018 年；建筑中心不是入口，开放时间与道路通行需现场核对。课表、活动、菜单及可导航路网需另行补充。',
  mapImage: { url: '/campus-maps/shanghaitech/map.webp', bounds, attribution: '地图来源：上海科技大学校园地图', sourceUrl: origin, importedAt, sourceCoordinates: 'BD-09', coordinates: 'WGS84' } }, places });
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.mkdir(assetDir, { recursive: true });
await fs.writeFile(path.join(assetDir, 'map.webp'), image);
await fs.writeFile(path.join(assetDir, 'source.json'), JSON.stringify({ sourceUrl: origin, importedAt, campusName: campus.name, sourceCoordinates: 'BD-09', coordinates: 'WGS84', projection: 'EPSG:3857 raster', bounds, width, height, tileZoom: zoom, tilesLoaded: loaded, tilesMissing: missing, buildings: buildings.length, serviceRecords: services.length, placesImported: places.length, skipped, imageSha256: createHash('sha256').update(image).digest('hex'), notice: '学校公开地图的有限校园范围快照；保留来源署名。公开运营前需确认学校地图使用许可和资料时效。未导入账号、创建者标识、原站代码、第三方 Key 或导航栅格。' }, null, 2) + '\n');
await fs.writeFile(output, JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, buildings: buildings.length, services: services.length, imported: places.length, skipped, tilesLoaded: loaded, tilesMissing: missing, imageBytes: image.length, output: path.relative(root, output) }));
