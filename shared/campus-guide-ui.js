import { dailyItems, findRoute, isOpenNow, planDay } from './campus-guide.js';
import { diningAvailability, gaussianMealEstimate } from './campus-dining.js';

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
export const shanghaiInput = value => `${dateFormat.format(new Date(value))}T${timeFormat.format(new Date(value))}`;
export function allDayRange(item) {
  const start = Date.parse(item.start), end = Date.parse(item.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '日期待确认';
  const first = dateFormat.format(new Date(start)), last = dateFormat.format(new Date(end - 1));
  return `${first}${first === last ? '' : ` 至 ${last}`} · 全天`;
}
export const routeEndpointParam = value => typeof value === 'string' ? value : value && value.source !== 'gps' ? `@${value.lat},${value.lng}` : '';
export function parseRouteEndpoint(value) {
  if (!value) return '';
  if (/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value)) return value;
  const coordinates = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
  if (!coordinates) return '';
  const lat = Number(coordinates[1]), lng = Number(coordinates[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, name: '分享的地图位置' } : '';
}

export function filterCampusEvents(events, { range = 'week', category = '', query = '', placeId = '', sourceKind = '' } = {}, instant = Date.now()) {
  const today = dateFormat.format(new Date(instant)), startOfDay = Date.parse(`${today}T00:00:00+08:00`), nextDay = startOfDay + 86400000, weekEnd = startOfDay + 7 * 86400000;
  const search = query.trim().toLowerCase();
  return events.filter(event => {
    const start = Date.parse(event.start), end = Date.parse(event.end);
    if (event.hidden || (category && event.category !== category) || (placeId && event.placeId !== placeId) || (sourceKind && event.sourceKind !== sourceKind)) return false;
    if (search && !`${event.title} ${event.englishTitle || ''} ${event.summary || ''} ${event.organizer || ''} ${event.speaker || ''} ${event.room || ''} ${event.locationText || ''}`.toLowerCase().includes(search)) return false;
    if (range === 'past') return end <= instant;
    if (event.status === 'cancelled') return false;
    return range === 'now' ? start <= instant && end > instant : range === 'today' ? start < nextDay && end > startOfDay : range === 'week' ? end > instant && start < weekEnd : end > instant;
  }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

/** Suggestions require both time and known walking connections before and after an event. */
export function suggestCampusEvents(catalog, profile, date, { avoidRain = false, now = Date.now() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];
  const items = dailyItems(catalog, profile, date), registered = new Set(profile.registrations);
  return catalog.events.flatMap(event => {
    const start = Date.parse(event.start), end = Date.parse(event.end);
    if (event.hidden || event.status === 'cancelled' || registered.has(event.id) || dateFormat.format(new Date(start)) !== date || start <= now) return [];
    if (items.some(item => Date.parse(item.start) < end && Date.parse(item.end) > start)) return [];
    const previous = items.filter(item => Date.parse(item.end) <= start).sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
    const next = items.find(item => Date.parse(item.start) >= end), origin = previous?.placeId || profile.homePlaceId || profile.labPlaceId;
    if (!origin || !event.placeId || (next && !next.placeId)) return [];
    try {
      const inbound = findRoute(catalog, { from: origin, to: event.placeId, avoidRain });
      const outbound = next ? findRoute(catalog, { from: event.placeId, to: next.placeId, avoidRain }) : null;
      if ((previous ? Date.parse(previous.end) : now) + inbound.durationMinutes * 60000 > start) return [];
      if (next && end + outbound.durationMinutes * 60000 > Date.parse(next.start)) return [];
      return [{ event, inbound, outbound, departAt: start - inbound.durationMinutes * 60000 }];
    } catch { return []; }
  }).sort((a, b) => Date.parse(a.event.start) - Date.parse(b.event.start)).slice(0, 5);
}

export function eventAttendancePreview(catalog, profile, event) {
  const day = dateFormat.format(new Date(event.start));
  const plan = planDay(catalog, { ...profile, registrations: [...new Set([...profile.registrations, event.id])] }, day);
  return {
    conflicts: plan.conflicts.filter(item => item.fromId === event.id || item.toId === event.id),
    unmapped: plan.unroutable.filter(item => item.toItemId === event.id),
    inbound: plan.legs.find(item => item.toItemId === event.id) || null,
  };
}

export function activeMenu(menu, venue, at = Date.now()) {
  const date = dateFormat.format(new Date(at)), time = timeFormat.format(new Date(at)), hour = Number(time.slice(0, 2));
  const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
  const meal = hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : 'dinner';
  const window = venue?.windows?.find(item => item.id === menu.windowId);
  const availability = diningAvailability(venue || {}, window || {}, menu, at);
  return (!menu.validFrom || menu.validFrom <= date) && (!menu.validUntil || menu.validUntil >= date) && (menu.availableDays || [1, 2, 3, 4, 5, 6, 7]).includes(weekday) && (!menu.meal || menu.meal === 'all' || menu.meal === meal) && !menu.soldOut && !availability.temporarilyClosed && !availability.orderStopped;
}

export function semesterMonday(at = Date.now()) {
  const date = dateFormat.format(new Date(at)), weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
  return dateFormat.format(new Date(Date.parse(`${date}T12:00:00+08:00`) - (weekday - 1) * 86400000));
}

const foodSynonyms = [
  ['牛肉', '肥牛', '牛腩', '牛柳', '牛排'], ['鸡肉', '鸡排', '鸡腿', '鸡胸'],
  ['猪肉', '里脊', '五花肉', '排骨'], ['土豆', '马铃薯'], ['番茄', '西红柿'],
  ['米饭', '盖饭', '盖浇饭', '拌饭'], ['面食', '面条', '拉面', '拌面', '汤面'],
  ['素食', '蔬菜', '青菜', '素菜'], ['饮品', '饮料', '奶茶', '果汁'],
];
function normalizeFoodText(text) {
  let value = String(text || '').toLowerCase();
  for (const words of foodSynonyms) for (const word of words.slice(1)) value = value.replaceAll(word, words[0]);
  return value;
}
/** Small, visible rule-based food search; unknown requests remain literal text. */
export function parseFoodQuery(query = '') {
  let value = String(query).trim(), minPrice = 0, maxPrice = Infinity;
  value = value.replace(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:到|至|[-–~～])\s*(\d+(?:\.\d+)?)\s*(?:元|块)/g, (_, lower, upper) => { minPrice = Number(lower); maxPrice = Number(upper); return ' '; });
  value = value.replace(/(?:不超过|不高于|低于|小于|最多)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?|(\d+(?:\.\d+)?)\s*(?:元|块)\s*(?:以?内|以下)/g, (_, first, second) => { maxPrice = Math.min(maxPrice, Number(first || second)); return ' '; });
  value = value.replace(/(?:不少于|不低于|高于|大于|至少)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?|(\d+(?:\.\d+)?)\s*(?:元|块)\s*(?:以上|起)/g, (_, first, second) => { minPrice = Math.max(minPrice, Number(first || second)); return ' '; });
  const tokens = normalizeFoodText(value.replace(/(?:请|帮我|给我|推荐|我想吃|想吃|想找|有啥|有什么|好吃的|的)/g, ' ')).split(/[\s，,、]+/).filter(Boolean);
  return { minPrice, maxPrice, tokens };
}
export function matchesFoodQuery(menu, venue, query) {
  const parsed = typeof query === 'string' ? parseFoodQuery(query) : query;
  if ((parsed.minPrice > 0 || Number.isFinite(parsed.maxPrice)) && (menu.pricePending || !Number.isFinite(menu.price) || menu.price < parsed.minPrice || menu.price > parsed.maxPrice)) return false;
  const window = venue?.windows?.find(item => item.id === menu.windowId);
  const text = normalizeFoodText([menu.name, menu.description, ...(menu.tags || []), menu.flavor, venue?.name, venue?.floor, window?.name].filter(Boolean).join(' '));
  return parsed.tokens.every(token => text.includes(token));
}

export function suggestCampusMeals(catalog, profile, date, { items = [], queues = {}, avoidRain = false, now = Date.now() } = {}) {
  if (!profile || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];
  const today = dateFormat.format(new Date(now));
  return [12, 18].flatMap(hour => {
    const base = Date.parse(`${date}T${hour}:00:00+08:00`);
    const candidates = [0, 20, 40].flatMap(restMinutes => {
      const start = base + restMinutes * 60000, end = start + 45 * 60000;
      if (start <= now || items.some(item => Date.parse(item.start) < end && Date.parse(item.end) > start)) return [];
      const previous = items.filter(item => Date.parse(item.end) <= start).sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
      const next = items.find(item => Date.parse(item.start) >= end), origin = previous?.placeId || profile.homePlaceId;
      if (!origin || (next && !next.placeId)) return [];
      return catalog.venues.flatMap(venue => {
        if (isOpenNow(venue.openHours, start) !== true || diningAvailability(venue, {}, {}, start).acceptingOrders === false) return [];
        try {
          const route = findRoute(catalog, { from: origin, to: venue.placeId, avoidRain });
          const onward = next?.placeId ? findRoute(catalog, { from: venue.placeId, to: next.placeId, avoidRain }) : null;
          if (Math.max(previous ? Date.parse(previous.end) : now, now) + route.durationMinutes * 60000 > start || (next && end + onward.durationMinutes * 60000 > Date.parse(next.start))) return [];
          const fresh = date === today && Math.abs(start - now) <= 30 * 60000 ? queues.venues?.find(report => report.venueId === venue.id && report.source === 'feedback') : null;
          const queue = fresh || gaussianMealEstimate(start);
          return [{ venue, route, wait: queue.waitMinutes, queueSource: queue.source, restMinutes, start: new Date(start).toISOString(), end: new Date(end).toISOString(), score: route.durationMinutes + (queue.waitMinutes || 0) + restMinutes * 0.05 }];
        } catch { return []; }
      });
    });
    return candidates.sort((a, b) => a.score - b.score || a.start.localeCompare(b.start)).slice(0, 1).map(item => ({ ...item, meal: hour === 12 ? '午餐' : '晚餐' }));
  });
}
