import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('附件下载带认证读取文件，保存 blob 而不是直接打开私人 API', async () => {
  const original = { document: globalThis.document, fetch: globalThis.fetch, window: globalThis.window };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const originalTimeout = globalThis.setTimeout;
  const calls = [], anchors = [], timers = [];
  const authSource = (await fs.readFile(new URL('../src/lib/auth-fetch.js', import.meta.url), 'utf8'))
    .replace("import { getAuthToken } from '@/lib/auth-api';", "const getAuthToken = () => 'fixture-token';")
    .replace("import { getRequestMailboxId } from '@/lib/api';", "const getRequestMailboxId = () => 'owned-box';")
    .replace("import { apiErrorMessage } from '@/lib/api-error';", "const apiErrorMessage = (v, fallback) => v.error || fallback;");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`;
  const source = (await fs.readFile(new URL('../src/lib/attachment-download.js', import.meta.url), 'utf8'))
    .replace("'@/lib/auth-fetch'", JSON.stringify(moduleUrl));
  const binary = Buffer.from('%PDF-1.4\nfixture');
  try {
    globalThis.window = { location: { host: 'daylight.test' } };
    globalThis.document = { body: { appendChild(anchor) { anchor.attached = true; } }, createElement() {
      const anchor = { click() { calls.push({ download: this.download, href: this.href, attached: this.attached }); }, remove() { this.removed = true; } };
      anchors.push(anchor); return anchor;
    } };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, token: options.headers.get('Authorization'), mailbox: options.headers.get('X-Mailbox-Id') });
      return new Response(binary, { headers: { 'content-type': 'application/pdf' } });
    };
    URL.createObjectURL = blob => { assert.equal(blob.size, binary.length); return 'blob:authenticated-pdf'; };
    URL.revokeObjectURL = url => calls.push({ revoked: url });
    globalThis.setTimeout = (fn, delay) => { timers.push({ fn, delay }); };
    const { downloadAttachment } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await downloadAttachment('/api/attachments/private%2Ffile.pdf', '会议资料.pdf');
    assert.deepEqual(calls[0], { url: '/api/attachments/private%2Ffile.pdf', token: 'Bearer fixture-token', mailbox: 'owned-box' });
    assert.deepEqual(calls[1], { download: '会议资料.pdf', href: 'blob:authenticated-pdf', attached: true });
    assert.equal(anchors[0].removed, true);
    assert.equal(timers[0].delay, 60_000);
    timers[0].fn();
    assert.deepEqual(calls[2], { revoked: 'blob:authenticated-pdf' });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '请先登录' }), { status: 401, headers: { 'content-type': 'application/json' } });
    await assert.rejects(downloadAttachment('/api/attachments/private', 'file.pdf'), /请先登录/);
    assert.equal(anchors.length, 1, '拒绝的请求不能下载错误 JSON');
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; globalThis.setTimeout = originalTimeout;
  }
});
