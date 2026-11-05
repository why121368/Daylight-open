#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { isolatedEnvironment } from './lib/isolated-environment.mjs';
import { sourceDigest, treeDigest } from './lib/release-inventory.mjs';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'work', 'release-check-'));
const baseline = path.join(directory, 'test-data');
const guardLog = path.join(directory, 'guard.jsonl');
fs.mkdirSync(baseline); fs.writeFileSync(guardLog, '');
const env = isolatedEnvironment({ DAYLIGHT_DATA_DIR: baseline, DAYLIGHT_REGRESSION_BASE: baseline, DAYLIGHT_REGRESSION_GUARD_LOG: guardLog });
const guard = path.join(root, 'scripts/fixtures/offline-guard.cjs');
const stages = [];
const initialDigest = sourceDigest(root);
const git = args => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
};
const archiveManifest = !fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, 'DELIVERY-MANIFEST.json'))
  ? JSON.parse(fs.readFileSync(path.join(root, 'DELIVERY-MANIFEST.json'), 'utf8')) : null;
console.log(`Release verification: ${directory}`);
async function stage(name, args, guarded = false) {
  const started = Date.now();
  const file = path.join(directory, `${name}.log`);
  const output = fs.createWriteStream(file);
  let transcript = '';
  console.log(`Running ${name}…`);
  const child = spawn(process.execPath, [...(guarded ? ['--require', guard] : []), ...args], {
    cwd: root, env: guarded ? { ...env, NODE_OPTIONS: `--require="${guard.replaceAll('\\', '/')}"` } : env,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', bytes => { output.write(bytes); transcript += bytes; });
  const [code] = await once(child, 'exit');
  await new Promise(resolve => output.end(resolve));
  const summary = name === 'tests' ? transcript.split(/\r?\n/).filter(line => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line)) : undefined;
  stages.push({ name, code, elapsedMs: Date.now() - started, log: path.basename(file), ...(summary ? { summary } : {}) });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (code !== 0) throw new Error(`${name} failed. See ${file}`);
}
let error;
try {
  const tests = fs.readdirSync(path.join(root, 'server')).filter(file => file.endsWith('.test.js')).sort().map(file => `server/${file}`);
  await stage('tests', ['--test', '--test-reporter=tap', ...tests], true);
  await stage('build', ['node_modules/vite/bin/vite.js', 'build']);
  await stage('evaluation-corpus', ['scripts/evaluate-mail.js', '--validate'], true);
  await stage('demo', ['scripts/demo.mjs', '--check', '--no-build']);
  await stage('deployment-assets', ['scripts/deploy-check.mjs', '--source']);
  if (sourceDigest(root) !== initialDigest) throw new Error('Source changed during verification. Run verification again for a stable snapshot.');
} catch (cause) { error = cause.message; console.error(error); }
const report = { ok: !error, at: new Date().toISOString(), sourceCommit: archiveManifest?.sourceCommit || git(['rev-parse', 'HEAD']),
  dirty: archiveManifest ? archiveManifest.workingTreeChangesIncluded || archiveManifest.sourceDigest !== initialDigest : Boolean(git(['status', '--porcelain'])),
  sourceInventory: archiveManifest ? 'delivery-manifest' : 'git-checkout', node: process.version, platform: `${process.platform}/${process.arch}`,
  sourceDigest: initialDigest,
  buildDigest: !error ? treeDigest(path.join(root, 'dist')) : null,
  scope: 'isolated-offline-release', liveServicesChecked: false, cloudAcceptance: false, stages,
  blockedExternalAttempts: fs.readFileSync(guardLog, 'utf8').trim().split('\n').filter(Boolean).length, ...(error ? { error } : {}) };
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2));
console.log(`Report: ${path.join(directory, 'summary.json')}`);
process.exitCode = error ? 1 : 0;
