import { authRequest, getAuthToken } from '@/lib/auth-api';

export const guideRequest = (path, method = 'GET', body) => authRequest(`/campus-guide${path}`, method, body);
export const CATEGORY_LABELS = { teaching: '教学', research: '学院', dining: '餐饮', service: '服务', sports: '运动', residence: '住宿', gate: '校门', transit: '交通', parking: '停车' };
export const EVENT_LABELS = { academic: '讲座报告', arts: '文化艺术', sports: '体育运动', career: '职业发展', community: '校园生活', conference: '会议研讨', workshop: '工作坊', competition: '竞赛', volunteer: '志愿公益', exhibition: '展览展示' };
export const TOPIC_LABELS = { share: '分享', review: '测评', question: '提问', guide: '攻略', meetup: '约伴' };
export const QUEUE_LABELS = { empty: '人少', short: '稍等', medium: '排队中', long: '较拥挤' };
export const emptyProfile = () => ({ revision: 0, favorites: [], homePlaceId: '', labPlaceId: '', courses: [], schedule: [], registrations: [], checkins: [] });
export const shanghaiDate = (value = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export const clock = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '时间待定';
export const dayLabel = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value));
export function offsetDate(date, offset) { return shanghaiDate(new Date(`${date}T12:00:00+08:00`).getTime() + offset * 86400000); }
export function safeExternal(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
export function downloadFile(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
}
export async function downloadPrivate(path, filename) {
  const response = await fetch(`/api/campus-guide${path}`, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} });
  if (!response.ok) throw new Error((await response.json()).error || '下载失败');
  downloadFile(await response.text(), filename, response.headers.get('Content-Type') || 'text/plain');
}
export function matches(record, query) { return JSON.stringify(record).toLowerCase().includes(query.trim().toLowerCase()); }
export function dayItems(profile, catalog, date) {
  const items = (profile.schedule || []).filter(item => shanghaiDate(item.start) <= date && shanghaiDate(item.end) >= date).map(item => ({ ...item }));
  const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
  for (const course of profile.courses || []) {
    if (Number(course.weekday) !== weekday || date < course.startDate || date > course.endDate) continue;
    const week = Math.floor((new Date(`${date}T00:00:00+08:00`) - new Date(`${course.startDate}T00:00:00+08:00`)) / 604800000) + 1;
    if (course.weeks?.length && !course.weeks.includes(week)) continue;
    items.push({ ...course, id: `${course.id}:${date}`, kind: 'course', start: `${date}T${course.startTime}:00+08:00`, end: `${date}T${course.endTime}:00+08:00` });
  }
  for (const event of catalog.events || []) {
    if (!(profile.registrations || []).includes(event.id) || event.status === 'cancelled' || shanghaiDate(event.start) > date || shanghaiDate(event.end) < date) continue;
    items.push({ ...event, id: `event:${event.id}`, eventId: event.id, kind: 'event' });
  }
  return items.sort((a, b) => new Date(a.start) - new Date(b.start));
}
export function guestIcs(items) {
  const escape = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daylight//Campus//ZH', ...items.flatMap(item => ['BEGIN:VEVENT', `UID:${escape(item.id)}@campus.daylight`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(item.start)}`, `DTEND:${stamp(item.end)}`, `SUMMARY:${escape(item.title)}`, `LOCATION:${escape(item.location)}`, 'END:VEVENT']), 'END:VCALENDAR', ''].join('\r\n');
}
