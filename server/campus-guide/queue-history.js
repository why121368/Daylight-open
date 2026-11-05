import { guideError, QUEUE_LEVELS } from '../../shared/campus-guide.js';

export const QUEUE_HISTORY_HOURS = 24;
export const QUEUE_HISTORY_LIMIT = 100000;
const historyMilliseconds = QUEUE_HISTORY_HOURS * 60 * 60 * 1000;
const validLevels = new Set(QUEUE_LEVELS.map(level => level.id));
const isCurrent = (report, instant) => report && typeof report.venueId === 'string' && validLevels.has(report.level) && Date.parse(report.reportedAt) > instant - historyMilliseconds && Date.parse(report.reportedAt) <= instant;

/** Called in the same transaction as the accepted report. No actor or IP history. */
export function recordQueueHistory(state, { venueId, windowId = '', level, reportedAt }) {
  const instant = Date.parse(reportedAt);
  state.queueReportHistory = (state.queueReportHistory || []).filter(report => isCurrent(report, instant)).map(report => ({ venueId: report.venueId, windowId: typeof report.windowId === 'string' ? report.windowId : '', level: report.level, reportedAt: report.reportedAt }));
  if (state.queueReportHistory.length >= QUEUE_HISTORY_LIMIT) throw guideError('过去24小时排队反馈记录已达容量，请稍后重试。', 429);
  const started = Date.parse(state.queueHistoryStartedAt);
  if (!Number.isFinite(started) || started > instant) state.queueHistoryStartedAt = reportedAt;
  state.queueReportHistory.push({ venueId, windowId, level, reportedAt });
}

/** Successful submissions, including accepted updates, over (now - 24h, now]. */
export function campusQueueHistoryStats(catalog, state, now = new Date()) {
  const instant = now.getTime(), windowStart = instant - historyMilliseconds;
  const reports = (state.queueReportHistory || []).filter(report => isCurrent(report, instant));
  const started = Date.parse(state.queueHistoryStartedAt), tracking = Number.isFinite(started) && started <= instant;
  const venues = new Map(), levels = new Map(QUEUE_LEVELS.map(level => [level.id, { id: level.id, label: level.label, count: 0 }]));
  for (const report of reports) {
    if (!venues.has(report.venueId)) venues.set(report.venueId, { venueId: report.venueId, name: catalog.venues.find(venue => venue.id === report.venueId)?.name || '已移除的餐厅', count: 0 });
    venues.get(report.venueId).count++;
    levels.get(report.level).count++;
  }
  return {
    windowHours: QUEUE_HISTORY_HOURS,
    windowStartedAt: new Date(windowStart).toISOString(),
    trackingStartedAt: tracking ? new Date(started).toISOString() : '',
    coverageStartedAt: tracking ? new Date(Math.max(started, windowStart)).toISOString() : '',
    complete: tracking && started <= windowStart,
    acceptedReports: reports.length,
    venuesWithReports: venues.size,
    venues: [...venues.values()].sort((a, b) => b.count - a.count || a.venueId.localeCompare(b.venueId)),
    levels: [...levels.values()],
    notice: '统计成功接收的提交次数；同一访客的有效更新会分别计数，拒绝的提交不计入。与30分钟内按目标保留的当前反馈不同。只统计最近24小时，过期历史在后续提交时清理；无访客、账号或IP标识，首次启用记录之前的反馈无法补齐。'
  };
}
