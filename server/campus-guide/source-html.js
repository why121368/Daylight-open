/** Parses one fetched official page. Never executes scripts or follows page links. */
const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[value]).replace(/\s+/g, ' ').trim();
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const names = value => Array.isArray(value) ? value.map(names).filter(Boolean).join('、') : typeof value === 'object' && value ? plain(value.name) : plain(value);
const explicitEnglish = value => typeof value === 'string' ? plain(value) : value;
const isLanguage = (value, language) => typeof value === 'string' && value.toLowerCase().split(/[-_]/)[0] === language;
function localized(value, language) {
  if (Array.isArray(value)) return value.map(item => localized(item, language)).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  if (isLanguage(value['@language'], language) && typeof value['@value'] === 'string') return plain(value['@value']);
  return Object.entries(value).filter(([key, text]) => isLanguage(key, language) && typeof text === 'string').map(([, text]) => plain(text)).join('\n');
}

export function parseCampusHtml(html, source) {
  const events = [], seen = new Set();
  const append = event => { if (events.length >= 500) return; const key = event.uid || event.url || `${event.title}\0${event.start}`; if (seen.has(key)) return; seen.add(key); events.push(event); };
  let objects = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12 || ++objects > 5000) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => typeof type === 'string' && /(?:^|\/)\w*Event$/.test(type))) {
      const allDay = day(value.startDate) && day(value.endDate);
      const englishPage = isLanguage(value.inLanguage, 'en');
      const englishDescription = explicitEnglish(value.englishDescription) ?? (localized(value.description, 'en') || (englishPage && typeof value.description === 'string' ? plain(value.description) : ''));
      const englishSummary = explicitEnglish(value.englishSummary) ?? (localized(value.abstract, 'en') || (englishPage && typeof value.abstract === 'string' ? plain(value.abstract) : ''));
      const title = typeof value.name === 'string' ? plain(value.name) : localized(value.name, 'zh') || localized(value.name, 'en');
      const description = typeof value.description === 'string' ? englishPage ? '' : plain(value.description) : localized(value.description, 'zh');
      append({ uid: value['@id'] || value.url, title, englishTitle: typeof value.alternateName === 'string' ? plain(value.alternateName) : localized(value.name, 'en') || (englishPage ? title : ''), englishSummary, englishDescription, description, summary: typeof value.abstract === 'string' ? englishPage ? '' : plain(value.abstract) : localized(value.abstract, 'zh'), start: allDay ? `${value.startDate}T00:00:00+08:00` : value.startDate || '', end: allDay ? `${value.endDate}T00:00:00+08:00` : value.endDate || '', allDay, organizer: names(value.organizer), speaker: names(value.performer), location: names(value.location), locationText: names(value.location), url: value.url || source.url, status: /EventCancelled$/.test(value.eventStatus || '') ? 'cancelled' : 'published' });
    }
    for (const key of ['@graph', 'itemListElement', 'item', 'event', 'events', 'subEvent']) if (value[key]) visit(value[key], depth + 1);
  }
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) { if (++scripts > 100) break; if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) continue; try { visit(JSON.parse(match[2])); } catch {} }
  if (events.length) return events;
  // Plain links are only incomplete candidates. Dates are never inferred from headlines.
  const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi, ' '), origin = new URL(source.url).origin;
  for (const match of withoutScripts.matchAll(/<a\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    if (events.length >= 200) break;
    let url; try { url = new URL(match[2].replace(/&amp;/g, '&'), source.url); } catch { continue; }
    const title = plain(match[3]); if (url.origin !== origin || title.length < 4 || title.length > 300 || !/(活动|讲座|论坛|报告|分享|讲堂|seminar|workshop|event|talk|lecture|forum|conference)/i.test(`${title} ${url.pathname}`)) continue;
    append({ uid: url.href, title, url: url.href, description: '从官网列表链接识别；尚未读取详情，请人工核对活动时间、地点和授权。', start: '', end: '', location: '' });
  }
  return events;
}
