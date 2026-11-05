/** Local, no-store A/B transport for the public entry page. Never serves user data. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const readArg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const before = path.resolve(root, readArg('--before', 'work/entry-v17/before/dist'));
const after = path.resolve(root, readArg('--after', 'work/entry-v17/after/dist'));
const api = new URL(readArg('--api', 'http://127.0.0.1:3196'));
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw new Error('Use an isolated local demo API.');
const bytesPerSecond = Number(readArg('--bytes-per-second', '200000'));
const delayMs = Number(readArg('--delay-ms', '80'));
const mathFixture = args.includes('--math-fixture');
const ports = [Number(readArg('--before-port', '3197')), Number(readArg('--after-port', '3198'))];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.vtt': 'text/vtt' };
const instrument = version => `<script>
(() => {
  const report = () => {
    const buttons = [...document.querySelectorAll('button')];
    const start = buttons.find(b => b.textContent.includes('开始体验：处理面试通知') && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
    if (!start || start.disabled || document.getElementById('daylight-boot')) {
      if (performance.now() < 30000) return requestAnimationFrame(report);
      document.documentElement.dataset.entryBenchmark = JSON.stringify({ok:false,version:'${version}',timeoutMs:performance.now()});
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const resources = performance.getEntriesByType('resource').map(r => ({name:new URL(r.name).pathname,initiator:r.initiatorType,startMs:r.startTime,endMs:r.responseEnd,transferBytes:r.transferSize,encodedBytes:r.encodedBodySize,decodedBytes:r.decodedBodySize}));
      const nav = performance.getEntriesByType('navigation')[0];
      document.documentElement.dataset.entryBenchmark = JSON.stringify({ok:true,version:'${version}',readyMs:performance.now(),width:innerWidth,height:innerHeight,
        userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
        navigation:{responseEndMs:nav.responseEnd,domContentLoadedMs:nav.domContentLoadedEventEnd,loadMs:nav.loadEventEnd},
        paints:performance.getEntriesByType('paint').map(p=>({name:p.name,startMs:p.startTime})),resources});
    }));
  };
  requestAnimationFrame(report);
})();</script>`;

const servers = [];
for (const [index, directory] of [before, after].entries()) {
  if (!fs.existsSync(path.join(directory, 'index.html'))) throw new Error(`Missing build: ${directory}`);
  const version = index === 0 ? 'before' : 'after';
  // Shared per-server byte budget, round-robin across all pending responses.
  const queue = [];
  let credit = 0, lastTick = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    credit = Math.min(bytesPerSecond * .05, credit + bytesPerSecond * (now - lastTick) / 1000);
    lastTick = now;
    let remaining = queue.length;
    while (credit >= 1 && queue.length && remaining-- > 0) {
      const item = queue.shift();
      if (item.res.destroyed) continue;
      const count = Math.min(Math.floor(credit), 4096, item.bytes.length - item.offset);
      item.res.write(item.bytes.subarray(item.offset, item.offset + count));
      item.offset += count; credit -= count;
      if (item.offset >= item.bytes.length) item.res.end(); else queue.push(item);
    }
  }, 10);
  tick.unref();
  const send = (req, res, status, type, data) => {
    const compress = /javascript|text\/|application\/json/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const bytes = compress ? gzipSync(data) : Buffer.from(data);
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding', ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
      if (req.method === 'HEAD') res.end();
      else if (bytesPerSecond > 0) queue.push({ res, bytes, offset: 0 });
      else res.end(bytes);
    }, delayMs);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health/')) {
        const requestBytes = [];
        for await (const bytes of req) requestBytes.push(bytes);
        const body = Buffer.concat(requestBytes);
        if (mathFixture && url.pathname === '/api/assistant/chat') {
          return send(req, res, 200, 'application/json', JSON.stringify({
            reply: '## Local formula fixture\n\nInline: $E=mc^2$.\n\n$$\n\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}\n$$\n\n| Item | Value |\n| --- | --- |\n| Source | Synthetic local response |',
            toolTrace: [], citations: [], cost_cny: 0, cost_status: 'fixture',
          }));
        }
        const response = await fetch(new URL(req.url, api), { method: req.method,
          headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
            ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) },
          ...(body.length ? { body } : {}), signal: AbortSignal.timeout(15000) });
        send(req, res, response.status, response.headers.get('content-type') || 'application/json', Buffer.from(await response.arrayBuffer()));
        return;
      }
      const target = path.resolve(directory, '.' + decodeURIComponent(url.pathname));
      if (!target.startsWith(directory + path.sep) && target !== directory) return send(req, res, 403, 'text/plain', 'Forbidden');
      const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(directory, 'index.html');
      let bytes = fs.readFileSync(file);
      if (file.endsWith('index.html') && url.searchParams.has('entry-bench')) {
        bytes = Buffer.from(bytes.toString('utf8').replace('<head>', '<head>' + instrument(version)));
      }
      send(req, res, 200, mime[path.extname(file)] || 'application/octet-stream', bytes);
    } catch (error) {
      send(req, res, 500, 'text/plain', error.message);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(ports[index], '127.0.0.1', resolve); });
  servers.push(server);
  console.log(JSON.stringify({ version, port: ports[index], directory: path.relative(root, directory), bytesPerSecond, delayMs, cache: 'no-store', api: api.origin, mathFixture }));
}
const stop = () => { for (const server of servers) server.close(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
