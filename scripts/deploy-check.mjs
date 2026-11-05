#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnvironment, validateComposeEnvironment, validateRuntimeEnvironment } from './lib/deployment-config.mjs';
import { checkEvidenceSnapshot } from './lib/competition-evidence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let composeEnv, runtimeEnv, publicEnv, output;
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (['--compose-env', '--runtime-env', '--public-env', '--out'].includes(key)) {
    const value = args[++index]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    if (key === '--compose-env') composeEnv = value;
    if (key === '--runtime-env') runtimeEnv = value;
    if (key === '--public-env') publicEnv = value;
    if (key === '--out') output = value;
  } else if (!['--source', '--docker'].includes(key)) throw new Error(`Unknown preflight option: ${key}.`);
}
if (composeEnv && runtimeEnv) throw new Error('Choose --compose-env or --runtime-env.');
if (publicEnv && !composeEnv) throw new Error('--public-env requires --compose-env.');
const checks = [];
const add = (key, ok, message) => checks.push({ key, ok: Boolean(ok), message });
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
add('node-version', nodeMajor > 22 || nodeMajor === 22 && nodeMinor >= 19, 'Node.js >=22.19 is required by the HTTP/PDF dependencies.');
const package_ = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
add('dependency-lock', JSON.stringify(package_.dependencies) === JSON.stringify(lock.packages[''].dependencies)
  && JSON.stringify(package_.devDependencies) === JSON.stringify(lock.packages[''].devDependencies), 'package.json and lockfile dependencies must agree.');
for (const file of ['Dockerfile', '.dockerignore', 'docker-compose.yml', 'deploy/public/compose.public.yml', 'deploy/public/Caddyfile',
  'deploy/kubernetes/apps.yaml', 'deploy/kubernetes/migrate.yaml', 'deploy/kubernetes/kustomization.yaml', 'deploy/backup.sh', 'deploy/restore.sh',
  'docs/delivery/README.md', 'docs/delivery/cloud-deployment.md', 'docs/delivery/demo-script.md']) {
  add(`file:${file}`, fs.existsSync(path.join(root, file)), 'Required delivery asset exists.');
}
if (args.includes('--source')) {
  try {
    const snapshot = checkEvidenceSnapshot(root);
    add('frontend-evidence-snapshot', snapshot.ok, `${snapshot.files} public sources must match the tracked build snapshot. Run npm run evidence:sync after updating evidence.`);
  } catch {
    add('frontend-evidence-snapshot', false, 'Evidence sources or build snapshot are missing or invalid. Run npm run evidence:sync.');
  }
}
if (composeEnv) {
  const env = { ...parseEnvironment(fs.readFileSync(composeEnv, 'utf8')), ...(publicEnv ? parseEnvironment(fs.readFileSync(publicEnv, 'utf8')) : {}) };
  checks.push(...validateComposeEnvironment(env, { publicAccess: Boolean(publicEnv) }));
}
if (runtimeEnv) checks.push(...validateRuntimeEnvironment(parseEnvironment(fs.readFileSync(runtimeEnv, 'utf8'))));
if (args.includes('--docker')) {
  const dockerArgs = ['compose', '--env-file', path.resolve(composeEnv || path.join(root, 'deploy/compose.env.example'))];
  if (publicEnv) dockerArgs.push('--env-file', path.resolve(publicEnv));
  dockerArgs.push('-f', path.join(root, 'docker-compose.yml'));
  if (publicEnv) dockerArgs.push('-f', path.join(root, 'deploy/public/compose.public.yml'));
  dockerArgs.push('config', '--quiet');
  const result = spawnSync('docker', dockerArgs, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  // Do not print Compose output: an error can interpolate a secret value.
  add('compose-parser', result.status === 0, 'Docker Compose config must parse successfully (no containers are started).');
}
const report = { ok: checks.every(check => check.ok), at: new Date().toISOString(),
  scope: runtimeEnv ? 'runtime-configuration' : composeEnv ? 'compose-configuration' : 'source-assets', checks,
  liveServicesChecked: false, cloudAcceptance: false };
if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); }
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.key}: ${check.message}`);
console.log(`${report.ok ? 'PASS' : 'FAIL'}: ${checks.length} checks. Live dependencies, DNS, TLS and cloud acceptance require a separate run.`);
process.exitCode = report.ok ? 0 : 1;
