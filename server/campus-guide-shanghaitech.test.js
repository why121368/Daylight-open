import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { bd09ToWgs84, wgs84ToBd09, campusBd09Mercator } from '../shared/campus-coordinates.js';
import { validateCatalog, distanceBetween, findRoute, searchPlaces } from '../shared/campus-guide.js';
import { shanghaitechCatalog, mergeShanghaitechCatalog } from './campus-guide/shanghaitech.js';
import { demoCatalog } from './campus-guide/seed.js';
import { createGuideRepository } from './campus-guide/repository.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';

test('上科大地图：转换百度坐标，保留真实点位并拒绝投影范围外坐标', () => {
  const beijing = bd09ToWgs84({ lng: 116.404, lat: 39.915 });
  assert.ok(Math.abs(beijing.lng - 116.39138) < 0.00003);
  assert.ok(Math.abs(beijing.lat - 39.90725) < 0.00003);
  const original = { lng: 121.601, lat: 31.183 }, wgs = bd09ToWgs84(original);
  assert.ok(distanceBetween(original, wgs) > 800);
  assert.ok(distanceBetween(original, wgs84ToBd09(wgs)) < 1);
  const projected = campusBd09Mercator(original);
  assert.ok(projected.x > 13_530_000 && projected.x < 13_550_000);
  assert.ok(projected.y > 3_630_000 && projected.y < 3_650_000);
  assert.throws(() => campusBd09Mercator({ lng: 0, lat: 0 }));
});

test('上科大地图：导入 65 个轮廓和 44 个服务点，未知通行与营业信息不补造', () => {
  const catalog = shanghaitechCatalog();
  assert.equal(catalog.places.length, 109);
  assert.equal(catalog.places.filter(place => place.polygons.length).length, 65);
  assert.equal(catalog.places.filter(place => place.id.startsWith('sht-service-')).length, 44);
  assert.equal(catalog.meta.isDemo, false);
  assert.ok(searchPlaces(catalog, '图书馆').length);
  assert.ok(searchPlaces(catalog, 'IT服务中心').length);
  for (const place of catalog.places) {
    assert.equal(place.isDemo, false); assert.equal(place.nodeId, ''); assert.equal(place.accessible, false);
    assert.equal(place.openHours.length, 0); assert.equal(place.entrances.length, 0);
    assert.ok(place.lat > 31.17 && place.lat < 31.19 && place.lng > 121.58 && place.lng < 121.61);
  }
  assert.equal(catalog.nodes.length + catalog.edges.length + catalog.events.length + catalog.menus.length, 0);
  assert.throws(() => findRoute(catalog, { from: catalog.places[0].id, to: catalog.places[1].id }), error => error.status === 422);
  assert.doesNotMatch(JSON.stringify(catalog), /CreateUserId|createUserId|ssoAppKey|dhzb|jczb/);
});

test('上科大地图：图片署名、边界和路径校验，拒绝跳转路径与未经转换的坐标系', () => {
  const catalog = shanghaitechCatalog();
  assert.equal(validateCatalog(catalog).meta.mapImage.coordinates, 'WGS84');
  const invalid = change => { const draft = structuredClone(catalog); change(draft.meta.mapImage); assert.throws(() => validateCatalog(draft)); };
  invalid(image => { image.url = '//example.invalid/map.webp'; });
  invalid(image => { image.url = '/campus-maps/../settings.json'; });
  invalid(image => { image.url = 'javascript:alert(1)'; });
  invalid(image => { image.bounds.north = image.bounds.south; });
  invalid(image => { image.attribution = ''; });
  invalid(image => { image.coordinates = 'BD-09'; });
  const draft = structuredClone(catalog); draft.meta.mapImage.secret = 'not-public';
  assert.equal(validateCatalog(draft).meta.mapImage.secret, undefined);
});

test('上科大地图：本地底图校验和与尺寸相符，图片包含校园而不是透明空白', async () => {
  const root = new URL('../public/campus-maps/shanghaitech/', import.meta.url);
  const bytes = await fs.readFile(new URL('map.webp', root));
  const source = JSON.parse(await fs.readFile(new URL('source.json', root), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.imageSha256);
  const image = await loadImage(bytes), canvas = createCanvas(160, 110), context = canvas.getContext('2d');
  assert.equal(image.width, source.width); assert.equal(image.height, source.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let opaque = 0, colored = 0;
  for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] > 128) opaque++; if (pixels[i + 1] > pixels[i] * 1.1 && pixels[i + 1] > pixels[i + 2]) colored++; }
  assert.ok(opaque > canvas.width * canvas.height * 0.7);
  assert.ok(colored > canvas.width * canvas.height * 0.1);
});

test('上科大地图：增量导入保留用户地点、活动及示例引用，重复导入不覆盖人工修订', () => {
  const original = demoCatalog();
  original.places.push({ ...original.places[0], id: 'custom', name: '用户维护资料', isDemo: false });
  const merged = mergeShanghaitechCatalog(original);
  assert.equal(merged.added, 109); assert.equal(merged.retained, 10);
  assert.equal(merged.catalog.places.length, 119);
  assert.deepEqual(merged.catalog.events, original.events);
  assert.deepEqual(merged.catalog.nodes, original.nodes);
  assert.deepEqual(merged.catalog.edges, original.edges);
  assert.equal(merged.catalog.meta.isDemo, true);
  const modified = merged.catalog.places.find(place => place.id.startsWith('sht-building-'));
  modified.name = '管理员人工核对后的名称';
  const again = mergeShanghaitechCatalog(merged.catalog);
  assert.equal(again.added, 0); assert.deepEqual(again.catalog, merged.catalog);
  assert.equal(original.places.length, 10);
});

test('上科大地图 HTTP：仅管理员可导入，版本冲突拒绝且重复导入保留原记录', async t => {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/shanghaitech-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false });
  const app = express();
  app.use('/guide', createCampusGuideRouter({ repository, resolveUser: async header => header ? { id: header, role: header === 'admin' ? 'admin' : 'user' } : null, adminUser: user => user.role === 'admin' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(user, revision) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/guide/admin/import-shanghaitech`, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { authorization: user } : {}) }, body: JSON.stringify({ revision }) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request(null, 0)).status, 401);
  assert.equal((await request('user', 0)).status, 403);
  const imported = await request('admin', 0);
  assert.equal(imported.status, 200); assert.equal(imported.body.added, 109); assert.equal(imported.body.retained, 9);
  assert.equal(imported.body.catalog.meta.revision, 1);
  assert.equal((await request('admin', 0)).status, 409);
  const repeated = await request('admin', 1);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.added, 0);
  assert.equal(repeated.body.catalog.places.length, 118);
});

test('上科大地图 CLI：先预览，应用前备份，重复应用不重复写入并保留其他文件', async t => {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/shanghaitech-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, 'data'), config = path.join(directory, 'environment.json');
  await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'calendar.json'), 'preserved-calendar');
  await fs.writeFile(config, JSON.stringify({ DAYLIGHT_RUNTIME: 'local', DAYLIGHT_DATA_DIR: dataDir }));
  const run = apply => {
    const result = spawnSync(process.execPath, ['scripts/apply-shanghaitech-map.mjs', '--environment-file', config, ...(apply ? ['--apply'] : [])], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout.trim());
  };
  const preview = run(false); assert.equal(preview.preview, true); assert.equal(preview.revision, 0);
  await assert.rejects(fs.stat(path.join(dataDir, 'campus-guide')), { code: 'ENOENT' });
  const applied = run(true); assert.equal(applied.applied, true); assert.equal(applied.revision, 1); assert.equal(applied.places, 109);
  const before = JSON.parse(await fs.readFile(applied.backup, 'utf8')); assert.equal(before.version, 0);
  const again = run(true); assert.equal(again.applied, false); assert.equal(again.revision, 1);
  assert.equal((await fs.readdir(path.join(dataDir, 'campus-guide', 'backups'))).length, 1);
  assert.equal(await fs.readFile(path.join(dataDir, 'calendar.json'), 'utf8'), 'preserved-calendar');
});
