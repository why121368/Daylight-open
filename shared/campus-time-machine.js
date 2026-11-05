/** Replay helpers use Beijing time and never replace the application's real clock. */
export const REPLAY_HOURS = 48;
export const REPLAY_MINUTES = REPLAY_HOURS * 60;
export const REPLAY_SPAN_MS = REPLAY_MINUTES * 60000;
const SHANGHAI_OFFSET_MS = 8 * 3600000;
const LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

export function formatShanghaiDateTime(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 16) : '';
}

/** datetime-local has no zone; explicitly interpret its wall clock as UTC+08:00. */
export function parseShanghaiDateTime(value) {
  if (typeof value !== 'string' || !LOCAL_PATTERN.test(value)) return null;
  const timestamp = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(timestamp) && formatShanghaiDateTime(timestamp) === value ? timestamp : null;
}

export function replayInitialState(queryTime, now = Date.now()) {
  const shared = typeof queryTime === 'string' && /^\d{1,16}$/.test(queryTime) ? Number(queryTime) : null;
  if (shared !== null && Number.isSafeInteger(shared) && formatShanghaiDateTime(shared)) return { start: shared, minute: 0, expanded: true };
  const wallClock = formatShanghaiDateTime(now);
  const start = parseShanghaiDateTime(`${wallClock.slice(0, 10)}T00:00`) ?? 0;
  return { start, minute: Math.min(REPLAY_MINUTES, Math.max(0, (now - start) / 60000)), expanded: false };
}

const visibleEvents = events => (Array.isArray(events) ? events : []).filter(event => !event.hidden && event.status !== 'cancelled' && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) > Date.parse(event.start));
export function isLongExhibition(event) {
  return Date.parse(event.end) - Date.parse(event.start) >= 86400000 && /展览|展出|特展|陈列|exhibition/i.test([event.title, ...(event.tags || [])].join(' '));
}

export function replayFrame(events, start, minute) {
  const boundedMinute = Math.min(REPLAY_MINUTES, Math.max(0, Number(minute) || 0));
  const timestamp = start + boundedMinute * 60000;
  const activeEvents = visibleEvents(events).filter(event => Date.parse(event.start) <= timestamp && Date.parse(event.end) > timestamp).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || String(a.id).localeCompare(String(b.id)));
  const hour = new Date(timestamp + SHANGHAI_OFFSET_MS).getUTCHours();
  // The tint is an illustration with fixed 06:00 / 18:00 boundaries, not an astronomical claim.
  const daylight = hour >= 6 && hour < 18;
  const longExhibitions = activeEvents.filter(isLongExhibition);
  return { timestamp, minute: boundedMinute, activeEvents, daylight, night: !daylight, phase: daylight ? 'day' : 'night', simulated: true, clockKind: 'playback', longExhibitions, longExhibitionCount: longExhibitions.length };
}

export function advanceReplayMinute({ minute, speed, smart, loop, events, start }) {
  const value = Math.min(REPLAY_MINUTES, Math.max(0, Number(minute) || 0));
  const timestamp = start + value * 60000;
  const boundaries = visibleEvents(events).flatMap(event => [Date.parse(event.start), Date.parse(event.end)]);
  const near = boundaries.some(boundary => Math.abs(boundary - timestamp) <= 20 * 60000);
  let increment = Math.min(60, Math.max(1, Number(speed) || 1)) * (smart && !near ? 6 : 1);
  const nextBoundary = boundaries.reduce((nearest, boundary) => boundary > timestamp ? Math.min(nearest, boundary) : nearest, Infinity);
  if (smart && Number.isFinite(nextBoundary)) {
    const until = (nextBoundary - timestamp) / 60000;
    // Arrive at the slow zone, then at each event boundary; a large speed cannot skip a short event.
    increment = Math.min(increment, until > 20 && !near ? until - 20 : until);
  }
  const next = value + increment;
  if (next >= REPLAY_MINUTES) return { minute: loop ? next % REPLAY_MINUTES : REPLAY_MINUTES, playing: Boolean(loop) };
  return { minute: next, playing: true };
}

/** Find the busiest half-open 48-hour window in O(n log n), with stable earliest ties. */
export function busiestReplayStart(events) {
  const rows = visibleEvents(events); if (!rows.length) return null;
  const starts = rows.map(event => Date.parse(event.start)).sort((a, b) => a - b), ends = rows.map(event => Date.parse(event.end)).sort((a, b) => a - b);
  const lowerBound = (values, target, inclusive = false) => { let low = 0, high = values.length; while (low < high) { const middle = (low + high) >> 1; if (values[middle] < target || inclusive && values[middle] === target) low = middle + 1; else high = middle; } return low; };
  const candidates = [...new Set(starts.flatMap(time => [time, time - REPLAY_SPAN_MS + 1]).filter(time => time >= starts[0]))].sort((a, b) => a - b);
  let chosen = starts[0], most = -1;
  for (const candidate of candidates) {
    const count = lowerBound(starts, candidate + REPLAY_SPAN_MS) - lowerBound(ends, candidate, true);
    if (count > most) { chosen = candidate; most = count; }
  }
  return chosen;
}
