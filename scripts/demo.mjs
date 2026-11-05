#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isolatedEnvironment } from './lib/isolated-environment.mjs';
import { DEMO_ACCOUNT, DEMO_ADMIN } from '../shared/demo-profile.js';

const root = path.resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);
if (arguments_.includes('--help')) {
  console.log('npm run demo -- [--port 3180] [--no-build] [--check]\nEach run creates a fresh work/demo-* directory. --check verifies HTTP workflows and exits.');
  process.exit(0);
}
const check = arguments_.includes('--check');
let port = check ? 0 : 3180;
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === '--port') {
    const value = arguments_[++index];
    if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid --port (1..65535).');
    port = Number(value);
  } else if (!['--check', '--no-build'].includes(argument)) throw new Error(`Unknown demo option: ${argument}`);
}
// Check the exact loopback binding before doing work. Never stop an existing service.
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'work', 'demo-'));
const dataDir = path.join(directory, 'data');
const guard = path.join(root, 'scripts', 'fixtures', 'offline-guard.cjs');
const guardLog = path.join(directory, 'guard.jsonl');
fs.writeFileSync(guardLog, '');
const env = isolatedEnvironment({ DAYLIGHT_DATA_DIR: dataDir, DAYLIGHT_DEMO: '1', DAYLIGHT_DEMO_GUARDED: '1',
  DAYLIGHT_REGRESSION_GUARD_LOG: guardLog, HOST: '127.0.0.1', PORT: String(port) });
const base = `http://127.0.0.1:${port}`;

async function run(file, args = [], outputName = 'prepare.log') {
  const output = fs.createWriteStream(path.join(directory, outputName));
  const child = spawn(process.execPath, ['--require', guard, file, ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', bytes => output.write(bytes));
  const [code] = await once(child, 'exit');
  await new Promise(resolve => output.end(resolve));
  if (code !== 0) throw new Error(`${path.basename(file)} failed; see ${path.join(directory, outputName)}`);
}

if (!arguments_.includes('--no-build')) {
  console.log('Building the demo frontend…');
  // Vite only reads source files. It does not require the application I/O preload.
  await run('node_modules/vite/bin/vite.js', ['build'], 'build.log');
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('No frontend build. Run npm run build, or omit --no-build.');
await run('scripts/seed-demo.mjs');
const output = fs.createWriteStream(path.join(directory, 'server.log'));
const server = spawn(process.execPath, ['--require', guard, 'server/index.js', '--production'], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverExit;
server.once('exit', code => { serverExit = code ?? 1; });
for (const pipe of [server.stdout, server.stderr]) pipe.on('data', bytes => output.write(bytes));
let stopping;
async function stop() {
  if (!stopping) stopping = (async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
      try { await once(server, 'exit'); } finally { clearTimeout(timer); }
    }
    await new Promise(resolve => output.end(resolve));
  })();
  return stopping;
}
const onSignal = () => { stop().then(() => process.exit(0), () => process.exit(1)); };
process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
const records = [];
async function request(route, { token, body, method = body ? 'POST' : 'GET', expected = 200 } = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${route}`, { method, signal: AbortSignal.timeout(15000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  records.push({ route, method, status: response.status, elapsedMs: Math.round(performance.now() - started) });
  if (response.status !== expected) throw new Error(`${method} ${route} returned ${response.status}, expected ${expected}: ${text.slice(0, 150)}`);
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}
const verify = (condition, message) => { if (!condition) throw new Error(`Demo check failed: ${message}`); };
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (serverExit !== undefined) throw new Error(`Demo server exited (${serverExit}); see ${path.join(directory, 'server.log')}`);
    try { const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) }); ready = response.ok; } catch { /* Starting. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Demo did not become ready in 30 seconds.');
  const config = await request('/api/auth/config');
  verify(config.demo?.enabled && config.requireAuth, 'demo label and authentication');
  await request('/api/state', { expected: 401 });
  const captcha = await request('/api/auth/captcha');
  const login = await request('/api/auth/login', { body: { account: DEMO_ACCOUNT.username, password: DEMO_ACCOUNT.password, captchaId: captcha.id, captchaText: captcha.text } });
  const token = login.token;
  verify(login.user.role === 'user', 'demo user must have ordinary permissions');
  const state = await request('/api/state', { token });
  verify(state.emails.length >= 15 && state.tasks.length >= 2, 'mail and tasks');
  verify(state.events.some(event => event.status === 'cancelled' && event.replacementEventId), 'reschedule lineage');
  verify(state.emails.some(email => email.conflicts?.length), 'conflict evidence');
  verify(state.emails.some(email => email.invoices?.length), 'invoice fields');
  verify(state.settings.mailboxes.every(mailbox => mailbox.ownerUserId !== 'demo-other'), 'cross-account mailbox isolation');
  await request('/api/state?mailbox=demo-other-mailbox', { token, expected: 404 });
  await request('/api/admin/users', { token, expected: 403 });
  const recruitment = await request('/api/recruitment', { token });
  verify(recruitment.candidates?.length === 3, 'preset resumes');
  const knowledge = await request('/api/rag/ask', { token, body: { message: '项目报告' } });
  verify(knowledge.citations?.length && knowledge.mode === 'keyword', 'keyword search with source citations');
  const scenarios = await request('/api/scenarios', { token });
  verify(scenarios.workbenches.length >= 4, 'scenario workbenches');
  const counts = [state.emails.length, state.events.length, state.tasks.length];
  await request('/api/sync/demo', { token, body: {} });
  const after = await request('/api/state', { token });
  verify(JSON.stringify(counts) === JSON.stringify([after.emails.length, after.events.length, after.tasks.length]), 'duplicate import idempotency');
  for (const route of ['/', '/experience', '/experience?step=3', '/evidence', '/demo', '/login', '/app', '/app/calendar', '/app/recruitment', '/app/invoices', '/campus']) {
    verify((await request(route)).includes('<!doctype html>'), `${route} frontend entry`);
  }
  const experience = await request('/api/experience?step=7');
  verify(JSON.stringify(experience.steps.map(step => step.status)) === JSON.stringify(['completed', 'conflict', 'completed', 'duplicate', 'failed', 'completed', 'completed']), 'public seven-step tools');
  verify(experience.modelCalls === 0 && experience.persisted === false, 'public experience execution mode');
  const report = { ok: true, at: new Date().toISOString(), mode: 'isolated-local-presets', externalServices: false,
    directory, baseUrl: base, counts: JSON.parse(fs.readFileSync(path.join(dataDir, 'demo-manifest.json'))), checks: records,
    blockedExternalAttempts: fs.readFileSync(guardLog, 'utf8').trim().split('\n').filter(Boolean).length };
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(`Demo ready: ${base}/login\nUser: ${DEMO_ACCOUNT.username} / ${DEMO_ACCOUNT.password}\nAdmin: ${DEMO_ADMIN.username} / ${DEMO_ADMIN.password}\nEvidence: ${path.join(directory, 'verification.json')}\nPreset data; no real mailbox, model or SMTP. Campus map is illustrative.`);
  if (check) await stop();
  else { console.log('Press Ctrl+C to stop. This run is retained; rerunning creates a fresh demo.'); await once(server, 'exit'); }
} catch (error) {
  await stop(); throw error;
} finally {
  process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  await stop();
}
