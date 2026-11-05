/** Summarize the fixed paired live run and recompute usage against saved prices. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nearestRank } from './lib/mail-evaluation.js';

const root = path.resolve(import.meta.dirname, '..');
const input = path.resolve(root, process.argv[2] || '');
const destination = path.join(root, 'docs/competition-rag-latency-2026-11-04/evidence');
assert.ok(input.startsWith(path.join(root, 'work') + path.sep));
const read = name => JSON.parse(fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, ''));
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = read(path.join(input, 'manifest.json'));
const results = fs.readFileSync(path.join(input, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const evaluation = read(path.join(input, 'summary.json'));
assert.equal(manifest.rounds, 3);
assert.equal(manifest.selectedCases.length, 8);
assert.equal(results.length, 48);
assert.equal(evaluation.failedAfter.length, 0);
assert.ok(results.every(row => row.correct && row.returnedScope && row.usedExpectedSources && row.quotesExact && row.expectedMode));
for (const method of ['before', 'after']) for (let round = 1; round <= 3; round += 1) {
  assert.equal(new Set(results.filter(row => row.round === round && row.method === method).map(row => row.caseId)).size, 8);
}
const previousPath = 'docs/competition-submission-2026-11-04/evidence/report-baseline.json';
const previous = read(path.join(root, previousPath));
const pricePath = 'docs/competition-2026-11-04/evidence/official-model-price.json';
const price = read(path.join(root, pricePath));
assert.equal(price.inputCnyPerMillion, 2); assert.equal(price.outputCnyPerMillion, 8);
const summarize = method => {
  const selected = results.filter(row => row.method === method);
  const calls = selected.filter(row => row.metrics.llm_tokens_in !== null);
  assert.equal(calls.length, 21);
  const inputs = calls.reduce((sum, row) => sum + row.metrics.llm_tokens_in, 0);
  const outputs = calls.reduce((sum, row) => sum + row.metrics.llm_tokens_out, 0);
  return { ...evaluation[method], modelCalls: calls.length,
    cachedInputTokens: calls.reduce((sum, row) => sum + row.metrics.llm_tokens_cached_in, 0),
    estimatedCny: (inputs * 2 + outputs * 8) / 1e6,
    modelOnlyLatency: { samples: calls.length, p50Ms: nearestRank(calls.map(row => row.latencyMs), .5),
      p95Ms: nearestRank(calls.map(row => row.latencyMs), .95) },
    answerCharacters: selected.reduce((sum, row) => sum + row.answerCharacters, 0),
    perCase: Object.fromEntries(manifest.selectedCases.map(id => {
      const rows = selected.filter(row => row.caseId === id);
      return [id, { samples: rows.length, correct: rows.filter(row => row.correct).length,
        p50Ms: nearestRank(rows.map(row => row.latencyMs), .5),
        p95Ms: nearestRank(rows.map(row => row.latencyMs), .95),
        inputTokens: rows.reduce((sum, row) => sum + (row.metrics.llm_tokens_in || 0), 0),
        outputTokens: rows.reduce((sum, row) => sum + (row.metrics.llm_tokens_out || 0), 0),
        answerCharacters: rows.reduce((sum, row) => sum + row.answerCharacters, 0) }];
    })),
  };
};
const before = summarize('before'), after = summarize('after');
const change = (first, last) => Number(((last / first - 1) * 100).toFixed(2));
const summary = { finishedAt: evaluation.finishedAt, scope: manifest.scope,
  rounds: 3, uniqueCases: 8, samplesPerMethod: 24, order: manifest.order,
  model: manifest.model, endpointOrigin: manifest.endpointOrigin, embeddings: false,
  baselineRef: manifest.baselineRef, baselineSha256: manifest.baselineSha256,
  before, after,
  relativeChangePercent: { inputTokens: change(before.inputTokens, after.inputTokens),
    outputTokens: change(before.outputTokens, after.outputTokens),
    modelOnlyP50: change(before.modelOnlyLatency.p50Ms, after.modelOnlyLatency.p50Ms),
    modelOnlyP95: change(before.modelOnlyLatency.p95Ms, after.modelOnlyLatency.p95Ms),
    estimatedCny: change(before.estimatedCny, after.estimatedCny) },
  price: { inputCnyPerMillion: 2, outputCnyPerMillion: 8, cachedInputCnyPerMillion: 2,
    source: price.source, kind: 'published-list-price-estimate', sourceSha256: hash(fs.readFileSync(path.join(root, pricePath))) },
  hashes: { manifest: hash(fs.readFileSync(path.join(input, 'manifest.json'))),
    results: hash(fs.readFileSync(path.join(input, 'results.jsonl'))) },
};
const groups = [...previous.budget.groups, ...['before', 'after'].map(method => ({ id: 'rag-concise-' + method,
  calls: summary[method].modelCalls, inputTokens: summary[method].inputTokens,
  outputTokens: summary[method].outputTokens, estimatedCny: summary[method].estimatedCny }))];
const total = { currency: 'CNY', modelCalls: groups.reduce((sum, group) => sum + group.calls, 0),
  inputTokens: groups.reduce((sum, group) => sum + group.inputTokens, 0),
  outputTokens: groups.reduce((sum, group) => sum + group.outputTokens, 0),
  estimatedModelCny: Number(groups.reduce((sum, group) => sum + group.estimatedCny, 0).toFixed(6)),
  groups, price: summary.price, budgetLimitCny: 500,
  previousBaseline: previousPath, previousBaselineSha256: hash(fs.readFileSync(path.join(root, previousPath))),
  currentSummarySha256: hash(JSON.stringify(summary, null, 2) + '\n'),
};
fs.mkdirSync(destination, { recursive: true });
for (const name of ['manifest.json', 'results.jsonl', 'corpus.json']) fs.copyFileSync(path.join(input, name), path.join(destination, name));
fs.writeFileSync(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'budget-total.json'), JSON.stringify(total, null, 2) + '\n');
const csvRows = [['round', 'caseId', 'method', 'latencyMs', 'inputTokens', 'outputTokens', 'answerCharacters', 'citations', 'estimatedCny', 'evidenceStatus'],
  ...results.map(row => [row.round, row.caseId, row.method, row.latencyMs, row.metrics.llm_tokens_in || 0,
    row.metrics.llm_tokens_out || 0, row.answerCharacters, row.citations,
    ((row.metrics.llm_tokens_in || 0) * 2 + (row.metrics.llm_tokens_out || 0) * 8) / 1e6, row.evidenceStatus])];
fs.writeFileSync(path.join(destination, 'calls.csv'), csvRows.map(row => row.map(String).map(v => JSON.stringify(v)).join(',')).join('\n') + '\n');
console.log(JSON.stringify({ before, after, relativeChangePercent: summary.relativeChangePercent, budget: total }, null, 2));
