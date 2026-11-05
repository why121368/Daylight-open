import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { demoCatalog } from './campus-guide/seed.js';
import { createGuideRepository, CATALOG_KEY, ACTIVITY_KEY } from './campus-guide/repository.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { gaussianMealEstimate, campusQueueOverview, diningAvailability } from '../shared/campus-dining.js';
import { validateCatalog, publicCampusCatalog, emptyPersonal, validatePersonal, dailyItems, calendarExport, eventsInRange, searchPlaces, menuMatches, EVENT_CATEGORIES } from '../shared/campus-guide.js';

async function fixture(t) {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-dining-')), repository = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false });
  let current = new Date('2026-10-26T12:00:00+08:00');
  const app = express(); app.use('/api/campus-guide', createCampusGuideRouter({ repository, now: () => new Date(current), resolveUser: async header => header === 'Bearer alice' ? { id: 'alice', role: 'user' } : header === 'Bearer admin' ? { id: 'admin', role: 'admin' } : null, adminUser: user => user.role === 'admin' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  return { repository, setTime: value => { current = new Date(value); }, async call(route, { user, cookie, origin, body, method = body ? 'POST' : 'GET' } = {}) { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '', setCookie: response.headers.get('set-cookie') || '' }; } };
}

test('匿名排队：签名HttpOnly Cookie、账号兼容、每目标限流、30分钟过期与公开投影', async t => {
  const { call, repository, setTime } = await fixture(t), body = { venueId: 'demo-canteen-1', windowId: 'demo-window-rice', level: 'short' };
  const initial = await call('/queues'); assert.equal(initial.body.allowsAnonymous, true); assert.equal(initial.body.venues[0].source, 'guess'); assert.equal(initial.body.reports.length, 0);
  const report = await call('/queue-reports', { body }); assert.equal(report.status, 200); assert.equal(report.body.anonymous, true); assert.match(report.setCookie, /HttpOnly; SameSite=Lax/); assert.match(report.cookie, /^[^=]+=[a-f0-9]{48}\.[a-f0-9]{64}$/);
  assert.equal((await call('/queue-reports', { body, cookie: report.cookie })).status, 429);
  assert.equal((await call('/queue-reports', { body, user: 'alice' })).status, 200);
  assert.equal((await call('/queue-reports', { body, origin: 'https://other.example.invalid' })).status, 403);
  assert.equal((await call('/queue-reports', { body: { ...body, windowId: 'wrong-window' } })).status, 400);
  const overview = (await call('/queues')).body, venue = overview.venues.find(row => row.venueId === body.venueId), window = venue.windows.find(row => row.windowId === body.windowId);
  assert.equal(venue.source, 'feedback'); assert.equal(window.reportCount, 2); assert.equal(window.level, 'short');
  const stored = JSON.stringify((await repository.read(ACTIVITY_KEY)).payload); assert.equal(stored.includes(report.cookie.split('=')[1]), false); assert.equal(stored.includes('127.0.0.1'), false);
  assert.equal(JSON.stringify(overview).includes('actorId'), false); assert.equal(JSON.stringify(overview).includes('alice'), false);
  setTime('2026-10-26T12:30:01+08:00'); assert.equal((await call('/queues')).body.venues[0].source, 'guess'); assert.equal((await call('/queues')).body.reports.length, 0);
});

test('匿名排队：轮换Cookie仍受匿名IP哈希预算限制；账号共享身份10次/10分钟', async t => {
  const { call, setTime } = await fixture(t), body = { venueId: 'demo-canteen-1', level: 'short' };
  for (let index = 0; index < 30; index++) assert.equal((await call('/queue-reports', { body })).status, 200);
  assert.equal((await call('/queue-reports', { body })).status, 429);
  for (let index = 0; index < 10; index++) { setTime(new Date(Date.parse('2026-10-26T12:00:00+08:00') + index * 31000)); assert.equal((await call('/queue-reports', { user: 'alice', body: { ...body, windowId: index % 2 ? 'demo-window-rice' : 'demo-window-noodle' } })).status, 200); }
  setTime('2026-10-26T12:05:10+08:00'); assert.equal((await call('/queue-reports', { user: 'alice', body })).status, 429);
});

test('排队规则：餐峰估算可重现且始终标记guess；同人多个窗口只计一份餐厅反馈', () => {
  const noon = gaussianMealEstimate('2026-10-26T12:00:00+08:00'), morning = gaussianMealEstimate('2026-10-26T04:00:00+08:00');
  assert.equal(noon.source, 'guess'); assert.equal(noon.estimated, true); assert.equal(noon.waitMinutes, 20); assert.ok(morning.waitMinutes < noon.waitMinutes); assert.match(noon.notice, /未使用/);
  const catalog = demoCatalog(), reports = [{ id: '1', actorId: 'same', venueId: 'demo-canteen-1', windowId: 'demo-window-rice', level: 'long', reportedAt: '2026-10-26T11:50:00+08:00', expiresAt: '2026-10-26T12:20:00+08:00' }, { id: '2', actorId: 'same', venueId: 'demo-canteen-1', windowId: 'demo-window-noodle', level: 'short', reportedAt: '2026-10-26T11:55:00+08:00', expiresAt: '2026-10-26T12:25:00+08:00' }];
  const overview = campusQueueOverview(catalog, reports, '2026-10-26T12:00:00+08:00'); assert.equal(overview[0].reportCount, 1); assert.equal(overview[0].level, 'short'); assert.equal(overview[0].windows[0].level, 'long');
  assert.equal(campusQueueOverview(catalog, reports, '2026-10-26T04:00:00+08:00')[0].source, 'closed');
});

test('餐饮目录：未知价格不伪装零元、停单/临时停业继承、原菜单图与私密备注投影', async t => {
  const { call, repository, setTime } = await fixture(t);
  await repository.mutate(CATALOG_KEY, catalog => {
    catalog.venues[0].adminNote = 'secret-venue-note'; catalog.venues[0].operator = '示例运营单位'; catalog.venues[0].menuImageUrl = 'https://menu.example.invalid/original.jpg';
    catalog.venues[0].windows[0].adminNote = 'secret-window-note'; catalog.venues[0].windows[0].temporarilyClosed = true; catalog.venues[0].windows[0].closureUntil = '2026-10-26T12:15:00+08:00'; catalog.venues[0].windows[0].closureReason = '示例检修';
    catalog.menus[0].price = null; catalog.menus[0].pricePending = true; catalog.menus[0].unit = '份'; catalog.menus[0].adminNote = 'secret-menu-note';
  });
  let dining = (await call('/dining')).body, menu = dining.menus.find(row => row.id === 'demo-menu-rice');
  assert.equal(menu.price, null); assert.equal(menu.pricePending, true); assert.equal(menu.unit, '份'); assert.equal(menu.acceptingOrders, false); assert.equal(menu.closureReason, '示例检修'); assert.equal(dining.venues[0].menuImageUrl, 'https://menu.example.invalid/original.jpg');
  assert.equal(JSON.stringify(dining).includes('secret-'), false); assert.equal(JSON.stringify((await call('/catalog')).body).includes('secret-'), false); assert.equal(JSON.stringify((await call('/admin/catalog', { user: 'admin' })).body).includes('secret-menu-note'), true);
  assert.equal((await call('/dining?maxPrice=20')).body.menus.some(row => row.id === menu.id), false);
  setTime('2026-10-26T12:16:00+08:00'); menu = (await call('/dining')).body.menus.find(row => row.id === menu.id); assert.equal(menu.temporarilyClosed, false); assert.equal(menu.acceptingOrders, true);
  await repository.mutate(CATALOG_KEY, catalog => { catalog.venues[0].orderStopped = true; });
  assert.equal((await call('/dining')).body.menus.find(row => row.id === menu.id).acceptingOrders, false);
});

test('元数据：英语/楼群/入驻单位/教师、十类活动、全天独占结束与ICS日期值保持语义', () => {
  const catalog = demoCatalog(); assert.equal(EVENT_CATEGORIES.length, 10); assert.ok(searchPlaces(catalog, 'Teaching Center').some(place => place.id === 'demo-teaching'));
  catalog.events[0] = { ...catalog.events[0], englishTitle: 'Sample workshop', speaker: '合成教师', room: '101', locationText: '教学中心101', allDay: true, start: '2026-10-26T00:00:00+08:00', end: '2026-10-27T00:00:00+08:00', category: 'workshop', sortOrder: 3 };
  const checked = validateCatalog(catalog); assert.equal(eventsInRange(checked, { query: 'Sample workshop', now: '2026-10-26T12:00:00+08:00' }).length, 1);
  const personal = validatePersonal({ ...emptyPersonal(), registrations: [checked.events[0].id], courses: [{ id: 'class', title: '合成课程', teacher: '合成教师', placeId: '', weekday: 1, startTime: '10:00', endTime: '11:00', startDate: '2026-10-26', endDate: '2026-11-02' }] }, checked), day = dailyItems(checked, personal, '2026-10-26');
  assert.equal(day.find(item => item.kind === 'course').teacher, '合成教师');
  assert.match(calendarExport(day), /DTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261027/);
  checked.events[0].start = '2026-10-26T01:00:00+08:00'; assert.throws(() => validateCatalog(checked), /全天活动/);
  assert.equal(publicCampusCatalog(demoCatalog()).places[1].groupId, 'demo-academic');
  assert.equal(menuMatches({ ...demoCatalog().menus[0], price: null, pricePending: true }, { maxPrice: 20 }), false);
});

test('街景位置：道路里程和成对坐标校验，来源文件名可追溯', () => {
  const catalog = demoCatalog(); catalog.streetViews = [{ id: 'view', edgeId: catalog.edges[0].id, offsetMeters: 15, lat: 31.17, lng: 121.59, sourceFilename: '0001.jpg', imageUrl: 'https://view.example.invalid/1.jpg' }];
  assert.equal(validateCatalog(catalog).streetViews[0].sourceFilename, '0001.jpg');
  catalog.streetViews[0].offsetMeters = catalog.edges[0].distanceMeters + 1; assert.throws(() => validateCatalog(catalog), /位置无效/);
  catalog.streetViews[0].offsetMeters = 1; delete catalog.streetViews[0].lng; assert.throws(() => validateCatalog(catalog), /经度/);
});
