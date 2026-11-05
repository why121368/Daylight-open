import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceDigest, treeDigest } from './release-inventory.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimeDirectories = new Set(['node_modules', 'work', 'data', 'output']);
const stages = ['tests', 'build', 'evaluation-corpus', 'demo', 'deployment-assets'];
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validPath(value) {
  return typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value)
    && !path.win32.isAbsolute(value) && !/[\\:\x00-\x1f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Check extracted bytes before running their code; this function only reads files. */
export function verifyDeliveryIntegrity(input) {
  const started = performance.now();
  const root = path.resolve(input);
  if (fs.existsSync(path.join(root, '.git'))) throw new Error('Use an extracted delivery directory.');
  const manifestFile = path.join(root, 'DELIVERY-MANIFEST.json');
  if (!fs.lstatSync(manifestFile).isFile()) throw new Error('Delivery manifest must be a regular file.');
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || !manifest.files.length
    || !validDigest(manifest.sourceDigest) || !validDigest(manifest.buildDigest)) throw new Error('Invalid delivery manifest.');
  const expected = new Map();
  for (const row of manifest.files) {
    if (!validPath(row.path) || row.path === 'DELIVERY-MANIFEST.json'
      || runtimeDirectories.has(row.path.split('/')[0])
      || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !validDigest(row.sha256)) throw new Error('Invalid delivery file entry.');
    if (expected.has(row.path)) throw new Error(`Duplicate delivery path: ${row.path}`);
    expected.set(row.path, row);
  }
  if (!expected.has('START-HERE.md') || manifest.verification !== 'delivery-evidence/summary.json'
    || !expected.has(manifest.verification)) throw new Error('Starter and verification must be included in the file inventory.');
  const actual = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link in delivery: ${relative}`);
      if (!prefix && runtimeDirectories.has(entry.name) && entry.isDirectory()) continue;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile()) { if (relative !== 'DELIVERY-MANIFEST.json') actual.push(relative); }
      else throw new Error(`Non-regular delivery entry: ${relative}`);
    }
  }
  walk(root);
  for (const relative of actual) if (!expected.has(relative)) throw new Error(`Unexpected delivery file: ${relative}`);
  let bytes = 0;
  for (const [relative, row] of expected) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) throw new Error(`Missing delivery file: ${relative}`);
    const content = fs.readFileSync(file);
    if (content.length !== row.bytes || digest(content) !== row.sha256) throw new Error(`Delivery file mismatch: ${relative}`);
    bytes += content.length;
  }
  if (sourceDigest(root) !== manifest.sourceDigest) throw new Error('Delivery source digest mismatch.');
  if (treeDigest(path.join(root, 'dist')) !== manifest.buildDigest) throw new Error('Delivery build digest mismatch.');
  const verification = JSON.parse(fs.readFileSync(path.join(root, manifest.verification), 'utf8'));
  if (!verification.ok || verification.sourceDigest !== manifest.sourceDigest || verification.buildDigest !== manifest.buildDigest
    || verification.sourceCommit !== manifest.sourceCommit || !Array.isArray(verification.stages)
    || verification.stages.length !== stages.length || verification.stages.some((row, index) => row.name !== stages[index] || row.code !== 0)) {
    throw new Error('Delivery verification does not match this source and build.');
  }
  for (const row of verification.stages) {
    if (!validPath(row.log) || row.log.includes('/') || !expected.has(`delivery-evidence/${row.log}`)) throw new Error('Stage log is missing from the inventory.');
  }
  return { ok: true, checkedAt: new Date().toISOString(), scope: 'extracted-delivery-file-integrity',
    sourceCommit: manifest.sourceCommit, sourceDigest: manifest.sourceDigest, buildDigest: manifest.buildDigest,
    manifestSha256: digest(manifestBytes), files: expected.size, bytes, stages: verification.stages.map(row => row.name),
    runtimeDirectories: [...runtimeDirectories], elapsedMs: Math.round(performance.now() - started) };
}
