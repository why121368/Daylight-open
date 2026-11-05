// Local browser verification fixture. Uses only the isolated public demo endpoint.
// Start the isolated demo on 3202 first, then run from the repository root.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('dist');
let failures = 0;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  try {
    const url = new URL(request.url, 'http://127.0.0.1:3203');
    if (url.pathname === '/api/experience') {
      if (url.searchParams.get('step') === '4' && failures++ === 0) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: '验证用临时故障，请重试。' }));
        console.log('INJECTED_STEP4_HTTP_503');
        return;
      }
      const upstream = await fetch(new URL(request.url, 'http://127.0.0.1:3202'), { signal: AbortSignal.timeout(15000) });
      response.writeHead(upstream.status, { 'content-type': 'application/json' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    if (url.pathname.startsWith('/api/')) { response.writeHead(404); response.end(); return; }
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  } catch { response.writeHead(502); response.end(); }
});
server.listen(3203, '127.0.0.1', () => console.log('CONTINUITY_FAILURE_PREVIEW http://127.0.0.1:3203/experience?step=3'));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
