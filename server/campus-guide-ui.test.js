import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCampusEvents, shanghaiInput, suggestCampusEvents, activeMenu, routeEndpointParam, parseRouteEndpoint, semesterMonday, parseFoodQuery, matchesFoodQuery, suggestCampusMeals, allDayRange } from '../shared/campus-guide-ui.js';
import { demoCatalog } from './campus-guide/seed.js';
import { emptyPersonal } from '../shared/campus-guide.js';

test('校园页面日期：UTC安排编辑保留北京时间；路线分享剔除实时GPS', () => {
  assert.equal(shanghaiInput('2026-10-23T04:45:00.000Z'), '2026-10-23T12:45');
  assert.equal(shanghaiInput('2026-10-23T20:00:00.000Z'), '2026-10-24T04:00');
  assert.equal(routeEndpointParam({ lat: 31, lng: 121, source: 'gps' }), '');
  assert.deepEqual(parseRouteEndpoint(routeEndpointParam({ lat: 31.5, lng: 121.2 })), { lat: 31.5, lng: 121.2, name: '分享的地图位置' });
  assert.equal(parseRouteEndpoint('@91,0'), ''); assert.equal(parseRouteEndpoint('https://invalid'), '');
});

test('校园活动筛选：北京时间跨午夜、隐藏、取消、置顶和来源保持一致', () => {
  const base = { title: '讲座', summary: '', organizer: '', category: 'academic', status: 'published', sourceKind: 'rss', placeId: 'p' };
  const rows = [
    { ...base, id: 'cross', start: '2026-10-22T23:30:00+08:00', end: '2026-10-23T01:00:00+08:00' },
    { ...base, id: 'end-midnight', start: '2026-10-22T20:00:00+08:00', end: '2026-10-23T00:00:00+08:00' },
    { ...base, id: 'hidden', hidden: true, start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T10:00:00+08:00' },
    { ...base, id: 'cancelled', status: 'cancelled', start: '2026-10-23T09:00:00+08:00', end: '2026-10-23T10:00:00+08:00' },
    { ...base, id: 'pinned', pinned: true, start: '2026-10-23T19:00:00+08:00', end: '2026-10-23T20:00:00+08:00' },
  ];
  const at = Date.parse('2026-10-23T00:30:00+08:00');
  assert.deepEqual(filterCampusEvents(rows, { range: 'today' }, at).map(row => row.id), ['pinned', 'cross']);
  assert.deepEqual(filterCampusEvents(rows, { range: 'now' }, at).map(row => row.id), ['cross']);
  assert.equal(filterCampusEvents(rows, { range: 'today', sourceKind: 'email' }, at).length, 0);
});

test('校园活动建议：不能只看空闲，前后步行无法衔接和未映射地点均排除', () => {
  const catalog = demoCatalog(), profile = emptyPersonal(), date = '2026-10-26'; profile.homePlaceId = 'demo-dorm';
  catalog.events = [{ id: 'event', title: '校园活动', category: 'academic', placeId: 'demo-library', start: `${date}T10:00:00+08:00`, end: `${date}T11:00:00+08:00`, status: 'published' }];
  const options = { now: Date.parse(`${date}T08:00:00+08:00`) };
  assert.equal(suggestCampusEvents(catalog, profile, date, options).length, 1);
  profile.schedule = [{ id: 'before', title: '前项', start: `${date}T09:00:00+08:00`, end: `${date}T09:59:00+08:00`, placeId: 'demo-gate', kind: 'personal' }];
  assert.equal(suggestCampusEvents(catalog, profile, date, options).length, 0);
  profile.schedule = [{ id: 'next', title: '后项', start: `${date}T11:01:00+08:00`, end: `${date}T12:00:00+08:00`, placeId: 'demo-gate', kind: 'personal' }];
  assert.equal(suggestCampusEvents(catalog, profile, date, options).length, 0);
  profile.schedule[0].start = `${date}T12:00:00+08:00`; profile.schedule[0].end = `${date}T13:00:00+08:00`; profile.schedule[0].placeId = '';
  assert.equal(suggestCampusEvents(catalog, profile, date, options).length, 0);
});

test('菜单当前供应过滤：生效期、星期、餐次和售罄分别生效', () => {
  const menu = { availableDays: [5], meal: 'lunch', validFrom: '2026-10-23', validUntil: '2026-10-23', soldOut: false };
  const at = Date.parse('2026-10-23T12:00:00+08:00');
  assert.equal(activeMenu(menu, {}, at), true);
  assert.equal(activeMenu({ ...menu, soldOut: true }, {}, at), false);
  assert.equal(activeMenu(menu, {}, Date.parse('2026-10-24T12:00:00+08:00')), false);
  assert.equal(activeMenu(menu, {}, Date.parse('2026-10-23T18:00:00+08:00')), false);
  assert.equal(activeMenu({ ...menu, orderStopped: true }, {}, at), false);
  assert.equal(activeMenu(menu, { temporarilyClosed: true }, at), false);
});

test('课表默认周一按北京时间锚定，新课程不从周五误计第一周', () => {
  assert.equal(semesterMonday('2026-10-23T23:00:00+08:00'), '2026-10-19');
  assert.equal(semesterMonday('2026-10-25T16:00:00Z'), '2026-10-26');
});

test('食物规则解析预算区间和常见同义词；未知价不冒充零元进入预算结果', () => {
  const menu = { name: '番茄鸡蛋面', tags: ['面食'], price: 12 }, venue = { name: '一楼食堂', windows: [] };
  assert.equal(matchesFoodQuery(menu, venue, '想吃15元以内的西红柿'), true);
  assert.equal(matchesFoodQuery(menu, venue, '10到15元的面'), true);
  assert.equal(matchesFoodQuery(menu, venue, '至少15元的面'), false);
  assert.equal(matchesFoodQuery({ ...menu, price: null }, venue, '15元以内'), false);
  assert.equal(matchesFoodQuery({ ...menu, pricePending: true }, venue, '15元以内'), false);
  assert.equal(matchesFoodQuery({ ...menu, price: null }, venue, '面'), true);
  assert.equal(matchesFoodQuery(menu, venue, '一楼 面'), true);
  assert.deepEqual(parseFoodQuery('不超过10块的土豆'), { minPrice: 0, maxPrice: 10, tokens: ['土豆'] });
});

test('用餐建议跳过过去时段，未来排队明确为估算，无法衔接下一项则排除', () => {
  const catalog = demoCatalog(), profile = emptyPersonal(), date = '2026-10-26';
  profile.homePlaceId = 'demo-dorm';
  const options = { now: Date.parse(`${date}T12:05:00+08:00`), queues: { venues: catalog.venues.map(venue => ({ venueId: venue.id, source: 'feedback', waitMinutes: 25 })) } };
  const meals = suggestCampusMeals(catalog, profile, date, options);
  assert.ok(meals.length > 0);
  assert.ok(meals.every(item => Date.parse(item.start) > options.now));
  assert.equal(meals.find(item => item.meal === '晚餐')?.queueSource, 'guess');
  assert.equal(suggestCampusMeals(catalog, profile, '', options).length, 0);
  const blocked = suggestCampusMeals(catalog, profile, date, { ...options, items: [{ id: 'class', start: `${date}T11:00:00+08:00`, end: `${date}T20:00:00+08:00`, placeId: 'demo-teaching' }] });
  assert.equal(blocked.length, 0);
  const stoppedCatalog = structuredClone(catalog); stoppedCatalog.venues.forEach(venue => { venue.orderStopped = true; });
  assert.equal(suggestCampusMeals(stoppedCatalog, profile, date, options).length, 0);
});

test('全天日期展示按北京时间包含最后一天，次日零点结束不多显示一天', () => {
  assert.equal(allDayRange({ start: '2026-10-25T16:00:00Z', end: '2026-10-26T16:00:00Z' }), '2026-10-26 · 全天');
  assert.equal(allDayRange({ start: '2026-10-26T00:00:00+08:00', end: '2026-10-29T00:00:00+08:00' }), '2026-10-26 至 2026-10-28 · 全天');
});
