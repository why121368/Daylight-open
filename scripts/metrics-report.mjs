#!/usr/bin/env node
/**
 * Reads the metrics sink written by server/metrics.js and prints a human-readable report.
 *
 * The recorder keeps every raw sample in `metrics-<host>-<pid>.jsonl` precisely so that any
 * percentile can be recomputed later; this tool re-derives the numbers from those files
 * instead of trusting the summaries, and only uses summaries for health flags
 * (`sinkError`, `dropped`, provenance).
 *
 * Usage:
 *   node scripts/metrics-report.mjs [dir] [--json] [--top N] [--metric <name>]
 *
 * `dir` defaults to DAYLIGHT_METRICS_DIR, then <DAYLIGHT_DATA_DIR>/metrics, then data/metrics.
 * Inside Compose the sink lives on the shared metrics-data volume:
 *   docker compose exec api node scripts/metrics-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const options = {};
let positional;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--json') options.json = true;
  else if (/^--(?:top|metric)(?:=|$)/.test(arg)) {
    const [name, value] = arg.slice(2).split('=', 2);
    options[name] = value === undefined ? args[++index] : value;
    if (!options[name] || options[name].startsWith('--')) throw new Error(`Missing value for --${name}`);
  } else if (!arg.startsWith('--') && !positional) positional = arg;
  else throw new Error(`Unexpected argument: ${arg}`);
}
const jsonOnly = Boolean(options.json);
const top = Math.max(1, Number(options.top) || 12);
const focus = options.metric || null;

const dataDir = process.env.DAYLIGHT_DATA_DIR || 'data';
const dir = path.resolve(positional || process.env.DAYLIGHT_METRICS_DIR || path.join(dataDir, 'metrics'));

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))));
  return sorted[index];
}
const round = value => (value === null || value === undefined ? null : Number(value.toFixed(3)));

if (!fs.existsSync(dir)) {
  const message = `no metrics sink at ${dir} — run with DAYLIGHT_METRICS=1 to record one`;
  if (jsonOnly) console.log(JSON.stringify({ dir, error: message }, null, 2));
  else console.error(message);
  process.exitCode = 2;
} else {
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
  const processes = [];
  const series = new Map();
  let malformed = 0;
  const runIds = new Set();
  const git = new Set();
  let firstTs = null;
  let lastTs = null;

  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);
    let kept = 0;
    for (const line of lines) {
      let sample;
      try { sample = JSON.parse(line); } catch { malformed += 1; continue; }
      if (!sample || typeof sample.metric !== 'string') { malformed += 1; continue; }
      kept += 1;
      if (sample.runId) runIds.add(sample.runId);
      if (sample.gitSha) git.add(`${sample.gitSha}${sample.dirty === true ? ' (dirty)' : sample.dirty === false ? ' (clean)' : ''}`);
      if (sample.ts) { if (!firstTs || sample.ts < firstTs) firstTs = sample.ts; if (!lastTs || sample.ts > lastTs) lastTs = sample.ts; }
      const entry = series.get(sample.metric) || { unit: sample.unit, values: [], labels: new Map() };
      if (typeof sample.value === 'number' && Number.isFinite(sample.value)) entry.values.push(sample.value);
      const labelKey = Object.entries(sample.labels || {}).map(([k, v]) => `${k}=${v}`).sort().join(',') || '(none)';
      const bucket = entry.labels.get(labelKey) || [];
      if (typeof sample.value === 'number' && Number.isFinite(sample.value)) bucket.push(sample.value);
      entry.labels.set(labelKey, bucket);
      series.set(sample.metric, entry);
    }
    processes.push({ file, samples: kept });
  }

  const summaries = [];
  const summaryErrors = [];
  const summaryFiles = fs.readdirSync(dir).filter(name => /^metrics-summary(?:-[a-zA-Z0-9_.-]+)?\.json$/.test(name));
  for (const file of summaryFiles) {
    try { summaries.push({ file, ...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) }); }
    catch (error) { summaryErrors.push({ file, error: error.code || error.name }); }
  }

  const rows = [...series.entries()].map(([metric, entry]) => {
    const sorted = [...entry.values].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return { metric, unit: entry.unit, count: sorted.length, min: round(sorted[0] ?? null),
      p50: round(percentile(sorted, 0.5)), p90: round(percentile(sorted, 0.9)),
      p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? null), mean: sorted.length ? round(sum / sorted.length) : null };
  }).sort((a, b) => b.count - a.count);

  const health = summaries.map(summary => ({ file: summary.file, role: summary.role, runId: summary.runId,
    written: summary.written, dropped: summary.dropped, buffered: summary.buffered, inFlight: summary.inFlight,
    sinkError: summary.sinkError, sampling: summary.sampling, gitSha: summary.gitSha, dirty: summary.dirty,
    limits: summary.limits, retention: summary.retention }));

  const report = {
    dir, files: files.length, samples: rows.reduce((n, row) => n + row.count, 0), malformed,
    window: firstTs && lastTs ? { from: firstTs, to: lastTs } : null,
    runIds: [...runIds], provenance: [...git], processes, health, summaryErrors,
    metrics: rows,
    focus: focus && series.has(focus) ? {
      metric: focus,
      labels: [...series.get(focus).labels.entries()]
        .map(([key, values]) => { const sorted = [...values].sort((a, b) => a - b);
          return { labels: key, count: sorted.length, p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), max: round(sorted.at(-1) ?? null) }; })
        .sort((a, b) => b.count - a.count).slice(0, top),
    } : null,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`metrics sink: ${dir}`);
    console.log(`  ${files.length} process file(s), ${report.samples} samples, ${malformed} malformed line(s)`);
    if (report.window) console.log(`  window: ${report.window.from} → ${report.window.to}`);
    if (report.runIds.length) console.log(`  runId(s): ${report.runIds.join(', ')}`);
    if (report.provenance.length) console.log(`  provenance: ${report.provenance.join(', ')}`);
    for (const process_ of report.processes) console.log(`  - ${process_.file}: ${process_.samples}`);
    const problems = health.filter(h => h.sinkError || h.dropped);
    console.log(`  health: ${health.length} summaries; ${problems.length} with drops or sink errors; ${summaryErrors.length} unreadable`);
    console.log('');
    const header = ['metric', 'count', 'unit', 'p50', 'p95', 'p99', 'max', 'mean'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.slice(0, top).map(r =>
      String([r.metric, r.count, r.unit, r.p50, r.p95, r.p99, r.max, r.mean][i] ?? '').length)));
    const line = cells => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
    console.log(line(header));
    console.log(widths.map(w => '─'.repeat(w)).join('  '));
    for (const row of rows.slice(0, Math.max(top, 1))) {
      console.log(line([row.metric, row.count, row.unit, row.p50, row.p95, row.p99, row.max, row.mean]));
    }
    if (rows.length > top) console.log(`  … ${rows.length - top} more metric(s); use --top N`);
    if (focus) {
      if (!report.focus) console.log(`\nno samples for --metric ${focus}`);
      else {
        console.log(`\n${focus} by label set (top ${report.focus.labels.length}):`);
        for (const row of report.focus.labels) {
          console.log(`  ${row.labels}  n=${row.count} p50=${row.p50} p95=${row.p95} max=${row.max}`);
        }
      }
    }
  }
}
