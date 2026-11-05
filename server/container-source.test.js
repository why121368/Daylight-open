import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { evidenceSnapshot, evidenceSources, evidenceSnapshotPath, checkEvidenceSnapshot } from '../scripts/lib/competition-evidence.mjs';
import { frontendInputs } from '../scripts/lib/frontend-inputs.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-build-inputs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  for (const file of Object.values(evidenceSources)) put(file, '{"publicValue":12}\n');
  put(evidenceSnapshotPath, evidenceSnapshot(root));
  return { root, put };
}

test('tracked frontend evidence matches all five sources and has reproducible hashes', t => {
  const f = fixture(t);
  const first = evidenceSnapshot(f.root);
  assert.equal(checkEvidenceSnapshot(f.root).ok, true);
  const parsed = JSON.parse(first);
  assert.equal(Object.keys(parsed.data).length, 5);
  assert.equal(Object.keys(parsed.sources).length, 5);
  assert.ok(Object.values(parsed.sources).every(row => /^[a-f0-9]{64}$/.test(row.canonicalSha256)));
  assert.equal(evidenceSnapshot(f.root), first);
});

test('updating a source fails the deployment gate until the snapshot is regenerated', t => {
  const f = fixture(t);
  f.put(evidenceSources.currentBudget, '{"imageCalls":16}');
  assert.equal(checkEvidenceSnapshot(f.root).ok, false);
  f.put(evidenceSnapshotPath, evidenceSnapshot(f.root));
  assert.equal(checkEvidenceSnapshot(f.root).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, evidenceSnapshotPath))).data.currentBudget.imageCalls, 16);
});

test('Windows and Linux JSON formatting keeps the same snapshot and canonical hashes', t => {
  const f = fixture(t);
  const before = evidenceSnapshot(f.root);
  f.put(evidenceSources.currentBudget, '{\r\n  "publicValue": 12\r\n}\r\n');
  assert.equal(evidenceSnapshot(f.root), before);
  assert.equal(checkEvidenceSnapshot(f.root).ok, true);
});

test('missing, invalid, and non-object evidence cannot become a build snapshot', t => {
  const f = fixture(t);
  for (const content of ['{bad json', '[]', 'null']) {
    f.put(evidenceSources.currentBudget, content);
    assert.throws(() => evidenceSnapshot(f.root));
  }
  fs.unlinkSync(path.join(f.root, evidenceSources.currentBudget));
  assert.throws(() => checkEvidenceSnapshot(f.root));
});

test('edited snapshot data or source provenance fails the deployment gate', t => {
  const f = fixture(t);
  const parsed = JSON.parse(evidenceSnapshot(f.root));
  parsed.data.recovery.publicValue = 17;
  f.put(evidenceSnapshotPath, JSON.stringify(parsed));
  assert.equal(checkEvidenceSnapshot(f.root).ok, false);
  parsed.data.recovery.publicValue = 12;
  parsed.sources.recovery.path = 'docs/unrelated.json';
  f.put(evidenceSnapshotPath, JSON.stringify(parsed));
  assert.equal(checkEvidenceSnapshot(f.root).ok, false);
});

async function bundle(f, entry) {
  return build({ root: f.root, configFile: false, logLevel: 'silent', plugins: [frontendInputs(f.root)],
    build: { write: false, copyPublicDir: false, minify: false, rollupOptions: { input: path.join(f.root, entry) } } });
}

test('the actual Vite graph accepts src/shared/public data included by Docker COPY', async t => {
  const f = fixture(t);
  f.put('shared/helper.js', 'export const value = 7;');
  f.put('public/qr-origin.json', '{"origin":"https://example.invalid"}');
  f.put('src/main.js', "import d from './data/competition-evidence.json'; import {value} from '../shared/helper.js'; import q from '../public/qr-origin.json'; console.log(d.data.currentBudget, value, q);");
  const result = await bundle(f, 'src/main.js');
  assert.ok(result.output.some(row => row.type === 'chunk' && row.code.includes('publicValue')));
});

test('an indirect dynamic import from excluded docs fails the actual Vite graph', async t => {
  const f = fixture(t);
  f.put('src/main.js', "import('./lazy.js').then(console.log);");
  f.put('src/lazy.js', `import d from '../${evidenceSources.currentBudget}'; export default d;`);
  await assert.rejects(bundle(f, 'src/main.js'), /Frontend input is outside the Docker build sources:.*docs/);
});

test('a symlink from src to an excluded source cannot bypass the Vite boundary', async t => {
  const f = fixture(t);
  f.put('docs/secret-input.js', 'export default 42;');
  try { fs.symlinkSync(path.join(f.root, 'docs/secret-input.js'), path.join(f.root, 'src/link.js'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not grant file symlink creation.'); return; } throw error; }
  f.put('src/main.js', "import value from './link.js'; console.log(value);");
  await assert.rejects(bundle(f, 'src/main.js'), /Frontend input is outside the Docker build sources/);
});
