import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { demoCatalog } from './campus-guide/seed.js';
import { createGuideRepository, ACTIVITY_KEY } from './campus-guide/repository.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { parseCampusFeed } from './campus-guide/sources.js';
import { campusQueueHistoryStats, QUEUE_HISTORY_LIMIT } from './campus-guide/queue-history.js';
import { validateCatalog, publicCampusCatalog } from '../shared/campus-guide.js';

// Synthetic data and injected source/operations dependencies only. No real user
// data, IMAP, model, school site or cloud dependency is read by these tests.
const initialTime = '2026-10-26T12:00:00+08:00';
const source = { id: 'synthetic-source', format: 'json', url: 'https://campus.example.com/events' };
const english = { englishSummary: 'An independently reviewed English summary.', englishDescription: 'English event details.\nA second paragraph.' };
const event = () => ({ id: 'synthetic-english-event', title: '合成双语活动', summary: '中文简介', description: '中文详情', placeId: 'demo-teaching', start: '2026-10-26T18:00:00+08:00', end: '2026-10-26T20:00:00+08:00', category: 'academic', ...english });

async function fixture(t) {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/campus-final-details-'));
  const repository = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false });
  let current = new Date(initialTime), sourceText = JSON.stringify([event()]);
  const app = express();
  app.use('/api/campus-guide', createCampusGuideRouter({ repository, now: () => new Date(current),
    resolveUser: async header => header === 'Bearer admin' ? { id: 'synthetic-admin', role: 'admin' } : header === 'Bearer user' ? { id: 'synthetic-user', role: 'user' } : null,
    adminUser: user => user.role === 'admin',
    fetchSource: async () => ({ text: sourceText, finalUrl: source.url }),
    readOperations: async () => ({ scope: 'synthetic-test', generatedAt: current.toISOString() }),
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { repository, setTime: value => { current = new Date(value); }, setSource: value => { sourceText = value; }, async call(route, { user, cookie, body, method = body ? 'POST' : 'GET' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '', cacheControl: response.headers.get('cache-control') };
  } };
}

test('活动英文schema：旧资料兼容、独立正文、精确长度和非文字拒绝，公开过滤不泄漏隐藏活动', () => {
  const catalog = demoCatalog();
  assert.equal(validateCatalog(catalog).events[0].englishSummary, '');
  assert.equal(validateCatalog(catalog).events[0].englishDescription, '');
  catalog.events[0] = { ...catalog.events[0], ...english };
  const checked = validateCatalog(catalog);
  assert.equal(checked.events[0].englishSummary, english.englishSummary);
  assert.equal(checked.events[0].englishDescription, english.englishDescription);
  for (const [key, max] of [['englishSummary', 1000], ['englishDescription', 15000]]) {
    catalog.events[0][key] = 'a'.repeat(max);
    assert.equal(validateCatalog(catalog).events[0][key].length, max);
    for (const invalid of ['a'.repeat(max + 1), 42, {}, []]) {
      catalog.events[0][key] = invalid;
      assert.throws(() => validateCatalog(catalog), error => error.status === 400 && /活动英文/.test(error.message));
    }
    catalog.events[0][key] = english[key];
  }
  assert.equal(publicCampusCatalog(catalog).events[0].englishDescription, english.englishDescription);
  catalog.events[0].hidden = true;
  assert.equal(publicCampusCatalog(catalog).events.some(row => row.id === catalog.events[0].id), false);
});

test('活动英文来源：JSON/单页JSON-LD保留明确英文语言字段，不自动翻译，超长和非文字拒绝', () => {
  assert.equal(parseCampusFeed(JSON.stringify([event()]), source)[0].event.englishDescription, english.englishDescription);
  const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  const structured = { '@type': 'Event', name: [{ '@value': '中文标题', '@language': 'zh-CN' }, { '@value': 'English title', '@language': 'en' }], description: [{ '@value': '中文详情', '@language': 'zh' }, { '@value': '<p>English detail.</p>', '@language': 'en-GB' }], abstract: { zh: '中文摘要', en: 'English summary.' }, startDate: event().start, endDate: event().end };
  let result = parseCampusFeed(html(structured), { ...source, format: 'html' })[0].event;
  assert.equal(result.title, '中文标题'); assert.equal(result.englishTitle, 'English title');
  assert.equal(result.description, '中文详情'); assert.equal(result.englishDescription, 'English detail.');
  assert.equal(result.summary, '中文摘要'); assert.equal(result.englishSummary, 'English summary.');
  result = parseCampusFeed(html({ '@type': 'Event', name: 'English event', inLanguage: 'en-US', description: 'English only.', abstract: 'English overview.' }), { ...source, format: 'html' })[0].event;
  assert.equal(result.description, ''); assert.equal(result.summary, ''); assert.equal(result.englishDescription, 'English only.'); assert.equal(result.englishSummary, 'English overview.');
  result = parseCampusFeed(html({ '@type': 'Event', name: '中文活动', description: '只有中文' }), { ...source, format: 'html' })[0].event;
  assert.equal(result.englishDescription, ''); assert.equal(result.englishSummary, '');
  for (const [key, max] of [['englishSummary', 1000], ['englishDescription', 15000]]) for (const invalid of ['x'.repeat(max + 1), 42]) {
    assert.throws(() => parseCampusFeed(JSON.stringify([{ ...event(), [key]: invalid }]), source), /活动英文/);
    assert.throws(() => parseCampusFeed(html({ '@type': 'Event', name: 'Invalid English', [key]: invalid }), { ...source, format: 'html' }), /活动英文/);
  }
});

test('活动英文HTTP：目录新增/修改/导出/隐藏及审核稿发布全链路保留，拒绝字段不落盘', async t => {
  const { call } = await fixture(t);
  let catalog = (await call('/admin/catalog', { user: 'admin' })).body;
  let response = await call('/admin/catalog/events', { user: 'admin', body: { revision: catalog.meta.revision, item: event() } });
  assert.equal(response.status, 200); catalog = response.body;
  assert.equal((await call('/catalog')).body.events.find(row => row.id === event().id).englishSummary, english.englishSummary);
  const updated = { ...catalog.events.find(row => row.id === event().id), englishSummary: 'Updated English summary.' };
  response = await call(`/admin/catalog/events/${updated.id}`, { user: 'admin', method: 'PUT', body: { revision: catalog.meta.revision, item: updated } });
  assert.equal(response.status, 200); catalog = response.body;
  assert.equal((await call('/admin/export', { user: 'admin' })).body.events.find(row => row.id === updated.id).englishSummary, updated.englishSummary);
  const invalid = await call(`/admin/catalog/events/${updated.id}`, { user: 'admin', method: 'PUT', body: { revision: catalog.meta.revision, item: { ...updated, englishSummary: 'x'.repeat(1001) } } });
  assert.equal(invalid.status, 400);
  assert.equal((await call('/admin/catalog', { user: 'admin' })).body.meta.revision, catalog.meta.revision);
  response = await call(`/admin/catalog/events/${updated.id}`, { user: 'admin', method: 'PUT', body: { revision: catalog.meta.revision, item: { ...updated, hidden: true } } });
  assert.equal(response.status, 200);
  assert.equal((await call('/catalog')).body.events.some(row => row.id === updated.id), false);
  const created = await call('/admin/sources', { user: 'admin', body: { name: '合成英文来源', url: source.url, format: 'json', enabled: false } });
  assert.equal(created.status, 200);
  assert.equal((await call(`/admin/sources/${created.body.id}/sync`, { user: 'admin', body: {} })).status, 200);
  let draft = (await call('/admin/sources', { user: 'admin' })).body.drafts[0];
  assert.equal(draft.event.englishDescription, english.englishDescription);
  const revised = await call(`/admin/drafts/${draft.id}`, { user: 'admin', method: 'PATCH', body: { revision: draft.revision, event: { ...draft.event, englishSummary: 'Reviewed in English.' } } });
  assert.equal(revised.status, 200); draft = revised.body;
  const catalogRevision = (await call('/admin/catalog', { user: 'admin' })).body.meta.revision;
  const published = await call(`/admin/drafts/${draft.id}/publish`, { user: 'admin', body: { revision: draft.revision, catalogRevision, confirmed: true } });
  assert.equal(published.status, 200); assert.equal(published.body.event.englishSummary, 'Reviewed in English.');
  assert.equal((await call('/catalog')).body.events.find(row => row.id === published.body.event.id).englishDescription, english.englishDescription);
});

test('排队24h：成功更新分别计数，限流失败不计，30min清理后历史保留，管理员聚合无身份', async t => {
  const { call, repository, setTime } = await fixture(t), body = { venueId: 'demo-canteen-1', windowId: 'demo-window-rice', level: 'short' };
  let response = await call('/admin/stats', { user: 'admin' });
  assert.equal(response.body.queue24h.complete, false); assert.equal(response.body.queue24h.trackingStartedAt, '');
  assert.equal((await call('/admin/stats')).status, 401); assert.equal((await call('/admin/stats', { user: 'user' })).status, 403);
  const first = await call('/queue-reports', { body }); assert.equal(first.status, 200);
  assert.equal((await call('/queue-reports', { body, cookie: first.cookie })).status, 429);
  setTime('2026-10-26T12:01:00+08:00');
  assert.equal((await call('/queue-reports', { body: { ...body, level: 'medium' }, cookie: first.cookie })).status, 200);
  let state = (await repository.read(ACTIVITY_KEY)).payload;
  assert.equal(state.queueReports.length, 1); assert.equal(state.queueReportHistory.length, 2);
  assert.deepEqual(Object.keys(state.queueReportHistory[0]).sort(), ['level', 'reportedAt', 'venueId', 'windowId']);
  assert.equal(JSON.stringify(state.queueReportHistory).includes(first.cookie.split('=')[1]), false);
  response = await call('/admin/stats', { user: 'admin' });
  assert.equal(response.cacheControl, 'private, no-store'); assert.equal(response.body.engagement.activeQueueReports, 1);
  assert.equal(response.body.queue24h.acceptedReports, 2); assert.equal(response.body.queue24h.complete, false);
  assert.equal(response.body.queue24h.trackingStartedAt, '2026-10-26T04:00:00.000Z');
  assert.equal(response.body.queue24h.levels.find(row => row.id === 'short').count, 1);
  assert.equal(response.body.queue24h.levels.find(row => row.id === 'medium').count, 1);
  setTime('2026-10-26T12:32:00+08:00');
  assert.equal((await call('/queue-reports', { user: 'user', body: { ...body, level: 'long' } })).status, 200);
  state = (await repository.read(ACTIVITY_KEY)).payload;
  assert.equal(state.queueReports.length, 1); assert.equal(state.queueReportHistory.length, 3);
  const stats = (await call('/admin/stats', { user: 'admin' })).body;
  assert.equal(stats.queue24h.acceptedReports, 3); assert.equal(stats.queue24h.venues[0].count, 3);
  for (const secret of ['actorId', 'userId', 'ipHash', 'synthetic-user', first.cookie.split('=')[1], '127.0.0.1']) assert.equal(JSON.stringify(stats).includes(secret), false, secret);
  const publicOverview = (await call('/queues')).body;
  assert.equal('queue24h' in publicOverview, false); assert.equal(JSON.stringify(publicOverview).includes('queueReportHistory'), false);
});

test('排队24h：精确排除24h边界/未来/坏记录；覆盖状态保守兼容旧数据', () => {
  const now = new Date(initialTime), instant = now.getTime(), catalog = demoCatalog();
  const report = age => ({ venueId: 'demo-canteen-1', windowId: '', level: 'short', reportedAt: new Date(instant - age).toISOString(), actorId: 'must-never-project' });
  const activity = { queueReports: [report(0)] };
  assert.equal(campusQueueHistoryStats(catalog, activity, now).acceptedReports, 0);
  assert.equal(campusQueueHistoryStats(catalog, activity, now).complete, false);
  activity.queueReportHistory = [report(86400000), report(86399999), report(0), report(-1), { ...report(100), level: 'invalid' }, { ...report(100), reportedAt: 'invalid' }];
  activity.queueHistoryStartedAt = new Date(instant - 86400000).toISOString();
  const stats = campusQueueHistoryStats(catalog, activity, now);
  assert.equal(stats.acceptedReports, 2); assert.equal(stats.complete, true);
  assert.equal(stats.coverageStartedAt, stats.windowStartedAt);
  assert.equal(JSON.stringify(stats).includes('must-never-project'), false);
  activity.queueHistoryStartedAt = new Date(instant + 1).toISOString();
  assert.equal(campusQueueHistoryStats(catalog, activity, now).complete, false);
  assert.equal(campusQueueHistoryStats(catalog, activity, now).trackingStartedAt, '');
});

test('排队24h：有界历史满时事务拒绝且不改当前反馈，过期释放后恢复接收', async t => {
  const { call, repository, setTime } = await fixture(t), report = { venueId: 'demo-canteen-1', windowId: '', level: 'short', reportedAt: new Date(initialTime).toISOString() };
  await repository.mutate(ACTIVITY_KEY, state => { state.queueReportHistory = Array.from({ length: QUEUE_HISTORY_LIMIT }, () => ({ ...report })); state.queueHistoryStartedAt = report.reportedAt; });
  const before = await repository.read(ACTIVITY_KEY);
  const body = { venueId: report.venueId, level: 'long' };
  const rejected = await call('/queue-reports', { user: 'user', body });
  assert.equal(rejected.status, 429); assert.match(rejected.body.error, /24小时/);
  const after = await repository.read(ACTIVITY_KEY);
  assert.equal(after.version, before.version); assert.equal(after.payload.queueReports.length, 0); assert.equal(after.payload.queueReportHistory.length, QUEUE_HISTORY_LIMIT);
  setTime('2026-10-27T12:00:00+08:00');
  assert.equal((await call('/queue-reports', { user: 'user', body })).status, 200);
  const recovered = (await repository.read(ACTIVITY_KEY)).payload;
  assert.equal(recovered.queueReports.length, 1); assert.equal(recovered.queueReportHistory.length, 1);
  const stats = (await call('/admin/stats', { user: 'admin' })).body.queue24h;
  assert.equal(stats.complete, true); assert.equal(stats.acceptedReports, 1);
});
