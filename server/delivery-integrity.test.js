import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceDigest, treeDigest } from '../scripts/lib/release-inventory.mjs';
import { verifyDeliveryIntegrity } from '../scripts/lib/delivery-integrity.mjs';

function fixture(t) {
  const workRoot = path.resolve('work');
  fs.mkdirSync(workRoot, { recursive: true });
  const parent = fs.mkdtempSync(path.join(workRoot, 'delivery-integrity-'));
  const root = path.join(parent, 'extracted');
  fs.mkdirSync(root);
  // The containing repository must never become the extracted package inventory.
  fs.mkdirSync(path.join(parent, '.git'));
  t.after(() => {
    assert.ok(path.resolve(parent).startsWith(workRoot + path.sep));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const put = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), value); };
  put('START-HERE.md', '# Read first\n');
  put('package.json', '{"type":"module"}\n');
  put('server/main.js', 'export const value = 1;\n');
  put('dist/index.html', '<!doctype html><p>Daylight</p>');
  put('dist/assets/image.bin', Buffer.from([0, 1, 128, 255]));
  const stages = ['tests', 'build', 'evaluation-corpus', 'demo', 'deployment-assets'].map(name => ({ name, code: 0, log: `${name}.log` }));
  for (const stage of stages) put(`delivery-evidence/${stage.log}`, `${stage.name} passed\n`);
  const verification = { ok: true, sourceCommit: 'a'.repeat(40), stages };
  put('delivery-evidence/summary.json', JSON.stringify(verification));
  const files = [];
  const walk = (dir, prefix = '') => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name + '/');
    else files.push({ path: prefix + entry.name });
  } };
  walk(root);
  const manifest = { format: 1, sourceCommit: verification.sourceCommit, verification: 'delivery-evidence/summary.json', files };
  const write = () => put('DELIVERY-MANIFEST.json', JSON.stringify(manifest));
  write();
  manifest.sourceDigest = sourceDigest(root);
  manifest.buildDigest = treeDigest(path.join(root, 'dist'));
  Object.assign(verification, { sourceDigest: manifest.sourceDigest, buildDigest: manifest.buildDigest });
  const seal = () => {
    put('delivery-evidence/summary.json', JSON.stringify(verification));
    for (const row of manifest.files) {
      const bytes = fs.readFileSync(path.join(root, row.path));
      row.bytes = bytes.length; row.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    write();
  };
  seal();
  return { root, put, manifest, verification, seal, write };
}

test('delivery verifies all bytes, starter, source/build and five logs within a parent checkout', t => {
  const f = fixture(t);
  const before = verifyDeliveryIntegrity(f.root);
  assert.equal(before.ok, true);
  assert.equal(before.files, f.manifest.files.length);
  assert.equal(before.sourceCommit, 'a'.repeat(40));
  f.put('node_modules/cache.txt', 'installed dependencies');
  f.put('work/previous-result.json', '{}');
  assert.equal(verifyDeliveryIntegrity(f.root).manifestSha256, before.manifestSha256);
});

test('delivery detects same-length source corruption, removed build assets and changed starter', t => {
  for (const [name, edit] of [
    ['source', f => f.put('server/main.js', 'export const value = 2;\n')],
    ['build', f => fs.unlinkSync(path.join(f.root, 'dist/assets/image.bin'))],
    ['starter', f => f.put('START-HERE.md', '# Different instructions\n')],
  ]) {
    const f = fixture(t); edit(f);
    assert.throws(() => verifyDeliveryIntegrity(f.root), /file mismatch|Missing delivery file/, name);
  }
});

test('delivery rejects additional executable files, duplicate entries and traversal paths', t => {
  const extra = fixture(t); extra.put('server/injected.js', 'export default 2');
  assert.throws(() => verifyDeliveryIntegrity(extra.root), /Unexpected delivery file/);
  const duplicate = fixture(t); duplicate.manifest.files.push({ ...duplicate.manifest.files[0] }); duplicate.write();
  assert.throws(() => verifyDeliveryIntegrity(duplicate.root), /Duplicate/);
  for (const candidate of ['../outside', '/absolute', 'C:/outside', 'folder\\outside', 'folder/../outside']) {
    const f = fixture(t); f.manifest.files[0].path = candidate; f.write();
    assert.throws(() => verifyDeliveryIntegrity(f.root), /Invalid delivery file entry/);
  }
});

test('delivery rejects file digests resealed around a changed source or build', t => {
  const source = fixture(t); source.put('server/main.js', 'export const value = 7;\n'); source.seal();
  assert.throws(() => verifyDeliveryIntegrity(source.root), /source digest mismatch/);
  const build = fixture(t); build.put('dist/index.html', '<p>Changed frontend</p>'); build.seal();
  assert.throws(() => verifyDeliveryIntegrity(build.root), /build digest mismatch/);
});

test('delivery requires a matching successful verification and all stage logs', t => {
  const failed = fixture(t); failed.verification.stages[0].code = 1; failed.seal();
  assert.throws(() => verifyDeliveryIntegrity(failed.root), /verification does not match/);
  const old = fixture(t); old.verification.sourceCommit = 'b'.repeat(40); old.seal();
  assert.throws(() => verifyDeliveryIntegrity(old.root), /verification does not match/);
  const log = fixture(t); log.manifest.files = log.manifest.files.filter(row => row.path !== 'delivery-evidence/demo.log');
  fs.unlinkSync(path.join(log.root, 'delivery-evidence/demo.log')); log.write();
  assert.throws(() => verifyDeliveryIntegrity(log.root), /Stage log is missing/);
  const starter = fixture(t); starter.manifest.files = starter.manifest.files.filter(row => row.path !== 'START-HERE.md'); starter.write();
  assert.throws(() => verifyDeliveryIntegrity(starter.root), /Starter and verification/);
});

test('delivery rejects a linked directory instead of traversing its target', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.root, 'server'), path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyDeliveryIntegrity(f.root), /Symbolic link/);
});
