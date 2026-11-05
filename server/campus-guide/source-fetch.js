import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { guideError } from '../../shared/campus-guide.js';
import { inspectShareUrl } from '../../shared/public-url.js';

/** Only globally routable addresses. All DNS answers must pass, not only the chosen one. */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Excludes mapped IPv4, loopback, link-local, ULA, multicast and transition ranges.
  if (family === 6) {
    const [first, second = 0] = address.split(':').map(part => Number.parseInt(part || '0', 16));
    // Numeric hextets also cover expanded spellings such as 2001:0db8::1.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
      && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8));
  }
  return false;
}
export function sourceUrl(value) {
  let parsed; try { parsed = new URL(value); } catch { throw guideError('请填写有效的 HTTPS 来源链接。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || parsed.hash || parsed.href.length > 2000 || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(parsed.hostname)) throw guideError('来源仅支持无凭据、无片段的公网 HTTPS:443 地址。');
  if (!inspectShareUrl(parsed.href).valid) throw guideError('来源链接不能包含登录令牌、私密订阅或签名凭据。');
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); if (isIP(host) && !isPublicAddress(host)) throw guideError('来源不能访问私有或保留网络地址。'); return parsed;
}
function requestPinned(parsed, { address, family, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(deadline); if (error) reject(error); else resolve(value); };
    const request = https.request(parsed, {
      method: 'GET', agent: false, rejectUnauthorized: true,
      headers: { Accept: 'application/json, application/rss+xml, application/atom+xml, text/calendar, text/html, application/xml, text/xml;q=0.8', 'Accept-Encoding': 'identity', 'User-Agent': 'Daylight-CampusGuide/1.0 (+administrator-configured-public-feed)' },
      lookup(host, options, callback) { if (typeof options === 'function') callback = options; if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family); },
    }, response => {
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { request.destroy(); finish(guideError('来源内容超过 2 MiB 限制。', 413)); } else chunks.push(chunk); });
      response.on('end', () => finish(null, { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', () => finish(guideError('来源响应中断，请稍后重试。', 502)));
    });
    const deadline = setTimeout(() => { request.destroy(); finish(guideError('来源读取超时。', 504)); }, timeoutMs);
    request.on('error', () => finish(guideError('无法读取校园来源，请核对公开链接与 HTTPS 证书。', 502))); request.end();
  });
}

/** Revalidate and pin DNS on every redirect. No cookies, credentials or user headers are sent. */
export async function fetchCampusSource(value, { lookup = dnsLookup, transport = requestPinned, timeoutMs = 20000, maxBytes = 2 * 1024 * 1024 } = {}) {
  let parsed = sourceUrl(value); const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= 3; hop++) {
    const host = parsed.hostname.replace(/^\[|\]$/g, ''), remaining = deadline - Date.now(); if (remaining <= 0) throw guideError('来源读取超时。', 504);
    let answers; try { answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([lookup(host, { all: true, verbatim: true }), new Promise((_, reject) => { const timer = setTimeout(() => reject(guideError('来源域名解析超时。', 504)), remaining); timer.unref?.(); })]); } catch (error) { if (error.status) throw error; throw guideError('来源域名解析失败。', 502); }
    if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) throw guideError('来源域名解析到私有或保留地址，已拒绝读取。');
    const chosen = answers.find(answer => answer.family === 4) || answers[0], response = await transport(parsed, { address: chosen.address, family: chosen.family, timeoutMs: Math.max(1, deadline - Date.now()), maxBytes });
    if ([301, 302, 303, 307, 308].includes(response.status)) { if (hop >= 3 || !response.headers.location) throw guideError('来源重定向过多或缺少地址。', 502); parsed = sourceUrl(new URL(response.headers.location, parsed).href); continue; }
    if (response.status < 200 || response.status >= 300) throw guideError(`来源返回 HTTP ${response.status}，本次未导入。`, 502);
    if (Buffer.byteLength(response.body, 'utf8') > maxBytes) throw guideError('来源内容超过大小限制。', 413);
    return { text: response.body, contentType: String(response.headers['content-type'] || ''), finalUrl: parsed.href };
  }
  throw guideError('来源读取失败。', 502);
}
