import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { parseCampusFeed, syncCampusSource, syncDueCampusSources, validateSource } from './campus-guide/sources.js';
import { fetchCampusSource, isPublicAddress, sourceUrl } from './campus-guide/source-fetch.js';
import { createGuideRepository, SOURCES_KEY, CATALOG_KEY } from './campus-guide/repository.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';
const validEvent = () => ({ id: 'official-1', title: '合成官方活动', category: 'academic', placeId: 'demo-teaching', start: '2026-10-26T18:00:00+08:00', end: '2026-10-26T20:00:00+08:00', description: '公开摘要', organizer: '合成组织' });
test('来源防SSRF：拒绝IP/域名私网、凭据、端口、重定向私网与混合DNS，公开连接固定解析IP', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.31.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2::1', '20::1', '200::1', '2001:0000::1', '2001:0002::1', '2001:db8::1', '2001:0db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const value of ['http://example.com/feed', 'https://admin:password@example.com/feed', 'https://127.1/feed', 'https://example.com:8443/feed', 'https://localhost/feed', 'https://10.0.0.1/feed', 'https://example.com/feed#fragment']) assert.throws(() => sourceUrl(value), value);
  let transported = 0;
  await assert.rejects(fetchCampusSource('https://campus.example.com/feed', { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], transport: async () => { transported++; } }), /私有/); assert.equal(transported, 0);
  await assert.rejects(fetchCampusSource('https://campus.example.com/feed', { lookup: async () => [{ address: '20::1', family: 6 }], transport: async () => { transported++; } }), /私有/); assert.equal(transported, 0);
  await assert.rejects(fetchCampusSource('https://campus.example.com/feed', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], transport: async () => ({ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' }, body: '' }) }), /私有/);
  const result = await fetchCampusSource('https://campus.example.com/feed', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], transport: async (url, options) => { assert.equal(options.address, '8.8.8.8'); assert.equal(url.hostname, 'campus.example.com'); return { status: 200, headers: { 'content-type': 'application/json' }, body: '[]' }; } }); assert.equal(result.text, '[]');
  await assert.rejects(fetchCampusSource('https://campus.example.com/feed', { maxBytes: 4, lookup: async () => [{ address: '8.8.8.8', family: 4 }], transport: async () => ({ status: 200, headers: {}, body: '12345' }) }), /大小/);
});

test('来源敏感链接：配置与重定向拒绝密钥参数，私密订阅/签名不会复制进待公开活动', async () => {
  const privateLinks = [
    'https://campus.example.com/feed?token=synthetic-secret',
    'https://campus.example.com/feed?api_key=synthetic-secret',
    'https://campus.example.com/calendar.ics?subscription=synthetic-secret',
    'https://campus.example.com/feed?X-Amz-Signature=synthetic-secret',
  ];
  for (const url of privateLinks) assert.throws(() => validateSource({ name: '合成源', url, format: 'json' }), /凭据|令牌|私密/);
  const source = { id: 'synthetic-source', format: 'json', url: privateLinks[0] };
  const legacyEntry = parseCampusFeed(JSON.stringify([validEvent()]), source)[0];
  assert.equal(legacyEntry.event.sourceUrl, '');
  const linkedEntry = parseCampusFeed(JSON.stringify([{ ...validEvent(), sourceUrl: privateLinks[2], registrationUrl: privateLinks[3] }]), { ...source, url: 'https://campus.example.com/feed?category=academic' })[0];
  assert.equal(linkedEntry.event.sourceUrl, ''); assert.equal(linkedEntry.event.registrationUrl, '');
  const publicEntry = parseCampusFeed(JSON.stringify([{ ...validEvent(), registrationUrl: 'https://campus.example.com/signup?event=one' }]), { ...source, url: 'https://campus.example.com/feed?category=academic' })[0];
  assert.match(publicEntry.event.sourceUrl, /category=academic/); assert.match(publicEntry.event.registrationUrl, /event=one/);
  let requests = 0;
  await assert.rejects(fetchCampusSource('https://campus.example.com/feed', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], transport: async () => { requests++; return { status: 302, headers: { location: privateLinks[0] }, body: '' }; } }), /凭据|令牌|私密/);
  assert.equal(requests, 1);
});
test('来源格式：JSON稳定ID/RSS发布日期不猜活动时间/ICS时区明确，禁止XML实体', () => {
  const source = { id: 'source-1', url: 'https://campus.example.com/feed', format: 'json' }, parsed = parseCampusFeed(JSON.stringify([validEvent(), validEvent()]), source); assert.equal(parsed.length, 1); assert.equal(parsed[0].event.id, parseCampusFeed(JSON.stringify([validEvent()]), source)[0].event.id);
  const rss = parseCampusFeed('<rss><channel><item><guid>one</guid><title>讲座</title><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>请核对时间</description></item></channel></rss>', { ...source, format: 'rss' }); assert.equal(rss[0].event.start, ''); assert.match(rss[0].event.description, /核对/);
  assert.throws(() => parseCampusFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss></rss>', { ...source, format: 'rss' }), /实体/);
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ics-1\r\nSUMMARY:合成活动\r\nDTSTART;TZID=Asia/Shanghai:20261026T183000\r\nDTEND;TZID=Asia/Shanghai:20261026T200000\r\nLOCATION:待选择教室\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'; const fromIcs = parseCampusFeed(ics, { ...source, format: 'ics' }); assert.equal(fromIcs[0].event.start, '2026-10-26T18:30:00+08:00'); assert.equal(fromIcs[0].sourceLocation, '待选择教室'); assert.equal(fromIcs[0].event.placeId, '');
  assert.equal(parseCampusFeed(ics.replaceAll(';TZID=Asia/Shanghai', ''), { ...source, format: 'ics' })[0].event.start, '');
});

async function fixture(t) {
  await fs.mkdir('work', { recursive: true }); const directory = await fs.mkdtemp(path.resolve('work/campus-source-api-')), repository = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  let body = JSON.stringify([validEvent()]), fetches = 0, current = new Date('2026-10-23T12:00:00+08:00'), failFetch = false;
  const fetchSource = async () => { fetches++; if (failFetch) throw Object.assign(Error('合成网络失败'), { status: 502 }); return { text: body, finalUrl: 'https://campus.example.com/feed' }; }, app = express();
  app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => header === 'Bearer admin' ? { id: 'admin', username: 'Admin', role: 'admin' } : header === 'Bearer alice' ? { id: 'alice', username: 'Alice', role: 'user' } : null, adminUser: user => user?.role === 'admin', now: () => new Date(current), fetchSource, readOwnedEmail: async (user, mailboxId, emailId) => { if (mailboxId !== 'admin-box') throw Object.assign(Error('邮箱不存在或无权访问。'), { status: 404 }); return { id: emailId, mailboxId, subject: '合成选定邮件活动', body: '这段单封邮件原文应只在私有草案预览中出现。', receivedAt: '2026-10-23T12:00:00+08:00' }; } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(route, user = 'admin', method = 'GET', input) { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { method, headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); return { status: response.status, body: await response.json() }; }
  return { call, repository, fetchSource, now: () => new Date(current), setBody: value => { body = value; }, setFail: value => { failFetch = value; }, setTime: value => { current = new Date(value); }, fetches: () => fetches };
}
test('来源HTTP：缺省未配置、权限、人工审核发布去重、人工覆盖不被定时同步覆盖', async t => {
  const { call, setBody } = await fixture(t); assert.equal((await call('/admin/sources', '')).status, 401); assert.equal((await call('/admin/sources', 'alice')).status, 403); assert.equal((await call('/sources', '')).body.sources.length, 0);
  const source = (await call('/admin/sources', 'admin', 'POST', { name: '合成官网JSON', url: 'https://campus.example.com/feed', format: 'json', enabled: false, intervalMinutes: 60 })).body;
  assert.equal((await call(`/admin/sources/${source.id}/sync`, 'alice', 'POST', {})).status, 403);
  const run = await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {}); assert.equal(run.status, 200); assert.equal(run.body.draftsAdded, 1);
  assert.equal((await call('/catalog', '')).body.events.length, 3); let state = (await call('/admin/sources')).body; let draft = state.drafts[0]; assert.equal(draft.status, 'pending'); assert.equal(draft.needsDetails, false);
  assert.equal((await call(`/admin/drafts/${draft.id}/publish`, 'admin', 'POST', { revision: draft.revision, catalogRevision: 0 })).status, 200);
  let catalog = (await call('/admin/catalog')).body, event = catalog.events.find(e => e.id === draft.event.id); assert.equal(event.manualOverride, true);
  event.title = '管理员人工修订'; event.pinned = true; event.hidden = true; assert.equal((await call('/admin/catalog', 'admin', 'PUT', catalog)).status, 200); assert.equal((await call('/catalog', '')).body.events.some(e => e.id === event.id), false);
  const duplicate = await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {}); assert.equal(duplicate.body.unchanged, 1); assert.equal(duplicate.body.draftsAdded, 0);
  setBody(JSON.stringify([{ ...validEvent(), title: '来源修改的活动' }])); const changed = await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {}); assert.equal(changed.body.changed, 1); catalog = (await call('/admin/catalog')).body; assert.equal(catalog.events.find(e => e.id === event.id).title, '管理员人工修订');
  state = (await call('/admin/sources')).body; draft = state.drafts.find(d => d.status === 'pending'); assert.ok(draft); assert.match(draft.notes, /原样/);
  assert.equal((await call(`/admin/drafts/${draft.id}/reject`, 'admin', 'POST', { revision: draft.revision, note: '来源变化待核对' })).status, 200); assert.equal((await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {})).body.unchanged, 1);
});
test('来源HTTP：RSS无日期待补全、编辑CAS、选定邮件仅私有草案，发布需完整核验字段', async t => {
  const { call, setBody } = await fixture(t); setBody('<rss><channel><item><guid>a</guid><title>待核对讲座</title><pubDate>2026-10-23</pubDate><description>示例官网内容</description></item></channel></rss>');
  const source = (await call('/admin/sources', 'admin', 'POST', { name: 'RSS源', url: 'https://campus.example.com/rss', format: 'rss' })).body; await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {});
  let draft = (await call('/admin/sources')).body.drafts[0]; assert.equal(draft.needsDetails, true); assert.equal((await call(`/admin/drafts/${draft.id}/publish`, 'admin', 'POST', { revision: draft.revision, catalogRevision: 0 })).status, 400);
  const corrected = await call(`/admin/drafts/${draft.id}`, 'admin', 'PATCH', { revision: draft.revision, event: { ...draft.event, ...validEvent() } }); assert.equal(corrected.status, 200); assert.equal(corrected.body.needsDetails, false); assert.equal((await call(`/admin/drafts/${draft.id}`, 'admin', 'PATCH', { revision: draft.revision, event: validEvent() })).status, 409);
  assert.equal((await call('/admin/sources/email-draft', 'admin', 'POST', { mailboxId: 'other-user-box', emailId: 'one' })).status, 404);
  const email = await call('/admin/sources/email-draft', 'admin', 'POST', { mailboxId: 'admin-box', emailId: 'one' }); assert.equal(email.status, 200); assert.equal(email.body.draft.needsDetails, true); assert.match(email.body.draft.event.description, /私有草案/); assert.equal(JSON.stringify((await call('/catalog', '')).body).includes('私有草案'), false); assert.equal(JSON.stringify((await call('/sources', '')).body).includes('私有草案'), false);
  assert.equal((await call('/admin/sources/email-draft', 'admin', 'POST', { mailboxId: 'admin-box', emailId: 'one' })).body.duplicate, true);
});

test('来源HTTP：审核保存与发布再次拒绝私密URL，匿名目录和目录导出不含未审核原文或凭据', async t => {
  const { call, repository } = await fixture(t);
  const source = (await call('/admin/sources', 'admin', 'POST', { name: '公开来源', url: 'https://campus.example.com/feed', format: 'json' })).body;
  await call(`/admin/sources/${source.id}/sync`, 'admin', 'POST', {});
  const draft = (await call('/admin/sources')).body.drafts[0], privateUrl = 'https://campus.example.com/calendar.ics?subscription=synthetic-secret';
  assert.equal((await call(`/admin/drafts/${draft.id}`, 'admin', 'PATCH', { revision: draft.revision, event: { ...draft.event, sourceUrl: privateUrl } })).status, 400);
  assert.equal((await call(`/admin/drafts/${draft.id}/publish`, 'admin', 'POST', { revision: draft.revision, catalogRevision: 0, event: { ...draft.event, registrationUrl: privateUrl } })).status, 400);
  // Simulate a draft saved by the earlier version; revalidation must also protect it.
  await repository.mutate(SOURCES_KEY, state => { state.drafts[0].event.sourceUrl = privateUrl; });
  assert.equal((await call(`/admin/drafts/${draft.id}/publish`, 'admin', 'POST', { revision: draft.revision, catalogRevision: 0 })).status, 400);
  for (const endpoint of ['/catalog', '/admin/export']) {
    const response = await call(endpoint, endpoint === '/catalog' ? '' : 'admin'); assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.body).includes('synthetic-secret'), false);
  }
  const saved = await call(`/admin/drafts/${draft.id}`, 'admin', 'PATCH', { revision: draft.revision, event: { ...draft.event, sourceUrl: 'https://campus.example.com/events/one' } }); assert.equal(saved.status, 200);
  assert.equal((await call(`/admin/drafts/${draft.id}/publish`, 'admin', 'POST', { revision: saved.body.revision, catalogRevision: 0 })).status, 200);
  const published = (await call('/catalog', '')).body.events.find(event => event.id === draft.event.id); assert.equal(published.sourceUrl, 'https://campus.example.com/events/one');
});
test('来源调度：仅启用来源按nextRun运行，网络失败记录和退避，多执行者租约避免重复抓取', async t => {
  const context = await fixture(t), { call, repository, fetchSource, now, setTime, setFail, fetches } = context;
  const created = (await call('/admin/sources', 'admin', 'POST', { name: '定时源', url: 'https://campus.example.com/feed', format: 'json', enabled: true, intervalMinutes: 15 })).body;
  assert.equal((await syncDueCampusSources({ repository, fetchSource, now })).succeeded, 1); assert.equal(fetches(), 1); assert.equal((await syncDueCampusSources({ repository, fetchSource, now })).due, 0);
  setTime('2026-10-23T12:16:00+08:00'); setFail(true); assert.equal((await syncDueCampusSources({ repository, fetchSource, now })).failed, 1); let state = (await repository.read(SOURCES_KEY)).payload; assert.match(state.sources[0].lastError, /失败/); assert.equal(state.runs.at(-1).status, 'failed'); assert.ok(Date.parse(state.sources[0].nextRunAt) > now().getTime());
  setFail(false); let unblock; const gate = new Promise(resolve => { unblock = resolve; }), slowFetch = async () => { await gate; return fetchSource(); };
  const one = syncCampusSource(created.id, { repository, fetchSource: slowFetch, now }); await new Promise(resolve => setTimeout(resolve, 30)); await assert.rejects(syncCampusSource(created.id, { repository, fetchSource, now }), e => e.status === 409); unblock(); await one;
  state = (await repository.read(SOURCES_KEY)).payload; assert.equal(state.sources[0].runningUntil, ''); assert.equal(state.sources[0].lastError, '');
});
test('来源配置：旧执行身份不能提交，未授权修改和过期revision拒绝', async t => {
  const { call, repository, now } = await fixture(t), source = (await call('/admin/sources', 'admin', 'POST', { name: '可编辑源', url: 'https://campus.example.com/feed', format: 'json' })).body;
  let unblock; const gate = new Promise(resolve => { unblock = resolve; }); const running = syncCampusSource(source.id, { repository, now, fetchSource: async () => { await gate; return { text: JSON.stringify([validEvent()]) }; } }); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await call(`/admin/sources/${source.id}`, 'admin', 'PUT', { revision: 0, name: '管理员改变配置', enabled: false })).status, 200); unblock(); await assert.rejects(running, /身份已更新/); assert.equal((await repository.read(SOURCES_KEY)).payload.drafts.length, 0);
  assert.equal((await call(`/admin/sources/${source.id}`, 'admin', 'DELETE', { revision: 0 })).status, 409); assert.equal((await call(`/admin/sources/${source.id}`, 'admin', 'DELETE', { revision: 1 })).status, 200);
});
