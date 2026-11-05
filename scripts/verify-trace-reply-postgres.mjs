/** Real PostgreSQL, isolated schema, original synthetic mail and injected SMTP transport. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.DAYLIGHT_DATABASE_URL) throw new Error('DAYLIGHT_DATABASE_URL is required');
const reportPath = process.argv[2];
const schema = `reply_verify_${randomUUID().replaceAll('-', '')}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-reply-pg-'));
const connection = new URL(process.env.DAYLIGHT_DATABASE_URL);
connection.searchParams.set('options', `-c search_path=${schema}`);
Object.assign(process.env, { DAYLIGHT_DATABASE_URL: connection.href, DAYLIGHT_DATA_DIR: directory,
  DAYLIGHT_RUNTIME: 'production', DAYLIGHT_METRICS: '0', DAYLIGHT_AUTO_PROXY: '0' });
const admin = new pg.Pool({ connectionString: connection.href, max: 1,
  ssl: process.env.DAYLIGHT_DATABASE_SSL === '1' ? { rejectUnauthorized: true } : undefined });
const checks = [];
const check = async (name, fn) => { const start = performance.now(); await fn(); checks.push({ name, passed: true, elapsedMs: performance.now() - start }); };
let postgres, created = false, cleaned = false, failure, transportCalls = 0;
try {
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  assert.equal((await admin.query('SELECT current_schema() AS name')).rows[0].name, schema);
  postgres = await import('../server/infra/postgres.js');
  const storage = await import('../server/storage/index.js');
  const { AUXILIARY_SCHEMA } = await import('../server/storage/aux-schema.js');
  await admin.query(postgres.SCHEMA); await admin.query(storage.STORAGE_SCHEMA); await admin.query(AUXILIARY_SCHEMA);
  const settings = { mailboxes: ['alice', 'bob'].map(id => ({ id: `reply-${id}`, ownerUserId: id,
    email: `${id}@example.invalid`, smtpHost: 'smtp.example.invalid', smtpPort: 465, smtpSecure: true,
    authorizationCode: 'synthetic-not-a-service-credential' })), userPrefs: {
    alice: { activeMailboxId: 'reply-alice' }, bob: { activeMailboxId: 'reply-bob' },
  } };
  const traces = [0, 1].map(i => ({ trace_id: `synthetic-trace-${i}`, mode: 'qq', draft_reply: `合成回复${i}。` }));
  const calendar = { events: [], tasks: [], emails: traces.map((trace, i) => ({ id: `synthetic-mail-${i}`, trace_id: trace.trace_id,
    mode: 'qq', subject: `合成通知${i}`, replyTo: 'Team <reply@example.invalid>', messageId: `<source-${i}@example.invalid>`,
    references: ['<previous@example.invalid>'] })) };
  await admin.query('INSERT INTO app_settings(id,payload,updated_at) VALUES($1,$2,now())', ['default', settings]);
  await admin.query('INSERT INTO app_settings(id,payload,updated_at) VALUES($1,$2,now())', ['traces:reply-alice', JSON.stringify(traces)]);
  await admin.query('INSERT INTO mailbox_calendars(mailbox_id,payload,updated_at) VALUES($1,$2,now())', ['reply-alice', calendar]);
  assert.deepEqual(await postgres.initPostgres(), { ok: true, mode: 'postgres' });
  const actions = await import('../server/assistant-actions.js');
  const { readSettings } = await import('../server/store.js');
  const scope = (owner, fn) => storage.withStorageSnapshot({ userId: owner }, fn);
  const prepare = i => scope('alice', () => actions.createAssistantDraft('reply-alice', { kind: 'trace_reply', sourceTraceId: traces[i].trace_id }));
  let draft, reviewed;
  await check('Eight concurrent prepares commit one durable reply draft', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, () => prepare(0)));
    assert.equal(new Set(rows.map(row => row.draft.id)).size, 1); draft = rows[0].draft;
    assert.equal(draft.sourceEmailId, 'synthetic-mail-0'); assert.equal(draft.status, 'pending');
    assert.deepEqual(draft.to, ['reply@example.invalid']); assert.equal(draft.from, 'alice@example.invalid');
  });
  await check('Another owner and another mailbox cannot resolve or edit the source draft', async () => {
    await assert.rejects(scope('bob', () => actions.createAssistantDraft('reply-bob', { kind: 'trace_reply', sourceTraceId: traces[0].trace_id })), { status: 404 });
    await assert.rejects(scope('bob', () => actions.getAssistantDraft('reply-bob', draft.id)), { status: 404 });
    await assert.rejects(scope('alice', () => actions.getAssistantDraft('reply-bob', draft.id)), { status: 404 });
  });
  await check('Editing increments revision and stale confirmation stops before transport', async () => {
    reviewed = (await scope('alice', () => actions.updateAssistantDraft('reply-alice', draft.id, { revision: 1, body: '本人核对后的合成回复。' }))).draft;
    assert.equal(reviewed.revision, 2);
    await assert.rejects(scope('alice', () => actions.sendAssistantDraft('reply-alice', draft.id, { revision: 1, confirmed: true }, readSettings(), {
      sendMail: async () => { transportCalls++; assert.fail('stale revision must not send'); },
    })), { status: 409 });
    assert.equal(transportCalls, 0);
  });
  await check('Pool reconnect recovers the reviewed body, thread and source identity', async () => {
    await postgres.closePostgres(); await postgres.initPostgres();
    const reopened = (await prepare(0)).draft;
    assert.equal(reopened.id, draft.id); assert.equal(reopened.body, reviewed.body); assert.equal(reopened.revision, 2);
    assert.equal(reopened.inReplyTo, '<source-0@example.invalid>');
    assert.deepEqual(reopened.references, ['<previous@example.invalid>', '<source-0@example.invalid>']);
  });
  await check('Sending marker commits before transport and repeated confirmation calls it once', async () => {
    const send = async () => scope('alice', () => actions.sendAssistantDraft('reply-alice', draft.id, { revision: 2, confirmed: true }, readSettings(), {
      sendMail: async (_settings, mail) => {
        transportCalls++;
        assert.equal((await actions.getAssistantDraft('reply-alice', draft.id)).draft.status, 'sending');
        assert.equal(mail.inReplyTo, '<source-0@example.invalid>');
        assert.deepEqual(mail.references, ['<previous@example.invalid>', '<source-0@example.invalid>']);
        assert.equal(mail.text, reviewed.body);
        return { accepted: mail.to, rejected: [], messageId: mail.messageId };
      },
    }));
    assert.equal((await send()).draft.status, 'sent'); assert.equal((await send()).draft.status, 'sent');
    assert.equal(transportCalls, 1);
  });
  await check('Saved receipt survives a second reconnect and reopening the trace', async () => {
    await postgres.closePostgres(); await postgres.initPostgres();
    const recovered = (await prepare(0)).draft;
    assert.equal(recovered.id, draft.id); assert.equal(recovered.status, 'sent');
    assert.deepEqual(recovered.delivery.accepted, ['reply@example.invalid']); assert.equal(transportCalls, 1);
  });
  await check('Unknown delivery remains durable and prevents another transport call', async () => {
    const second = (await prepare(1)).draft;
    const result = await scope('alice', () => actions.sendAssistantDraft('reply-alice', second.id, { revision: 1, confirmed: true }, readSettings(), {
      sendMail: async () => { transportCalls++; throw Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }); },
    }));
    assert.equal(result.draft.status, 'unknown');
    assert.equal((await prepare(1)).draft.status, 'unknown');
    await assert.rejects(scope('alice', () => actions.sendAssistantDraft('reply-alice', second.id, { revision: result.draft.revision, confirmed: true }, readSettings(), {
      sendMail: async () => { transportCalls++; assert.fail('unknown must not resend'); },
    })), { status: 409 });
    assert.equal(transportCalls, 2);
  });
  await check('Original calendar and trace rows remain byte-equivalent JSON values', async () => {
    assert.deepEqual((await admin.query('SELECT payload FROM mailbox_calendars WHERE mailbox_id=$1', ['reply-alice'])).rows[0].payload, calendar);
    assert.deepEqual((await admin.query('SELECT payload FROM app_settings WHERE id=$1', ['traces:reply-alice'])).rows[0].payload, traces);
  });
} catch (error) {
  failure = { name: error.name, code: error.code || null, check: checks.length + 1 };
} finally {
  await postgres?.closePostgres();
  if (created) {
    assert.match(schema, /^reply_verify_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    cleaned = (await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount === 0;
  }
  await admin.end();
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('daylight-reply-pg-'));
  fs.rmSync(directory, { recursive: true, force: true });
}
const report = { checkedAt: new Date().toISOString(), ok: !failure && cleaned && checks.length === 8,
  scope: 'Real PostgreSQL production storage in a new schema; original synthetic inputs and injected SMTP transport',
  node: process.version, schema, schemaRemoved: cleaned, realModelCalls: 0, realSmtpCalls: 0, injectedTransportCalls: transportCalls,
  checks, ...(failure ? { failure } : {}) };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
