import { Router, json } from 'express';
import { randomUUID, randomInt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { currentUserFromAuthHeader, isAdminUser } from '../auth.js';
import { guideRepository, CATALOG_KEY, ACTIVITY_KEY, personalKey } from './repository.js';
import { mergeShanghaitechCatalog } from './shanghaitech.js';
import { installCommunityRoutes } from './community.js';
import { installSourceRoutes } from './sources.js';
import { diningAvailability } from '../../shared/campus-dining.js';
import { installQueueRoutes } from './queues.js';
import { installGeometryRoutes } from './geometry.js';
import { registerCampusOperationsRoutes } from './operations.js';
import { installCampusMediaRoutes } from './media.js';
import { GUIDE_COLLECTIONS, PLACE_CATEGORIES, EVENT_CATEGORIES, QUEUE_LEVELS, QUEUE_TTL_MINUTES, guideError, validateCatalog, publicCampusCatalog, withoutDemo, validatePersonal, findRoute, planStops, planDay, dailyItems, calendarExport, queueSummaries, isOpenNow, menuMatches, shanghaiDate, validDate } from '../../shared/campus-guide.js';

const clean = (value, max = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const revision = value => { if (!Number.isSafeInteger(value) || value < 0) throw guideError('请携带最新的数据 revision，刷新后重试。', 409, 'CAMPUS_GUIDE_VERSION_REQUIRED'); return value; };
const stamp = value => new Date(value).toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const publicCatalog = (catalog, admin = false) => { const projected = publicCampusCatalog(catalog, { admin }); return { ...projected, floorPlans: projected.indoorPlans || [], placeCategories: PLACE_CATEGORIES, eventCategories: EVENT_CATEGORIES }; };
const dateRange = (query, now) => { const from = query.from || shanghaiDate(now); if (!validDate(from)) throw guideError('导出开始日期无效。'); const to = query.to || shanghaiDate(new Date(Date.parse(`${from}T12:00:00+08:00`) + 120 * 86400000)); if (!validDate(to) || to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 370 * 86400000) throw guideError('导出日期范围无效，最多 370 天。'); return { from, to }; };
const boolQuery = value => value === 'true' || value === '1';
const adminCollection = value => { const name = value === 'floorPlans' ? 'indoorPlans' : value; if (!GUIDE_COLLECTIONS.includes(name)) throw guideError('目录集合不存在。', 404); return name; };

/** Mount before the mailbox auth/storage middlewares; all protected endpoints authenticate here. */
export function createCampusGuideRouter({ repository = guideRepository, resolveUser = currentUserFromAuthHeader, adminUser = isAdminUser, now = () => new Date(), attachments, mediaAttachments, fetchSource, readOwnedEmail, readOwnedMailboxEmails, readSourceMailboxes, readOperations, readBackups } = {}) {
  const router = Router();
  router.use(json({ limit: '12mb' }));
  const route = handler => async (req, res, next) => { try { const value = await handler(req, res); if (!res.headersSent) res.json(value); } catch (error) { next(error); } };
  async function optionalUser(req) {
    if (req.campusGuideUserResolved) return req.campusGuideUser || null;
    req.campusGuideUserResolved = true;
    try { req.campusGuideUser = await resolveUser(req.get('Authorization')); } catch { req.campusGuideUser = null; }
    return req.campusGuideUser || null;
  }
  async function requireUser(req) { const user = await optionalUser(req); if (!user?.id) throw guideError('请先登录后再保存校园安排。', 401, 'CAMPUS_GUIDE_AUTH_REQUIRED'); return user; }
  async function requireAdmin(req) { const user = await requireUser(req); if (!adminUser(user)) throw guideError('需要管理员权限。', 403, 'CAMPUS_GUIDE_ADMIN_REQUIRED'); return user; }

  router.get('/catalog', route(async () => publicCatalog(await repository.readCatalog())));
  router.post('/route', route(async req => findRoute(await repository.readCatalog(), req.body)));
  router.post('/plan', route(async req => planStops(await repository.readCatalog(), req.body)));
  installQueueRoutes(router, { repository, route, optionalUser, now });
  router.post('/feedback', route(async req => {
    const user = await requireUser(req), input = req.body || {}, kind = clean(input.kind, 30), message = clean(input.message, 5000), catalog = await repository.readCatalog();
    if (!['place', 'event', 'menu', 'route', 'other'].includes(kind) || !message || typeof input.message !== 'string' || input.message.length > 5000) throw guideError('请选择问题类型并填写反馈（最多 5000 字）。');
    const placeId = clean(input.placeId, 100); if (placeId && !catalog.places.some(p => p.id === placeId)) throw guideError('反馈地点不存在。');
    return (await repository.mutate(ACTIVITY_KEY, data => { const instant = now().getTime(); if (data.feedback.filter(f => f.userId === user.id && Date.parse(f.createdAt) > instant - 3600000).length >= 20) throw guideError('反馈过于频繁，请稍后再试。', 429); if (data.feedback.length >= 10000) throw guideError('反馈已达容量，请联系管理员。', 409); const row = { id: randomUUID(), revision: 0, kind, placeId, message, userId: user.id, status: 'open', resolution: '', createdAt: stamp(instant), updatedAt: stamp(instant) }; data.feedback.push(row); return { id: row.id, status: row.status, createdAt: row.createdAt }; })).value;
  }));
  router.get('/me', route(async req => repository.readPersonal((await requireUser(req)).id)));
  router.put('/me', route(async req => {
    const user = await requireUser(req), key = personalKey(user.id), catalog = await repository.readCatalog(), expected = revision(req.body?.revision);
    const result = await repository.mutate(key, personal => { const next = validatePersonal(req.body, catalog, personal); Object.keys(personal).forEach(k => delete personal[k]); Object.assign(personal, next); }, { expectedRevision: expected }); return result.payload;
  }));
  router.get('/me/day', route(async req => {
    const user = await requireUser(req), catalog = await repository.readCatalog(), personal = await repository.readPersonal(user.id);
    return planDay(catalog, personal, req.query.date || shanghaiDate(now()), { avoidRain: boolQuery(req.query.avoidRain), accessible: boolQuery(req.query.accessible), returnHome: boolQuery(req.query.returnHome), mode: req.query.mode || 'all' });
  }));
  router.get('/me/calendar-export', async (req, res, next) => {
    try { const user = await requireUser(req), catalog = await repository.readCatalog(), personal = await repository.readPersonal(user.id), { from, to } = dateRange(req.query, now()), items = [];
      for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += 86400000) items.push(...dailyItems(catalog, personal, new Date(time).toISOString().slice(0, 10)));
      const unique = [...new Map(items.map(item => [item.id, item])).values()]; res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="daylight-campus.ics"'); res.setHeader('Cache-Control', 'private, no-store'); res.send(calendarExport(unique, now()));
    } catch (error) { next(error); }
  });
  router.get('/dining', route(async req => {
    const user = await optionalUser(req), catalog = publicCampusCatalog(await repository.readCatalog()), at = now(), reports = (await repository.read(ACTIVITY_KEY)).payload.menuReports || [];
    const maxPrice = req.query.maxPrice === undefined ? undefined : Number(req.query.maxPrice); if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) throw guideError('最高价格无效。');
    return { venues: catalog.venues.map(v => ({ ...v, ...diningAvailability(v, null, null, at), windows: v.windows.map(w => ({ ...w, ...diningAvailability(v, w, null, at) })) })), menus: catalog.menus.filter(m => menuMatches(m, { query: req.query.q, maxPrice, flavor: req.query.flavor, meal: req.query.meal, at })).map(menu => { const ratings = reports.filter(r => r.menuId === menu.id && r.rating), availability = reports.filter(r => r.menuId === menu.id && typeof r.soldOut === 'boolean' && Date.parse(r.availabilityExpiresAt || r.expiresAt) > at.getTime()).sort((a, b) => Date.parse(b.availabilityReportedAt || b.reportedAt) - Date.parse(a.availabilityReportedAt || a.reportedAt)); const mine = user ? reports.find(r => r.menuId === menu.id && r.userId === user.id) : null; const venue = catalog.venues.find(v => v.id === menu.venueId), window = venue?.windows.find(w => w.id === menu.windowId), soldOut = availability[0]?.soldOut ?? menu.soldOut; return { ...menu, ...diningAvailability(venue, window, { ...menu, soldOut }, at), myRating: mine?.rating ?? null, ratingAverage: ratings.length ? Math.round(ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length * 10) / 10 : null, ratingCount: ratings.length, soldOut: availability[0]?.soldOut ?? menu.soldOut, availabilityReportedAt: availability[0]?.availabilityReportedAt || availability[0]?.reportedAt || '', availabilityExpiresAt: availability[0]?.availabilityExpiresAt || availability[0]?.expiresAt || '' }; }), at: at.toISOString(), availabilityNotice: '售罄反馈有效期 3 小时；评分来自登录用户，不代表官方评价。' };
  }));
  router.post('/menu-reports', route(async req => {
    const user = await requireUser(req), { menuId, rating, soldOut } = req.body || {}, catalog = await repository.readCatalog(), instant = now().getTime();
    if (!catalog.menus.some(m => m.id === menuId) || (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) || (soldOut !== undefined && typeof soldOut !== 'boolean') || (rating === undefined && soldOut === undefined)) throw guideError('请选择菜单并提供 1 至 5 分评分或售罄状态。');
    return (await repository.mutate(ACTIVITY_KEY, state => { state.menuReports ||= []; let report = state.menuReports.find(r => r.userId === user.id && r.menuId === menuId); if (report && Date.parse(report.reportedAt) > instant - 60000) throw guideError('同一菜单每分钟可更新一次。', 429); if (!report) { if (state.menuReports.length >= 30000) throw guideError('菜单反馈已达容量。', 409); report = { id: randomUUID(), userId: user.id, menuId }; state.menuReports.push(report); } if (typeof report.soldOut === 'boolean' && !report.availabilityExpiresAt) { report.availabilityReportedAt = report.reportedAt || stamp(0); report.availabilityExpiresAt = report.expiresAt || (Number.isFinite(Date.parse(report.reportedAt)) ? stamp(Date.parse(report.reportedAt) + 3 * 3600000) : stamp(0)); } if (rating !== undefined) report.rating = rating; if (soldOut !== undefined) { report.soldOut = soldOut; report.availabilityReportedAt = stamp(instant); report.availabilityExpiresAt = stamp(instant + 3 * 3600000); } report.reportedAt = stamp(instant); report.expiresAt = stamp(instant + 3 * 3600000); return { menuId, rating: report.rating ?? null, soldOut: report.soldOut ?? null, reportedAt: report.reportedAt, expiresAt: report.expiresAt }; })).value;
  }));

  router.get('/admin/catalog', route(async req => { await requireAdmin(req); return publicCatalog(await repository.readCatalog(), true); }));
  router.put('/admin/catalog', route(async req => {
    await requireAdmin(req); const catalog = validateCatalog(req.body), expected = revision(req.body?.meta?.revision);
    return publicCatalog((await repository.mutate(CATALOG_KEY, data => { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, catalog); }, { expectedRevision: expected })).payload, true);
  }));
  router.get('/admin/export', route(async req => { await requireAdmin(req); return publicCatalog(await repository.readCatalog(), true); }));
  router.post('/admin/import-shanghaitech', route(async req => {
    await requireAdmin(req); const expected = revision(req.body?.revision);
    const result = await repository.mutate(CATALOG_KEY, data => {
      const merged = mergeShanghaitechCatalog(data);
      Object.assign(data, merged.catalog);
      return { added: merged.added, retained: merged.retained };
    }, { expectedRevision: expected });
    return { catalog: publicCatalog(result.payload, true), ...result.value };
  }));
  router.post('/admin/import', route(async req => {
    await requireAdmin(req); const source = req.body?.catalog || req.body, catalog = validateCatalog(source), expected = revision(req.body?.expectedRevision ?? source.meta.revision);
    return publicCatalog((await repository.mutate(CATALOG_KEY, data => { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, catalog); }, { expectedRevision: expected })).payload, true);
  }));
  router.post('/admin/clear-demo', route(async req => {
    await requireAdmin(req); const expected = revision(req.body?.revision ?? req.body?.expectedRevision);
    const result = await repository.mutate(CATALOG_KEY, data => { const next = withoutDemo(data); Object.keys(data).forEach(k => delete data[k]); Object.assign(data, next); }, { expectedRevision: expected });
    return publicCatalog(result.payload, true);
  }));
  // Fine-grained maintenance still validates the whole graph, preventing dangling references.
  router.post('/admin/catalog/:collection', route(async req => {
    await requireAdmin(req); const collection = adminCollection(req.params.collection), item = req.body?.item || req.body?.data, expected = revision(req.body?.revision);
    return publicCatalog((await repository.mutate(CATALOG_KEY, data => { data[collection].push(item); const next = validateCatalog(data); Object.assign(data, next); }, { expectedRevision: expected })).payload, true);
  }));
  router.put('/admin/catalog/:collection/:id', route(async req => {
    await requireAdmin(req); const collection = adminCollection(req.params.collection), item = req.body?.item || req.body?.data, expected = revision(req.body?.revision);
    return publicCatalog((await repository.mutate(CATALOG_KEY, data => { const index = data[collection].findIndex(row => row.id === req.params.id); if (index < 0) throw guideError('资料不存在。', 404); data[collection][index] = { ...item, id: req.params.id }; Object.assign(data, validateCatalog(data)); }, { expectedRevision: expected })).payload, true);
  }));
  router.delete('/admin/catalog/:collection/:id', route(async req => {
    await requireAdmin(req); const collection = adminCollection(req.params.collection), expected = revision(req.body?.revision);
    return publicCatalog((await repository.mutate(CATALOG_KEY, data => { const index = data[collection].findIndex(row => row.id === req.params.id); if (index < 0) throw guideError('资料不存在。', 404); data[collection].splice(index, 1); Object.assign(data, validateCatalog(data)); }, { expectedRevision: expected })).payload, true);
  }));
  router.get('/admin/feedback', route(async req => { await requireAdmin(req); const state = (await repository.read(ACTIVITY_KEY)).payload; return { feedback: [...state.feedback].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), revision: state.revision }; }));
  router.get('/admin/feedback/:id', route(async req => { await requireAdmin(req); const row = (await repository.read(ACTIVITY_KEY)).payload.feedback.find(f => f.id === req.params.id); if (!row) throw guideError('反馈不存在。', 404); return row; }));
  router.patch('/admin/feedback/:id', route(async req => {
    await requireAdmin(req); if (!['open', 'resolved', 'dismissed'].includes(req.body?.status)) throw guideError('处理状态无效。'); const expected = revision(req.body?.revision);
    return (await repository.mutate(ACTIVITY_KEY, state => { const row = state.feedback.find(f => f.id === req.params.id); if (!row) throw guideError('反馈不存在。', 404); if (row.revision !== expected) throw guideError('反馈已更新，请刷新后重试。', 409); row.status = req.body.status; row.resolution = clean(req.body.resolution, 3000); row.revision++; row.updatedAt = now().toISOString(); return { ...row }; })).value;
  }));

  router.post('/admin/events/:id/checkin-code', route(async req => {
    await requireAdmin(req); const catalog = await repository.readCatalog(), event = catalog.events.find(e => e.id === req.params.id && e.status === 'published'); if (!event) throw guideError('活动不存在。', 404);
    const code = String(randomInt(0, 1000000)).padStart(6, '0'), salt = randomBytes(16).toString('hex'), issuedAt = now().toISOString(), expiresAt = stamp(now().getTime() + 5 * 60000);
    await repository.mutate(ACTIVITY_KEY, state => { state.checkinCodes ||= {}; state.checkinCodes[event.id] = { salt, hash: digest(`${salt}:${code}`), issuedAt, expiresAt }; });
    return { code, expiresAt, checkinStartsAt: stamp(Date.parse(event.start) - 30 * 60000), checkinEndsAt: stamp(Date.parse(event.end) + 30 * 60000), notice: '主办方动态码核验，不验证 GPS 位置。请仅向现场参加者展示。' };
  }));
  router.post('/events/:id/checkin', route(async req => {
    const user = await requireUser(req), catalog = await repository.readCatalog(), event = catalog.events.find(e => e.id === req.params.id && e.status === 'published'); if (!event) throw guideError('活动不存在。', 404);
    const instant = now().getTime(), key = personalKey(user.id), attemptKey = digest(`${user.id}\0${event.id}`), submittedCode = typeof req.body?.code === 'string' ? req.body.code : '';
    const result = await repository.mutateMany([ACTIVITY_KEY, key], drafts => {
      const state = drafts.get(ACTIVITY_KEY), personal = drafts.get(key); personal.checkins ||= []; state.checkinCodes ||= {}; state.checkinAttempts ||= {};
      const existing = personal.checkins.find(c => c.eventId === event.id); if (existing) return { checkin: existing, alreadyCheckedIn: true };
      if (!personal.registrations.includes(event.id)) return { error: '请先保存参加意向后再签到。', status: 409 };
      if (instant < Date.parse(event.start) - 30 * 60000 || instant > Date.parse(event.end) + 30 * 60000) return { error: '当前不在签到时间内（开始前 30 分钟至结束后 30 分钟）。', status: 409 };
      for (const [id, attempt] of Object.entries(state.checkinAttempts)) if (instant - attempt.startedAt >= 5 * 60000) delete state.checkinAttempts[id];
      const attempt = state.checkinAttempts[attemptKey] ||= { startedAt: instant, failures: 0 };
      if (attempt.failures >= 5) return { error: '签到码尝试过多，请 5 分钟后再试。', status: 429 };
      const grant = state.checkinCodes[event.id];
      const expectedHash = Buffer.from(grant?.hash || digest('missing'), 'hex'), actualHash = Buffer.from(digest(`${grant?.salt || ''}:${submittedCode}`), 'hex');
      const accepted = /^\d{6}$/.test(submittedCode) && grant && Date.parse(grant.expiresAt) > instant && timingSafeEqual(expectedHash, actualHash);
      if (!accepted) { attempt.failures++; return { error: '签到码错误或已过期，请向主办方获取最新动态码。', status: 400 }; }
      const checkin = { eventId: event.id, checkedAt: stamp(instant), method: 'organizer_code' }; personal.checkins.push(checkin); state.checkinCount = (Number(state.checkinCount) || 0) + 1; delete state.checkinAttempts[attemptKey]; return { checkin, alreadyCheckedIn: false };
    });
    if (result.value.error) throw guideError(result.value.error, result.value.status, 'CAMPUS_GUIDE_CHECKIN_FAILED'); return result.value;
  }));

  installCommunityRoutes(router, { repository, route, requireUser, optionalUser, requireAdmin, now, isAdminUser: adminUser, attachments });
  installSourceRoutes(router, { repository, route, requireAdmin, now, fetchSource, readOwnedEmail, readOwnedMailboxEmails, readSourceMailboxes });
  installGeometryRoutes(router, { repository, route, requireAdmin, now, readOperations });
  registerCampusOperationsRoutes(router, { route, requireAdmin, now, readOperations, readBackups });
  installCampusMediaRoutes(router, { repository, route, requireAdmin, optionalUser, isAdminUser: adminUser, now, attachments: mediaAttachments });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : [400, 401, 403, 404, 409, 413, 422, 429, 502, 503, 504].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: status >= 500 && !error.code?.startsWith('CAMPUS_GUIDE_') ? '校园服务暂时不可用，请稍后重试。' : error.type === 'entity.too.large' ? '上传内容过大。' : error.type === 'entity.parse.failed' ? 'JSON 格式无效。' : error.message, code: error.code || 'CAMPUS_GUIDE_REQUEST_FAILED' });
  });
  return router;
}
export const campusGuideRouter = createCampusGuideRouter();
