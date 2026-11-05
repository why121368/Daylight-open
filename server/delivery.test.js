import test from 'node:test';
import assert from 'node:assert/strict';
import { demoInformation, assertDemoIsolation } from './demo-mode.js';
import { isolatedEnvironment } from '../scripts/lib/isolated-environment.mjs';
import { parseEnvironment, validateComposeEnvironment, validateRuntimeEnvironment } from '../scripts/lib/deployment-config.mjs';
import { bootstrapPrivateBucket } from '../scripts/bootstrap-bucket.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { releaseSources, sourceDigest } from '../scripts/lib/release-inventory.mjs';

test('production cannot advertise or activate the isolated demo', () => {
  assert.deepEqual(demoInformation({ DAYLIGHT_DEMO: '1', DAYLIGHT_RUNTIME: 'production' }), { enabled: false });
  assert.deepEqual(demoInformation({}), { enabled: false });
  assert.equal(demoInformation({ DAYLIGHT_RUNTIME: 'local', DAYLIGHT_DEMO: '1' }).externalServices, false);
  for (const patch of [{ HOST: '0.0.0.0' }, { DAYLIGHT_RUNTIME: 'production' }, { DAYLIGHT_DATA_DIR: '' }, { DAYLIGHT_DEMO_GUARDED: '' }]) {
    assert.throws(() => assertDemoIsolation({ DAYLIGHT_RUNTIME: 'local', HOST: '127.0.0.1', DAYLIGHT_DATA_DIR: '/isolated', DAYLIGHT_DEMO: '1', DAYLIGHT_DEMO_GUARDED: '1', ...patch }), /isolated launcher/);
  }
  assert.doesNotThrow(() => assertDemoIsolation({ DAYLIGHT_RUNTIME: 'production' }));
});

test('demo and verification children drop inherited service credentials and runtime overrides', () => {
  const env = isolatedEnvironment({ DAYLIGHT_DATA_DIR: '/fixture' }, { PATH: '/bin', SYSTEMROOT: 'C:/Windows',
    DAYLIGHT_DATABASE_URL: 'private', OPENAI_API_KEY: 'private', AWS_SECRET_ACCESS_KEY: 'private',
    HTTPS_PROXY: 'private', NODE_OPTIONS: '--require=private', PORT: '3000', PGHOST: 'private' });
  for (const key of ['DAYLIGHT_DATABASE_URL', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS', 'PORT', 'PGHOST']) assert.equal(env[key], undefined, key);
  assert.equal(env.PATH, '/bin'); assert.equal(env.SYSTEMROOT, 'C:/Windows');
  assert.equal(env.DAYLIGHT_RUNTIME, 'local'); assert.equal(env.DAYLIGHT_DATA_DIR, '/fixture');
});

test('environment parsing preserves literal values, rejects duplicates and never executes shell substitutions', () => {
  assert.deepEqual(parseEnvironment('# comment\nA="$(never-execute)"\nB=literal=equals\n'), { A: '$(never-execute)', B: 'literal=equals' });
  assert.throws(() => parseEnvironment('A=one\nA=two'), /Duplicate/);
  assert.throws(() => parseEnvironment('export A=one'), /Invalid/);
});

test('deployment preflight rejects placeholders, shared secrets and production authentication bypasses without exposing values', () => {
  const env = { POSTGRES_PASSWORD: 'a'.repeat(64), REDIS_PASSWORD: 'b'.repeat(64), RABBITMQ_PASSWORD: 'c'.repeat(64),
    MINIO_ROOT_PASSWORD: 'd'.repeat(64), DAYLIGHT_JWT_SECRET: 'e'.repeat(96), MINIO_ROOT_USER: 'daylight', DAYLIGHT_ADMIN_EMAILS: 'admin@mycompany.cn' };
  assert.ok(validateComposeEnvironment(env).every(check => check.ok));
  assert.ok(validateComposeEnvironment({ ...env, REDIS_PASSWORD: env.POSTGRES_PASSWORD }).some(check => !check.ok && check.key === 'independent-secrets'));
  const failed = validateComposeEnvironment({ ...env, DAYLIGHT_REQUIRE_AUTH: '0', DAYLIGHT_JWT_SECRET: 'replace-with-random-secret' });
  assert.ok(failed.some(check => !check.ok && check.key === 'demo-disabled'));
  assert.ok(failed.some(check => !check.ok && check.key === 'DAYLIGHT_JWT_SECRET'));
  assert.equal(JSON.stringify(failed).includes(env.POSTGRES_PASSWORD), false);
  assert.ok(validateRuntimeEnvironment({ DAYLIGHT_RUNTIME: 'local' }).some(check => !check.ok));
});

test('private bucket initialization creates only missing buckets and refuses authentication failures', async () => {
  const calls = [];
  await bootstrapPrivateBucket({ send: async command => {
    calls.push(command.constructor.name);
    if (command.constructor.name === 'HeadBucketCommand') throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
  } }, 'daylight-test');
  assert.deepEqual(calls, ['HeadBucketCommand', 'CreateBucketCommand', 'DeleteBucketPolicyCommand']);
  calls.length = 0;
  await bootstrapPrivateBucket({ send: async command => calls.push(command.constructor.name) }, 'daylight-test');
  assert.deepEqual(calls, ['HeadBucketCommand', 'DeleteBucketPolicyCommand']);
  const denied = [];
  await assert.rejects(() => bootstrapPrivateBucket({ send: async command => {
    denied.push(command.constructor.name); throw Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } });
  } }, 'daylight-test'), /denied/);
  assert.deepEqual(denied, ['HeadBucketCommand']);
});

test('extracted deliveries verify their own source inventory without using an enclosing Git checkout', t => {
  const root = path.resolve(import.meta.dirname, '..');
  const directory = fs.mkdtempSync(path.join(root, 'work', 'manifest-inventory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'entry.js'), 'export const value = 1;\n');
  fs.mkdirSync(path.join(directory, 'delivery-evidence'));
  fs.writeFileSync(path.join(directory, 'delivery-evidence', 'summary.json'), '{}');
  const write = entries => fs.writeFileSync(path.join(directory, 'DELIVERY-MANIFEST.json'), JSON.stringify({ format: 1, files: entries.map(path => ({ path })) }));
  write(['entry.js', 'delivery-evidence/summary.json']);
  assert.deepEqual(releaseSources(directory), ['entry.js']);
  const before = sourceDigest(directory);
  fs.appendFileSync(path.join(directory, 'entry.js'), '// changed\n');
  assert.notEqual(sourceDigest(directory), before);
  write(['../package.json']);
  assert.throws(() => releaseSources(directory), /Invalid release source path/);
});
