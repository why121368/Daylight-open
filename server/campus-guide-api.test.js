import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { createGuideRepository, CATALOG_KEY, ACTIVITY_KEY, COMMUNITY_KEY, personalKey } from './campus-guide/repository.js';

async function fixture(t) {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-guide-api-')), repository = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  let current = new Date('2026-10-26T18:30:00+08:00'); const users = { alice: { id: 'alice', username: 'Alice', role: 'user' }, bob: { id: 'bob', username: 'Bob', role: 'user' }, admin: { id: 'admin', username: 'Admin', role: 'admin' } };
  const objects = new Map(), app = express();
  app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => users[header?.replace('Bearer ', '')] || null, adminUser: user => user?.role === 'admin', now: () => new Date(current), attachments: { put: async data => { const key = `private-image-${objects.size}`; objects.set(key, { buffer: data.buffer, contentType: data.contentType }); return { key }; }, get: async key => objects.get(key) } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/campus-guide`;
  async function call(route, { user, method = 'GET', body, binary = false } = {}) { const response = await fetch(base + route, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }) }, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }) }); const contentType = response.headers.get('content-type') || '', value = contentType.includes('application/json') ? await response.json() : await response.text(); return { status: response.status, body: value, headers: response.headers }; }
  return { call, repository, setTime: value => { current = new Date(value); }, directory };
}

test('校园HTTP：匿名公开目录/路线可访问，私人和管理操作按用户门禁', async t => {
  const { call } = await fixture(t); const catalog = await call('/catalog'); assert.equal(catalog.status, 200); assert.equal(catalog.body.places.length, 9); assert.equal(catalog.body.meta.isDemo, true); assert.deepEqual(catalog.body.floorPlans, catalog.body.indoorPlans);
  assert.equal((await call('/route', { method: 'POST', body: { from: 'demo-teaching', to: 'demo-library', avoidRain: true } })).body.distanceMeters, 230);
  assert.equal((await call('/me')).status, 401); assert.equal((await call('/admin/catalog', { user: 'alice' })).status, 403); assert.equal((await call('/admin/catalog', { user: 'admin' })).status, 200);
  assert.equal((await call('/feedback', { method: 'POST', body: { kind: 'other', message: 'example' } })).status, 401);
  assert.equal((await call('/route', { method: 'POST', body: { from: 'missing', to: 'demo-library' } })).status, 404);
  assert.equal((await call('/admin/import', { user: 'alice', method: 'POST', body: catalog.body })).status, 403);
});
test('校园HTTP：个人多端CAS、隔离、课程展开、ICS，不能伪造签到', async t => {
  const { call, directory } = await fixture(t); await fs.writeFile(path.join(directory, 'calendar.json'), 'existing-private-calendar');
  const personal = (await call('/me', { user: 'alice' })).body;
  const next = { ...personal, favorites: ['demo-library'], homePlaceId: 'demo-dorm', registrations: ['demo-event-academic'], courses: [{ id: 'c1', title: '示例课', placeId: 'demo-teaching', weekday: 1, startTime: '08:15', endTime: '09:55', startDate: '2026-10-19', endDate: '2026-11-20', weeks: [2] }], checkins: [{ eventId: 'fake', checkedAt: '2026-10-26T18:00:00+08:00' }] };
  const saved = await call('/me', { user: 'alice', method: 'PUT', body: next }); assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1); assert.deepEqual(saved.body.checkins, []);
  assert.equal((await call('/me', { user: 'alice', method: 'PUT', body: next })).status, 409); assert.deepEqual((await call('/me', { user: 'bob' })).body.favorites, []);
  const day = await call('/me/day?date=2026-10-26', { user: 'alice' }); assert.equal(day.body.items.length, 2); assert.ok(day.body.legs.length);
  const ics = await call('/me/calendar-export?from=2026-10-26&to=2026-10-27', { user: 'alice' }); assert.equal(ics.status, 200); assert.match(ics.body, /BEGIN:VCALENDAR/); assert.equal(ics.body.match(/BEGIN:VEVENT/g).length, 2); assert.match(ics.headers.get('cache-control'), /no-store/);
  assert.equal(await fs.readFile(path.join(directory, 'calendar.json'), 'utf8'), 'existing-private-calendar');
});
test('校园HTTP：排队限频、用户隐私与真实TTL到期', async t => {
  const { call, setTime } = await fixture(t), report = { venueId: 'demo-canteen-1', level: 'short' };
  assert.equal((await call('/queue-reports', { user: 'alice', method: 'POST', body: report })).status, 200);
  assert.equal((await call('/queue-reports', { user: 'alice', method: 'POST', body: report })).status, 429);
  assert.equal((await call('/queue-reports', { user: 'bob', method: 'POST', body: { ...report, level: 'long' } })).status, 200);
  const queues = await call('/queues'); assert.equal(queues.body.reports[0].reportCount, 2); assert.equal(JSON.stringify(queues.body).includes('alice'), false);
  setTime('2026-10-26T19:00:01+08:00'); assert.equal((await call('/queues')).body.reports.length, 0);
});
test('校园HTTP：管理员目录CAS、导入导出、反馈处理与彻底清空示例', async t => {
  const { call } = await fixture(t); const catalog = (await call('/admin/catalog', { user: 'admin' })).body;
  catalog.meta.title = '管理员维护校园'; catalog.places.push({ ...catalog.places[0], id: 'custom-gate', name: '自有已核验入口', nodeId: '', isDemo: false });
  const saved = await call('/admin/catalog', { user: 'admin', method: 'PUT', body: catalog }); assert.equal(saved.status, 200); assert.equal(saved.body.meta.revision, 1);
  assert.equal((await call('/admin/import', { user: 'admin', method: 'POST', body: catalog })).status, 409);
  const exported = await call('/admin/export', { user: 'admin' }); assert.equal(exported.body.meta.title, '管理员维护校园');
  const feedback = await call('/feedback', { user: 'alice', method: 'POST', body: { kind: 'place', placeId: 'custom-gate', message: '请核对开放时间。' } }); assert.equal(feedback.status, 200);
  assert.equal((await call('/admin/feedback', { user: 'bob' })).status, 403);
  const list = await call('/admin/feedback', { user: 'admin' }), row = list.body.feedback[0];
  const processed = await call(`/admin/feedback/${row.id}`, { user: 'admin', method: 'PATCH', body: { status: 'resolved', resolution: '已核对', revision: row.revision } }); assert.equal(processed.status, 200); assert.equal(processed.body.revision, 1);
  assert.equal((await call(`/admin/feedback/${row.id}`, { user: 'admin', method: 'PATCH', body: { status: 'dismissed', revision: row.revision } })).status, 409);
  const empty = await call('/admin/clear-demo', { user: 'admin', method: 'POST', body: { revision: saved.body.meta.revision } }); assert.equal(empty.status, 200); assert.deepEqual(empty.body.places.map(p => p.id), ['custom-gate']); for (const field of ['events', 'menus', 'nodes', 'edges', 'venues', 'indoorPlans', 'parcelStations']) assert.equal(empty.body[field].length, 0);
  assert.deepEqual((await call('/catalog')).body.places.map(p => p.id), ['custom-gate']);
});
test('校园HTTP：目录细粒度维护保持图关系，不静默删除依赖', async t => {
  const { call } = await fixture(t); const deleted = await call('/admin/catalog/places/demo-teaching', { user: 'admin', method: 'DELETE', body: { revision: 0 } }); assert.equal(deleted.status, 400); assert.equal((await call('/catalog')).body.meta.revision, 0);
  const added = await call('/admin/catalog/places', { user: 'admin', method: 'POST', body: { revision: 0, item: { id: 'custom', name: '新地点', category: 'service', lat: 31.17, lng: 121.59 } } }); assert.equal(added.status, 200); assert.equal(added.body.meta.revision, 1);
  const renamed = await call('/admin/catalog/places/custom', { user: 'admin', method: 'PUT', body: { revision: 1, item: { ...added.body.places.find(p => p.id === 'custom'), name: '资料维护' } } }); assert.equal(renamed.status, 200);
  assert.equal((await call('/admin/catalog/places/custom', { user: 'admin', method: 'DELETE', body: { revision: 2 } })).status, 200);
});
test('校园HTTP：管理员细粒度维护响应保留所有hidden活动，公众不见hidden', async t => {
  const { call, repository } = await fixture(t); await repository.mutate(CATALOG_KEY, c => { c.events[0].hidden = true; });
  const added = await call('/admin/catalog/places', { user: 'admin', method: 'POST', body: { revision: 1, item: { id: 'custom', name: '维护地点', category: 'service', lat: 31.17, lng: 121.59 } } }); assert.equal(added.status, 200); assert.equal(added.body.events.length, 3); assert.equal(added.body.events[0].hidden, true); assert.equal((await call('/catalog')).body.events.length, 2);
  const renamed = await call('/admin/catalog/places/custom', { user: 'admin', method: 'PUT', body: { revision: 2, item: { ...added.body.places.find(p => p.id === 'custom'), name: '维护地点改名' } } }); assert.equal(renamed.body.events.length, 3);
  const deleted = await call('/admin/catalog/places/custom', { user: 'admin', method: 'DELETE', body: { revision: 3 } }); assert.equal(deleted.body.events.length, 3);
});
test('校园HTTP：主办方动态码只返回给管理员，报名意向/时间窗口/限次/幂等签到', async t => {
  const { call, repository, setTime } = await fixture(t); const eventId = 'demo-event-academic';
  assert.equal((await call(`/admin/events/${eventId}/checkin-code`, { user: 'alice', method: 'POST', body: {} })).status, 403);
  const issued = await call(`/admin/events/${eventId}/checkin-code`, { user: 'admin', method: 'POST', body: {} }); assert.equal(issued.status, 200); assert.match(issued.body.code, /^\d{6}$/);
  assert.equal(JSON.stringify((await call('/catalog')).body).includes(issued.body.code), false);
  const stored = (await repository.read(ACTIVITY_KEY)).payload; assert.equal(stored.checkinCodes[eventId].code, undefined); assert.equal(stored.checkinCodes[eventId].hash.includes(issued.body.code), false);
  assert.equal((await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: issued.body.code } })).status, 409);
  const personal = (await call('/me', { user: 'alice' })).body; await call('/me', { user: 'alice', method: 'PUT', body: { ...personal, registrations: [eventId] } });
  for (let i = 0; i < 5; i++) assert.equal((await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: 'wrong' } })).status, 400);
  assert.equal((await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: issued.body.code } })).status, 429);
  setTime('2026-10-26T18:36:00+08:00'); assert.equal((await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: issued.body.code } })).status, 400);
  const fresh = await call(`/admin/events/${eventId}/checkin-code`, { user: 'admin', method: 'POST', body: {} }), accepted = await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: fresh.body.code } }); assert.equal(accepted.status, 200); assert.equal(accepted.body.checkin.method, 'organizer_code');
  assert.equal((await call(`/events/${eventId}/checkin`, { user: 'alice', method: 'POST', body: { code: 'anything' } })).body.alreadyCheckedIn, true); assert.equal((await call('/me', { user: 'alice' })).body.checkins.length, 1); assert.equal((await call('/me', { user: 'bob' })).body.checkins.length, 0);
  setTime('2026-10-27T12:00:00+08:00'); const bob = (await call('/me', { user: 'bob' })).body; await call('/me', { user: 'bob', method: 'PUT', body: { ...bob, registrations: [eventId] } }); assert.equal((await call(`/events/${eventId}/checkin`, { user: 'bob', method: 'POST', body: { code: fresh.body.code } })).status, 409);
});
test('校园HTTP：社区帖子/评论/回复/点赞收藏，账号归属与管理隐藏', async t => {
  const { call } = await fixture(t); const input = { title: '校园体验', body: '合成测试帖子，仅用于验证。', topic: 'share', placeId: 'demo-library', images: [] };
  assert.equal((await call('/community/posts', { method: 'POST', body: input })).status, 401);
  const created = await call('/community/posts', { user: 'alice', method: 'POST', body: { ...input, authorId: 'bob', authorName: 'Impersonation' } }); assert.equal(created.status, 200); assert.equal(created.body.post.authorId, 'alice'); const id = created.body.post.id;
  assert.equal((await call('/community/posts?q=校园&topic=share&placeId=demo-library')).body.total, 1);
  assert.equal((await call(`/community/posts/${id}`, { user: 'bob', method: 'DELETE' })).status, 403);
  const comment = await call(`/community/posts/${id}/comments`, { user: 'bob', method: 'POST', body: { body: '合成评论' } }); assert.equal(comment.status, 200);
  assert.equal((await call(`/community/posts/${id}/comments`, { user: 'alice', method: 'POST', body: { body: '合成回复', parentId: comment.body.comment.id } })).status, 200);
  assert.equal((await call(`/community/posts/${id}/comments/${comment.body.comment.id}`, { user: 'alice', method: 'DELETE' })).status, 403);
  for (let i = 0; i < 2; i++) await call(`/community/posts/${id}/like`, { user: 'bob', method: 'PUT', body: { active: true } }); await call(`/community/posts/${id}/bookmark`, { user: 'bob', method: 'PUT', body: { active: true } });
  const publicDetail = await call(`/community/posts/${id}`); assert.equal(publicDetail.body.post.likeCount, 1); assert.equal(publicDetail.body.post.bookmarked, false); assert.equal(publicDetail.body.comments.length, 2);
  assert.deepEqual((await call('/community/me', { user: 'bob' })).body.bookmarkedPostIds, [id]); assert.deepEqual((await call('/community/me', { user: 'alice' })).body.bookmarkedPostIds, []);
  assert.equal((await call(`/admin/community/posts/${id}`, { user: 'admin', method: 'PATCH', body: { status: 'hidden' } })).status, 200); assert.equal((await call(`/community/posts/${id}`)).status, 404); assert.equal((await call('/community/posts')).body.total, 0); assert.equal((await call(`/community/posts/${id}`, { user: 'alice' })).status, 200);
  assert.equal((await call(`/community/posts/${id}`, { user: 'alice', method: 'DELETE' })).status, 200); assert.equal((await call(`/community/posts/${id}`, { user: 'alice' })).status, 404);
});
test('校园HTTP：社区图片限制真实位图类型、归属与公开引用，拒绝任意外链', async t => {
  const { call } = await fixture(t), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=', 'base64');
  assert.equal((await call('/community/images', { user: 'alice', method: 'POST', body: Buffer.from('<svg></svg>'), binary: true })).status, 400);
  const uploaded = await call('/community/images', { user: 'alice', method: 'POST', body: png, binary: true }); assert.equal(uploaded.status, 200); const imageRoute = uploaded.body.url.slice('/api/campus-guide'.length);
  assert.equal((await call(imageRoute)).status, 404); assert.equal((await call(imageRoute, { user: 'bob' })).status, 404); assert.equal((await call(imageRoute, { user: 'alice' })).status, 200);
  const post = { title: '图片测试', body: '合成内容', topic: 'share', images: [uploaded.body.url] }; assert.equal((await call('/community/posts', { user: 'bob', method: 'POST', body: post })).status, 400);
  assert.equal((await call('/community/posts', { user: 'alice', method: 'POST', body: { ...post, images: ['https://example.invalid/private.png'] } })).status, 400);
  const created = await call('/community/posts', { user: 'alice', method: 'POST', body: post }); assert.equal(created.status, 200); assert.equal((await call(imageRoute)).status, 200);
  await call(`/community/posts/${created.body.post.id}`, { user: 'alice', method: 'DELETE' }); assert.equal((await call(imageRoute)).status, 404);
});
test('校园HTTP：我的收藏/点赞/笔记由服务器隔离与分页，隐藏只出现在作者mine', async t => {
  const { call, repository } = await fixture(t);
  await repository.mutate(COMMUNITY_KEY, state => {
    for (let i = 0; i < 45; i++) { const post = { id: `page-post-${i}`, title: `笔记 ${i}`, body: '合成分页材料', topic: 'share', placeId: '', eventId: '', venueId: '', images: [], authorId: i % 2 ? 'bob' : 'alice', authorName: i % 2 ? 'Bob' : 'Alice', status: 'published', createdAt: new Date(Date.UTC(2026, 9, 23, 0, i)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 23, 0, i)).toISOString() }; state.posts.push(post); state.reactions.push({ postId: post.id, userId: 'alice', bookmark: true, like: i < 5 }); }
    state.posts.push({ ...state.posts[0], id: 'alice-hidden', status: 'hidden' }, { ...state.posts[1], id: 'bob-hidden', status: 'hidden' }, { ...state.posts[0], id: 'alice-deleted', status: 'deleted' }); state.reactions.push({ postId: 'bob-hidden', userId: 'alice', bookmark: true, like: true });
  });
  for (const filter of ['bookmarked', 'liked', 'mine']) assert.equal((await call(`/community/posts?filter=${filter}`)).status, 401);
  const first = await call('/community/posts?filter=bookmarked&page=1', { user: 'alice' }), second = await call('/community/posts?filter=bookmarked&page=2', { user: 'alice' }), third = await call('/community/posts?filter=bookmarked&page=3', { user: 'alice' });
  assert.equal(first.body.total, 45); assert.equal(first.body.posts.length, 20); assert.equal(second.body.posts.length, 20); assert.equal(third.body.posts.length, 5); assert.equal(new Set([...first.body.posts, ...second.body.posts, ...third.body.posts].map(p => p.id)).size, 45); assert.equal((await call('/community/posts?filter=bookmarked', { user: 'bob' })).body.total, 0);
  assert.equal((await call('/community/posts?filter=liked', { user: 'alice' })).body.total, 5); const mine = await call('/community/posts?filter=mine&page=2', { user: 'alice' }); assert.equal(mine.body.total, 24); assert.ok(mine.body.posts.every(p => p.authorId === 'alice' && p.status !== 'deleted')); const mineFirst = await call('/community/posts?filter=mine', { user: 'alice' }); assert.ok([...mineFirst.body.posts, ...mine.body.posts].some(p => p.id === 'alice-hidden'));
  assert.equal((await call('/community/posts?q=hidden')).body.total, 0);
});
test('校园HTTP：菜单价格规格/生效期、评分按账号去重与售罄3小时到期', async t => {
  const { call, repository, setTime } = await fixture(t);
  await repository.mutate(CATALOG_KEY, c => { c.menus[0].portion = '标准份'; c.menus[0].specs = [{ name: '加大', price: 20 }]; c.menus[0].validFrom = '2026-10-26'; c.menus[0].validUntil = '2026-10-27'; c.menus[0].soldOut = false; });
  assert.equal((await call('/menu-reports', { method: 'POST', body: { menuId: 'demo-menu-rice', rating: 5 } })).status, 401);
  assert.equal((await call('/menu-reports', { user: 'alice', method: 'POST', body: { menuId: 'demo-menu-rice', rating: 5, soldOut: true } })).status, 200); assert.equal((await call('/menu-reports', { user: 'bob', method: 'POST', body: { menuId: 'demo-menu-rice', rating: 3 } })).status, 200);
  let dining = (await call('/dining')).body, menu = dining.menus.find(m => m.id === 'demo-menu-rice'); assert.equal(menu.ratingAverage, 4); assert.equal(menu.ratingCount, 2); assert.equal(menu.soldOut, true); assert.equal(menu.specs[0].price, 20); assert.equal(JSON.stringify(dining).includes('alice'), false);
  assert.equal(menu.myRating, null); assert.equal((await call('/dining', { user: 'alice' })).body.menus.find(m => m.id === menu.id).myRating, 5); assert.equal((await call('/dining', { user: 'bob' })).body.menus.find(m => m.id === menu.id).myRating, 3); assert.equal((await call('/dining', { user: 'admin' })).body.menus.find(m => m.id === menu.id).myRating, null);
  const originalAvailabilityExpiry = menu.availabilityExpiresAt;
  setTime('2026-10-26T21:29:00+08:00'); assert.equal((await call('/menu-reports', { user: 'alice', method: 'POST', body: { menuId: menu.id, rating: 4 } })).status, 200);
  menu = (await call('/dining', { user: 'alice' })).body.menus.find(m => m.id === menu.id); assert.equal(menu.ratingCount, 2); assert.equal(menu.myRating, 4); assert.equal(menu.availabilityExpiresAt, originalAvailabilityExpiry); assert.equal(menu.soldOut, true);
  setTime('2026-10-26T21:31:00+08:00'); menu = (await call('/dining')).body.menus.find(m => m.id === 'demo-menu-rice'); assert.equal(menu.soldOut, false); assert.equal(menu.ratingCount, 2);
  setTime('2026-10-28T12:00:00+08:00'); assert.equal((await call('/dining')).body.menus.some(m => m.id === 'demo-menu-rice'), false);
});

test('校园HTTP：修改评分不抢占更新的库存反馈，旧库存记录保留原三小时有效期', async t => {
  const { call, repository, setTime } = await fixture(t), menuId = 'demo-menu-rice', readMenu = async () => (await call('/dining')).body.menus.find(menu => menu.id === menuId);
  await call('/menu-reports', { user: 'alice', method: 'POST', body: { menuId, soldOut: true, rating: 5 } });
  setTime('2026-10-26T18:35:00+08:00'); await call('/menu-reports', { user: 'bob', method: 'POST', body: { menuId, soldOut: false } });
  const newerAvailability = await readMenu(); assert.equal(newerAvailability.soldOut, false);
  setTime('2026-10-26T18:40:00+08:00'); await call('/menu-reports', { user: 'alice', method: 'POST', body: { menuId, rating: 4 } });
  assert.equal((await readMenu()).soldOut, false); assert.equal((await readMenu()).availabilityReportedAt, newerAvailability.availabilityReportedAt);
  await repository.mutate(ACTIVITY_KEY, state => { state.menuReports = [{ id: 'legacy-report', userId: 'alice', menuId, rating: 4, soldOut: true, reportedAt: '2026-10-26T18:30:00+08:00', expiresAt: '2026-10-26T21:30:00+08:00' }]; });
  setTime('2026-10-26T21:29:00+08:00'); await call('/menu-reports', { user: 'alice', method: 'POST', body: { menuId, rating: 3 } });
  assert.equal((await readMenu()).soldOut, true); assert.equal(Date.parse((await readMenu()).availabilityExpiresAt), Date.parse('2026-10-26T21:30:00+08:00'));
  setTime('2026-10-26T21:31:00+08:00'); assert.equal((await readMenu()).soldOut, false); assert.equal((await readMenu()).ratingAverage, 3);
});
test('校园主服务HTTP：真实JWT/前置公共挂载、私有状态隔离、已入库自有邮件只能进私有草案', { timeout: 60000 }, async () => {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-guide-main-')), secret = 'synthetic-campus-guide-main-only-secret';
  const users = [{ id: 'cg-main-admin', email: 'synthetic-admin@example.invalid', username: 'cg-main-admin', role: 'admin', session_version: 0 }, { id: 'cg-main-user', email: 'synthetic-user@example.invalid', username: 'cg-main-user', role: 'user', session_version: 0 }];
  await fs.writeFile(path.join(directory, 'users.json'), JSON.stringify({ users, resets: [] }));
  await fs.writeFile(path.join(directory, 'infra.json'), JSON.stringify({ postgres: { enabled: false }, redis: { enabled: false }, mq: { enabled: false }, oss: { enabled: false }, auth: { requireAuth: true, jwtSecret: secret } }));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ mailboxes: [{ id: 'cg-admin-box', ownerUserId: users[0].id, email: users[0].email }, { id: 'cg-user-box', ownerUserId: users[1].id, email: users[1].email }], userPrefs: { [users[0].id]: { activeMailboxId: 'cg-admin-box' }, [users[1].id]: { activeMailboxId: 'cg-user-box' } } }));
  for (const box of ['cg-admin-box', 'cg-user-box']) { await fs.mkdir(path.join(directory, 'mailboxes', box), { recursive: true }); await fs.writeFile(path.join(directory, 'mailboxes', box, 'calendar.json'), JSON.stringify({ events: [], tasks: [], emails: [{ id: `stored-${box}`, subject: `合成-${box}-活动`, body: `private-${box}-body`, receivedAt: '2026-10-23T12:00:00+08:00' }] })); }
  const protectedKeys = ['campus/project/private.json', 'campus-media/private.json', 'campus-community/private.json', 'users/synthetic/mailboxes/box/campus-media/nested.json'];
  const ordinaryKey = 'users/synthetic/mailboxes/box/ordinary.json';
  for (const key of [...protectedKeys, ordinaryKey]) { const target = path.join(directory, 'attachments', key); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, JSON.stringify({ syntheticAttachment: true, privateMarker: key })); }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server/index.js', '--production'], { env: { ...process.env, DAYLIGHT_DATA_DIR: directory, DAYLIGHT_RUNTIME: 'local', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const tokens = users.map(user => jwt.sign({ sub: user.id, sv: 0 }, secret, { expiresIn: '5m' }));
  async function call(route, token, method = 'GET', body) { const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; }
  try {
    const deadline = Date.now() + 45000; while (Date.now() < deadline && !output.includes('Daylight is ready')) { if (child.exitCode !== null) throw Error(output); await new Promise(resolve => setTimeout(resolve, 80)); } assert.match(output, /Daylight is ready/);
    assert.equal((await call('/state')).status, 401); const campus = await call('/campus-guide/catalog'); assert.equal(campus.status, 200); assert.equal(campus.body.places.length, 109); assert.ok(campus.body.meta.mapImage); assert.equal((await call('/campus-guide/me')).status, 401); assert.equal((await call('/campus-guide/admin/catalog', tokens[1])).status, 403);
    const me = (await call('/campus-guide/me', tokens[1])).body; assert.equal((await call('/campus-guide/me', tokens[1], 'PUT', { ...me, favorites: [campus.body.places[0].id] })).status, 200); assert.equal((await call('/campus-guide/me', tokens[0])).body.favorites.length, 0);
    const selected = await call('/campus-guide/admin/sources/email-draft', tokens[0], 'POST', { mailboxId: 'cg-admin-box', emailId: 'stored-cg-admin-box' }); assert.equal(selected.status, 200, JSON.stringify(selected)); assert.match(selected.body.draft.event.description, /private-cg-admin-box-body/);
    assert.equal((await call('/campus-guide/admin/sources/email-draft', tokens[0], 'POST', { mailboxId: 'cg-user-box', emailId: 'stored-cg-user-box' })).status, 404);
    assert.equal(JSON.stringify((await call('/campus-guide/catalog')).body).includes('private-'), false);
    // The generic local attachment fallback must not bypass either campus ACL.
    for (const key of protectedKeys) for (const token of tokens) { const response = await call(`/attachments/${encodeURIComponent(key)}`, token); assert.equal(response.status, 404, key); assert.equal(JSON.stringify(response.body).includes('privateMarker'), false); }
    assert.equal((await call(`/attachments/${encodeURIComponent(ordinaryKey)}`, tokens[0])).status, 200);
    assert.equal((await call(`/attachments/${encodeURIComponent(protectedKeys[1])}`)).status, 404);
  } finally { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]); if (child.exitCode === null) child.kill('SIGKILL'); }
});
