import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demoCatalog } from './campus-guide/seed.js';
import { createGuideRepository, CATALOG_KEY, ACTIVITY_KEY, personalKey } from './campus-guide/repository.js';
import { validateCatalog, withoutDemo, searchPlaces, findRoute, isOpenNow, eventsInRange, emptyPersonal, validatePersonal, dailyItems, planDay, queueSummaries, calendarExport } from '../shared/campus-guide.js';

test('校园目录：仅提供自制示意资料，搜索教室别名，清除示例保留真实自有资料', () => {
  const catalog = demoCatalog(); assert.equal(catalog.meta.isDemo, true); assert.match(catalog.meta.notice, /示意/); assert.equal(searchPlaces(catalog, '教学中心201')[0].id, 'demo-teaching');
  catalog.places.push({ ...catalog.places[0], id: 'custom-gate', name: '经核验入口', isDemo: false, nodeId: '' });
  const clean = withoutDemo(catalog); assert.equal(clean.meta.isDemo, false); assert.deepEqual(clean.places.map(p => p.id), ['custom-gate']); assert.equal(clean.events.length, 0); assert.equal(clean.menus.length, 0); assert.equal(clean.nodes.length, 0); assert.equal(clean.indoorPlans.length, 0);
});
test('校园目录：图关系、图片链接、价格、时区与非法日期不允许导入', () => {
  const invalid = change => { const c = demoCatalog(); change(c); assert.throws(() => validateCatalog(c)); };
  invalid(c => c.edges[0].to = 'missing'); invalid(c => c.places[0].nodeId = 'missing'); invalid(c => c.events[0].start = '2026-02-30T18:30:00+08:00'); invalid(c => c.events[0].start = '2026-10-26T18:30:00'); invalid(c => c.events[0].registrationUrl = 'javascript:alert(1)'); invalid(c => c.menus[0].price = -1); invalid(c => c.indoorPlans[0].rooms[0].x = 990); invalid(c => c.meta.satelliteTileUrl = 'https://tiles.example.invalid/{z}/{x}/{y}.png');
  const source = demoCatalog(); source.meta.secret = 'never-publish'; source.places[0].privateEmail = 'not-public@example.invalid'; assert.equal('secret' in validateCatalog(source).meta, false); assert.equal('privateEmail' in validateCatalog(source).places[0], false);
});
test('校园路线：最短路、避雨、地下模式与无障碍依据道路属性', () => {
  const catalog = demoCatalog(), route = input => findRoute(catalog, { from: 'demo-teaching', to: 'demo-library', ...input });
  assert.equal(route({}).distanceMeters, 150); assert.equal(route({ avoidRain: true }).distanceMeters, 230); assert.equal(route({ mode: 'underground' }).distanceMeters, 230); assert.equal(route({ avoidRain: true, accessible: true }).distanceMeters, 370); assert.equal(route({ mode: 'ground' }).steps.every(s => s.level === 'ground'), true);
  assert.throws(() => route({ mode: 'underground', accessible: true }), error => error.code === 'CAMPUS_GUIDE_ROUTE_UNREACHABLE');
  assert.deepEqual(findRoute(catalog, { from: 'demo-gate', to: 'demo-gate' }).steps, []); assert.throws(() => route({ from: 'missing' }), /起点/);
});
test('校园路线：不把无路网的地点伪装成直线可通行', () => {
  const catalog = demoCatalog(); catalog.places[0].nodeId = ''; assert.throws(() => findRoute(catalog, { from: 'demo-gate', to: 'demo-library' }), e => e.status === 422);
  catalog.places[0].nodeId = 'node-demo-gate'; catalog.edges = []; assert.throws(() => findRoute(catalog, { from: 'demo-gate', to: 'demo-library' }), e => e.code === 'CAMPUS_GUIDE_ROUTE_UNREACHABLE');
});
test('校园时间：北京时间、跨午夜开放时间、活动结束与取消状态筛选', () => {
  const overnight = [{ days: [1], start: '22:00', end: '02:00' }]; assert.equal(isOpenNow(overnight, '2026-10-26T23:00:00+08:00'), true); assert.equal(isOpenNow(overnight, '2026-10-27T01:00:00+08:00'), true); assert.equal(isOpenNow(overnight, '2026-10-27T23:00:00+08:00'), false); assert.equal(isOpenNow([], new Date()), null);
  const catalog = demoCatalog(); assert.equal(eventsInRange(catalog, { now: '2026-10-26T19:00:00+08:00' }).length, 3); catalog.events[1].status = 'cancelled'; assert.equal(eventsInRange(catalog, { category: 'sports', now: '2026-10-23T00:00:00+08:00' }).length, 0);
});
test('校园个人安排：课表周次、活动意向、冲突与路程时间不足可复现', () => {
  const catalog = demoCatalog(), personal = validatePersonal({ ...emptyPersonal(), homePlaceId: 'demo-dorm', registrations: ['demo-event-academic'], courses: [{ id: 'c1', title: '示例课程', placeId: 'demo-research', weekday: 1, startTime: '18:00', endTime: '18:29', startDate: '2026-10-19', endDate: '2026-11-20', weeks: [2] }], schedule: [{ id: 'p1', title: '安排', placeId: 'demo-library', start: '2026-10-26T18:10:00+08:00', end: '2026-10-26T18:29:00+08:00', kind: 'personal' }] }, catalog);
  assert.equal(dailyItems(catalog, personal, '2026-10-19').length, 0); assert.equal(dailyItems(catalog, personal, '2026-10-26').length, 3);
  const day = planDay(catalog, personal, '2026-10-26', { returnHome: true }); assert.ok(day.conflicts.some(c => c.kind === 'overlap')); assert.ok(day.conflicts.some(c => c.kind === 'travel')); assert.equal(day.legs.at(-1).returningHome, true);
  assert.throws(() => validatePersonal({ ...personal, schedule: [{ ...personal.schedule[0], end: '2026-10-26T18:00:00+08:00' }] }, catalog));
});
test('校园个人安排：不能伪造签到，历史已删除地点不清空已有用户数据', () => {
  const catalog = demoCatalog(), previous = { ...emptyPersonal(), favorites: ['removed-place'], checkins: [{ eventId: 'historic', checkedAt: '2026-10-20T01:00:00Z', method: 'organizer_code' }] };
  const next = validatePersonal({ ...previous, checkins: [{ eventId: 'fake' }] }, catalog, previous); assert.deepEqual(next.checkins, previous.checkins); assert.deepEqual(next.favorites, ['removed-place']); assert.throws(() => validatePersonal({ ...emptyPersonal(), favorites: ['missing'] }, catalog));
});
test('校园排队：只汇总有效反馈，不泄露用户，过期30分钟自动消失', () => {
  const now = '2026-10-23T12:00:00+08:00', reports = [{ venueId: 'v', userId: 'secret-user', level: 'short', reportedAt: '2026-10-23T11:50:00+08:00', expiresAt: '2026-10-23T12:20:00+08:00' }, { venueId: 'v', level: 'long', reportedAt: '2026-10-23T11:55:00+08:00', expiresAt: '2026-10-23T12:25:00+08:00' }, { venueId: 'v', level: 'empty', reportedAt: '2026-10-23T11:00:00+08:00', expiresAt: '2026-10-23T11:30:00+08:00' }];
  const result = queueSummaries(reports, now); assert.equal(result[0].reportCount, 2); assert.equal(result[0].level, 'long'); assert.equal(JSON.stringify(result).includes('secret-user'), false); assert.equal(queueSummaries(reports, '2026-10-23T12:30:00+08:00').length, 0);
});
test('校园 ICS：文本无法注入日历字段，中文按UTF8行折叠且使用UTC', () => {
  const ics = calendarExport([{ id: 'a', title: '标题\nBEGIN:VEVENT,;', location: '中文地点'.repeat(25), start: '2026-10-26T18:30:00+08:00', end: '2026-10-26T20:00:00+08:00' }], '2026-10-23T12:00:00+08:00');
  assert.equal(ics.match(/^BEGIN:VEVENT$/gm).length, 1); assert.match(ics, /DTSTART:20261026T103000Z/); assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75)); assert.match(ics, /标题\\nBEGIN:VEVENT\\,\\;/);
});
test('校园文件存储：并发更新CAS、重启恢复，独立用户不覆盖既有数据', async () => {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-guide-repo-')); const repo = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  await fs.writeFile(path.join(directory, 'calendar.json'), 'preserve-existing');
  const expected = await repo.read(CATALOG_KEY), results = await Promise.allSettled([1, 2].map(n => repo.mutate(CATALOG_KEY, c => { c.meta.description = `change ${n}`; }, { expectedRevision: expected.version })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  await repo.mutate(personalKey('alice'), p => { p.favorites.push('demo-gate'); });
  assert.equal((await repo.readPersonal('bob')).favorites.length, 0); assert.deepEqual((await createGuideRepository({ dataDir: directory, pgRequired: false, pool: null }).readPersonal('alice')).favorites, ['demo-gate']); assert.equal(await fs.readFile(path.join(directory, 'calendar.json'), 'utf8'), 'preserve-existing');
});

/** Minimal transactional PG fixture exercises parameterized CAS and rollback, not a real PG service. */
class TransactionPool {
  documents = new Map(); tail = Promise.resolve(); failWrite = false;
  async query(sql, values) { if (!sql.startsWith('SELECT payload')) throw Error(`Unexpected pool SQL ${sql}`); const row = this.documents.get(values[0]); return { rows: row ? [structuredClone(row)] : [] }; }
  async connect() {
    const pool = this; let working, release;
    return { async query(sql, values = []) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.startsWith('SELECT pg_advisory')) { if (!release) { const previous = pool.tail; pool.tail = new Promise(resolve => { release = resolve; }); await previous; working = structuredClone(pool.documents); } return { rows: [] }; }
      if (sql.startsWith('SELECT payload')) { const row = working.get(values[0]); return { rows: row ? [structuredClone(row)] : [] }; }
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) { if (pool.failWrite) throw Error('Synthetic PG failure'); const old = working.get(values[0]), expected = sql.startsWith('UPDATE') ? Number(values[2]) : 0; if ((old?.version || 0) !== expected) return { rows: [] }; const row = { payload: JSON.parse(values[1]), version: expected + 1 }; working.set(values[0], row); return { rows: [{ version: row.version }] }; }
      if (sql === 'COMMIT') { pool.documents = working; release?.(); release = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') { release?.(); release = null; return { rows: [] }; }
      throw Error(`Unexpected SQL ${sql}`);
    }, release() { release?.(); } };
  }
}
test('校园PG协议：并发CAS仅一方成功，多文档失败回滚，无文件静默回退', async () => {
  const pool = new TransactionPool(), repo = createGuideRepository({ pool, pgRequired: true });
  const first = await repo.mutate(CATALOG_KEY, c => { c.meta.title = '共享校园'; }); assert.equal(first.version, 1);
  const results = await Promise.allSettled([1, 2].map(n => repo.mutate(CATALOG_KEY, c => { c.meta.description = `${n}`; }, { expectedRevision: 1 }))); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  const before = structuredClone(pool.documents); pool.failWrite = true;
  await assert.rejects(repo.mutateMany([ACTIVITY_KEY, personalKey('alice')], drafts => { drafts.get(ACTIVITY_KEY).feedback.push({ id: 'f' }); drafts.get(personalKey('alice')).favorites.push('p'); }), e => e.status === 503); assert.deepEqual(pool.documents, before);
  await assert.rejects(createGuideRepository({ pool: null, pgRequired: true }).read(CATALOG_KEY), e => e.code === 'CAMPUS_GUIDE_STORAGE_UNAVAILABLE');
});
