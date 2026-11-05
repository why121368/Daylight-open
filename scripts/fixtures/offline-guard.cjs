// I/O guard for the offline verification and isolated demo child processes.
// Production processes never preload this file.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
const { fileURLToPath } = require('node:url');
const baseline = process.env.DAYLIGHT_REGRESSION_BASE;
if (baseline && path.resolve(process.env.DAYLIGHT_DATA_DIR || baseline) === path.resolve(baseline)) {
  process.env.DAYLIGHT_DATA_DIR = path.join(baseline, `process-${process.pid}`);
  fs.mkdirSync(process.env.DAYLIGHT_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.DAYLIGHT_DATA_DIR, 'infra.json'), JSON.stringify({ postgres: { enabled: false }, redis: { enabled: false }, mq: { enabled: false }, oss: { enabled: false }, auth: { requireAuth: true, allowLocalDemoLogin: false } }));
}
const originalAppend = fs.appendFileSync;
function rejected(kind, detail) {
  if (process.env.DAYLIGHT_REGRESSION_GUARD_LOG) originalAppend(process.env.DAYLIGHT_REGRESSION_GUARD_LOG, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, entry: path.basename(process.argv[1] || ''), kind, detail }) + '\n');
  return Object.assign(new Error(`Isolated regression blocked ${kind}: ${detail}`), { code: 'DAYLIGHT_REGRESSION_GUARD' });
}
const loopback = input => { const host = String(input || 'localhost').replace(/^\[|\]$/g, '').toLowerCase(); return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host) || /^::ffff:127(?:\.\d{1,3}){3}$/.test(host); };
function connectionTarget(args) {
  if (Array.isArray(args[0])) args = args[0];
  const first = args[0];
  if (first && typeof first === 'object') return first.path || first.socket ? null : { host: first.host || first.hostname || 'localhost', port: first.port || '' };
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null; // Unix socket / Windows named pipe.
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first || '' };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { const target = connectionTarget(args); if (target && !loopback(target.host)) throw rejected('socket', `${target.host}:${target.port}`); return Reflect.apply(connect, this, args); };
const secureConnect = tls.connect;
tls.connect = function (...args) { const target = connectionTarget(args); if (target && !loopback(target.host)) throw rejected('TLS', `${target.host}:${target.port}`); return Reflect.apply(secureConnect, this, args); };
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, options) { const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); if (!loopback(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) return Promise.reject(rejected('fetch', url.hostname)); return originalFetch(input, options); };

// Catch accidental fallback to the user's real data even when a test overrides env.
const realData = path.resolve(__dirname, '..', '..', 'data').toLowerCase();
function checkFile(input) {
  if (typeof input !== 'string' && !(input instanceof URL) && !Buffer.isBuffer(input)) return;
  const resolved = path.resolve(input instanceof URL ? fileURLToPath(input) : String(input)).toLowerCase();
  if (resolved === realData || resolved.startsWith(realData + path.sep)) throw rejected('user-data access', 'repository data directory');
}
const fileOperations = ['access', 'appendFile', 'chmod', 'chown', 'exists', 'lstat', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readFile', 'readdir', 'readlink', 'realpath', 'rm', 'rmdir', 'stat', 'truncate', 'unlink', 'utimes', 'watch', 'writeFile'];
for (const name of fileOperations.flatMap(name => [name, name + 'Sync'])) if (typeof fs[name] === 'function') {
  const original = fs[name]; fs[name] = function (...args) { checkFile(args[0]); return Reflect.apply(original, this, args); };
  // Vite switches to realpathSync.native after its Windows network-drive probe.
  // Keep Node's native variants available and subject to the same data guard.
  if (typeof original.native === 'function') {
    fs[name].native = function (...args) { checkFile(args[0]); return Reflect.apply(original.native, this, args); };
  }
}
for (const name of ['copyFile', 'rename', 'link', 'symlink'].flatMap(name => [name, name + 'Sync'])) if (typeof fs[name] === 'function') {
  const original = fs[name]; fs[name] = function (...args) { checkFile(args[0]); checkFile(args[1]); return Reflect.apply(original, this, args); };
}
for (const name of fileOperations) if (typeof fs.promises[name] === 'function') {
  const original = fs.promises[name]; fs.promises[name] = function (...args) { checkFile(args[0]); return Reflect.apply(original, this, args); };
}
for (const name of ['copyFile', 'rename', 'link', 'symlink']) if (typeof fs.promises[name] === 'function') {
  const original = fs.promises[name]; fs.promises[name] = function (...args) { checkFile(args[0]); checkFile(args[1]); return Reflect.apply(original, this, args); };
}
syncBuiltinESMExports();
