import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

// These tests use an isolated local data directory and injected models. No remote model,
// mailbox, calendar provider, credentials or user data are read.
fsSync.mkdirSync('work', { recursive: true });
const dataDirectory = fsSync.mkdtempSync(path.resolve('work/campus-extras-'));
process.env.DAYLIGHT_DATA_DIR = dataDirectory;
process.env.DAYLIGHT_RUNTIME = 'local';
fsSync.writeFileSync(path.join(dataDirectory, 'infra.json'), JSON.stringify({ postgres: { enabled: false }, redis: { enabled: false }, mq: { enabled: false }, oss: { enabled: false } }));
const { importCampusItems, validateRecognition, createCampusExtrasRouter } = await import('./campus-guide/extras.js');
const { createGuideRepository, personalKey, COMMUNITY_KEY } = await import('./campus-guide/repository.js');
const { demoCatalog } = await import('./campus-guide/seed.js');
const { validatePersonal, emptyPersonal, dailyItems, calendarExport } = await import('../shared/campus-guide.js');
const { runWithRequestContext, getRequestUserId } = await import('./request-context.js');
const { readStore, readSettings, saveStore } = await import('./store.js');
const catalog = demoCatalog(), png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';

test('校园日历导入纯函数：重复不增、标题更新、改期取消原安排并串联新旧记录', () => {
  const store = { events: [{ id: 'unrelated', title: '用户已有记录', start: '2026-10-26T08:00:00+08:00', end: '2026-10-26T09:00:00+08:00' }] }, base = { id: 'a', kind: 'event', title: '校园活动', placeId: 'demo-library', start: '2026-10-26T10:00:00+08:00', end: '2026-10-26T11:00:00+08:00' }, options = { catalog, mailboxId: 'box-a', now: new Date('2026-10-23T12:00:00+08:00') };
  assert.equal(importCampusItems(store, [base], options).created.length, 1); const first = store.events[1]; assert.equal(importCampusItems(store, [base], options).created.length, 0); assert.equal(store.events.length, 2);
  assert.equal(importCampusItems(store, [{ ...base, title: '标题调整' }], options).updated.length, 1); assert.equal(first.title, '标题调整');
  const result = importCampusItems(store, [{ ...base, start: '2026-10-26T12:00:00+08:00', end: '2026-10-26T13:00:00+08:00' }], options), next = result.created[0]; assert.equal(result.cancelled.length, 1); assert.equal(first.status, 'cancelled'); assert.equal(first.replacementEventId, next.id); assert.equal(next.previousEventId, first.id); assert.equal(first.start, base.start); assert.equal(store.events[0].title, '用户已有记录');
});
test('校园日历导入纯函数：活动与个人安排同ID隔离，取消重导唯一ID和追溯关联', () => {
  const store = { events: [] }, item = { id: 'collision', kind: 'event', title: '活动', placeId: 'demo-library', start: '2026-10-26T10:00:00+08:00', end: '2026-10-26T11:00:00+08:00' }, options = { catalog, mailboxId: 'a', now: new Date('2026-10-23T12:00:00+08:00') };
  importCampusItems(store, [item, { ...item, kind: 'personal', title: '私人安排' }], options); assert.equal(store.events.length, 2); assert.notEqual(store.events[0].campusGuideSourceKey, store.events[1].campusGuideSourceKey);
  let previous = store.events[0]; for (let i = 0; i < 3; i++) { previous.status = 'cancelled'; previous.cancellationReason = '用户取消'; const created = importCampusItems(store, [item], options).created[0]; assert.equal(created.previousEventId, previous.id); assert.equal(previous.replacementEventId, created.id); assert.equal(previous.cancellationReason, '用户取消'); previous = created; }
  assert.equal(new Set(store.events.map(e => e.id)).size, store.events.length);
  const wholeDay = { ...item, id: 'whole-day', title: '全天校园活动', allDay: true, start: '2026-10-26T00:00:00+08:00', end: '2026-10-28T00:00:00+08:00' };
  const imported = importCampusItems(store, [wholeDay], options).created[0]; assert.equal(imported.allDay, true); assert.equal(imported.end, wholeDay.end); assert.equal(importCampusItems(store, [wholeDay], options).created.length, 0);
});
test('课表识别纯函数：地点精确映射和未匹配保留、周次校验、拒绝编造无效时刻', () => {
  const dates = { startDate: '2026-10-19', endDate: '2027-01-15' }, course = { title: '算法', teacher: '截图明确教师', weekday: 1, startTime: '08:15', endTime: '09:55', weeks: [1, 3], locationText: '教学中心 201' };
  const result = validateRecognition({ courses: [course, { ...course, teacher: undefined, locationText: '未收录教室', placeId: 'fabricated-id' }], notes: '核对地点' }, catalog, dates); assert.equal(result.courses[0].placeId, 'demo-teaching'); assert.equal(result.courses[1].placeId, ''); assert.equal(result.courses[1].locationText, '未收录教室'); assert.equal(result.courses[0].teacher, '截图明确教师'); assert.equal(result.courses[1].teacher, ''); assert.equal(result.requiresConfirmation, true);
  assert.throws(() => validateRecognition(null, catalog, dates), e => e.status === 422); assert.throws(() => validateRecognition({ courses: [{ ...course, startTime: '25:00' }] }, catalog, dates)); assert.throws(() => validateRecognition({ courses: [{ ...course, weeks: [0, 61] }] }, catalog, dates)); assert.throws(() => validateRecognition({ courses: [] }, catalog, { ...dates, startDate: '2026-02-30' }));
});
test('全天个人安排：北京零点与独占结束校验、UTC等价时间、旧定时安排兼容和ICS日期值', () => {
  const allDay = { id: 'whole-day', title: '合成全天安排', placeId: 'demo-library', allDay: true, start: '2026-10-25T16:00:00Z', end: '2026-10-27T16:00:00Z' };
  const timed = { id: 'timed', title: '原有定时安排', placeId: '', start: '2026-10-26T09:00:00+08:00', end: '2026-10-26T10:00:00+08:00' };
  const profile = validatePersonal({ ...emptyPersonal(), schedule: [allDay, timed] }, catalog);
  assert.equal(profile.schedule[0].allDay, true); assert.equal(profile.schedule[1].allDay, false); assert.equal(profile.schedule[1].start, timed.start);
  assert.ok(dailyItems(catalog, profile, '2026-10-27').some(item => item.id === allDay.id)); assert.equal(dailyItems(catalog, profile, '2026-10-28').some(item => item.id === allDay.id), false);
  assert.match(calendarExport([profile.schedule[0]]), /DTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261028/);
  assert.throws(() => validatePersonal({ ...emptyPersonal(), schedule: [{ ...allDay, start: '2026-10-26T01:00:00+08:00' }] }, catalog), /全天安排/);
  assert.throws(() => validatePersonal({ ...emptyPersonal(), schedule: [{ ...allDay, end: '2026-10-28T00:00:00Z' }] }, catalog), /全天安排/);
  assert.throws(() => validatePersonal({ ...emptyPersonal(), schedule: [{ ...allDay, allDay: 'true' }] }, catalog), /布尔/);
});

let sequence = 0;
async function fixture(t, { configured = true, modelResult, modelError, school = false } = {}) {
  const suffix = ++sequence, users = { alice: { id: `extras-alice-${suffix}`, username: 'Alice', role: 'user' }, bob: { id: `extras-bob-${suffix}`, username: 'Bob', role: 'user' } }, boxes = Object.values(users).map((user, index) => ({ id: `extras-box-${suffix}-${index}`, email: `synthetic-${suffix}-${index}@${school ? "shanghaitech.edu.cn" : "example.invalid"}`, ownerUserId: user.id }));
  await fs.writeFile(path.join(dataDirectory, 'settings.json'), JSON.stringify({ mailboxes: boxes, userPrefs: Object.fromEntries(Object.values(users).map((user, index) => [user.id, { activeMailboxId: boxes[index].id, baseUrl: 'https://synthetic-model.example.invalid/v1', apiKey: configured ? `synthetic-key-${index}` : '', model: 'synthetic-vision-model' }])) }));
  const repository = createGuideRepository({ dataDir: path.join(dataDirectory, `guide-${suffix}`), pool: null, pgRequired: false }), modelCalls = [], app = express();
  const contextRead = (user, fn) => runWithRequestContext({ userId: user.id, user }, fn);
  for (let index = 0; index < boxes.length; index++) contextRead(Object.values(users)[index], () => saveStore({ events: [], emails: [], tasks: [] }, boxes[index].id));
  const model = async (settings, messages, options) => { modelCalls.push({ settings, messages, options, context: getRequestUserId() }); if (modelError) throw modelError; return typeof modelResult === 'function' ? modelResult({ settings, messages, options }) : modelResult || { courses: [{ title: '合成课程', weekday: 1, startTime: '08:15', endTime: '09:55', locationText: '未收录教室', weeks: [] }], notes: '合成识别' }; };
  app.use('/api/campus-guide', createCampusExtrasRouter({ repository, resolveUser: async header => { if (header === 'Bearer broken') throw Error('synthetic token failure'); return users[header?.replace('Bearer ', '')] || null; }, model, now: () => new Date('2026-10-23T12:00:00+08:00') }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(route, user, method = 'GET', body) { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; }
  return { call, repository, modelCalls, users, boxes, contextRead };
}
const recognitionInput = () => ({ image: png, startDate: '2026-10-19', endDate: '2027-01-15' });

test('校园邮箱HTTP：游客拒绝、按账号过滤上科大邮箱、改期取消自动投影，不写公开目录', async t => {
  const { call, contextRead, users, boxes, repository } = await fixture(t, { school: true });
  const event = { id: 'synthetic-private', source: 'email', title: 'Alice合成私人报告', start: '2026-10-23T13:00:00+08:00', end: '2026-10-23T14:00:00+08:00', location: '合成教室' };
  contextRead(users.alice, () => saveStore({ events: [event], emails: [], tasks: [] }, boxes[0].id));
  contextRead(users.bob, () => saveStore({ events: [{ ...event, title: 'Bob合成安排' }], emails: [], tasks: [] }, boxes[1].id));
  assert.equal((await call('/school-calendar', '')).status, 401);
  const first = await call('/school-calendar', 'alice'); assert.equal(first.status, 200); assert.equal(first.body.items.length, 1); assert.equal(first.body.items[0].title, event.title); assert.equal(first.body.mailboxes[0].id, boxes[0].id); assert.equal(first.body.mailboxes[0].authorizationCode, undefined);
  assert.equal((await call('/school-calendar?userId=alice', 'bob')).body.items[0].title, 'Bob合成安排');
  assert.equal((await repository.readCatalog()).events.some(item => item.title === event.title), false);
  contextRead(users.alice, () => saveStore({ events: [{ ...event, status: 'cancelled' }], emails: [], tasks: [] }, boxes[0].id));
  assert.equal((await call('/school-calendar', 'alice')).body.items.length, 0);
});

test('校园小D HTTP：游客只查询公开数据、本人活动不串号、默认调用本人模型且可显式关闭', async t => {
  const { call, contextRead, users, boxes, modelCalls } = await fixture(t, { school: true, modelResult: { intent: 'events', date: '2026-10-23', query: '', days: 1 } });
  const event = { id: 'assistant-private', source: 'email', title: '合成私人邮箱报告', start: '2026-10-23T13:00:00+08:00', end: '2026-10-23T14:00:00+08:00' };
  contextRead(users.alice, () => saveStore({ events: [event], emails: [], tasks: [] }, boxes[0].id));
  const query = { message: '今天有哪些活动' };
  assert.equal((await call('/assistant', '', 'POST', { message: '' })).status, 400);
  const guest = await call('/assistant', '', 'POST', query); assert.equal(guest.status, 200); assert.ok(!JSON.stringify(guest.body).includes(event.title));
  const guestFree = await call('/assistant', '', 'POST', { message: '明天有哪些60分钟的空档？' }); assert.equal(guestFree.body.cards.length, 0); assert.match(guestFree.body.reply, /请先登录/);
  const alice = await call('/assistant', 'alice', 'POST', query); assert.ok(alice.body.cards.some(card => card.title === event.title)); assert.equal(alice.body.mode, 'model'); assert.equal(modelCalls.length, 1); assert.equal(modelCalls[0].settings.apiKey, 'synthetic-key-0');
  const bob = await call('/assistant', 'bob', 'POST', query); assert.ok(!JSON.stringify(bob.body).includes(event.title));
  assert.equal(modelCalls[1].settings.apiKey, 'synthetic-key-1');
  const rules = await call('/assistant', 'alice', 'POST', { ...query, useModel: false }); assert.equal(rules.body.mode, 'rules'); assert.equal(modelCalls.length, 2);
  const modeled = await call('/assistant', 'alice', 'POST', { ...query, useModel: true }); assert.equal(modeled.status, 200); assert.equal(modeled.body.mode, 'model'); assert.equal(modelCalls.length, 3);
  assert.ok(!JSON.stringify(modeled.body).includes('synthetic-key-0'));
});

test('校园小D HTTP：无模型显式提示基础查询，模型故障不伪装成功或静默降级', async t => {
  const missing = await fixture(t, { configured: false });
  const basic = await missing.call('/assistant', 'alice', 'POST', { message: '今天有什么安排' });
  assert.equal(basic.body.mode, 'rules'); assert.equal(basic.body.modelReady, false); assert.match(basic.body.notice, /尚未配置/); assert.equal(missing.modelCalls.length, 0);
  assert.equal((await missing.call('/assistant', 'alice', 'POST', { message: '今天有什么安排', useModel: true })).status, 409);
  const failed = await fixture(t, { modelError: new Error('synthetic-model-unavailable') });
  assert.equal((await failed.call('/assistant', 'alice', 'POST', { message: '今天有什么安排' })).status, 500); assert.equal(failed.modelCalls.length, 1);
});
test('截图识别HTTP：登录与图片/日期校验、使用账号模型配置、仅返回人工核对草稿', async t => {
  const { call, repository, modelCalls, users, boxes, contextRead } = await fixture(t);
  assert.equal((await call('/recognize-timetable', '', 'POST', recognitionInput())).status, 401); assert.equal((await call('/recognize-timetable', 'broken', 'POST', recognitionInput())).status, 401);
  assert.equal((await call('/recognize-timetable', 'alice', 'POST', { ...recognitionInput(), image: 'https://private-image.invalid/a.png' })).status, 400); assert.equal((await call('/recognize-timetable', 'alice', 'POST', { ...recognitionInput(), startDate: '2026-02-30' })).status, 400); assert.equal((await call('/recognize-timetable', 'alice', 'POST', { ...recognitionInput(), image: `data:image/png;base64,${Buffer.from('not png').toString('base64')}` })).status, 400); assert.equal(modelCalls.length, 0);
  const response = await call('/recognize-timetable', 'alice', 'POST', recognitionInput()); assert.equal(response.status, 200); assert.equal(response.body.requiresConfirmation, true); assert.equal(response.body.courses[0].placeId, ''); assert.equal(modelCalls.length, 1); assert.equal(modelCalls[0].settings.apiKey, 'synthetic-key-0'); assert.equal(modelCalls[0].settings.mailboxes.length, 1); assert.equal(modelCalls[0].settings.mailboxes[0].id, boxes[0].id); assert.equal(modelCalls[0].messages[1].content[1].image_url.url, png);
  assert.equal((await repository.readPersonal(users.alice.id)).courses.length, 0); assert.equal(contextRead(users.alice, () => readStore(boxes[0].id).events.length), 0);
});
test('截图识别HTTP：缺模型配置不调用模型，非法模型课程不写数据', async t => {
  const first = await fixture(t, { configured: false }); assert.equal((await first.call('/recognize-timetable', 'alice', 'POST', recognitionInput())).status, 409); assert.equal(first.modelCalls.length, 0);
  const second = await fixture(t, { modelResult: { courses: [{ title: '错误课程', weekday: 8, startTime: '08:00', endTime: '09:00' }] } }); assert.equal((await second.call('/recognize-timetable', 'alice', 'POST', recognitionInput())).status, 400); assert.equal((await second.repository.readPersonal(second.users.alice.id)).courses.length, 0);
});
test('社区摘要HTTP：只提交明确选定公开内容、过滤模型伪造引用、不携带隐藏内容', async t => {
  const { call, repository, modelCalls } = await fixture(t, { modelResult: { summary: '合成公开讨论摘要', openQuestions: ['待核实'], references: ['post-1', 'hidden-post', 'invented-post', 'post-1'] } });
  await repository.mutate(COMMUNITY_KEY, state => { state.posts.push({ id: 'post-1', title: '公开校园笔记', body: '合成公开材料', status: 'published' }, { id: 'hidden-post', title: '隐藏', body: 'secret-hidden-body', status: 'hidden' }, { id: 'unselected', title: '未选择', body: 'do-not-send-body', status: 'published' }); state.comments.push({ id: 'c1', postId: 'post-1', body: '公开评论', status: 'published' }, { id: 'c2', postId: 'post-1', body: 'secret-hidden-comment', status: 'deleted' }); });
  assert.equal((await call('/community/summary', '', 'POST', { postIds: ['post-1'] })).status, 401); assert.equal((await call('/community/summary', 'alice', 'POST', { postIds: ['hidden-post'] })).status, 409); assert.equal(modelCalls.length, 0);
  const response = await call('/community/summary', 'alice', 'POST', { postIds: ['post-1'] }); assert.equal(response.status, 200); assert.deepEqual(response.body.references, ['post-1']); assert.equal(response.body.postCount, 1); assert.equal(modelCalls[0].settings.apiKey, 'synthetic-key-0'); const supplied = JSON.stringify(modelCalls[0].messages); assert.match(supplied, /公开评论/); assert.equal(supplied.includes('secret-hidden'), false); assert.equal(supplied.includes('do-not-send'), false);
});
test('全天日历互通HTTP：本人邮箱读取保留全天属性，校园行程再写入保留北京日期与独占结束', async t => {
  const { call, repository, users, boxes, contextRead } = await fixture(t);
  const event = { id: 'source-whole-day', title: '合成两日安排', allDay: true, location: '教学中心', start: '2026-10-25T16:00:00Z', end: '2026-10-27T16:00:00Z' };
  contextRead(users.alice, () => saveStore({ events: [event], tasks: [], emails: [] }, boxes[0].id));
  const read = await call('/calendar-items?date=2026-10-26', 'alice'); assert.equal(read.status, 200); assert.equal(read.body.events[0].allDay, true); assert.equal(read.body.events[0].end, event.end);
  assert.equal((await call('/calendar-items?date=2026-10-28', 'alice')).body.events.length, 0); assert.equal((await call('/calendar-items?date=2026-10-26', 'bob')).body.events.length, 0);
  const profile = validatePersonal({ ...emptyPersonal(), schedule: [{ ...read.body.events[0], id: 'campus-whole-day', placeId: 'demo-teaching', kind: 'personal' }] }, catalog);
  await repository.mutate(personalKey(users.alice.id), stored => { Object.assign(stored, profile); });
  const imported = await call('/calendar-import', 'alice', 'POST', { date: '2026-10-26' }); assert.equal(imported.status, 200); assert.equal(imported.body.created, 1);
  const saved = contextRead(users.alice, () => readStore(boxes[0].id).events.find(row => row.campusGuideSourceKey)); assert.equal(saved.allDay, true); assert.equal(saved.start, event.start); assert.equal(saved.end, event.end);
  assert.equal((await call('/calendar-import', 'alice', 'POST', { date: '2026-10-27' })).body.created, 0); assert.equal((await call('/calendar-import', 'alice', 'POST', { date: '2026-10-28' })).body.created, 0);
});
test('校园日历HTTP：只读自有日历、校园安排导入幂等、改期保留旧记录，不能指定别人的邮箱', async t => {
  const { call, repository, users, boxes, contextRead } = await fixture(t);
  contextRead(users.alice, () => saveStore({ events: [{ id: 'a-event', title: 'Alice私有', start: '2026-10-26T12:00:00+08:00', end: '2026-10-26T13:00:00+08:00' }, { id: 'a-cancel', title: '取消项', status: 'cancelled', start: '2026-10-26T10:00:00+08:00', end: '2026-10-26T11:00:00+08:00' }], tasks: [], emails: [] }, boxes[0].id));
  contextRead(users.bob, () => saveStore({ events: [{ id: 'b-event', title: 'Bob秘密安排', start: '2026-10-26T12:00:00+08:00', end: '2026-10-26T13:00:00+08:00' }], tasks: [], emails: [] }, boxes[1].id));
  assert.equal((await call('/calendar-items?date=2026-10-26')).status, 401); const listed = await call('/calendar-items?date=2026-10-26', 'alice'); assert.deepEqual(listed.body.events.map(e => e.id), ['a-event']); assert.equal(JSON.stringify(listed.body).includes('Bob'), false);
  const item = { id: 'schedule-1', title: '合成校园安排', kind: 'personal', placeId: 'demo-library', start: '2026-10-26T15:00:00+08:00', end: '2026-10-26T16:00:00+08:00', notes: '合成备注' }; await repository.mutate(personalKey(users.alice.id), personal => { personal.schedule.push(item); });
  const imported = await call('/calendar-import', 'alice', 'POST', { date: '2026-10-26', mailboxId: boxes[1].id }); assert.equal(imported.status, 200); assert.equal(imported.body.created, 1); assert.equal(imported.body.mailboxId, boxes[0].id); assert.equal((await call('/calendar-import', 'alice', 'POST', { date: '2026-10-26' })).body.unchanged, 1);
  await repository.mutate(personalKey(users.alice.id), personal => { personal.schedule[0].start = '2026-10-26T16:30:00+08:00'; personal.schedule[0].end = '2026-10-26T17:30:00+08:00'; });
  const changed = await call('/calendar-import', 'alice', 'POST', { date: '2026-10-26' }); assert.equal(changed.status, 200); assert.equal(changed.body.created, 1); assert.equal(changed.body.cancelled, 1);
  const events = contextRead(users.alice, () => readStore(boxes[0].id).events), importedEvents = events.filter(event => event.campusGuideSourceKey); assert.equal(importedEvents.length, 2); assert.equal(importedEvents[0].status, 'cancelled'); assert.equal(importedEvents[0].replacementEventId, importedEvents[1].id); assert.equal(importedEvents[1].previousEventId, importedEvents[0].id); assert.equal(events.find(e => e.id === 'a-event').title, 'Alice私有'); assert.equal(contextRead(users.bob, () => readStore(boxes[1].id).events.length), 1); assert.deepEqual((await call('/calendar-items?date=2026-10-26', 'alice')).body.events.map(e => e.id), ['a-event']);
});
