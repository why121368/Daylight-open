import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { createGuideRepository, COMMUNITY_KEY, CATALOG_KEY } from './campus-guide/repository.js';

async function fixture(t) {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-community-boards-'));
  const repository = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  const users = { alice: { id: 'alice', username: '合成用户甲', role: 'user' }, bob: { id: 'bob', username: '合成用户乙', role: 'user' }, admin: { id: 'admin', username: '合成管理员', role: 'admin' } };
  const app = express(); app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => users[header?.replace('Bearer ', '')] || null, adminUser: user => user?.role === 'admin', now: () => new Date('2026-10-23T12:00:00+08:00') }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/campus-guide`;
  async function call(route, { user, method = 'GET', body } = {}) { const response = await fetch(base + route, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; }
  const post = (input = {}, user = 'alice') => call('/community/posts', { user, method: 'POST', body: { title: '合成笔记', body: '公开合成内容', topic: 'share', images: [], ...input } });
  return { call, post, repository };
}

test('校园交流分区：四板块独立筛选，旧帖默认campus且保留笔记类型', async t => {
  const { call, post, repository } = await fixture(t);
  for (const board of ['campus', 'events', 'food', 'places']) { const created = await post({ board, title: `${board}合成笔记` }); assert.equal(created.status, 200); assert.equal(created.body.post.board, board); assert.equal(created.body.post.topic, 'share'); }
  await repository.mutate(COMMUNITY_KEY, state => state.posts.push({ id: 'legacy', title: '旧版未带板块', body: '合成旧内容', topic: 'guide', placeId: '', eventId: '', venueId: '', images: [], authorId: 'bob', authorName: '合成用户', createdAt: '2026-10-23T10:00:00+08:00', updatedAt: '2026-10-23T10:00:00+08:00', status: 'published' }));
  assert.equal((await call('/community/posts')).body.total, 5);
  const campus = await call('/community/posts?board=campus'); assert.equal(campus.body.total, 2); assert.equal(campus.body.posts.find(row => row.id === 'legacy').board, 'campus');
  assert.equal((await call('/community/posts?board=food')).body.total, 1); assert.equal((await call('/community/posts?board=campus&topic=guide')).body.total, 1);
  assert.equal((await call('/community/posts?board=not-a-board')).status, 400);
});

test('校园交流关联：校验活动/地点/食堂窗口，拒绝隐藏活动与跨食堂窗口', async t => {
  const { post, repository } = await fixture(t); await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].hidden = true; });
  for (const input of [{ board: 'invalid' }, { board: ['food'] }, { eventId: 'missing' }, { eventId: 'demo-event-academic' }, { placeId: 'missing' }, { venueId: 'missing' }, { windowId: 'demo-window-rice' }, { venueId: 'demo-canteen-2', windowId: 'demo-window-rice' }, { windowId: 1 }, { placeId: false }]) assert.equal((await post(input)).status, 400);
  const result = await post({ board: 'food', placeId: 'demo-dining', venueId: 'demo-canteen-1', windowId: 'demo-window-rice', authorId: 'bob' });
  assert.equal(result.status, 200); assert.equal(result.body.post.windowId, 'demo-window-rice'); assert.equal(result.body.post.authorId, 'alice');
});

test('校园交流关联：活动/地点/食堂/窗口精确相交过滤', async t => {
  const { call, post } = await fixture(t);
  await post({ board: 'food', title: '米饭窗口', placeId: 'demo-dining', venueId: 'demo-canteen-1', windowId: 'demo-window-rice' });
  await post({ board: 'food', title: '面食窗口', placeId: 'demo-dining', venueId: 'demo-canteen-1', windowId: 'demo-window-noodle' });
  await post({ board: 'food', title: '二楼窗口', venueId: 'demo-canteen-2', windowId: 'demo-window-salad' });
  await post({ board: 'events', title: '合成活动讨论', eventId: 'demo-event-academic', placeId: 'demo-teaching' });
  const selected = await call('/community/posts?board=food&venueId=demo-canteen-1&windowId=demo-window-rice'); assert.equal(selected.body.total, 1); assert.equal(selected.body.posts[0].title, '米饭窗口');
  assert.equal((await call('/community/posts?placeId=demo-dining')).body.total, 2);
  assert.equal((await call('/community/posts?eventId=demo-event-academic')).body.posts[0].title, '合成活动讨论');
  assert.equal((await call('/community/posts?board=events&venueId=demo-canteen-1')).body.total, 0);
  assert.equal((await call('/community/posts?windowId=demo-window-rice-other')).body.total, 0);
});

test('校园交流分区：全局收藏跨板块保留隔离，隐藏帖只作者和管理员可读', async t => {
  const { call, post } = await fixture(t); const food = (await post({ board: 'food' })).body.post, event = (await post({ board: 'events' })).body.post;
  for (const row of [food, event]) assert.equal((await call(`/community/posts/${row.id}/bookmark`, { method: 'PUT', user: 'alice', body: { active: true } })).status, 200);
  assert.equal((await call('/community/posts?filter=bookmarked')).status, 401);
  assert.equal((await call('/community/posts?filter=bookmarked', { user: 'alice' })).body.total, 2);
  assert.equal((await call('/community/posts?board=food&filter=bookmarked', { user: 'alice' })).body.total, 1);
  assert.equal((await call('/community/posts?filter=bookmarked', { user: 'bob' })).body.total, 0);
  await call(`/admin/community/posts/${food.id}`, { method: 'PATCH', user: 'admin', body: { status: 'hidden' } });
  assert.equal((await call('/community/posts?board=food')).body.total, 0);
  assert.equal((await call('/community/posts?board=food&filter=mine', { user: 'alice' })).body.total, 1);
  assert.equal((await call(`/community/posts/${food.id}`, { user: 'bob' })).status, 404);
  assert.equal((await call(`/community/posts/${food.id}`, { user: 'admin' })).status, 200);
});
