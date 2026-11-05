import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2] || 'https://daylight.yunforis.com').origin;
const output = process.argv[3];
const request = (path, init = {}) => fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(15000) });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const response = await request('/api/experience?step=7');
assert.equal(response.status, 200);
assert.match(response.headers.get('cache-control'), /no-store/);
const data = await response.json();
const statuses = data.steps.map(item => item.status);
assert.deepEqual(statuses, ['completed', 'conflict', 'completed', 'duplicate', 'failed', 'completed', 'completed']);
assert.equal(data.modelCalls, 0);
assert.equal(data.persisted, false);
assert.deepEqual(data.steps[3].before, data.steps[3].after);
assert.deepEqual(data.steps[4].before, data.steps[4].after);
assert.equal(data.events.filter(item => item.status === 'cancelled').length, 2);
const assertions = { statuses, cancelledEvents: 2, tasks: data.tasks.length, modelCalls: data.modelCalls, persisted: data.persisted };
const checks = await Promise.all([
  ['/competition/container-report.html',200], ['/competition/container-assets/assets/container.webp',200], ['/competition/container-assets/evidence/summary.json',200], ['/competition/container-assets/evidence/candidate-runtime.json',200], ['/competition/container-assets/evidence/budget-total.json',200],
  ['/health/ready', 200], ['/api/state', 401], ['/api/experience?step=8', 400],
  ['/experience', 200], ['/experience?step=3', 200], ['/evidence', 200], ['/competition/architecture.webp', 200],
  ['/competition/dataflow.webp', 200], ['/competition/performance.webp', 200], ['/competition/experience-qr.png', 200],
  ['/competition/report.html', 200], ['/competition/performance-report.html', 200],
  ['/competition/capacity-design.html', 200], ['/competition/k8s-measurements.html', 200],
  ['/competition/reproduce.html', 200], ['/competition/deployment-snapshot.html', 200],
  ['/competition/report-assets/evidence/model-full/summary.json', 200],
  ['/competition/report-assets/evidence/model-full/results.jsonl', 200],
  ['/competition/operations-report.html', 200], ['/competition/observability.webp', 200],
  ['/competition/operations-assets/evidence/cost-estimate.json', 200],
  ['/competition/operations-assets/evidence/cost-estimate.csv', 200],
  ['/competition/operations-assets/evidence/official-model-price.json', 200],
  ['/competition/operations-assets/images/official-model-price.jpg', 200],
  ['/competition/operations-assets/evidence/metrics-cloud-overhead.json', 200],
  ['/competition/operations-assets/evidence/metrics-live-v7.json', 200],
  ['/competition/operations-assets/evidence/candidate-tests-v7.txt', 200],
  ['/competition/operations-assets/evidence/deploy-v7.txt', 200],
  ['/competition/operations-assets/evidence/release-v7-manifest.json', 200],
  ['/competition/operations-assets/evidence/public-verification-v7.json', 200],
  ['/competition/operations-assets/evidence/public-metrics-off.json', 200],
  ['/competition/operations-assets/evidence/public-metrics-on.json', 200],
  ['/competition/operations-assets/images/cost-mobile.jpg', 200],
  ['/competition/rag-report.html', 200], ['/competition/rag-evidence.webp', 200],
  ['/competition/rag-assets/evidence/summary.json', 200],
  ['/competition/rag-assets/evidence/results.jsonl', 200],
  ['/competition/rag-assets/evidence/cost-estimate.json', 200],
  ['/competition/technical-report.html', 200], ['/competition/technical-report.pdf', 200],
  ['/competition/rag-release-v10.html', 200],
  ['/competition/submission-assets/evidence/report-manifest.json', 200],
  ['/competition/value-report.html', 200], ['/competition/value-study.html', 200], ['/competition/budget.html', 200],
  ['/competition/value-assets/assets/study-flow.webp', 200],
  ['/competition/value-assets/evidence/summary.json', 200],
  ['/competition/value-assets/evidence/preflight.json', 200],
  ['/competition/value-assets/evidence/study-inputs.json', 200],
  ['/competition/value-assets/evidence/calls.csv', 200], ['/api/study/config', 401],
  ['/competition/reply-review-report.html', 200], ['/competition/value-release-v12.html', 200],
  ['/competition/reply-assets/assets/reply-flow.webp', 200],
  ['/competition/reply-assets/evidence/postgres-verification.json', 200],
  ['/competition/reply-assets/evidence/ui-layout.json', 200],
  ['/demo', 200], ['/competition/demo-chapters.json', 200],
  ['/competition/demo-zh.vtt', 200], ['/competition/demo-chapters.vtt', 200],
  ['/competition/demo-poster.jpg', 200], ['/competition/demo-transcript.txt', 200],
  ['/competition/demo-transcript.html', 200], ['/competition/video-report.html', 200],
  ['/competition/reply-release-v13.html', 200],
  ['/competition/report-refresh.html', 200],
  ['/competition/video-release-v14.html', 200],
  ['/competition/submission-assets/evidence/report-baseline.json', 200],
  ['/competition/rag-latency-report.html', 200],
  ['/competition/rag-latency-assets/assets/concise-answers.webp', 200],
  ['/competition/rag-latency-assets/evidence/summary.json', 200],
  ['/competition/rag-latency-assets/evidence/budget-total.json', 200],
  ['/competition/rag-latency-assets/evidence/results.jsonl', 200],
  ['/competition/entry-report.html', 200],
  ['/competition/entry-assets/assets/entry-loading.webp', 200],
  ['/competition/entry-assets/evidence/summary.json', 200],
  ['/competition/entry-assets/evidence/budget-total.json', 200],
  ['/competition/entry-assets/evidence/browser-samples.json', 200],
  ['/logo-small.webp', 200],
  ['/competition/entry-release-v17.html', 200],
  ['/competition/recovery-report.html', 200],
  ['/competition/recovery-assets/assets/recovery-flow.webp', 200],
  ['/competition/recovery-assets/image-generation.json', 200],
  ['/competition/recovery-assets/evidence/recovery-summary.json', 200],
  ['/competition/recovery-assets/evidence/recovery-proof.json', 200],
  ['/competition/recovery-assets/evidence/encrypted-copy.json', 200],
  ['/competition/recovery-assets/evidence/budget-total.json', 200],
  ['/competition/recovery-release-v18.html', 200],
  ['/competition/continuity-report.html', 200],
  ['/competition/continuity-assets/assets/continuity.webp', 200],
  ['/competition/continuity-assets/image-generation.json', 200],
  ['/competition/continuity-assets/evidence/local-behavior.json', 200],
  ['/competition/continuity-assets/evidence/local-layouts.json', 200],
  ['/competition/continuity-assets/evidence/local-qr-verification.json', 200],
  ['/competition/continuity-assets/evidence/bundle-summary.json', 200],
  ['/competition/continuity-assets/evidence/budget-total.json', 200],
  ['/competition/delivery-report.html', 200],
  ['/competition/delivery-assets/assets/delivery.webp', 200],
  ['/competition/delivery-assets/image-generation.json', 200],
  ['/competition/delivery-assets/evidence/package-summary.json', 200],
  ['/competition/delivery-assets/evidence/reproduction.json', 200],
  ['/competition/delivery-assets/evidence/package-browser.json', 200],
  ['/competition/delivery-assets/evidence/verification-summary.json', 200],
  ['/competition/delivery-assets/evidence/budget-total.json', 200],
  ['/competition/experience-step-qr.json', 200],
  ...Array.from({length:8},(_,step)=>[`/competition/experience-step-${step}-qr.png`,200]),
].map(async ([path, expected]) => {
  const result = await request(path);
  assert.equal(result.status, expected, path);
  const bytes = new Uint8Array(await result.arrayBuffer());
  const sha256 = digest(bytes);
  if (path === '/health/ready') {
    const readiness = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(readiness.ok, true);
    assert.equal(readiness.metrics.enabled, true);
    assert.equal(readiness.metrics.dropped, 0);
    assert.equal(readiness.metrics.sinkError, null);
  }
  if (path.startsWith('/competition/')) {
    assert.equal(sha256, digest(await readFile(new URL(`../public${path}`, import.meta.url))), path);
  }
  if (path.endsWith('.pdf')) {
    assert.match(result.headers.get('content-type'), /application\/pdf/);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  }
  if (path === '/competition/entry-assets/evidence/summary.json') {
    const entry = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(entry.bundle.before.experienceJavaScript.gzipBytes, 210510);
    assert.equal(entry.bundle.after.experienceJavaScript.gzipBytes, 165987);
    assert.equal(entry.bundle.after.combinedGzipJsCssAndBootImageBytes, 202384);
    assert.equal(entry.bundle.reductions.combinedGzipJsCssAndBootImagePercent, 44.11);
    assert.ok(Object.values(entry.bundle.after.excludedPublicModules).every(Boolean));
    for (const width of [390,1440]) for (const version of ['before','after']) assert.equal(entry.browser[width][version].samples, 5);
    assert.equal(entry.costs.realModelCalls, 0);
    assertions.publicEntry = { samples: 20, gzipJavaScriptBytes: 165987, combinedBytesReductionPercent: 44.11 };
  }
  if (path === '/logo-small.webp') {
    assert.match(result.headers.get('content-type'), /image\/webp/);
    assert.equal(sha256, digest(await readFile(new URL('../public/logo-small.webp', import.meta.url))));
    assert.equal(bytes.length, 8278);
  }
  if (path.endsWith('.vtt')) {
    assert.match(result.headers.get('content-type'), /text\/vtt/);
    const vtt = new TextDecoder().decode(bytes);
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    assert.equal((vtt.match(/ --> /g) || []).length, 12);
  }
  if (path === '/competition/demo-chapters.json') {
    const catalog = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(catalog.chapters.length, 12);
    assert.equal(catalog.chapters.at(-1).end, 180);
    assert.equal(catalog.chapters.find(row => row.id === 'architecture').start, 135);
    assert.equal(catalog.bytes, 1431534);
    assertions.demoVideo = { chapters: 12, encodedDurationSeconds: catalog.encodedDurationSeconds, videoBytes: catalog.bytes, silent: catalog.silent };
  }
  if (path === '/competition/value-assets/evidence/summary.json') {
    const study = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(study.kind, 'automated-fixture-preflight');
    assert.equal(study.realModelCalls, 10);
    assert.equal(study.participants, 0);
    assert.deepEqual(study.sets.map(row => [row.passed, row.total, row.errors]), [[12,12,0],[12,12,0]]);
    assertions.studyPreflight = { calls: study.realModelCalls, participants: study.participants, passed: [12,12] };
  }
  if (path === '/competition/reply-assets/evidence/postgres-verification.json') {
    const reply = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(reply.ok, true); assert.equal(reply.schemaRemoved, true);
    assert.equal(reply.checks.length, 8); assert.ok(reply.checks.every(row => row.passed));
    assert.equal(reply.realModelCalls, 0); assert.equal(reply.realSmtpCalls, 0);
    assertions.replyPostgres = { passed: 8, schemaRemoved: true, realModelCalls: 0, realSmtpCalls: 0 };
  }
  if (path === '/competition/submission-assets/evidence/report-baseline.json') {
    const baseline = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(baseline.snapshotRelease, 'daylight:public-competition-20261104-v14');
    assert.deepEqual(baseline.tests, { tests: 1017, pass: 988, fail: 0, skipped: 29 });
    assert.equal(baseline.budget.modelCalls, 42);
    assert.equal(baseline.budget.estimatedModelCny, 0.40682);
    assert.equal(baseline.value.participants, 0);
    const manifest = JSON.parse(await readFile(new URL('../public/competition/submission-assets/evidence/report-manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.baselineSha256, sha256);
    assert.equal(manifest.pages, manifest.bookmarks);
    assert.equal(manifest.pages, 21);
    assertions.report = { snapshotRelease: baseline.snapshotRelease, pages: manifest.pages, sourceRecords: Object.keys(baseline.sourceHashes).length, testsPassed: baseline.tests.pass, modelCalls: baseline.budget.modelCalls };
  }
  if (path === '/competition/rag-latency-assets/evidence/summary.json') {
    const rag = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(rag.rounds, 3); assert.equal(rag.uniqueCases, 8);
    for (const method of ['before', 'after']) {
      assert.equal(rag[method].correct, 24); assert.equal(rag[method].scopeCorrect, 24);
      assert.equal(rag[method].exactQuoteCases, 24); assert.equal(rag[method].expectedModes, 24);
      assert.equal(rag[method].modelOnlyLatency.samples, 21);
    }
    assert.equal(rag.after.modelOnlyLatency.p95Ms, 3134.212);
    assert.equal(rag.after.outputTokens, 3812);
    assertions.ragLatency = { rounds: 3, cases: 8, modelCalls: 42, checkedPerVersion: 24, afterModelP95Ms: rag.after.modelOnlyLatency.p95Ms };
  }
  if (path === '/competition/recovery-assets/evidence/recovery-summary.json') {
    const recovery = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(recovery.tables,9); assert.equal(recovery.rows,9269);
    assert.equal(recovery.sequences,1); assert.equal(recovery.objects,187);
    assert.equal(recovery.objectBytes,199654466); assert.equal(recovery.contentMismatches,0);
    assert.equal(recovery.dataRestoreMs,48000); assert.equal(recovery.publishedRestorePorts,0);
    assert.equal(recovery.temporaryResourcesRemoved,true); assert.equal(recovery.productionAfterHealthy,true);
    assert.equal(recovery.encryptedOffHostCopy.gcmTagVerified,true);
    assertions.recovery = { tables:9, rows:9269, objects:187, objectBytes:199654466, dataRestoreMs:48000, contentMismatches:0, encryptedCopy:true };
  }
  if (path === '/competition/recovery-assets/evidence/budget-total.json') {
    const budget = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(budget.modelCalls,84); assert.equal(budget.estimatedModelCny,.516094);
    assert.equal(budget.imageCalls,13); assert.equal(budget.budgetLimitCny,500);
    assertions.recoveryBudget = { modelCalls:84, estimatedModelCny:.516094, imageCalls:13, budgetLimitCny:500 };
  }
  if (path === '/competition/continuity-assets/evidence/budget-total.json') {
    const budget = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(budget.modelCalls,84); assert.equal(budget.estimatedModelCny,.516094);
    assert.equal(budget.imageCalls,14); assert.equal(budget.budgetLimitCny,500);
    assertions.continuityBudget = { modelCalls:84, estimatedModelCny:.516094, imageCalls:14, budgetLimitCny:500 };
  }
  if (path === '/competition/delivery-assets/evidence/package-summary.json') {
    const delivery = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(delivery.archive.sourceCommit,'fc3ae1de6002bc56d1b4ca2038097862e62e40fe');
    assert.equal(delivery.archive.sha256,'46a5570589a94a35fa3542173bedb66d401180b91fec60e267f8b7c3a27dad24');
    assert.equal(delivery.archive.files,2345);assert.equal(delivery.actualArchiveFilesIncludingManifest,2346);
    assert.equal(delivery.archive.bytes,112500706);assert.equal(delivery.cleanCheckout,true);
    assert.equal(delivery.fiveStageVerification,true);
    assert.deepEqual(delivery.tests,{total:1042,pass:1013,skipped:29,fail:0});
    assert.equal(delivery.reproduction.emptyNodeModulesBeforeInstall,true);
    assert.equal(delivery.reproduction.demoHttpRequests,24);assert.equal(delivery.cleanInstallMs,61135);
    assert.equal(delivery.faultsDetected,4);assert.equal(delivery.browserChecks,12);assert.equal(delivery.browserOk,true);
    assertions.delivery = { sourceCommit:delivery.archive.sourceCommit, files:2345, archiveBytes:112500706,
      cleanInstallMs:61135, demoHttpRequests:24, faultsDetected:4, browserChecks:12 };
  }
  if (path === '/competition/delivery-assets/evidence/reproduction.json') {
    const delivery = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(delivery.ok,true);assert.equal(delivery.emptyNodeModulesBeforeInstall,true);
    assert.equal(delivery.stages.length,5);assert.ok(delivery.stages.every(row=>row.exitCode===0));
    assert.equal(delivery.faults.length,4);assert.ok(delivery.faults.every(row=>row.detected));
  }
  if (path === '/competition/delivery-assets/evidence/package-browser.json') {
    const browser = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(browser.ok,true);assert.equal(browser.checks.length,12);
    assert.ok(browser.checks.every(row=>row.ok));assert.equal(browser.consoleErrors.length,0);
  }
  if (path === '/competition/delivery-assets/evidence/verification-summary.json') {
    const gate = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(gate.ok,true);assert.equal(gate.dirty,false);assert.equal(gate.stages.length,5);
    assert.ok(gate.stages.every(row=>row.code===0));
  }
  if (path === '/competition/container-assets/evidence/budget-total.json') {
    const budget=JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(budget.modelCalls,84);assert.equal(budget.estimatedModelCny,.516094);assert.equal(budget.imageCalls,16);assert.equal(budget.budgetLimitCny,500);
    assertions.latestContainerBudget={modelCalls:84,estimatedModelCny:.516094,imageCalls:16,budgetLimitCny:500};
  }
  if (path === '/competition/delivery-assets/evidence/budget-total.json') {
    const budget = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(budget.modelCalls,84);assert.equal(budget.estimatedModelCny,.516094);
    assert.equal(budget.imageCalls,15);assert.equal(budget.budgetLimitCny,500);
    assertions.currentBudget = { modelCalls:84, estimatedModelCny:.516094, imageCalls:15, budgetLimitCny:500 };
  }
  if (path === '/competition/continuity-assets/evidence/local-behavior.json') {
    const behavior = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(behavior.length,15); assert.ok(behavior.every(row=>row.ok));
    assert.equal(behavior.find(row=>row.name==='browser-back-after-evidence').actual,3);
    assert.equal(behavior.find(row=>row.name==='http503-keeps-completed-state').progress,3);
    assertions.continuity = { behaviorChecks:15, returnedStep:3, failureRetainedStep:3 };
  }
  if (path === '/competition/experience-step-qr.json') {
    const catalog = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(catalog.origin,'https://daylight.yunforis.com');
    assert.deepEqual(catalog.records.map(row=>row.step),[0,1,2,3,4,5,6,7]);
    assert.ok(catalog.records.every(row=>row.url===`${catalog.origin}/experience?step=${row.step}`));
    assertions.staticStepQr = { files:8, totalPngBytes:catalog.records.reduce((sum,row)=>sum+row.bytes,0) };
  }
  if (path === '/competition/rag-latency-assets/evidence/budget-total.json') {
    const budget = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(budget.modelCalls, 84); assert.equal(budget.estimatedModelCny, .516094);
    assert.equal(budget.budgetLimitCny, 500);
    assertions.ragLatencyBudget = { modelCalls: budget.modelCalls, estimatedModelCny: budget.estimatedModelCny };
  }
  return { path, status: result.status, bytes: bytes.length, sha256, contentType: result.headers.get('content-type') };
}));
const video = await request('/competition/demo.mp4', { headers: { Range: 'bytes=0-31' } });
assert.equal(video.status, 206);
assert.match(video.headers.get('content-type'), /video\/mp4/);
assert.ok((await video.text()).includes('ftyp'));
checks.push({ path: '/competition/demo.mp4', status: video.status, contentType: video.headers.get('content-type'), contentRange: video.headers.get('content-range') });
const pdfRange = await request('/competition/technical-report.pdf', { headers: { Range: 'bytes=0-31' } });
assert.equal(pdfRange.status, 206);
assert.match(pdfRange.headers.get('content-type'), /application\/pdf/);
const pdfBytes = new Uint8Array(await pdfRange.arrayBuffer());
assert.equal(pdfBytes.length, 32);
assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), '%PDF-');
assert.match(pdfRange.headers.get('content-range'), /^bytes 0-31\/\d+$/);
assert.equal(digest(pdfBytes), digest((await readFile(new URL('../public/competition/technical-report.pdf', import.meta.url))).subarray(0, 32)));
checks.push({ path: '/competition/technical-report.pdf', status: pdfRange.status, contentType: pdfRange.headers.get('content-type'), contentRange: pdfRange.headers.get('content-range'), range: 'bytes=0-31' });
const result = { checkedAt: new Date().toISOString(), origin, assertions, checks, scope: 'Anonymous public synthetic workflow, HTTPS resources, private-state denial, video/PDF ranges, MIME and exact local publication bytes.' };
if (output) await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
