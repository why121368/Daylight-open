import { createHash } from 'node:crypto';

export const isSchoolMailbox = box => !box.pendingSetup && /^[^@\s]+@(?:[a-z0-9-]+\.)*shanghaitech\.edu\.cn$/i.test(String(box.email || ''));
export function matchCampusPlace(catalog, location) {
  const normalize = text => String(text || '').toLowerCase().replace(/[\s（）()·/]/g, '');
  const needle = normalize(location); if (!needle) return '';
  const candidates = catalog.places.map(place => ({ place, score: Math.max(0, ...[place.name, ...(place.aliases || [])].map(name => { const n = normalize(name); return n.length >= 2 && (needle === n || needle.includes(n)) ? n.length : 0; })) })).filter(p => p.score).sort((a, b) => b.score - a.score);
  return candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score) ? candidates[0].place.id : '';
}

/** Private live projection: cancellations/deletions disappear without stale copied schedules. */
export function projectSchoolCalendar(settings, readMailbox, catalog) {
  const mailboxes = [], items = [];
  for (const box of (settings.mailboxes || []).filter(isSchoolMailbox)) {
    const store = readMailbox(box.id);
    mailboxes.push({ id: box.id, email: box.email, ready: Boolean(box.authorizationCode && box.imapHost), lastSync: store.lastSync || null });
    for (const event of store.events || []) {
      if (event.source !== 'email' || event.status === 'cancelled' || event.attendanceStatus === 'declined' || event.responseStatus === 'declined' || event.campusGuideSourceKey || !Number.isFinite(Date.parse(event.start)) || !(Date.parse(event.end) > Date.parse(event.start))) continue;
      const key = createHash('sha256').update(`${box.id}\0${event.id}`).digest('hex').slice(0, 32);
      items.push({ id: `school-mail-${key}`, sourceEventId: event.id, mailboxId: box.id, title: String(event.title || '邮件安排').slice(0, 300), start: event.start, end: event.end, allDay: Boolean(event.allDay), location: String(event.location || '').slice(0, 500), placeId: matchCampusPlace(catalog, event.location), kind: 'event', source: 'school-mail', private: true, notes: '从本人上科大邮箱自动识别，与邮箱日历保持同步。时间与地点请核对原邮件。', status: event.status || 'active' });
    }
  }
  return { mailboxes, items: items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), modelReady: Boolean(settings.apiKey && settings.baseUrl && settings.model), notice: '仅本人可见；沿用邮箱后台同步和模型提取，自动反映取消、改期与删除。同步范围和失败重试以邮箱设置为准。' };
}
