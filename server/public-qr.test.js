import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectShareUrl, isPrivateHost } from '../shared/public-url.js';
import { parseArgs, verifyPublicUrl } from '../scripts/public-qr.mjs';

test('public QR requires HTTPS and rejects local, reserved, credential-bearing URLs', () => {
  for (const url of [
    'http://daylight.ucloud.cn/campus', 'https://localhost/campus',
    'https://127.1/campus', 'https://0x7f000001/campus', 'https://10.0.0.1/campus',
    'https://172.20.0.1/campus', 'https://192.168.1.1/campus',
    'https://100.64.0.1/campus', 'https://[::1]/campus',
    'https://[fd00::1]/campus', 'https://[::ffff:7f00:1]/campus',
    'https://daylight.example.com/campus', 'javascript:alert(1)',
    'https://user:secret@daylight.ucloud.cn/campus',
    'https://daylight.ucloud.cn/reset-password?token=private',
    'https://daylight.ucloud.cn/reset-password?resetToken=private',
    'https://daylight.ucloud.cn/calendar.ics?subscription=private',
    'https://daylight.ucloud.cn/campus?sig=private',
    'https://daylight.ucloud.cn/campus?X-Amz-Signature=private',
    'https://daylight.ucloud.cn/campus#access_token=private',
  ]) assert.throws(() => parseArgs(['--url', url]), url);
  const parsed = parseArgs(['--url', 'https://daylight.ucloud.cn/campus?tab=events']);
  assert.equal(parsed.preview, false);
  assert.equal(parsed.skipVerify, false);
  assert.equal(parsed.url, 'https://daylight.ucloud.cn/campus?tab=events');
  assert.equal(parseArgs(['--url', 'https://daylight.ucloud.cn/campus?event=one&checkin=123456']).url, 'https://daylight.ucloud.cn/campus?event=one&checkin=123456');
});

test('explicit preview and unverified modes carry distinguishable output labels', () => {
  const preview = parseArgs(['--url', 'http://localhost:3000/campus', '--allow-local-preview']);
  assert.equal(preview.preview, true);
  assert.equal(preview.skipVerify, true);
  assert.match(preview.output, /local-preview/);
  const skipped = parseArgs(['--url', 'https://daylight.ucloud.cn/campus', '--skip-verify']);
  assert.equal(skipped.preview, false);
  assert.equal(skipped.skipVerify, true);
  assert.match(skipped.output, /unverified/);
  assert.throws(() => parseArgs(['--url', 'https://daylight.ucloud.cn', '--timeout-ms', '0']));
  assert.throws(() => parseArgs(['--url', 'https://daylight.ucloud.cn', '--output', 'qr.svg']));
});

test('browser sharing resolves public paths and identifies local previews without claiming reachability', () => {
  const publicLink = inspectShareUrl('/campus?tab=food', 'https://daylight.ucloud.cn');
  assert.equal(publicLink.url, 'https://daylight.ucloud.cn/campus?tab=food');
  assert.equal(publicLink.publicCandidate, true);
  const local = inspectShareUrl('/campus', 'http://192.168.0.2:3000');
  assert.equal(local.local, true);
  assert.equal(local.publicCandidate, false);
  assert.equal(isPrivateHost('203.0.113.8'), true);
  assert.equal(isPrivateHost('1.1.1.1'), false);
});

test('public verification refuses a private target before any HTTP probe', async () => {
  await assert.rejects(verifyPublicUrl('https://127.0.0.1/campus', 100), /local or reserved/);
});

test('probe accepts guest access with SMTP disabled while requiring healthy application and protected private APIs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    if (pathname === '/health/ready') return Response.json({ ok: true });
    if (pathname === '/api/state') return Response.json({ error: 'login required' }, { status: 401 });
    if (pathname === '/api/auth/config') return Response.json({ requireAuth: true, allowLocalDemoLogin: false, systemMailReady: false, emailCodeRequired: true });
    return new Response('<html>Guest campus page</html>', { headers: { 'content-type': 'text/html' } });
  });
  const probes = await verifyPublicUrl('https://1.1.1.1/campus');
  assert.deepEqual(calls, ['/campus', '/health/ready', '/api/state', '/api/auth/config']);
  assert.equal(probes.length, 4);
  assert.equal(probes[2].status, 401);
});

test('probe rejects an anonymous private API response even when page and readiness are healthy', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    return new URL(url).pathname === '/health/ready' ? Response.json({ ok: true }) : new Response('ok');
  });
  await assert.rejects(verifyPublicUrl('https://1.1.1.1/campus'), /Anonymous.*expected 401/);
});
