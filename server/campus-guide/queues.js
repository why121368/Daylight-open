import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { guideError, QUEUE_LEVELS, QUEUE_TTL_MINUTES } from '../../shared/campus-guide.js';
import { campusQueueOverview } from '../../shared/campus-dining.js';
import { ACTIVITY_KEY } from './repository.js';
import { isProductionRuntime } from '../runtime-mode.js';
import { recordQueueHistory } from './queue-history.js';

const cookieName = 'daylight-campus-anon';
const moduleSecret = randomBytes(32).toString('hex');
const stamp = value => new Date(value).toISOString();
function anonymousActor(req, res, secret) {
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const cookie = String(req.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  let [id = '', signature = ''] = cookie.split('.');
  const expected = hash(`cookie:${id}`);
  if (!/^[a-f0-9]{48}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    id = randomBytes(24).toString('hex'); signature = hash(`cookie:${id}`);
    res.append('Set-Cookie', `${cookieName}=${id}.${signature}; Path=/api/campus-guide; HttpOnly; SameSite=Lax; Max-Age=2592000${req.secure || isProductionRuntime() ? '; Secure' : ''}`);
  }
  // Raw cookie IDs and IP addresses are never persisted or returned in reports.
  return { actorId: hash(`anonymous:${id}`), ipHash: hash(`anonymous-ip:${req.ip || req.socket.remoteAddress || 'unknown'}`) };
}

export function installQueueRoutes(router, { repository, route, optionalUser, now, anonymousSecret = process.env.DAYLIGHT_JWT_SECRET || moduleSecret }) {
  router.get('/queues', route(async () => { const [catalog, state] = await Promise.all([repository.readCatalog(), repository.read(ACTIVITY_KEY)]); const venues = campusQueueOverview(catalog, state.payload.queueReports, now()); return { reports: venues.filter(row => row.source === 'feedback').map(({ windows, ...row }) => row), venues, levels: QUEUE_LEVELS, ttlMinutes: QUEUE_TTL_MINUTES, allowsAnonymous: true, notice: '反馈30分钟有效；无反馈时标记guess，按餐峰规则估算，并非实时监控。' }; }));
  router.post('/queue-reports', route(async (req, res) => {
    if (req.get('Origin')) { let origin; try { origin = new URL(req.get('Origin')); } catch {} if (!origin || origin.host !== req.get('Host')) throw guideError('请从同源校园页面提交反馈。', 403); }
    const user = await optionalUser(req), { venueId, windowId = '', level } = req.body || {}, catalog = await repository.readCatalog(), venue = catalog.venues.find(row => row.id === venueId);
    if (typeof windowId !== 'string' || !venue || (windowId && !venue.windows.some(window => window.id === windowId)) || !QUEUE_LEVELS.some(row => row.id === level)) throw guideError('请选择有效餐厅、窗口和排队情况。');
    const hash = value => createHmac('sha256', anonymousSecret).update(value).digest('hex'), identity = user ? { actorId: hash(`user:${user.id}`), ipHash: '' } : anonymousActor(req, res, anonymousSecret);
    const instant = now().getTime(), reportedAt = stamp(instant), expiresAt = stamp(instant + QUEUE_TTL_MINUTES * 60000);
    return (await repository.mutate(ACTIVITY_KEY, state => {
      state.queueReports = state.queueReports.filter(report => Date.parse(report.expiresAt) > instant);
      const matchesActor = report => report.actorId === identity.actorId || user && report.userId === user.id;
      const old = state.queueReports.find(report => matchesActor(report) && report.venueId === venueId && (report.windowId || '') === windowId);
      if (old && Date.parse(old.reportedAt) > instant - 60000) throw guideError('同一餐厅或窗口每分钟可更新一次，请稍后再试。', 429);
      state.queueRateLimits = (state.queueRateLimits || []).filter(row => row.at > instant - 10 * 60000);
      if (state.queueRateLimits.filter(row => row.actorId === identity.actorId).length >= 10 || identity.ipHash && state.queueRateLimits.filter(row => row.ipHash === identity.ipHash).length >= 30) throw guideError('排队反馈过于频繁，请稍后再试。', 429);
      if (state.queueReports.length >= 10000 || state.queueRateLimits.length >= 20000) throw guideError('当前反馈较多，请稍后重试。', 429);
      recordQueueHistory(state, { venueId, windowId, level, reportedAt });
      state.queueReports = state.queueReports.filter(report => !(matchesActor(report) && report.venueId === venueId && (report.windowId || '') === windowId));
      state.queueReports.push({ id: randomBytes(16).toString('hex'), venueId, windowId, level, actorId: identity.actorId, ...(user ? { userId: user.id } : { anonymous: true }), reportedAt, expiresAt });
      state.queueRateLimits.push({ actorId: identity.actorId, ipHash: identity.ipHash, at: instant });
      return { venueId, windowId, level, anonymous: !user, reportedAt, expiresAt };
    })).value;
  }));
}
