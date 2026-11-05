import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.resolve(root, process.argv[2] || 'work/entry-v17');
const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const samples = read('browser/samples.json');
const before = read('before/inventory.json'), after = read('after/inventory.json');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const stats = values => ({ samples: values.length, p50Ms: +percentile(values, .5).toFixed(3),
  p95Ms: +percentile(values, .95).toFixed(3), meanMs: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3) });
const improvement = (a, b) => +((a - b) / a * 100).toFixed(2);
assert.equal(samples.length, 20);
assert.ok(samples.every(s => s.ok));
const result = { createdAt: new Date().toISOString(),
  method: { environment: 'Windows, IAB Chromium, local isolated demo API',
    builds: { beforeSource: '435c7c7', afterSource: 'working tree recorded in source-hashes.json' },
    transport: { sharedBytesPerSecond: 200000, perResponseDelayMs: 80, firstPartyCacheControl: 'no-store', gzip: true,
      scope: 'Local server applies one shared byte budget per variant; external Google Fonts uses the existing browser cache and is outside the shaped transport.' },
    samplesPerVariantAndWidth: 5, widths: [1440, 390], order: 'Alternating paired AB / BA within each width',
    readyDefinition: 'From navigation start until the visible start button is enabled, the startup overlay is removed, and two animation frames have elapsed.',
    percentile: 'nearest rank; all samples retained; p95 is the maximum of n=5',
    hardware: { userAgent: samples[0].userAgent, hardwareConcurrency: samples[0].hardwareConcurrency },
    deviceScope: 'Desktop browser with two viewport sizes; no CPU emulation; WeChat device validation is recorded separately.' },
  bundle: {}, browser: {},
  costs: { realModelCalls: 0, newCloudPurchases: 0 },
  hashes: { beforeInventory: sha(path.join(directory, 'before/inventory.json')),
    afterInventory: sha(path.join(directory, 'after/inventory.json')), browserSamples: sha(path.join(directory, 'browser/samples.json')) },
};
for (const name of ['before', 'after']) {
  const inventory = name === 'before' ? before : after;
  const route = inventory.routes['experience-page'];
  const mark = name === 'before' ? 'logo.png' : 'logo-small.webp';
  const bootImageBytes = fs.statSync(path.join(directory, name, 'dist', mark)).size;
  result.bundle[name] = { entryJavaScript: inventory.initialJavaScript,
    experienceJavaScript: route.javaScript, experienceCss: route.css, bootImage: {file:mark,bytes:bootImageBytes},
    combinedGzipJsCssAndBootImageBytes: route.javaScript.gzipBytes + route.css.gzipBytes + bootImageBytes };
  if (name === 'after') {
    const modules = route.javaScript.files.flatMap(file => inventory.chunks[file].modules.map(m => m.id));
    const excluded = ['src/context/workspace.jsx', 'src/context/workbenches.jsx', 'src/components/onboarding.jsx', 'src/pages/landing-page.jsx', 'temporal-polyfill', 'katex'];
    result.bundle.after.excludedPublicModules = Object.fromEntries(excluded.map(fragment => [fragment, !modules.some(id => id.includes(fragment))]));
    assert.ok(Object.values(result.bundle.after.excludedPublicModules).every(Boolean));
  }
}
result.bundle.reductions = {
  javaScriptPercent: improvement(result.bundle.before.experienceJavaScript.bytes, result.bundle.after.experienceJavaScript.bytes),
  gzipJavaScriptPercent: improvement(result.bundle.before.experienceJavaScript.gzipBytes, result.bundle.after.experienceJavaScript.gzipBytes),
  gzipCssPercent: improvement(result.bundle.before.experienceCss.gzipBytes, result.bundle.after.experienceCss.gzipBytes),
  combinedGzipJsCssAndBootImagePercent: improvement(result.bundle.before.combinedGzipJsCssAndBootImageBytes, result.bundle.after.combinedGzipJsCssAndBootImageBytes),
};
for (const width of [1440, 390]) {
  const groups = Object.fromEntries(['before', 'after'].map(version => {
    const rows = samples.filter(s => s.width === width && s.version === version);
    assert.equal(rows.length, 5);
    const expected = result.bundle[version];
    for (const row of rows) {
      const js = row.resources.filter(r => r.name.startsWith('/assets/') && r.name.endsWith('.js'));
      const css = row.resources.filter(r => r.name.startsWith('/assets/') && r.name.endsWith('.css'));
      assert.equal(js.reduce((sum, r) => sum + r.encodedBytes, 0), expected.experienceJavaScript.gzipBytes);
      assert.equal(css.reduce((sum, r) => sum + r.encodedBytes, 0), expected.experienceCss.gzipBytes);
      assert.ok([...js,...css].every(r => r.transferBytes > 0));
      assert.ok(row.resources.some(r => r.name === '/' + expected.bootImage.file && r.transferBytes > 0));
    }
    return [version, stats(rows.map(s => s.readyMs))];
  }));
  result.browser[width] = { ...groups, p50ReductionPercent: improvement(groups.before.p50Ms, groups.after.p50Ms),
    p95ReductionPercent: improvement(groups.before.p95Ms, groups.after.p95Ms) };
}
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
const csv = ['version,width,round,ok,readyMs', ...samples.map(s => [s.version,s.width,s.round,s.ok,s.readyMs.toFixed(3)].join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(directory, 'samples.csv'), csv);
console.log(JSON.stringify({ bundle: result.bundle.reductions, browser: result.browser }, null, 2));
