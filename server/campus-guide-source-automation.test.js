import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

// Every mailbox and source is synthetic. Remote fetch, IMAP and models are never used.
fsSync.mkdirSync('work', { recursive: true });
const dataDirectory = fsSync.mkdtempSync(path.resolve('work/campus-source-automation-'));
process.env.DAYLIGHT_DATA_DIR = dataDirectory;
process.env.DAYLIGHT_RUNTIME = 'local';
fsSync.writeFileSync(path.join(dataDirectory, 'infra.json'), JSON.stringify({ postgres: { enabled: false }, redis: { enabled: false }, mq: { enabled: false }, oss: { enabled: false } }));
const { parseCampusFeed, syncDueCampusSources, ownedSourceMailboxes, ownedMailboxEmailsForSource, storedMailboxSource } = await import('./campus-guide/sources.js');
const { createGuideRepository, SOURCES_KEY } = await import('./campus-guide/repository.js');
const { createCampusGuideRouter } = await import('./campus-guide/routes.js');

const officialSource = { id: 'html-source', format: 'html', url: 'https://campus.example.com/events' };
const htmlEvent = () => ({ '@type': 'EducationEvent', '@id': 'synthetic-lecture', name: '合成官网讲座', alternateName: 'Synthetic Campus Lecture', startDate: '2026-10-26T18:00:00+08:00', endDate: '2026-10-26T20:00:00+08:00', description: '未经核准的官网介绍', organizer: { name: '合成组织' }, performer: [{ name: '合成主讲人' }], location: { name: '合成教室101' }, url: 'https://campus.example.com/events/one' });
const page = (events = [htmlEvent()]) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': events })}</script></html>`;
const fullEvent = draft => ({ ...draft.event, title: '已核验公开讲座', description: '管理员核验后的公开介绍', summary: '核验完成', placeId: 'demo-teaching', start: '2026-10-26T18:00:00+08:00', end: '2026-10-26T20:00:00+08:00', allDay: false });

test('官网HTML：只解析JSON-LD活动和明确全天日期，不执行脚本或使用网页发布时间', () => {
  globalThis.syntheticCampusScriptExecuted = false;
  const html = `${page([htmlEvent(), { ...htmlEvent(), '@id': 'all-day', name: '合成全天展览', startDate: '2026-10-27', endDate: '2026-10-29', eventStatus: 'https://schema.org/EventCancelled' }])}<script>globalThis.syntheticCampusScriptExecuted = true</script><time>2026-10-23</time>`;
  const entries = parseCampusFeed(html, officialSource);
  assert.equal(entries.length, 2); assert.equal(globalThis.syntheticCampusScriptExecuted, false); delete globalThis.syntheticCampusScriptExecuted;
  assert.equal(entries[0].event.englishTitle, 'Synthetic Campus Lecture'); assert.equal(entries[0].event.speaker, '合成主讲人'); assert.equal(entries[0].event.organizer, '合成组织'); assert.equal(entries[0].event.locationText, '合成教室101'); assert.equal(entries[0].event.placeId, '');
  assert.equal(entries[1].event.allDay, true); assert.equal(entries[1].event.start, '2026-10-27T00:00:00+08:00'); assert.equal(entries[1].event.end, '2026-10-29T00:00:00+08:00'); assert.equal(entries[1].event.status, 'cancelled');
  const badJson = parseCampusFeed('<script type="application/ld+json">{invalid json}</script><p>发布于2026-10-23</p>', officialSource); assert.equal(badJson.length, 0);
});

test('官网HTML列表：只识别同站活动链接，不跟随详情，时间地点保持待补全', () => {
  const html = '<script><a href="/event/script">讲座脚本伪链接</a></script><a href="/events/one">校园学术讲座</a><a href="/events/one">校园学术讲座重复</a><a href="https://other.example.com/events/x">外站校园讲座</a><a href="javascript:alert(1)">错误活动链接</a><a href="/about">学校简介</a><time>2026-10-23</time>';
  const result = parseCampusFeed(html, officialSource); assert.equal(result.length, 1); assert.equal(result[0].event.title, '校园学术讲座'); assert.equal(result[0].event.start, ''); assert.equal(result[0].event.end, ''); assert.equal(result[0].event.placeId, ''); assert.equal(result[0].event.sourceUrl, 'https://campus.example.com/events/one'); assert.match(result[0].event.description, /尚未读取详情/);
});

let sequence = 0;
async function fixture(t, { defaultReaders = false } = {}) {
  const directory = path.join(dataDirectory, `fixture-${++sequence}`), repository = createGuideRepository({ dataDir: directory, pool: null, pgRequired: false });
  let current = new Date('2026-10-23T12:00:00+08:00'), body = page(), remoteCalls = [], mailboxCalls = [];
  const users = { alpha: { id: 'alpha-admin', username: 'Alpha', role: 'admin' }, beta: { id: 'beta-admin', username: 'Beta', role: 'admin' }, viewer: { id: 'viewer-user', username: 'Viewer', role: 'user' } };
  const mailboxes = { 'alpha-box': { owner: users.alpha.id, email: 'synthetic-alpha@example.invalid', emails: [] }, 'beta-box': { owner: users.beta.id, email: 'synthetic-beta@example.invalid', emails: [] } };
  const ownedReader = async (user, mailboxId, { limit = 100 } = {}) => { mailboxCalls.push({ userId: user.id, mailboxId, limit }); const box = mailboxes[mailboxId]; if (!box || box.owner !== user.id) throw Object.assign(Error('邮箱不存在或无权访问。'), { status: 404 }); return limit === 0 ? [] : [...box.emails].sort((a, b) => Date.parse(b.receivedAt || 0) - Date.parse(a.receivedAt || 0)).slice(0, limit); };
  const readMailboxSource = source => ownedReader(Object.values(users).find(user => user.id === source.ownerUserId), source.mailboxId, { limit: source.scanLimit });
  const fetchSource = async url => { remoteCalls.push(url); return { text: body, finalUrl: url }; };
  const app = express(); app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => users[header?.replace('Bearer ', '')] || null, adminUser: user => user?.role === 'admin', now: () => new Date(current), fetchSource, ...(defaultReaders ? {} : { readOwnedMailboxEmails: ownedReader, readSourceMailboxes: async user => Object.entries(mailboxes).filter(([, box]) => box.owner === user.id).map(([id, box]) => ({ id, email: box.email })), readOwnedEmail: async (user, mailboxId, emailId) => { const emails = await ownedReader(user, mailboxId); const email = emails.find(row => row.id === emailId); if (!email) throw Object.assign(Error('邮件不存在。'), { status: 404 }); return { ...email, mailboxId }; } }) }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (route, user = 'alpha', method = 'GET', input) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); return { status: response.status, body: await response.json() }; };
  return { call, repository, users, mailboxes, ownedReader, remoteCalls, mailboxCalls, now: () => new Date(current), setTime: time => { current = new Date(time); }, setPage: html => { body = html; }, due: () => syncDueCampusSources({ repository, fetchSource, readMailboxSource, now: () => new Date(current) }) };
}

test('官网HTML定时来源：单页抓取只进入待审区，人工补齐并发布才进入公共目录', async t => {
  const f = await fixture(t);
  const source = await f.call('/admin/sources', 'alpha', 'POST', { name: '合成官网HTML', url: officialSource.url, format: 'html', enabled: true, intervalMinutes: 15 }); assert.equal(source.status, 200);
  assert.equal((await f.due()).succeeded, 1); assert.deepEqual(f.remoteCalls, [officialSource.url]);
  const state = (await f.call('/admin/sources')).body, draft = state.drafts[0]; assert.equal(draft.needsDetails, true); assert.equal(draft.event.placeId, ''); assert.equal(draft.status, 'pending'); assert.equal(state.runs[0].scheduled, true);
  assert.equal(JSON.stringify((await f.call('/catalog', '')).body).includes('未经核准的官网介绍'), false); assert.equal((await f.call(`/admin/drafts/${draft.id}/publish`, 'alpha', 'POST', { revision: 0, catalogRevision: 0 })).status, 400);
  assert.equal((await f.call(`/admin/drafts/${draft.id}/publish`, 'alpha', 'POST', { revision: 0, catalogRevision: 0, event: fullEvent(draft) })).status, 200);
  const published = (await f.call('/catalog', '')).body.events.find(event => event.id === draft.event.id); assert.equal(published.title, '已核验公开讲座'); assert.equal(published.description, '管理员核验后的公开介绍'); assert.equal((await f.due()).due, 0);
});

test('自动邮箱来源：只允许自有邮箱，忽略伪造所有者，私有配置、草案和执行记录按管理员隔离', async t => {
  const f = await fixture(t); f.mailboxes['alpha-box'].emails = [{ id: 'stored-a', subject: '合成讲座邮件', body: 'synthetic-private-alpha-body', receivedAt: '2026-10-23T11:00:00+08:00' }];
  assert.equal((await f.call('/admin/source-mailboxes', '')).status, 401); assert.equal((await f.call('/admin/source-mailboxes', 'viewer')).status, 403);
  assert.deepEqual((await f.call('/admin/source-mailboxes')).body.mailboxes.map(box => box.id), ['alpha-box']);
  assert.equal((await f.call('/admin/sources', 'alpha', 'POST', { name: '伪造邮箱', format: 'mailbox', mailboxId: 'beta-box' })).status, 404);
  const created = await f.call('/admin/sources', 'alpha', 'POST', { name: '本人校园通知', format: 'mailbox', mailboxId: 'alpha-box', ownerUserId: 'beta-admin', enabled: true }); assert.equal(created.status, 200); const source = created.body; assert.equal(source.ownerUserId, f.users.alpha.id); assert.equal(source.url, ''); assert.equal(f.mailboxCalls.at(-1).limit, 0);
  assert.equal((await f.call('/admin/sources', 'alpha', 'POST', { name: '重复来源', format: 'mailbox', mailboxId: 'alpha-box' })).status, 409);
  assert.equal((await f.call(`/admin/sources/${source.id}/sync`, 'alpha', 'POST', {})).body.draftsAdded, 1); assert.equal(f.remoteCalls.length, 0);
  const own = (await f.call('/admin/sources')).body, draft = own.drafts[0]; assert.equal(draft.ownerUserId, f.users.alpha.id); assert.match(draft.event.description, /synthetic-private-alpha/); assert.equal(draft.needsDetails, true); assert.equal(own.runs.length, 1);
  const other = (await f.call('/admin/sources', 'beta')).body; assert.deepEqual(other.sources, []); assert.deepEqual(other.drafts, []); assert.deepEqual(other.runs, []);
  for (const endpoint of ['/catalog', '/sources']) { const publicState = JSON.stringify((await f.call(endpoint, '')).body); assert.equal(publicState.includes('synthetic-private-alpha'), false); assert.equal(publicState.includes('alpha-box'), false); assert.equal(publicState.includes(source.id), false); }
  for (const [route, method, body] of [
    [`/admin/sources/${source.id}`, 'PUT', { revision: 0, enabled: false }], [`/admin/sources/${source.id}`, 'DELETE', { revision: 0 }], [`/admin/sources/${source.id}/sync`, 'POST', {}],
    [`/admin/drafts/${draft.id}`, 'PATCH', { revision: 0, event: fullEvent(draft) }], [`/admin/drafts/${draft.id}/reject`, 'POST', { revision: 0 }], [`/admin/drafts/${draft.id}/publish`, 'POST', { revision: 0, catalogRevision: 0, event: fullEvent(draft) }],
  ]) assert.equal((await f.call(route, 'beta', method, body)).status, 404, route);
  assert.equal((await f.call(`/admin/drafts/${draft.id}/publish`, 'alpha', 'POST', { revision: 0, catalogRevision: 0, event: fullEvent(draft) })).status, 200);
  const publicCatalog = JSON.stringify((await f.call('/catalog', '')).body); assert.match(publicCatalog, /已核验公开讲座/); assert.equal(publicCatalog.includes('synthetic-private-alpha'), false);
  assert.equal((await f.call('/admin/sources', 'beta', 'POST', { name: '另一个管理员的邮箱', format: 'mailbox', mailboxId: 'beta-box' })).status, 200);
});

test('自动邮箱定时来源：最近范围与关键词、去重和变更、新邮件、暂停均可重现，绝不自动公开原文', async t => {
  const f = await fixture(t); f.mailboxes['alpha-box'].emails = [
    { id: 'stored-old', subject: '范围外讲座', body: 'private-old', receivedAt: '2026-10-20T10:00:00+08:00' },
    { id: 'stored-match', subject: '学术讲座', body: 'private-v1', receivedAt: '2026-10-22T10:00:00+08:00' },
    { id: 'stored-ignore', subject: '普通账单', body: 'private-ignore', receivedAt: '2026-10-23T10:00:00+08:00' },
  ];
  const source = (await f.call('/admin/sources', 'alpha', 'POST', { name: '关键词自动建稿', format: 'mailbox', mailboxId: 'alpha-box', keywords: ['讲座'], scanLimit: 2, enabled: true, intervalMinutes: 15 })).body;
  assert.equal((await f.due()).succeeded, 1); let state = (await f.call('/admin/sources')).body; assert.equal(state.drafts.length, 1); assert.equal(state.drafts[0].title, '学术讲座'); assert.equal(state.runs[0].items, 1); assert.equal(f.remoteCalls.length, 0);
  f.setTime('2026-10-23T12:16:00+08:00'); assert.equal((await f.due()).succeeded, 1); state = (await f.call('/admin/sources')).body; assert.equal(state.drafts.length, 1); assert.equal(state.runs.at(-1).unchanged, 1);
  f.mailboxes['alpha-box'].emails.find(email => email.id === 'stored-match').body = 'private-v2'; f.setTime('2026-10-23T12:32:00+08:00'); await f.due(); state = (await f.call('/admin/sources')).body; assert.equal(state.drafts.length, 2); assert.equal(state.drafts[0].status, 'superseded'); assert.equal(state.runs.at(-1).changed, 1); assert.match(state.drafts[1].event.description, /private-v2/);
  f.mailboxes['alpha-box'].emails.push({ id: 'stored-new', subject: '新讲座通知', body: 'private-new', receivedAt: '2026-10-23T12:40:00+08:00' }); f.setTime('2026-10-23T12:48:00+08:00'); await f.due(); state = (await f.call('/admin/sources')).body; assert.equal(state.drafts.length, 3); assert.equal(state.runs.at(-1).draftsAdded, 1);
  const update = await f.call(`/admin/sources/${source.id}`, 'alpha', 'PUT', { revision: source.revision, enabled: false, ownerUserId: 'beta-admin' }); assert.equal(update.status, 200); assert.equal(update.body.ownerUserId, 'alpha-admin');
  f.setTime('2026-10-23T14:00:00+08:00'); assert.equal((await f.due()).due, 0); assert.equal(f.remoteCalls.length, 0); assert.equal(JSON.stringify((await f.call('/catalog', '')).body).includes('private-'), false);
});

test('自有已入库邮箱实际读取：账号范围、最新顺序、排除示例、定时任务权限失效，始终使用隔离目录', async t => {
  const users = [{ id: 'alpha-admin', email: 'synthetic-alpha@example.invalid', role: 'admin' }, { id: 'beta-admin', email: 'synthetic-beta@example.invalid', role: 'admin' }, { id: 'viewer-user', role: 'user' }];
  await fs.writeFile(path.join(dataDirectory, 'users.json'), JSON.stringify({ users, resets: [] }));
  await fs.writeFile(path.join(dataDirectory, 'settings.json'), JSON.stringify({ mailboxes: [{ id: 'stored-alpha-box', ownerUserId: users[0].id, email: users[0].email }, { id: 'stored-beta-box', ownerUserId: users[1].id, email: users[1].email }], userPrefs: { 'alpha-admin': { activeMailboxId: 'stored-alpha-box' }, 'beta-admin': { activeMailboxId: 'stored-beta-box' } } }));
  for (const [box, emails] of [['stored-alpha-box', [{ id: 'real-old', subject: '合成旧讲座', body: 'stored-private-old', receivedAt: '2026-10-21T12:00:00+08:00' }, { id: 'demo-synthetic', subject: '示例不扫描', receivedAt: '2026-10-24T12:00:00+08:00' }, { id: 'real-new', subject: '合成新讲座', body: 'stored-private-new', receivedAt: '2026-10-23T12:00:00+08:00' }]], ['stored-beta-box', [{ id: 'beta-only', subject: 'Beta讲座', body: 'beta-private' }]]]) { const directory = path.join(dataDirectory, 'mailboxes', box); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'calendar.json'), JSON.stringify({ events: [], tasks: [], emails })); }
  assert.deepEqual((await ownedSourceMailboxes(users[0])).map(row => row.id), ['stored-alpha-box']); assert.deepEqual((await ownedMailboxEmailsForSource(users[0], 'stored-alpha-box', { limit: 1 })).map(row => row.id), ['real-new']); assert.equal((await ownedMailboxEmailsForSource(users[0], 'stored-alpha-box', { limit: 0 })).length, 0); await assert.rejects(ownedMailboxEmailsForSource(users[0], 'stored-beta-box'), error => error.status === 404);
  const owned = await storedMailboxSource({ ownerUserId: users[0].id, mailboxId: 'stored-alpha-box', scanLimit: 100 }); assert.deepEqual(owned.map(row => row.id), ['real-new', 'real-old']);
  await assert.rejects(storedMailboxSource({ ownerUserId: 'missing-admin', mailboxId: 'stored-alpha-box' }), error => error.status === 403); await assert.rejects(storedMailboxSource({ ownerUserId: 'viewer-user', mailboxId: 'stored-alpha-box' }), error => error.status === 403);
  const f = await fixture(t, { defaultReaders: true }); const created = await f.call('/admin/sources', 'alpha', 'POST', { name: '实际存储快照', format: 'mailbox', mailboxId: 'stored-alpha-box', keywords: ['讲座'] }); assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await f.call(`/admin/sources/${created.body.id}/sync`, 'alpha', 'POST', {})).body.draftsAdded, 2); assert.equal(f.remoteCalls.length, 0); assert.equal((await f.call('/admin/sources', 'beta')).body.drafts.length, 0);
});
