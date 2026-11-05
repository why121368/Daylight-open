import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { shanghaitechCatalog } from './campus-guide/shanghaitech.js';
import { withWeeklyMenu, weeklyMenu, nextWeeklyMenu } from './campus-guide/weekly-menu.js';
import { createGuideRepository, CATALOG_KEY } from './campus-guide/repository.js';
import { projectSchoolCalendar, isSchoolMailbox } from './campus-guide/mail-calendar.js';
import { campusAssistant } from './campus-guide/assistant.js';
import { planGroundNavigation } from './campus-guide/navigation.js';
import { emptyPersonal, dailyItems, distanceBetween, menuMatches } from '../shared/campus-guide.js';
import { walkingNavigationUrl, usableGps } from '../shared/campus-navigation.js';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../shared/campus-coordinates.js';

const catalog = withWeeklyMenu(shanghaitechCatalog()), now = new Date('2026-11-02T10:00:00+08:00');
const personal = emptyPersonal();
const library = catalog.places.find(p => p.name === '图书馆'), shangke = catalog.venues.find(v => v.name === '尚科食堂一楼');
const ask = (message, extra = {}) => campusAssistant({ catalog, personal, now, message, ...extra });

test('真实周菜单：三食堂六档口、两周1564条、原图均存在；价格日期餐次保留', async () => {
  assert.equal(catalog.venues.length, 3); assert.equal(catalog.venues.flatMap(v => v.windows).length, 6); assert.equal(catalog.menus.length, 1564);
  assert.equal(catalog.menus.find(m => m.name === '馒头').price, 0.6);
  assert.ok(catalog.menus.some(m => m.name === '白粥' && m.price === 0.5 && m.meal === 'breakfast'));
  assert.ok(catalog.menus.some(m => m.name === '拉面（大）' && m.price === 10));
  for (const menu of [weeklyMenu, nextWeeklyMenu]) {
    const rows = catalog.menus.filter(m => m.validFrom === menu.week);
    assert.equal(rows.length, 782);
    assert.ok(rows.every(m => m.validUntil === menu.until && !m.isDemo));
  }
  for (const source of weeklyMenu.sources) { const bytes = await fs.readFile(`public${source.image}`); assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); }
});
test('周菜单迁入：首次持久补充、重复不写、管理员修订和删除保留，示例目录不混入', async () => {
  const directory = await fs.mkdtemp('work/campus-menu-test-');
  const repo = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false, initialize: () => shanghaitechCatalog(), supplement: withWeeklyMenu });
  const first = await repo.readCatalog(); assert.equal(first.meta.revision, 1); assert.equal(first.menus.length, 1564);
  assert.equal((await repo.readCatalog()).meta.revision, 1);
  await repo.mutate(CATALOG_KEY, data => { data.menus.shift(); data.menus[0].price = 123; });
  const latest = await repo.readCatalog(); assert.equal(latest.menus.length, 1563); assert.equal(latest.menus[0].price, 123); assert.equal(latest.meta.revision, 2);
  const demo = { ...shanghaitechCatalog(), meta: { ...catalog.meta, isDemo: true } }; assert.equal(withWeeklyMenu(demo), demo);
});
test('校园邮箱投影：仅上科大域名，排除手动/示例/取消/婉拒；跨邮箱同ID隔离', () => {
  const boxes = [{ id: 'a', email: 'a@shanghaitech.edu.cn' }, { id: 'b', email: 'b@mail.shanghaitech.edu.cn' }, { id: 'q', email: 'x@qq.com' }, { id: 'fake', email: 'x@shanghaitech.edu.cn.evil.invalid' }];
  assert.equal(isSchoolMailbox(boxes[3]), false); assert.equal(isSchoolMailbox({ ...boxes[0], pendingSetup: true }), false);
  const event = { id: 'same-id', title: '本人合成活动', source: 'email', start: '2026-11-02T12:00:00+08:00', end: '2026-11-02T13:00:00+08:00', location: library.name };
  const calls = [];
  const projected = projectSchoolCalendar({ mailboxes: boxes }, id => { calls.push(id); return { events: [event, { ...event, source: 'manual' }, { ...event, source: 'demo' }, { ...event, status: 'cancelled' }, { ...event, responseStatus: 'declined' }] }; }, catalog);
  assert.deepEqual(calls, ['a', 'b']); assert.equal(projected.items.length, 2); assert.notEqual(projected.items[0].id, projected.items[1].id); assert.equal(projected.items[0].private, true);
  assert.equal(projectSchoolCalendar({ mailboxes: [boxes[0]] }, () => ({ events: [{ ...event, status: 'cancelled' }] }), catalog).items.length, 0);
});
test('邮箱全天跨日：日程独占结束，未知地点保留原文', () => {
  const event = { id: 'all', title: '合成多日活动', source: 'email', allDay: true, start: '2026-11-02T00:00:00+08:00', end: '2026-11-04T00:00:00+08:00', location: '未收录的新教室' };
  const projection = projectSchoolCalendar({ mailboxes: [{ id: 'a', email: 'a@shanghaitech.edu.cn' }] }, () => ({ events: [event] }), catalog);
  const profile = { ...personal, schedule: projection.items };
  assert.equal(dailyItems(catalog, profile, '2026-11-03')[0].location, event.location); assert.equal(dailyItems(catalog, profile, '2026-11-04').length, 0);
});
test('步行导航：腾讯walk URI进行WGS84→GCJ02，不包含凭据；未定位允许终点接力', async () => {
  const url = new URL(walkingNavigationUrl(catalog, library.id)); assert.equal(url.hostname, 'apis.map.qq.com'); assert.equal(url.searchParams.get('type'), 'walk');
  const [lat, lng] = url.searchParams.get('tocoord').split(',').map(Number); assert.ok(distanceBetween(library, { lat, lng }) > 100);
  assert.ok(distanceBetween(library, gcj02ToWgs84(wgs84ToGcj02(library))) < 0.01);
  const route = await planGroundNavigation(catalog, { to: library.id }, { key: '' }); assert.equal(route.externalOnly, true); assert.deepEqual(route.points, []);
  assert.throws(() => walkingNavigationUrl(catalog, '<script>'));
});
test('定位质量：过期/低精度拒绝导航；高德折线转回WGS84，不用直线伪造路线', async () => {
  assert.equal(usableGps({ ...library, accuracy: 500, timestamp: now.getTime() }, now.getTime()), false);
  assert.equal(usableGps({ ...library, accuracy: 10, timestamp: now.getTime() - 60001 }, now.getTime()), false);
  await assert.rejects(planGroundNavigation(catalog, { from: { ...library, source: 'gps', accuracy: 500, timestamp: now.getTime() }, to: shangke.placeId }, { now: now.getTime() }), /精度/);
  let called;
  const route = await planGroundNavigation(catalog, { from: library.id, to: shangke.placeId }, { key: 'synthetic-key', fetcher: async url => { called = new URL(url); return { ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '300', duration: '240', steps: [{ instruction: '沿道路前行', distance: '300', polyline: '121.597,31.177;121.598,31.178' }] }] } }) }; } });
  assert.equal(called.hostname, 'restapi.amap.com'); assert.equal(route.mode, 'ground'); assert.equal(route.distanceMeters, 300); assert.equal(route.points.length, 2); assert.ok(route.points[0].lng < 121.597);
});
test('小D控糖：只取当日午餐，不推荐含明确甜味菜名，搭配总价不超预算', async () => {
  const response = await ask('我最近在控糖，今天中午15元以内可以吃点什么呀');
  assert.equal(response.intent, 'food'); assert.ok(response.cards.length > 0); assert.match(response.reply, /营养成分/);
  for (const card of response.cards) { assert.ok(card.price <= 15); for (const selected of card.menus) { const menu = catalog.menus.find(m => m.id === selected.id); assert.ok(['all', 'lunch'].includes(menu.meal)); assert.ok(menu.availableDays.includes(1)); assert.doesNotMatch(menu.name, /糖醋|红糖|蜜|豆沙|蛋挞|红枣/); } }
  const next = await ask('2026-11-09中午控糖吃什么');
  assert.ok(next.cards.length > 0);
  assert.ok(next.cards.flatMap(card => card.menus).every(menu => menu.id.startsWith('menu-20261109-')));
  assert.equal((await ask('2026-11-16中午控糖吃什么')).cards.length, 0);
});
test('小D安全与缺数据：过敏和严格素食不臆测配料，售罄不推荐', async () => {
  assert.equal((await ask('花生过敏今天吃什么')).cards.length, 0); assert.equal((await ask('今天吃素食')).cards.length, 0);
  const closed = { ...catalog, menus: catalog.menus.map(m => ({ ...m, soldOut: true })) }; assert.equal((await ask('今天中午吃什么', { catalog: closed })).cards.length, 0);
});
test('小D活动与私人日程：查询北京日期、仅本人输入参与、同一天跨日去重', async () => {
  const school = [{ id: 'private-a', title: '合成私人讲座', source: 'school-mail', private: true, start: '2026-11-02T15:00:00+08:00', end: '2026-11-02T16:00:00+08:00' }];
  const response = await ask('今天有哪些活动', { schoolItems: school }); assert.equal(response.cards.length, 1); assert.equal(response.cards[0].private, true);
  assert.equal((await ask('今天有哪些活动')).cards.length, 0);
  assert.equal((await ask('今天有什么安排', { schoolItems: school })).cards[0].id, 'private-a');
});
test('小D路径：歧义让用户选择、明确终点调用地面导航；模型仅解析意图', async () => {
  const ambiguous = await ask('去图书馆怎么走'); assert.ok(ambiguous.cards.every(c => c.type === 'place')); assert.ok(ambiguous.cards.length > 1);
  let call;
  const response = await ask('带我去尚科餐厅1楼', { model: async () => ({ intent: 'route', to: '尚科餐厅1楼', from: '', date: '2026-11-02' }), navigation: async (c, args) => { call = args; return { ...args, fromName: '我的位置', toName: '尚科餐厅1楼', externalOnly: true, notice: '使用真实步行导航' }; } });
  assert.equal(call.mode, 'ground'); assert.equal(response.mode, 'model'); assert.equal(response.cards[0].type, 'route');
  await assert.rejects(ask('测试', { model: async () => ({ intent: 'send_email' }) }), /未能识别/);
});


test('下周菜单：旧目录增量保留编辑，日期边界隔离，早餐不包含餐次未知记录', async () => {
  const old = structuredClone(catalog);
  old.meta.supplements = old.meta.supplements.filter(v => v !== 'menu-2026-11-09');
  old.menus = old.menus.filter(m => m.validFrom === '2026-11-02');
  old.menus[0].price = 123;
  old.menus.splice(1, 1);
  const updated = withWeeklyMenu(old);
  assert.equal(updated.menus.length, 1563);
  assert.equal(updated.menus[0].price, 123);
  assert.equal(withWeeklyMenu(updated), updated);
  assert.equal(new Set(updated.menus.map(m => m.id)).size, updated.menus.length);
  for (const day of ['2026-11-08', '2026-11-09', '2026-11-15', '2026-11-16']) {
    const active = updated.menus.filter(m => menuMatches(m, { at: new Date(`${day}T12:00:00+08:00`) }));
    if (day === '2026-11-16') assert.equal(active.length, 0);
    else {
      assert.ok(active.length > 0);
      assert.ok(active.every(m => m.validFrom === (day === '2026-11-08' ? '2026-11-02' : '2026-11-09')));
    }
  }
  assert.ok(updated.menus.filter(m => m.validFrom === '2026-11-09').every(m => /确认.*沿用/.test(m.description)));
  const breakfast = await ask('2026-11-09早餐吃什么');
  assert.ok(breakfast.cards.length > 0);
  assert.ok(breakfast.cards.flatMap(card => card.menus).every(selected => updated.menus.find(m => m.id === selected.id).meal === 'breakfast'));
});
