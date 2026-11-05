import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ragEvaluation, scoreRagAnswer } from './fixtures/rag-evaluation.mjs';
import { metricsContext } from './lib/mail-evaluation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dataset = `${JSON.stringify(ragEvaluation, null, 2)}\n`;
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'dataset-validation', cases: ragEvaluation.cases.length,
    datasetSha256: hash(dataset), modelCalls: 0 }));
  process.exit(0);
}
const limit = Number(option('--limit'));
const rounds = Number(option('--rounds') || 1);
if (!option('--settings') || !Number.isSafeInteger(limit) || limit < 1 || limit > ragEvaluation.cases.length) {
  throw new Error('Use --live --settings <private file> --limit <1..8> [--baseline-ref <git ref>].');
}
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 3) throw new Error('--rounds must be 1..3.');
// Only selected model settings are read. Synthetic data is written to a new isolated directory.
let settings;
try {
  const original = JSON.parse(fs.readFileSync(path.resolve(option('--settings')), 'utf8').replace(/^\uFEFF/, ''));
  const selected = option('--settings-user') ? original.userPrefs?.[option('--settings-user')] : original;
  settings = Object.fromEntries(['baseUrl', 'apiKey', 'model'].map(key => [key, selected?.[key]]));
  const endpoint = new URL(settings.baseUrl);
  if (!settings.apiKey || !settings.model || !['https:', 'http:'].includes(endpoint.protocol)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
} catch { throw new Error('Selected model settings require a clean baseUrl, apiKey and model.'); }
settings = { ...settings, ragEnabled: true, ragEmbeddings: false };
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const runDir = fs.mkdtempSync(path.join(root, 'work', 'rag-evaluation-'));
process.env.DAYLIGHT_DATA_DIR = path.join(runDir, 'isolated-data');
process.env.DAYLIGHT_RUNTIME = 'local';
process.env.DAYLIGHT_AUTO_PROXY = '0';
fs.mkdirSync(process.env.DAYLIGHT_DATA_DIR);
fs.writeFileSync(path.join(process.env.DAYLIGHT_DATA_DIR, 'infra.json'), JSON.stringify({ postgres: { enabled: false } }));
fs.writeFileSync(path.join(runDir, 'corpus.json'), dataset);
const { ingestEmailKnowledge } = await import('../server/rag/mail-index.js');
const { askMailboxKnowledge } = await import('../server/rag/ask.js');
const { ragSearch } = await import('../server/rag/retrieve.js');
const { listChunks } = await import('../server/rag/store.js');
const baselineRef = option('--baseline-ref');
let before;
let baselineSha256 = null;
if (baselineRef) {
  const source = execFileSync('git', ['show', `${baselineRef}:server/rag/ask.js`], { cwd: root, encoding: 'utf8' });
  baselineSha256 = hash(source);
  // Instrumentation-only adaptation: imports and optional usage context. Prompt and behavior stay as committed.
  let adapted = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, relative) =>
    `from ${JSON.stringify(pathToFileURL(path.resolve(root, 'server/rag', relative)).href)}`);
  if (!source.includes('  context,')) adapted = adapted.replace('  limit = 6,', '  limit = 6,\n  context,');
  adapted = adapted.replace("{ label: '邮箱知识库问答' }", "{ context, label: '邮箱知识库问答' }");
  fs.writeFileSync(path.join(runDir, 'baseline-original.js'), source);
  const adaptedPath = path.join(runDir, 'baseline.mjs');
  fs.writeFileSync(adaptedPath, adapted);
  before = (await import(pathToFileURL(adaptedPath).href)).askMailboxKnowledge;
}
const selected = ragEvaluation.cases.slice(0, limit);
const sourceHashes = Object.fromEntries(['server/rag/ask.js', 'server/rag/answer-evidence.js', 'server/rag/retrieve.js',
  'server/model-json.js', 'scripts/evaluate-rag.mjs', 'scripts/fixtures/rag-evaluation.mjs']
  .map(name => [name, hash(fs.readFileSync(path.join(root, name)))]));
fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ startedAt: new Date().toISOString(),
  scope: ragEvaluation.scope, baselineRef, baselineSha256, baselineInstrumentation: 'Import paths and usage context only',
  sourceHashes, datasetSha256: hash(dataset), node: process.version, platform: process.platform,
  rounds, order: 'Alternate method order per case and round; same isolated corpus across rounds',
  model: settings.model, endpointOrigin: new URL(settings.baseUrl).origin, embeddings: false,
  maxModelCalls: selected.length * rounds * (before ? 2 : 1), selectedCases: selected.map(c => c.id),
  billing: 'Raw usage retained. Prices and supplier invoice are recorded separately.' }, null, 2));
const normalized = value => String(value || '').normalize('NFKC').replace(/\s/g, '');
const rows = [];
for (let round = 1; round <= rounds; round += 1) for (const [index, fixture] of selected.entries()) {
  const mailboxId = `rag-eval-${fixture.id}`;
  for (const email of fixture.documents) await ingestEmailKnowledge({ mailboxId: email.otherMailbox ? `${mailboxId}-other` : mailboxId, email, settings });
  const chunks = await listChunks(mailboxId);
  const search = await ragSearch({ mailboxId, query: fixture.question, settings, limit: 6 });
  const expectedVisibleBefore = fixture.required?.every(alternatives => alternatives.some(term => search.citations.some(c => normalized(c.quote).includes(normalized(term))))) ?? null;
  // Alternate method order per case to reduce a fixed warm-up/order advantage.
  const methods = before ? ((index + round - 1) % 2 ? [['after', askMailboxKnowledge], ['before', before]] : [['before', before], ['after', askMailboxKnowledge]]) : [['after', askMailboxKnowledge]];
  for (const [method, ask] of methods) {
    const meter = metricsContext();
    const started = performance.now();
    const actual = await ask({ mailboxId, message: fixture.question, settings, limit: 6, context: meter.context });
    const correct = scoreRagAnswer(fixture, actual.answer);
    const returnedScope = actual.citations.every(c => c.mailboxId === mailboxId);
    const usedExpectedSources = !fixture.sources || fixture.sources.every(id => actual.citations.some(c => c.emailId === id));
    const quotesExact = actual.citations.every(c => chunks.some(chunk => chunk.id === c.chunkId && chunk.content.includes(c.quote)));
    const expectedMode = !fixture.documents.length ? actual.evidenceStatus === 'extracts'
      : fixture.insufficient ? actual.evidenceStatus === 'insufficient' : actual.evidenceStatus === 'verified_quotes';
    const row = { round, caseId: fixture.id, method, latencyMs: Number((performance.now() - started).toFixed(3)),
      correct, returnedScope, usedExpectedSources, quotesExact,
      expectedMode, responseMode: actual.mode, answerCharacters: actual.answer.length,
      citations: actual.citations.length,
      evidenceStatus: actual.evidenceStatus || 'unvalidated', expectedVisibleBefore,
      metrics: meter.metrics, actual };
    rows.push(row);
    fs.appendFileSync(path.join(runDir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
    console.log(`round=${round} ${method} ${fixture.id} correct=${correct} evidence=${row.evidenceStatus} ${row.latencyMs}ms`);
  }
}
const summarize = method => {
  const selectedRows = rows.filter(row => row.method === method);
  const times = selectedRows.map(row => row.latencyMs).sort((a, b) => a - b);
  const percentile = q => times[Math.max(0, Math.ceil(times.length * q) - 1)] ?? null;
  return { cases: selectedRows.length, correct: selectedRows.filter(r => r.correct).length,
    scopeCorrect: selectedRows.filter(r => r.returnedScope).length, exactQuoteCases: selectedRows.filter(r => r.quotesExact).length,
    expectedModes: selectedRows.filter(r => r.expectedMode).length,
    modelErrors: selectedRows.filter(r => r.actual.fallbackReason === 'model_error').length,
    citationValidationFallbacks: selectedRows.filter(r => r.actual.fallbackReason === 'citation_validation').length,
    modelCallsWithUsage: selectedRows.filter(r => r.metrics.llm_tokens_in !== null).length,
    inputTokens: selectedRows.reduce((s, r) => s + (r.metrics.llm_tokens_in || 0), 0),
    outputTokens: selectedRows.reduce((s, r) => s + (r.metrics.llm_tokens_out || 0), 0),
    p50Ms: percentile(.5), p95Ms: percentile(.95) };
};
const summary = { finishedAt: new Date().toISOString(), scope: ragEvaluation.scope, rounds,
  before: before ? summarize('before') : null, after: summarize('after'),
  failedAfter: rows.filter(r => r.method === 'after' && (!r.correct || !r.returnedScope || !r.usedExpectedSources || !r.quotesExact || !r.expectedMode)).map(r => ({ round: r.round, caseId: r.caseId })) };
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('RAG_EVALUATION_SAVED', path.relative(root, runDir), JSON.stringify(summary));
if (summary.failedAfter.length) process.exitCode = 1;
