#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';

const [origin, output] = process.argv.slice(2);
if (!origin || !output || !['http:', 'https:'].includes(new URL(origin).protocol)) throw new Error('Usage: node scripts/benchmark-experience.mjs <origin> <output.json>');
const samples = [];
async function probe(batch, i) {
  const started = performance.now();
  const response = await fetch(`${origin}/api/experience?step=7`, { signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  let result; try { result = JSON.parse(body); } catch { /* record failed response */ }
  const row = { batch, i, ms: performance.now() - started, status: response.status, bytes: Buffer.byteLength(body),
    success: response.ok && result?.step === 7 && result?.modelCalls === 0 && result?.steps?.[4]?.status === 'failed' && result?.steps?.[5]?.status === 'completed',
    serverMs: result?.serverDurationMs ?? null };
  samples.push(row);
}
for (let i = 0; i < 20; i++) await probe('sequential', i);
for (let batch = 0; batch < 5; batch++) await Promise.all(Array.from({ length: 4 }, (_, i) => probe('concurrent-4', batch*4+i)));
const percentile = (values, q) => values.sort((a, b) => a-b)[Math.max(0, Math.ceil(values.length*q)-1)];
const summary = Object.fromEntries(['sequential', 'concurrent-4'].map(batch => {
  const rows = samples.filter(item => item.batch === batch);
  return [batch, { count: rows.length, successes: rows.filter(row => row.success).length, meanMs: rows.reduce((sum, row) => sum+row.ms, 0)/rows.length,
    p50Ms: percentile(rows.map(row => row.ms), .5), p95Ms: percentile(rows.map(row => row.ms), .95), maxBytes: Math.max(...rows.map(row => row.bytes)) }];
}));
fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), origin, path: '/api/experience?step=7',
  scope: 'Synthetic preset through live tools. 40 bounded HTTPS requests, client wall time, includes failed responses. Not live model throughput.',
  method: 'Nearest rank; 20 sequential, then 5 batches of 4 concurrent', summary, samples }, null, 2));
console.log(JSON.stringify(summary));
if (samples.some(row => !row.success)) process.exitCode = 1;
