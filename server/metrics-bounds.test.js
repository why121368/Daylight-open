import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createMetricsSink } from './metrics-sink.js';

const metricsUrl = new URL('./metrics.js', import.meta.url).href;
const reporter = new URL('../scripts/metrics-report.mjs', import.meta.url);
const runFile = promisify(execFile);
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-metrics-bounds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function child(dir, script, env = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, DAYLIGHT_METRICS: '1', DAYLIGHT_METRICS_DIR: dir,
      DAYLIGHT_GIT_SHA: 'bounds-test', DAYLIGHT_GIT_DIRTY: '0', DAYLIGHT_METRICS_BUFFER: '100',
      DAYLIGHT_METRICS_BUFFER_BYTES: '4096', ...env },
  });
}

test('slow disk charges in-flight data to both limits without growing a second queue', t => {
  const dir = directory(t);
  const result = JSON.parse(child(dir, `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const original = fs.promises.appendFile;
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const writing = new Promise(resolve => { entered = resolve; });
    fs.promises.appendFile = async (...args) => { entered(); await gate; return original(...args); };
    const m = await import(${JSON.stringify(metricsUrl)});
    m.startMetrics({ role: 'slow-disk' });
    m.counter('before.write');
    const pending = m.flushMetrics();
    await writing;
    let maxSamples=0, maxBytes=0;
    for(let n=0;n<2000;n++) {
      m.counter('under.load');
      assert.equal(m.flushMetrics(), pending);
      const s=m.metricsStatus();
      maxSamples=Math.max(maxSamples,s.buffered+s.inFlight);
      maxBytes=Math.max(maxBytes,s.bufferedBytes+s.inFlightBytes);
      assert.ok(maxSamples<=s.limits.samples);
      assert.ok(maxBytes<=s.limits.bytes);
    }
    const congested=m.metricsStatus();
    assert.ok(congested.dropped>0);
    assert.ok(congested.inFlight>0);
    release();
    await m.stopMetrics();
    const final=m.metricsStatus();
    const saved=JSON.parse(fs.readFileSync(final.summary,'utf8'));
    assert.equal(saved.written,final.written);
    assert.equal(saved.dropped,final.dropped);
    assert.equal(final.buffered+final.inFlight,0);
    assert.equal(final.sinkError,null);
    console.log(JSON.stringify({maxSamples,maxBytes,dropped:final.dropped,written:final.written}));
  `));
  assert.ok(result.maxBytes <= 4096);
  assert.ok(result.maxSamples <= 100);
  assert.ok(result.dropped > 1900);
});

test('shutdown awaits failed writes and persists their final dropped count', t => {
  const dir = directory(t);
  child(dir, `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    fs.promises.appendFile=async()=>{ await new Promise(r=>setTimeout(r,20)); throw Object.assign(new Error('fixture'),{code:'ENOSPC'}); };
    const m=await import(${JSON.stringify(metricsUrl)});
    m.startMetrics({role:'disk-full'});m.counter('last.sample');
    await m.stopMetrics();
    const s=m.metricsStatus(), saved=JSON.parse(fs.readFileSync(s.summary,'utf8'));
    assert.equal(saved.written,0);assert.equal(saved.dropped,2);assert.equal(saved.sinkError,'ENOSPC');
    assert.equal(m.counter('closed.sample'),false);
  `);
});

test('rotated files obey the per-process file count and byte limits', async t => {
  const dir = directory(t);
  const file = path.join(dir, 'metrics-rotation-1.jsonl');
  const sink = createMetricsSink({ file, summaryFile: path.join(dir,'metrics-summary-rotation-1.json'), maxFileBytes: 1024, maxFiles: 3, directoryBytes: 10000 });
  const line = `${JSON.stringify({metric:'probe',value:1,unit:'count',padding:'x'.repeat(830)})}\n`;
  for (let index = 0; index < 30; index += 1) await sink.append(line);
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
  assert.equal(files.length, 3);
  for(const name of files) {
    assert.ok(fs.statSync(path.join(dir,name)).size<=1024);
    for(const row of fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n')) assert.equal(JSON.parse(row).metric,'probe');
  }
});

test('directory retention reclaims files left by previous instances', async t => {
  const dir = directory(t);
  const line = `${JSON.stringify({metric:'probe',value:1,unit:'count',padding:'x'.repeat(700)})}\n`;
  let evicted = 0;
  for(let index=0;index<30;index+=1) {
    const sink = createMetricsSink({file:path.join(dir,`metrics-instance-${index}.jsonl`), summaryFile:path.join(dir,`metrics-summary-instance-${index}.json`),maxFileBytes:1024,maxFiles:3,directoryBytes:4096});
    await sink.append(line);
    await sink.summary({role:'restart',written:1});
    evicted += sink.status().evictedFiles;
    assert.ok(fs.readdirSync(dir).reduce((sum,name)=>sum+fs.statSync(path.join(dir,name)).size,0)<=4096);
  }
  assert.ok(evicted>0);
});

test('three roles produce independent atomic summaries and the CLI aggregates each', async t => {
  const dir = directory(t);
  await Promise.all(['api','worker','scheduler'].map(role => runFile(process.execPath, ['--input-type=module', '-e', `
    const m=await import(${JSON.stringify(metricsUrl)});
    m.startMetrics({role:${JSON.stringify(role)}});m.observe('role.latency.ms',7,'ms');await m.stopMetrics();
  `], {timeout:15000,env:{...process.env,DAYLIGHT_METRICS:'1',DAYLIGHT_METRICS_DIR:dir,DAYLIGHT_GIT_SHA:'bounds-test',DAYLIGHT_GIT_DIRTY:'0',HOSTNAME:`test-${role}`}})));
  const report = JSON.parse(execFileSync(process.execPath, [fileURLToPath(reporter), dir, '--json', '--metric', 'role.latency.ms'], {encoding:'utf8'}));
  assert.deepEqual(report.health.map(item=>item.role).sort(), ['api','scheduler','worker']);
  assert.equal(report.focus.labels[0].count,3);
  assert.equal(report.malformed,0);
  assert.deepEqual(report.summaryErrors,[]);
  assert.equal(fs.readdirSync(dir).some(name=>name.endsWith('.tmp')),false);
  assert.ok(report.health.every(item=>item.dropped===0 && item.sinkError===null && item.written===2));
});

test('metric identities, numeric payloads and aggregate cardinality are bounded', t => {
  const dir = directory(t);
  child(dir, `
    import assert from 'node:assert/strict';
    const m=await import(${JSON.stringify(metricsUrl)});
    m.startMetrics({role:'cardinality'});
    assert.equal(m.gauge('bad.payload',{},'count'),false);
    assert.equal(m.gauge('bad.nan',NaN,'ms'),false);
    assert.equal(m.counter('x'.repeat(500)),false);
    assert.equal(m.gauge('bad.unit',1,'x'.repeat(100)),false);
    for(let n=0;n<200;n++){m.counter('name.'+n);await m.flushMetrics();}
    assert.ok(Object.keys(m.metricsSummary().metrics).length<=16);
    assert.ok(m.metricsStatus().dropped>180);
    await m.stopMetrics();
  `, {DAYLIGHT_METRICS_SERIES:'16'});
});
