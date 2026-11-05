import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-rag-answer-'));
process.env.DAYLIGHT_DATA_DIR = directory;
fs.writeFileSync(path.join(directory, 'infra.json'), JSON.stringify({ postgres: { enabled: false } }));
const { buildAnswerSources, validateAnswerEvidence } = await import('./rag/answer-evidence.js');
const { askMailboxKnowledge } = await import('./rag/ask.js');
const { ingestEmailKnowledge } = await import('./rag/mail-index.js');

const source = (id, text, mailboxId = 'mailbox-a') => ({ chunkId: id, filename: id, page: 1,
  mailboxId, emailId: `imap:${id}`, attachmentId: `mailbody:${id}`, content: text, quote: text.slice(0, 280) });
const corpus = [source('deadline', '报名截止为11月6日17:00。'), source('location', '面试地点为学术中心203室。')];
const sources = buildAnswerSources({ hits: corpus, citations: corpus });
const claim = (sourceId, quote, text = '请按通知处理。') => ({ text, evidence: [{ sourceId, quote }] });

test('answer context preserves a late detail lost from the 280-character display excerpt', () => {
  const text = `主题：材料提交说明\n${'本次通知包含报名流程及联系说明。'.repeat(22)}\n材料补交截止为11月6日17:00。`;
  const hit = source('long', text);
  assert.equal(hit.quote.includes('11月6日17:00'), false);
  const built = buildAnswerSources({ hits: [hit], citations: [hit] });
  assert.match(built[0].text, /11月6日17:00/);
  assert.equal(built[0].citation.quote, hit.quote);
});

test('answer sources keep total and individual context bounded, including long legacy chunks', () => {
  const hits = Array.from({ length: 12 }, (_, i) => source(`long-${i}`, '通知资料'.repeat(2000)));
  const built = buildAnswerSources({ hits, citations: hits }, 20);
  assert.ok(built.length <= 8);
  assert.ok(built.every(item => item.text.length <= 1200));
  assert.ok(built.reduce((sum, item) => sum + item.text.length, 0) <= 6400);
});

test('only used evidence is returned and server numbers follow claim order', () => {
  const checked = validateAnswerEvidence({ answerable: true, claims: [
    claim('S2', '面试地点为学术中心203室。', '请去学术中心203室。[99]'),
    claim('S1', '报名截止为11月6日17:00。', '请在11月6日17:00前报名。'),
  ] }, sources);
  assert.equal(checked.evidenceStatus, 'verified_quotes');
  assert.match(checked.answer, /203室。 \[1\]/);
  assert.match(checked.answer, /报名前|17:00前报名。 \[2\]/);
  assert.ok(!checked.answer.includes('[99]'));
  assert.deepEqual(checked.citations.map(item => item.chunkId), ['location', 'deadline']);
  assert.ok(checked.citations.every(item => item.evidenceChecked));
  const subset = validateAnswerEvidence({ answerable: true, claims: [claim('S2', '面试地点为学术中心203室。')] }, sources);
  assert.deepEqual(subset.citations.map(item => item.chunkId), ['location']);
});

test('unknown sources, invented quotes, quotes from another source, empty and oversized claims reject the answer', () => {
  const invalid = [
    { answerable: true, claims: [claim('S3', '报名截止为11月6日17:00。')] },
    { answerable: true, claims: [claim('S1', '报名截止为12月31日。')] },
    { answerable: true, claims: [claim('S1', '面试地点为学术中心203室。')] },
    { answerable: true, claims: [claim('S1', '11')] },
    { answerable: true, claims: [{ text: '编造的结论', evidence: [] }] },
    { answerable: true, claims: [claim('S1', '报名截止为11月6日17:00。', '字'.repeat(601))] },
    { answer: '旧格式没有来源' },
    { answerable: true, claims: [] },
    { answerable: false, claims: [claim('S1', '报名截止为11月6日17:00。')] },
  ];
  for (const value of invalid) assert.equal(validateAnswerEvidence(value, sources), null);
});

test('insufficient evidence returns a fixed response without attaching unrelated sources', () => {
  const checked = validateAnswerEvidence({ answerable: false, claims: [] }, sources);
  assert.equal(checked.evidenceStatus, 'insufficient');
  assert.deepEqual(checked.citations, []);
  assert.match(checked.answer, /还没有找到/);
});

test('exact duplicate evidence is reused while individual quotes keep their original metadata', () => {
  const checked = validateAnswerEvidence({ answerable: true, claims: [
    claim('S1', '报名截止为11月6日17:00。'), claim('S1', '报名截止为11月6日17:00。'),
  ] }, sources);
  assert.equal(checked.citations.length, 1);
  assert.equal(checked.citations[0].mailboxId, 'mailbox-a');
  assert.equal(checked.citations[0].quote, '报名截止为11月6日17:00。');
  assert.equal((checked.answer.match(/\[1\]/g) || []).length, 2);
});

test('invalid model evidence and model errors produce explicit extracts, never the unsupported answer', async t => {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* consume the request */ }
    calls += 1;
    res.writeHead(calls === 1 ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(calls === 1 ? { choices: [{ message: { content: JSON.stringify({ answerable: true,
      claims: [claim('S99', '这是不存在的来源。', '请在12月31日提交。')] }) } }] } : { error: { message: 'synthetic-unavailable' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const settings = { ragEnabled: true, ragEmbeddings: false, baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'synthetic-rag-key', model: 'synthetic-rag' };
  await ingestEmailKnowledge({ mailboxId: 'model-evidence', email: { id: 'imap:evidence', subject: '材料提交', body: '材料提交截止为11月6日17:00。' }, settings });
  const rejected = await askMailboxKnowledge({ mailboxId: 'model-evidence', message: '材料提交截止', settings });
  assert.equal(rejected.fallbackReason, 'citation_validation');
  assert.equal(rejected.evidenceStatus, 'extracts');
  assert.ok(!rejected.answer.includes('12月31日'));
  assert.ok(rejected.notice);
  const failed = await askMailboxKnowledge({ mailboxId: 'model-evidence', message: '材料提交截止', settings });
  assert.equal(failed.fallbackReason, 'model_error');
  assert.ok(failed.citations.length);
  assert.match(failed.notice, /暂时不可用/);
  assert.equal(calls, 2);
});

test('one concise answer can cover multiple facts and retain both original source references', () => {
  const checked = validateAnswerEvidence({ answerable: true, claims: [{
    text: '请在11月6日17:00前报名，并前往学术中心203室。',
    evidence: [{ sourceId: 'S1', quote: '报名截止为11月6日17:00。' },
      { sourceId: 'S2', quote: '面试地点为学术中心203室。' }],
  }] }, sources);
  assert.equal(checked.answer, '请在11月6日17:00前报名，并前往学术中心203室。 [1] [2]');
  assert.deepEqual(checked.citations.map(item => item.emailId), ['imap:deadline', 'imap:location']);
  assert.ok(checked.citations.every(item => item.evidenceChecked));
});
