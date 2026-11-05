import { QUEUE_LEVELS, isOpenNow } from './campus-guide.js';

const clockMinutes = at => { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)).split(':').map(Number); return parts[0] * 60 + parts[1]; };
const closedNow = (row, at) => Boolean(row?.temporarilyClosed && (!row.closureUntil || Date.parse(row.closureUntil) > new Date(at).getTime()));

/** Time-of-day prior only. It is never a real-time observation or a measured forecast. */
export function gaussianMealEstimate(at = new Date()) {
  const minute = clockMinutes(at), peaks = [[8 * 60, 36, .6], [12 * 60, 42, 1], [18 * 60, 48, .85]];
  const pressure = Math.max(...peaks.map(([center, spread, weight]) => weight * Math.exp(-.5 * ((minute - center) / spread) ** 2)));
  const waitMinutes = Math.round(pressure * 20);
  const level = waitMinutes < 2 ? 'empty' : waitMinutes <= 8 ? 'short' : waitMinutes <= 18 ? 'medium' : 'long';
  return { source: 'guess', estimated: true, level, waitMinutes, reportCount: 0, reportedAt: '', lastReportedAt: '', expiresAt: '', notice: '暂无有效反馈；仅按北京时间餐峰高斯曲线估算，未使用现场传感器、订单或实时客流。' };
}

export function diningAvailability(venue, window, menu, at = new Date()) {
  const rows = [venue, window, menu].filter(Boolean), closure = rows.find(row => closedNow(row, at));
  const hours = window?.openHours?.length ? window.openHours : venue?.openHours || [];
  const open = closure ? false : isOpenNow(hours, at), orderStopped = rows.some(row => row.orderStopped), soldOut = Boolean(menu?.soldOut);
  return { open, temporarilyClosed: Boolean(closure), orderStopped, acceptingOrders: closure || orderStopped || soldOut || open === false ? false : open === true ? true : null, closureUntil: closure?.closureUntil || '', closureReason: closure?.closureReason || (orderStopped ? rows.find(row => row.orderStopped)?.closureReason || '暂停接单' : '') };
}

function feedbackSummary(reports) {
  if (!reports.length) return null;
  // One visitor may report several windows: use their latest venue observation once.
  const latestByActor = new Map();
  for (const report of reports) { const key = report.actorId || report.userId || report.id; const previous = latestByActor.get(key); if (!previous || Date.parse(report.reportedAt) > Date.parse(previous.reportedAt)) latestByActor.set(key, report); }
  const entries = [...latestByActor.values()].sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
  const weights = entries.map(report => QUEUE_LEVELS.findIndex(level => level.id === report.level)).filter(index => index >= 0).sort((a, b) => a - b);
  if (!weights.length) return null;
  const level = QUEUE_LEVELS[weights[Math.floor(weights.length / 2)]], latest = entries[0];
  return { source: 'feedback', estimated: false, level: level.id, waitMinutes: level.waitMinutes, reportCount: entries.length, reportedAt: latest.reportedAt, lastReportedAt: latest.reportedAt, expiresAt: latest.expiresAt, notice: '最近30分钟访客反馈的中位档位，仅供参考。' };
}

export function campusQueueOverview(catalog, reports, at = new Date()) {
  const instant = new Date(at).getTime(), active = reports.filter(report => Date.parse(report.expiresAt) > instant && Date.parse(report.reportedAt) <= instant);
  const summary = (venue, window) => {
    const state = diningAvailability(venue, window, null, at);
    if (state.open === false) return { source: 'closed', estimated: false, level: 'empty', waitMinutes: 0, reportCount: 0, reportedAt: '', lastReportedAt: '', expiresAt: '', notice: state.closureReason || '按已录入开放时段当前未营业。', ...state };
    return { ...(feedbackSummary(active.filter(report => report.venueId === venue.id && (!window || report.windowId === window.id))) || gaussianMealEstimate(at)), ...state };
  };
  return catalog.venues.map(venue => ({ venueId: venue.id, ...summary(venue), windows: venue.windows.map(window => ({ venueId: venue.id, windowId: window.id, ...summary(venue, window) })) }));
}
