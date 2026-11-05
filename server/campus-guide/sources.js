import { createHash, randomUUID } from 'node:crypto';
import { guideError, validateCatalog, validateEventEnglishContent, EVENT_CATEGORIES } from '../../shared/campus-guide.js';
import { guideRepository, SOURCES_KEY, CATALOG_KEY } from './repository.js';
import { sourceUrl, fetchCampusSource } from './source-fetch.js';
import { runWithRequestContext } from '../request-context.js';
import { withStorageSnapshot } from '../storage/index.js';
import { readSettings, readStore } from '../store.js';
import { postgresMode } from '../infra/postgres.js';
import { isProductionRuntime } from '../runtime-mode.js';
import { parseCampusHtml } from './source-html.js';
import { findUserById } from '../infra/postgres.js';
import { isAdminUser } from '../auth.js';
import { inspectShareUrl } from '../../shared/public-url.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const clean = (value, max = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const fail = message => { throw guideError(message); };
const revision = value => { if (!Number.isSafeInteger(value) || value < 0) throw guideError('请携带最新 revision。', 409); return value; };
const xmlText = value => clean(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&(?:lt|gt|quot|apos|amp);/g, entity => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' })[entity]), 15000);
const matchTag = (block, tag) => { const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i').exec(block)?.[1] || ''; };
// Untrusted feed links are optional public metadata, never credentials to republish.
const candidateLink = value => { if (!value) return ''; const checked = inspectShareUrl(value); return checked.valid ? checked.url : ''; };
function checkPublishLinks(event) {
  for (const key of ['sourceUrl', 'registrationUrl', 'imageUrl']) if (event?.[key] && !inspectShareUrl(event[key]).valid) throw guideError('公开活动链接不能包含登录令牌、私密订阅或签名凭据。请使用公开网页地址。');
}
function candidate(raw, source, sourceKey) {
  const id = `feed-${hash(`${source.id}\0${sourceKey}`).slice(0, 32)}`;
  const event = { id, title: clean(raw.title || raw.name || raw.summary, 120), englishTitle: clean(raw.englishTitle, 300), ...validateEventEnglishContent(raw), speaker: clean(raw.speaker, 500), room: clean(raw.room, 100), locationText: clean(raw.locationText || raw.location, 500), allDay: raw.allDay === true, sortOrder: Number.isFinite(raw.sortOrder) ? raw.sortOrder : 0, summary: clean(raw.summary || raw.description, 1000), description: clean(raw.description || raw.body, 15000), category: EVENT_CATEGORIES.some(category => category.id === raw.category) ? raw.category : 'academic', placeId: clean(raw.placeId, 100), start: clean(raw.start, 60), end: clean(raw.end, 60), registrationDeadline: clean(raw.registrationDeadline, 60), organizer: clean(raw.organizer, 300), registrationUrl: candidateLink(clean(raw.registrationUrl, 2000)), status: raw.status === 'cancelled' ? 'cancelled' : 'published', tags: Array.isArray(raw.tags) ? raw.tags.filter(v => typeof v === 'string').map(v => clean(v, 100)).slice(0, 40) : [], sourceId: source.id, sourceKind: source.format, sourceUrl: candidateLink(clean(raw.sourceUrl || raw.url || source.url, 2000)), isDemo: false, pinned: false, hidden: false, manualOverride: true };
  if (!event.title) fail('来源含缺少标题的活动，未导入。');
  return { sourceKey, event, title: event.title, sourceLocation: clean(raw.location, 500) };
}
const keyFor = raw => clean(raw.uid || raw.id || raw.guid || raw.url || raw.sourceUrl, 1000) || hash(`${raw.title || raw.summary}\0${raw.start || ''}`);
const calendarText = value => value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
function icsTime(value, params) {
  if (!value) return '';
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return '';
  if (!match[7] && !/(?:^|;)TZID=(?:Asia\/Shanghai|Asia\/Chongqing|Etc\/GMT-8)(?:;|$)/i.test(params)) return '';
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? 'Z' : '+08:00'}`;
}

/** Only stable feeds. Publication dates are never guessed to be activity start times. */
export function parseCampusFeed(text, source) {
  let entries;
  if (source.format === 'html') {
    entries = parseCampusHtml(text, source).map(raw => candidate(raw, source, keyFor(raw)));
  } else if (source.format === 'json') {
    let parsed; try { parsed = JSON.parse(text); } catch { fail('来源返回的 JSON 无效。'); }
    const rows = Array.isArray(parsed) ? parsed : parsed?.events; if (!Array.isArray(rows) || rows.length > 500) fail('JSON 来源应是最多 500 项活动数组，或 {"events":[...]}。');
    entries = rows.map(raw => { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('JSON 活动格式无效。'); return candidate(raw, source, keyFor(raw)); });
  } else if (source.format === 'rss') {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('RSS 不允许 DTD 或外部实体。');
    const blocks = [...text.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)]; if (blocks.length > 500) fail('RSS 超过 500 项限制。');
    if (!/<(?:rss|feed)(?:\s|>)/i.test(text)) fail('来源不是 RSS/Atom 文档。');
    entries = blocks.map(([, , block]) => {
      const link = xmlText(matchTag(block, 'link')) || /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i.exec(block)?.[1] || '';
      const raw = { uid: xmlText(matchTag(block, 'guid') || matchTag(block, 'id')), title: xmlText(matchTag(block, 'title')), description: xmlText(matchTag(block, 'description') || matchTag(block, 'content') || matchTag(block, 'summary')), url: link, start: xmlText(matchTag(block, 'event:start') || matchTag(block, 'dtstart')), end: xmlText(matchTag(block, 'event:end') || matchTag(block, 'dtend')), location: xmlText(matchTag(block, 'event:location') || matchTag(block, 'location')) };
      return candidate(raw, source, keyFor(raw));
    });
  } else if (source.format === 'ics') {
    const unfolded = text.replace(/\r?\n[ \t]/g, ''); if (!/^BEGIN:VCALENDAR\s*$/im.test(unfolded)) fail('来源不是 iCalendar 文档。');
    const events = [...unfolded.matchAll(/^BEGIN:VEVENT\r?\n([\s\S]*?)^END:VEVENT\s*$/gm)]; if (events.length > 500) fail('ICS 超过 500 项限制。');
    entries = events.map(([, block]) => {
      const fields = new Map(); for (const line of block.split(/\r?\n/)) { const colon = line.indexOf(':'); if (colon < 0) continue; const left = line.slice(0, colon), key = left.split(';')[0].toUpperCase(); if (!fields.has(key)) fields.set(key, { params: left.slice(key.length), value: line.slice(colon + 1) }); }
      const get = name => calendarText(fields.get(name)?.value || '');
      const raw = { uid: get('UID'), title: get('SUMMARY'), description: get('DESCRIPTION'), start: icsTime(fields.get('DTSTART')?.value, fields.get('DTSTART')?.params || ''), end: icsTime(fields.get('DTEND')?.value, fields.get('DTEND')?.params || ''), location: get('LOCATION'), url: get('URL'), status: get('STATUS').toUpperCase() === 'CANCELLED' ? 'cancelled' : 'published' };
      return candidate(raw, source, keyFor(raw));
    });
  } else fail('公开来源格式仅支持 JSON、RSS、ICS 或 HTML。');
  const seen = new Set(); return entries.filter(entry => { if (seen.has(entry.sourceKey)) return false; seen.add(entry.sourceKey); return true; });
}
function needsDetails(event, catalog) { try { validateCatalog({ ...catalog, events: [event] }); return false; } catch { return true; } }
export function validateSource(input, previous = {}) {
  if (!input || typeof input !== 'object') fail('来源配置无效。'); const name = clean(input.name ?? previous.name, 120); if (!name) fail('请填写来源名称。');
  const format = input.format ?? previous.format; if (!['json', 'rss', 'ics', 'html', 'mailbox'].includes(format)) fail('来源格式仅支持 JSON、RSS、ICS、HTML 或已入库自有邮箱。');
  const parsed = format === 'mailbox' ? null : sourceUrl(input.url ?? previous.url);
  const mailboxId = format === 'mailbox' ? clean(input.mailboxId ?? previous.mailboxId, 128) : ''; if (format === 'mailbox' && !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(mailboxId)) fail('请选择自有已入库邮箱。');
  const keywords = input.keywords ?? previous.keywords ?? ['活动', '讲座', '学术', '报告', 'seminar', 'lecture', 'workshop']; if (!Array.isArray(keywords) || keywords.length > 30 || keywords.some(value => typeof value !== 'string' || !value.trim() || value.length > 100)) fail('来源关键词应为最多30个非空短语。');
  const scanLimit = input.scanLimit ?? previous.scanLimit ?? 100; if (!Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 500) fail('邮箱扫描范围应为1至500封。');
  const intervalMinutes = input.intervalMinutes ?? previous.intervalMinutes ?? 60; if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 10080) fail('同步间隔应为 15 至 10080 分钟。');
  const enabled = input.enabled ?? previous.enabled ?? false; if (typeof enabled !== 'boolean') fail('来源启用状态无效。');
  return { name, url: parsed?.href || '', format, mailboxId, keywords: [...new Set(keywords.map(value => value.trim()))], scanLimit, intervalMinutes, enabled };
}

export async function syncCampusSource(sourceId, { repository = guideRepository, fetchSource = fetchCampusSource, now = () => new Date(), scheduled = false, readMailboxSource = storedMailboxSource } = {}) {
  const runId = randomUUID(), startedAt = now().toISOString();
  const claim = await repository.mutate(SOURCES_KEY, state => {
    const source = state.sources.find(s => s.id === sourceId); if (!source) throw guideError('来源不存在。', 404);
    const instant = now().getTime(); if (scheduled && (!source.enabled || Date.parse(source.nextRunAt || '') > instant)) return null;
    if (Date.parse(source.runningUntil || '') > instant) { if (scheduled) return null; throw guideError('该来源正在同步，请稍后查看结果。', 409); }
    for (const stale of state.runs.filter(r => r.sourceId === sourceId && r.status === 'running')) { stale.status = 'failed'; stale.error = '此前执行超过租约，已恢复重试。'; stale.finishedAt = startedAt; }
    const run = { id: runId, sourceId, status: 'running', startedAt, finishedAt: '', items: 0, draftsAdded: 0, changed: 0, unchanged: 0, error: '', scheduled };
    source.runningUntil = new Date(instant + 60000).toISOString(); source.runId = runId; source.lastRunAt = startedAt; state.runs.push(run); state.runs = state.runs.slice(-200); return { ...source };
  });
  const source = claim.value; if (!source) return { skipped: true };
  try {
    let entries;
    if (source.format === 'mailbox') { const emails = await readMailboxSource(source); entries = emails.slice(0, source.scanLimit || 100).filter(email => !source.keywords?.length || source.keywords.some(keyword => `${email.subject || ''} ${email.body || email.summary || ''}`.toLowerCase().includes(keyword.toLowerCase()))).map(email => { const key = hash(`${source.ownerUserId}\0${source.mailboxId}\0${email.id}`); return candidate({ uid: key, title: email.subject || '待核对校园邮件', description: email.body || email.summary || '' }, source, key); }); }
    else { const response = await fetchSource(source.url); entries = parseCampusFeed(response.text, source); }
    const catalog = await repository.readCatalog();
    const result = await repository.mutate(SOURCES_KEY, state => {
      const current = state.sources.find(s => s.id === sourceId), run = state.runs.find(r => r.id === runId); if (!current || current.runId !== runId || !run || run.status !== 'running') throw guideError('来源配置或执行身份已更新，本次抓取未提交。', 409);
      let added = 0, changed = 0, unchanged = 0;
      for (const entry of entries) {
        const contentHash = hash(JSON.stringify({ event: entry.event, sourceLocation: entry.sourceLocation }));
        const previous = [...state.drafts].reverse().find(d => d.sourceId === sourceId && d.sourceKey === entry.sourceKey);
        if (previous?.contentHash === contentHash) { unchanged++; continue; }
        if (previous?.status === 'pending') { previous.status = 'superseded'; previous.updatedAt = now().toISOString(); previous.revision++; }
        const draft = { id: randomUUID(), revision: 0, sourceId, sourceKey: entry.sourceKey, title: entry.title, event: entry.event, ownerUserId: source.format === 'mailbox' ? source.ownerUserId : '', sourceLocation: entry.sourceLocation, contentHash, status: 'pending', needsDetails: needsDetails(entry.event, catalog), publishedEventId: previous?.publishedEventId || '', createdAt: now().toISOString(), updatedAt: now().toISOString(), notes: source.format === 'mailbox' ? '从本人已入库邮箱按启用的关键词规则生成，仅本人审核区可见；发布前去除私人信息并补齐活动字段。' : previous ? '来源发生变化；已发布内容保持原样，需再次人工核对后发布。' : '来源内容尚未公开。请核对日期、校园地点与授权后发布。' };
        if (state.drafts.length >= 10000) throw guideError('待审核资料已达容量，请先处理历史草案。', 409);
        state.drafts.push(draft); added++; if (previous) changed++;
      }
      Object.assign(run, { status: 'succeeded', finishedAt: now().toISOString(), items: entries.length, draftsAdded: added, changed, unchanged });
      current.runningUntil = ''; current.runId = ''; current.lastSuccessAt = now().toISOString(); current.lastError = ''; current.failureCount = 0; current.nextRunAt = new Date(now().getTime() + current.intervalMinutes * 60000).toISOString();
      return { run: { ...run }, draftsAdded: added, changed, unchanged };
    }); return result.value;
  } catch (error) {
    const safeError = error.status ? clean(error.message, 500) : '来源读取或解析失败，请核对格式与公开链接。';
    await repository.mutate(SOURCES_KEY, state => { const current = state.sources.find(s => s.id === sourceId), run = state.runs.find(r => r.id === runId); if (!current || current.runId !== runId) return; if (run) Object.assign(run, { status: 'failed', finishedAt: now().toISOString(), error: safeError }); current.lastError = safeError; current.runningUntil = ''; current.runId = ''; current.failureCount = (current.failureCount || 0) + 1; current.nextRunAt = new Date(now().getTime() + Math.min(10080, current.intervalMinutes * Math.min(8, 2 ** (current.failureCount - 1))) * 60000).toISOString(); });
    throw guideError(safeError, error.status || 502, 'CAMPUS_GUIDE_SOURCE_FAILED');
  }
}

/** Scheduler entry: at most three administrator-enabled feeds per minute, leased in PG. */
export async function syncDueCampusSources(options = {}) {
  const repository = options.repository || guideRepository, now = options.now || (() => new Date()), state = (await repository.read(SOURCES_KEY)).payload;
  const due = state.sources.filter(s => s.enabled && !(Date.parse(s.nextRunAt || '') > now().getTime()) && !(Date.parse(s.runningUntil || '') > now().getTime())).slice(0, 3), result = { due: due.length, succeeded: 0, failed: 0, skipped: 0 };
  for (const source of due) try { const sync = await syncCampusSource(source.id, { ...options, repository, now, scheduled: true }); if (sync.skipped) result.skipped++; else result.succeeded++; } catch { result.failed++; }
  return result;
}

/** An explicit selection of one already-stored, owned email. Never fetches IMAP or a model. */
export async function ownedEmailForDraft(user, mailboxId, emailId) {
  if (typeof mailboxId !== 'string' || typeof emailId !== 'string' || mailboxId.length > 128 || emailId.length > 1000) fail('请选择自有邮箱与一封已入库邮件。');
  const read = () => {
    const settings = readSettings(), mailbox = settings.mailboxes.find(m => m.id === mailboxId && (m.ownerUserId || m.userId) === user.id); if (!mailbox) throw guideError('邮箱不存在或无权访问。', 404);
    const email = readStore(mailboxId).emails.find(e => e.id === emailId); if (!email) throw guideError('邮件尚未入库或无权访问。', 404);
    return { id: email.id, mailboxId, subject: clean(email.subject, 120), body: clean(email.body || email.summary, 15000), receivedAt: email.receivedAt || '', sender: clean(email.sender, 300) };
  };
  if (isProductionRuntime() || postgresMode() === 'postgres') return withStorageSnapshot({ userId: user.id, user, mailboxId }, read);
  return runWithRequestContext({ userId: user.id, user }, read);
}

/** Only the stored mailbox snapshot is read. This never establishes an IMAP connection. */
export async function ownedMailboxEmailsForSource(user, mailboxId, { limit = 100 } = {}) {
  const read = () => {
    const mailbox = readSettings().mailboxes.find(row => row.id === mailboxId && (row.ownerUserId || row.userId) === user.id);
    if (!mailbox) throw guideError('邮箱不存在或无权访问。', 404);
    if (!limit) return [];
    return [...readStore(mailboxId).emails].filter(email => !String(email.id).startsWith('demo')).sort((a, b) => Date.parse(b.receivedAt || 0) - Date.parse(a.receivedAt || 0)).slice(0, limit).map(email => ({ id: email.id, subject: clean(email.subject, 120), body: clean(email.body || email.summary, 15000), receivedAt: email.receivedAt || '' }));
  };
  if (isProductionRuntime() || postgresMode() === 'postgres') return withStorageSnapshot({ userId: user.id, user, mailboxId }, read);
  return runWithRequestContext({ userId: user.id, user }, read);
}
export async function ownedSourceMailboxes(user) {
  const read = () => readSettings().mailboxes.filter(row => (row.ownerUserId || row.userId) === user.id).map(row => ({ id: row.id, email: row.email }));
  if (isProductionRuntime() || postgresMode() === 'postgres') return withStorageSnapshot({ userId: user.id, user }, read);
  return runWithRequestContext({ userId: user.id, user }, read);
}
export async function storedMailboxSource(source) {
  const user = source.ownerUserId ? await findUserById(source.ownerUserId) : null;
  if (!user || !isAdminUser(user)) throw guideError('邮箱来源所有者已失效或不再具备管理权限。', 403);
  return ownedMailboxEmailsForSource(user, source.mailboxId, { limit: source.scanLimit || 100 });
}
const privateOwner = row => row.ownerUserId || (row.sourceId === 'selected-email' ? row.selectedBy : '') || '';
const visibleTo = (row, user) => !privateOwner(row) || privateOwner(row) === user.id;
const checkOwner = (row, user) => { if (!visibleTo(row, user)) throw guideError('自有邮箱来源或审核稿不存在或无权访问。', 404); };
const sameSource = (row, config, user) => config.format === 'mailbox' ? row.format === 'mailbox' && row.mailboxId === config.mailboxId && row.ownerUserId === user.id : row.format !== 'mailbox' && row.url === config.url;

export function installSourceRoutes(router, { repository, route, requireAdmin, now, fetchSource, readOwnedEmail = ownedEmailForDraft, readOwnedMailboxEmails = ownedMailboxEmailsForSource, readSourceMailboxes = ownedSourceMailboxes }) {
  router.get('/sources', route(async () => ({ sources: (await repository.read(SOURCES_KEY)).payload.sources.filter(s => s.enabled && s.format !== 'mailbox').map(s => ({ id: s.id, name: s.name, format: s.format, lastSuccessAt: s.lastSuccessAt || '' })) })));
  router.get('/admin/source-mailboxes', route(async req => ({ mailboxes: await readSourceMailboxes(await requireAdmin(req)) })));
  router.get('/admin/sources', route(async req => { const user = await requireAdmin(req), state = (await repository.read(SOURCES_KEY)).payload, sources = state.sources.filter(row => visibleTo(row, user)), ids = new Set(sources.map(row => row.id)); return { ...state, sources, drafts: state.drafts.filter(row => visibleTo(row, user)), runs: state.runs.filter(row => ids.has(row.sourceId)) }; }));
  router.post('/admin/sources', route(async req => {
    const user = await requireAdmin(req), config = validateSource(req.body); if (config.format === 'mailbox') await readOwnedMailboxEmails(user, config.mailboxId, { limit: 0 }); return (await repository.mutate(SOURCES_KEY, state => { if (state.sources.length >= 50) fail('最多添加 50 个数据源。'); if (state.sources.some(row => sameSource(row, config, user))) throw guideError('该来源已存在。', 409); const source = { id: randomUUID(), revision: 0, ...config, ownerUserId: config.format === 'mailbox' ? user.id : '', createdAt: now().toISOString(), updatedAt: now().toISOString(), lastRunAt: '', lastSuccessAt: '', nextRunAt: config.enabled ? now().toISOString() : '', lastError: '', runningUntil: '', runId: '', failureCount: 0 }; state.sources.push(source); return source; })).value;
  }));
  router.put('/admin/sources/:id', route(async req => {
    const user = await requireAdmin(req), expected = revision(req.body?.revision), previous = (await repository.read(SOURCES_KEY)).payload.sources.find(row => row.id === req.params.id); if (!previous) throw guideError('来源不存在。', 404); checkOwner(previous, user); const config = validateSource(req.body, previous); if (config.format === 'mailbox') await readOwnedMailboxEmails(user, config.mailboxId, { limit: 0 }); return (await repository.mutate(SOURCES_KEY, state => { const source = state.sources.find(s => s.id === req.params.id); if (!source) throw guideError('来源不存在。', 404); checkOwner(source, user); if (source.revision !== expected) throw guideError('来源已更新，请刷新。', 409); if (state.sources.some(row => row.id !== source.id && sameSource(row, config, user))) throw guideError('该来源已存在。', 409); Object.assign(source, config, { ownerUserId: config.format === 'mailbox' ? user.id : '' }, { revision: source.revision + 1, updatedAt: now().toISOString(), nextRunAt: config.enabled ? now().toISOString() : '', runningUntil: '', runId: '' }); for (const run of state.runs.filter(r => r.sourceId === source.id && r.status === 'running')) Object.assign(run, { status: 'failed', error: '管理员更新来源配置，中止此前执行。', finishedAt: now().toISOString() }); return source; })).value;
  }));
  router.delete('/admin/sources/:id', route(async req => { const user = await requireAdmin(req), expected = revision(req.body?.revision); return (await repository.mutate(SOURCES_KEY, state => { const index = state.sources.findIndex(s => s.id === req.params.id); if (index < 0) throw guideError('来源不存在。', 404); checkOwner(state.sources[index], user); if (state.sources[index].revision !== expected) throw guideError('来源已更新，请刷新。', 409); state.sources.splice(index, 1); return { deleted: true, notice: '已停止此来源后续同步，已有草案与已发布活动保留。' }; })).value; }));
  router.post('/admin/sources/:id/sync', route(async req => { const user = await requireAdmin(req), source = (await repository.read(SOURCES_KEY)).payload.sources.find(row => row.id === req.params.id); if (!source) throw guideError('来源不存在。', 404); checkOwner(source, user); return syncCampusSource(req.params.id, { repository, now, fetchSource, readMailboxSource: row => readOwnedMailboxEmails(user, row.mailboxId, { limit: row.scanLimit || 100 }) }); }));
  router.patch('/admin/drafts/:id', route(async req => {
    const user = await requireAdmin(req), expected = revision(req.body?.revision), catalog = await repository.readCatalog(); checkPublishLinks(req.body?.event);
    return (await repository.mutate(SOURCES_KEY, state => { const draft = state.drafts.find(d => d.id === req.params.id); if (!draft || draft.status !== 'pending') throw guideError('待审核草案不存在或已处理。', 404); checkOwner(draft, user); if (draft.revision !== expected) throw guideError('草案已更新，请刷新。', 409); const event = validateCatalog({ ...catalog, events: [{ ...req.body.event, id: draft.event.id, sourceId: draft.sourceId, sourceKind: draft.event.sourceKind, manualOverride: true, isDemo: false }] }).events[0]; draft.event = event; draft.title = event.title; draft.needsDetails = false; draft.revision++; draft.updatedAt = now().toISOString(); return draft; })).value;
  }));
  router.post('/admin/drafts/:id/reject', route(async req => { const user = await requireAdmin(req), expected = revision(req.body?.revision); return (await repository.mutate(SOURCES_KEY, state => { const draft = state.drafts.find(d => d.id === req.params.id && d.status === 'pending'); if (!draft) throw guideError('草案不存在或已处理。', 404); checkOwner(draft, user); if (draft.revision !== expected) throw guideError('草案已更新，请刷新。', 409); draft.status = 'rejected'; draft.notes = clean(req.body.note, 3000); draft.revision++; draft.updatedAt = now().toISOString(); return draft; })).value; }));
  router.post('/admin/drafts/:id/publish', route(async req => {
    const user = await requireAdmin(req), expected = revision(req.body?.revision), catalogRevision = revision(req.body?.catalogRevision);
    const result = await repository.mutateMany([SOURCES_KEY, CATALOG_KEY], drafts => {
      const state = drafts.get(SOURCES_KEY), catalog = drafts.get(CATALOG_KEY), draft = state.drafts.find(d => d.id === req.params.id); if (!draft) throw guideError('草案不存在。', 404); checkOwner(draft, user); if (draft.status === 'published') return { draft, alreadyPublished: true }; if (draft.status !== 'pending' || draft.revision !== expected) throw guideError('草案已处理或更新，请刷新。', 409);
      // Publishing is the sole boundary at which selected private source text may become public.
      const input = { ...(req.body.event || draft.event), id: draft.event.id, sourceId: draft.sourceId, sourceKind: draft.event.sourceKind, sourceUpdatedAt: now().toISOString(), manualOverride: true, isDemo: false }; checkPublishLinks(input);
      const event = validateCatalog({ ...catalog, events: [input] }).events[0];
      const index = catalog.events.findIndex(e => e.id === event.id); if (index >= 0) catalog.events[index] = event; else catalog.events.push(event);
      Object.assign(catalog, validateCatalog(catalog)); draft.status = 'published'; draft.event = event; draft.publishedEventId = event.id; draft.publishedAt = now().toISOString(); draft.publishedBy = user.id; draft.revision++; draft.updatedAt = now().toISOString(); return { draft, event, alreadyPublished: false };
    }, { expected: { [CATALOG_KEY]: catalogRevision } }); return { ...result.value, catalogRevision: result.documents.get(CATALOG_KEY).version };
  }));
  router.post('/admin/sources/email-draft', route(async req => {
    const user = await requireAdmin(req), email = await readOwnedEmail(user, req.body?.mailboxId, req.body?.emailId), sourceKey = hash(`${user.id}\0${email.mailboxId}\0${email.id}`), source = { id: 'selected-email', format: 'email', url: '' };
    return (await repository.mutate(SOURCES_KEY, state => { const prior = state.drafts.find(d => d.sourceId === 'selected-email' && d.sourceKey === sourceKey && ['pending', 'published'].includes(d.status)); if (prior) return { draft: prior, duplicate: true }; const entry = candidate({ title: email.subject, description: email.body }, source, sourceKey), draft = { id: randomUUID(), revision: 0, sourceId: source.id, sourceKey, title: entry.title, event: entry.event, sourceLocation: '', contentHash: hash(JSON.stringify(entry.event)), status: 'pending', needsDetails: true, publishedEventId: '', createdAt: now().toISOString(), updatedAt: now().toISOString(), notes: '管理员从自己已入库的单封邮件手动选择。内容仅在私有审核区；发布前请去除私人信息并补全公开活动字段。', selectedBy: user.id }; if (state.drafts.length >= 10000) fail('草案已达容量。'); state.drafts.push(draft); return { draft, duplicate: false }; })).value;
  }));
}
