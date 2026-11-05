/** Real PostgreSQL + synthetic local model. All writes use a new private schema. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.DAYLIGHT_DATABASE_URL) throw new Error('DAYLIGHT_DATABASE_URL is required');
const reportPath = process.argv[2];
const schema = `rag_verify_${randomUUID().replaceAll('-', '')}`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-rag-pg-'));
const connection = new URL(process.env.DAYLIGHT_DATABASE_URL);
connection.searchParams.set('options', `-c search_path=${schema}`);
process.env.DAYLIGHT_DATABASE_URL = connection.href;
process.env.DAYLIGHT_DATA_DIR = directory;
process.env.DAYLIGHT_RUNTIME = 'production';
process.env.DAYLIGHT_METRICS = '0';
process.env.DAYLIGHT_AUTO_PROXY = '0';
const admin = new pg.Pool({ connectionString: connection.href, max: 1,
  ssl: process.env.DAYLIGHT_DATABASE_SSL === '1' ? { rejectUnauthorized: true } : undefined });
const checks = [];
const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); };
let postgres, model, created = false, cleaned = false, failure;
let modelCalls = 0;
try {
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  assert.equal((await admin.query('SELECT current_schema() AS name')).rows[0].name, schema);
  postgres = await import('../server/infra/postgres.js');
  const { STORAGE_SCHEMA, withStorageSnapshot } = await import('../server/storage/index.js');
  const { AUXILIARY_SCHEMA } = await import('../server/storage/aux-schema.js');
  await admin.query(postgres.SCHEMA);
  await admin.query(STORAGE_SCHEMA);
  await admin.query(AUXILIARY_SCHEMA);
  const users = ['alice', 'bob'];
  const settings = { mailboxes: users.map(id => ({ id: `rag-${id}`, ownerUserId: id, email: `${id}@example.invalid` })),
    userPrefs: Object.fromEntries(users.map(id => [id, { activeMailboxId: `rag-${id}` }])) };
  await admin.query('INSERT INTO app_settings(id,payload,updated_at) VALUES($1,$2,now())', ['default', settings]);
  assert.deepEqual(await postgres.initPostgres(), { ok: true, mode: 'postgres' });
  const { ingestEmailKnowledge } = await import('../server/rag/mail-index.js');
  const { listChunks } = await import('../server/rag/store.js');
  const { askMailboxKnowledge } = await import('../server/rag/ask.js');
  const inScope = (userId, fn) => withStorageSnapshot({ userId, profile: 'settings' }, fn);
  const retrieval = { ragEnabled: true, ragEmbeddings: false };
  const deadline = '最终材料补交截止为11月6日17:00，逾期停止接收。';
  const materials = '报到时只需携带学生证原件和本人签名的保密协议。';
  await inScope('alice', async () => {
    await ingestEmailKnowledge({ mailboxId: 'rag-alice', settings: retrieval,
      email: { id: 'imap:pg-deadline', subject: '创新营材料补交说明',
        body: `${'本次通知介绍报名流程、项目安排与材料准备要求。'.repeat(21)}\n${deadline}` } });
    await ingestEmailKnowledge({ mailboxId: 'rag-alice', settings: retrieval,
      email: { id: 'imap:pg-attachment', subject: '远航实习报到通知', body: '请阅读附件中的实习报到材料要求。',
        attachmentTexts: [{ attachmentId: 'requirements', filename: '远航实习报到材料.pdf',
          text: `${'本附件介绍远航实习报到流程和资料核对事项。'.repeat(20)}\n${materials}` }] } });
  });
  await inScope('bob', () => ingestEmailKnowledge({ mailboxId: 'rag-bob', settings: retrieval,
    email: { id: 'imap:pg-other', subject: '创新营材料补交说明', body: 'OTHER_SCOPE_PRIVATE_11月30日' } }));
  const initialRows = Number((await admin.query('SELECT count(*) AS count FROM rag_chunks')).rows[0].count);
  await check('PostgreSQL readback retains full body, attachment and source metadata', () => inScope('alice', async () => {
    const chunks = await listChunks('rag-alice');
    assert.ok(chunks.some(c => c.content.includes(deadline) && c.content.indexOf(deadline) > 280));
    assert.ok(chunks.some(c => c.content.includes(materials) && c.source === 'attachment'));
    assert.ok(chunks.every(c => c.mailboxId === 'rag-alice' && c.emailId));
  }));
  model = http.createServer(async (req, res) => {
    let bytes = ''; for await (const part of req) bytes += part;
    const payload = JSON.parse(bytes);
    const { question, snippets } = JSON.parse(payload.messages.find(m => m.role === 'user').content);
    modelCalls += 1;
    assert.ok(!JSON.stringify(snippets).includes('OTHER_SCOPE_PRIVATE'));
    if (question.includes('故障')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'synthetic-unavailable' } })); return;
    }
    const quote = question.includes('实习') ? materials : deadline;
    const hit = snippets.find(s => s.text.includes(quote));
    const result = question.includes('金额') ? { answerable: false, claims: [] }
      : { answerable: true, claims: [{ text: quote,
        evidence: [{ sourceId: question.includes('伪造') ? 'S99' : hit?.sourceId, quote }] }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const modelSettings = { ...retrieval, baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    apiKey: 'synthetic-postgres-key', model: 'synthetic-postgres-model' };
  const ask = message => inScope('alice', () => askMailboxKnowledge({ mailboxId: 'rag-alice', message, settings: modelSettings }));
  await check('Answer reads deadline beyond the display excerpt from PostgreSQL', async () => {
    const result = await ask('创新营材料补交截止到什么时候？');
    assert.equal(result.evidenceStatus, 'verified_quotes');
    assert.equal(result.citations[0].quote, deadline);
  });
  await check('Answer reads attachment details and retains attachment identity', async () => {
    const result = await ask('远航实习报到要携带哪两项材料？');
    assert.equal(result.evidenceStatus, 'verified_quotes');
    assert.equal(result.citations[0].source, 'attachment');
    assert.equal(result.citations[0].quote, materials);
  });
  await check('Owner scope rejects another mailbox before retrieval', async () => {
    await assert.rejects(inScope('alice', () => listChunks('rag-bob')), { status: 403 });
  });
  await check('Insufficient information has no unrelated citations', async () => {
    const result = await ask('创新营补贴金额是多少？');
    assert.equal(result.evidenceStatus, 'insufficient'); assert.deepEqual(result.citations, []);
  });
  await check('Invalid citation IDs return source extracts', async () => {
    const result = await ask('创新营材料 伪造');
    assert.equal(result.fallbackReason, 'citation_validation'); assert.ok(result.citations.length);
  });
  await check('Model HTTP 503 returns source extracts', async () => {
    const result = await ask('创新营材料 故障');
    assert.equal(result.fallbackReason, 'model_error'); assert.ok(result.citations.length);
  });
  await check('Pool reconnect and five concurrent reads preserve durable rows', async () => {
    await postgres.closePostgres();
    assert.deepEqual(await postgres.initPostgres(), { ok: true, mode: 'postgres' });
    const results = await Promise.all(Array.from({ length: 5 }, () => ask('创新营材料补交截止？')));
    assert.ok(results.every(r => r.evidenceStatus === 'verified_quotes' && r.citations[0].mailboxId === 'rag-alice'));
    assert.equal(Number((await admin.query('SELECT count(*) AS count FROM rag_chunks')).rows[0].count), initialRows);
  });
} catch (error) {
  failure = { name: error.name, code: error.code || null };
} finally {
  await postgres?.closePostgres();
  if (model?.listening) await new Promise(resolve => model.close(resolve));
  if (created) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    cleaned = (await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount === 0;
  }
  await admin.end();
  fs.rmSync(directory, { recursive: true, force: true });
}
const report = { checkedAt: new Date().toISOString(), ok: !failure && cleaned && checks.length === 8,
  scope: 'Real PostgreSQL, production storage path, isolated schema, synthetic original content and local model stub',
  schema, schemaRemoved: cleaned, realModelCalls: 0, localModelRequests: modelCalls, checks, ...(failure ? { failure } : {}) };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
