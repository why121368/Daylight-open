import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { createGuideRepository, CATALOG_KEY, COMMUNITY_KEY, MEDIA_KEY } from './campus-guide/repository.js';
import { CAMPUS_MEDIA_LIMIT, campusMediaIsPublic } from './campus-guide/media.js';
import { demoCatalog } from './campus-guide/seed.js';

// Synthetic file headers only. No real photograph, external object store or user data.
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(20)]);
const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(20)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);

async function fixture(t, overrides = {}) {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/campus-media-'));
  const repository = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  const objects = new Map(), puts = [], gets = [];
  const users = { admin: { id: 'synthetic-admin', role: 'admin' }, member: { id: 'synthetic-member', role: 'user' } };
  const mediaAttachments = {
    put: async options => { puts.push({ ...options, buffer: undefined }); const key = `campus-media/test/${options.filename}`; objects.set(key, { buffer: Buffer.from(options.buffer) }); return { key, url: 'https://private-bucket.invalid/secret', proxyUrl: '/api/attachments/private-key', storage: 'synthetic' }; },
    get: async key => { gets.push(key); return objects.get(key); },
    ...overrides,
  };
  const app = express();
  app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => users[header?.replace('Bearer ', '')] || null, adminUser: user => user?.role === 'admin', now: () => new Date('2026-10-23T12:00:00+08:00'), mediaAttachments, attachments: { put: async () => { throw Error('community adapter must not be used'); }, get: async () => { throw Error('community adapter must not be used'); } } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function upload(buffer = png, { user = 'admin', filename = 'scene-01.png', headers = {} } = {}) {
    const response = await fetch(`${origin}/api/campus-guide/admin/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename), ...(user ? { Authorization: `Bearer ${user}` } : {}), ...headers }, body: buffer });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function read(url, user) { const response = await fetch(url, { headers: user ? { Authorization: `Bearer ${user}` } : {} }); const buffer = Buffer.from(await response.arrayBuffer()); return { status: response.status, headers: response.headers, buffer, text: buffer.toString() }; }
  // Send headers before a body to prove auth/size gates do not wait for 20 MiB.
  function headersOnly(headers) {
    return new Promise((resolve, reject) => {
      const request = http.request(`${origin}/api/campus-guide/admin/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'scene-01.png', ...headers } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); request.destroy(); }); });
      request.on('error', reject); request.flushHeaders();
    });
  }
  function hostUpload(host) {
    return new Promise((resolve, reject) => {
      const request = http.request(`${origin}/api/campus-guide/admin/media`, { method: 'POST', headers: { Host: host, Authorization: 'Bearer admin', 'Content-Type': 'application/octet-stream', 'X-Filename': 'scene-01.png', 'Content-Length': png.length } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); });
      request.on('error', reject); request.end(png);
    });
  }
  function chunkedUpload(buffer) {
    return new Promise((resolve, reject) => {
      const request = http.request(`${origin}/api/campus-guide/admin/media`, { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/octet-stream', 'X-Filename': 'scene-01.png', 'Transfer-Encoding': 'chunked' } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); });
      request.on('error', reject);
      for (let offset = 0; offset < buffer.length; offset += 1024 * 1024) request.write(buffer.subarray(offset, offset + 1024 * 1024));
      request.end();
    });
  }
  return { repository, objects, puts, gets, upload, read, headersOnly, hostUpload, chunkedUpload, origin };
}

test('校园媒体上传：管理员认证先于大文件读取，存储与社区图片隔离且响应不泄漏对象地址', async t => {
  const { upload, headersOnly, puts, repository, origin } = await fixture(t);
  assert.equal((await headersOnly({ 'Content-Length': CAMPUS_MEDIA_LIMIT + 1 })).status, 401);
  assert.equal((await headersOnly({ Authorization: 'Bearer member', 'Content-Length': CAMPUS_MEDIA_LIMIT + 1 })).status, 403);
  assert.equal(puts.length, 0);
  const result = await upload(); assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body).sort(), ['contentType', 'filename', 'id', 'size', 'url']);
  assert.equal(result.body.filename, 'scene-01.png'); assert.equal(result.body.contentType, 'image/png'); assert.equal(result.body.size, png.length);
  assert.equal(result.body.url, `${origin}/api/campus-guide/media/${result.body.id}`);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(puts[0].prefix, 'campus-media'); assert.match(puts[0].filename, /^[a-f0-9-]+\.png$/);
  assert.equal((await repository.read(COMMUNITY_KEY)).payload.images.length, 0);
  const metadata = (await repository.read(MEDIA_KEY)).payload.files[0]; assert.equal(metadata.id, result.body.id); assert.match(metadata.key, /^campus-media\//);
  assert.doesNotMatch(JSON.stringify(result.body), /private-bucket|secret|attachments|storage|key/);
});

test('校园媒体读取：仅管理员读未引用文件，公开引用后匿名读，撤引用/隐藏唯一活动立即撤权', async t => {
  const { upload, read, repository, gets } = await fixture(t), media = (await upload()).body;
  for (const user of [undefined, 'member']) assert.equal((await read(media.url, user)).status, 404);
  assert.equal(gets.length, 0);
  const privateRead = await read(media.url, 'admin'); assert.equal(privateRead.status, 200); assert.deepEqual(privateRead.buffer, png);
  assert.equal(privateRead.headers.get('x-content-type-options'), 'nosniff'); assert.equal(privateRead.headers.get('content-type'), 'image/png');
  await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].imageUrl = media.url; });
  const published = await read(media.url); assert.equal(published.status, 200); assert.deepEqual(published.buffer, png); assert.equal(published.headers.get('cache-control'), 'private, no-store');
  await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].hidden = true; });
  assert.equal((await read(media.url)).status, 404); assert.equal((await read(media.url, 'admin')).status, 200);
  await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].hidden = false; }); assert.equal((await read(media.url)).status, 200);
  await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].imageUrl = ''; catalog.venues[0].adminNote = media.url; catalog.events[0].description = media.url; });
  assert.equal((await read(media.url)).status, 404);
});

test('校园媒体公开判定：只接受公开投影的明确图片字段与原始媒体origin/path', () => {
  const media = { id: '01020304-1234-4abc-8abc-1234567890ab', origin: 'http://127.0.0.1:12345' }, url = `${media.origin}/api/campus-guide/media/${media.id}`;
  const changes = [c => { c.events[0].imageUrl = url; }, c => { c.streetViews.push({ id: 'synthetic-media-scene', nodeId: c.nodes[0].id, imageUrl: url }); }, c => { c.indoorPlans[0].imageUrl = url; }, c => { c.menus[0].imageUrl = url; }, c => { c.menus[0].menuImageUrl = url; }, c => { c.venues[0].menuImageUrl = url; }, c => { c.venues[0].windows[0].menuImageUrl = url; }, c => { c.edges[0].sceneImageUrl = url; }];
  for (const change of changes) { const catalog = demoCatalog(); change(catalog); assert.equal(campusMediaIsPublic(catalog, media), true); }
  for (const bad of [url.replace('127.0.0.1', 'localhost'), `${url}?private=1`, `${url}#image`, `${url}/extra`, `https://other.invalid/api/campus-guide/media/${media.id}`]) { const catalog = demoCatalog(); catalog.events[0].imageUrl = bad; assert.equal(campusMediaIsPublic(catalog, media), false); }
  const hidden = demoCatalog(); hidden.events[0].imageUrl = url; hidden.events[0].hidden = true; assert.equal(campusMediaIsPublic(hidden, media), false);
  hidden.venues[0].menuImageUrl = url; assert.equal(campusMediaIsPublic(hidden, media), true);
  const onlyText = demoCatalog(); onlyText.events[0].sourceUrl = url; onlyText.events[0].description = url; onlyText.venues[0].adminNote = url; onlyText.places[0].imageUrl = url; assert.equal(campusMediaIsPublic(onlyText, media), false);
});

test('校园媒体校验：按魔数接受PNG/JPEG/WebP，拒绝伪装图片、GIF与路径文件名', async t => {
  const { upload, puts } = await fixture(t);
  for (const [buffer, filename, contentType] of [[png, '街景-01.png', 'image/png'], [jpeg, 'scene-02.jpeg', 'image/jpeg'], [webp, 'scene-03.webp', 'image/webp']]) { const result = await upload(buffer, { filename }); assert.equal(result.status, 201); assert.equal(result.body.contentType, contentType); }
  for (const buffer of [Buffer.from('<svg onload="synthetic()"></svg>'), Buffer.from('GIF89a' + 'x'.repeat(20)), Buffer.from('not an image'), Buffer.alloc(0)]) assert.equal((await upload(buffer)).status, 400);
  for (const filename of ['../scene-01.png', 'folder/scene-01.png', 'folder\\scene-01.png', 'C:scene-01.png', 'scene|01.png', 'scene-01.svg', ' scene-01.png', `scene\n01.png`]) assert.equal((await upload(png, { filename })).status, 400);
  assert.equal((await upload(png, { headers: { 'X-Filename': '%broken' } })).status, 400);
  assert.equal(puts.length, 3);
});

test('校园媒体大小：20 MiB边界可上传，超限在读取文件前返回413', async t => {
  const { upload, headersOnly, chunkedUpload, puts } = await fixture(t);
  const full = Buffer.alloc(CAMPUS_MEDIA_LIMIT); png.copy(full);
  assert.equal((await upload(full)).status, 201);
  assert.equal((await headersOnly({ Authorization: 'Bearer admin', 'Content-Length': CAMPUS_MEDIA_LIMIT + 1 })).status, 413);
  const oversized = Buffer.alloc(CAMPUS_MEDIA_LIMIT + 1); png.copy(oversized);
  assert.equal((await chunkedUpload(oversized)).status, 413);
  assert.equal(puts.length, 1);
});

test('校园媒体地址：忽略跨域Origin/转发Host，拒绝无效Host，存储故障不泄漏内部信息', async t => {
  const { upload, hostUpload, origin, puts } = await fixture(t);
  const safe = await upload(png, { headers: { Origin: 'https://attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'https' } });
  assert.equal(safe.status, 201); assert.equal(new URL(safe.body.url).origin, origin);
  for (const host of ['bad.invalid@attacker.invalid', 'bad.invalid/path', 'bad.invalid?token=secret']) assert.equal((await hostUpload(host)).status, 400);
  assert.equal(puts.length, 1);
  const failure = await fixture(t, { put: async () => { throw Error('https://private-bucket.invalid/secret-key'); } });
  const failed = await failure.upload(); assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.body), /private-bucket|secret-key/); assert.equal((await failure.repository.read(MEDIA_KEY)).payload.files.length, 0);
});
