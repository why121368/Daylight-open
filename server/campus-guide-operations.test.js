import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { campusAccountStats, campusConfigurationFlags, campusOperationsSnapshot, listCampusBackupFiles } from './campus-guide/operations.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { createGuideRepository } from './campus-guide/repository.js';

const now = new Date('2026-10-23T12:00:00+08:00');
const privateValue = 'synthetic-private-key-never-return';
const accounts = [{ id: 'a', role: 'admin', session_version: 0 }, { id: 'b', role: 'user', session_version: 2 }];
const session = (userId, jti, seen, version = 0) => JSON.stringify({ userId, jti, lastSeenAt: seen, sessionVersion: version, email: privateValue, ip: privateValue });

test('校园运维：会话聚合排除失效版本、删除账号、过期读取、损坏记录，且不泄露身份', async () => {
  const rows = new Map([
    ['session:a:first', session('a', 'first', '2026-10-23T11:00:00+08:00')],
    ['session:a:second', session('a', 'second', '2026-10-23T10:00:00+08:00')],
    ['session:b:old', session('b', 'old', '2026-10-21T11:00:00+08:00', 2)],
    ['session:b:revoked', session('b', 'revoked', '2026-10-23T10:00:00+08:00', 1)],
    ['session:deleted:one', session('deleted', 'one', '2026-10-23T10:00:00+08:00')],
    ['session:a:future', session('a', 'future', '2026-10-25T10:00:00+08:00')],
    ['session:a:expired', null], ['session:a:broken', '{'], ['session:a:wrong-key', session('a', 'not-this-key', '2026-10-23T11:00:00+08:00')],
  ]);
  const result = await campusAccountStats({ now, readAccounts: async () => accounts, keys: async () => [...rows.keys()], get: async key => rows.get(key), accountSource: () => 'synthetic', sessionSource: () => 'synthetic' });
  assert.equal(result.accounts.total, 2); assert.equal(result.accounts.admins, 1);
  assert.equal(result.sessions.surviving, 4); assert.equal(result.sessions.active24h, 2); assert.equal(result.sessions.activeUsers24h, 1);
  assert.equal(JSON.stringify(result).includes(privateValue), false); assert.equal(JSON.stringify(result).includes('session:a:'), false);
  const oversized = await campusAccountStats({ now, readAccounts: async () => accounts, keys: async () => ['one', 'two'], get: async () => { assert.fail('Over-limit snapshot must not read sessions'); }, sessionLimit: 1 });
  assert.equal(oversized.sessions.available, false); assert.equal(oversized.sessions.complete, false); assert.equal(oversized.sessions.activeUsers24h, undefined);
  const unavailable = await campusAccountStats({ readAccounts: async () => { throw new Error(privateValue); } });
  assert.equal(unavailable.accounts.available, false); assert.equal(unavailable.accounts.total, undefined); assert.equal(JSON.stringify(unavailable).includes(privateValue), false);
});

test('校园运维：只投影配置布尔与当前进程指标，失败不返回配置正文', async () => {
  const config = { auth: { requireAuth: true, allowLocalDemoLogin: false, jwtSecret: privateValue }, postgres: { enabled: true, connectionString: privateValue }, systemMail: { enabled: true, host: privateValue, user: privateValue, pass: privateValue }, oss: { enabled: true, secretKey: privateValue } };
  const flags = campusConfigurationFlags(config); assert.equal(flags.systemMailFieldsReady, true); assert.equal(JSON.stringify(flags).includes(privateValue), false);
  const result = await campusOperationsSnapshot({ now, readAccounts: async () => accounts, keys: async () => [], readConfig: () => config, readBackups: async () => ({ available: false, files: [] }), getRuntime: () => 'local', uptime: () => 123.8, memory: () => ({ rss: 1000, heapUsed: 500, heapTotal: 800, external: 50, secret: privateValue }) });
  assert.equal(result.process.uptimeSeconds, 123); assert.equal(result.process.memoryBytes.rss, 1000); assert.equal(result.process.scope, 'current-api-process'); assert.equal(JSON.stringify(result).includes(privateValue), false);
  const failed = await campusOperationsSnapshot({ now, readAccounts: async () => [], keys: async () => [], readConfig: () => { throw new Error(privateValue); }, readBackups: async () => ({ files: [] }), getRuntime: () => 'local' });
  assert.equal(failed.configuration.available, false); assert.equal(JSON.stringify(failed).includes(privateValue), false);
});

test('校园运维：备份清单仅列静态目录常规文件的名称/时间/大小，拒绝链接且不读正文', async t => {
  await fs.mkdir('work', { recursive: true }); const root = await fs.mkdtemp(path.resolve('work/campus-operations-')), external = await fs.mkdtemp(path.resolve('work/campus-operations-external-'));
  // Keep all fixtures under work; no real user data or backup directory is opened.
  await fs.writeFile(path.join(root, 'daylight-a.dump'), privateValue); await fs.writeFile(path.join(root, 'daylight-b.json'), privateValue);
  await fs.writeFile(path.join(root, '.hidden.json'), privateValue); await fs.writeFile(path.join(root, 'compose.env'), privateValue); await fs.mkdir(path.join(root, 'nested.dump'));
  await fs.writeFile(path.join(external, 'outside.dump'), privateValue);
  let linkCreated = false;
  try { await fs.symlink(path.join(external, 'outside.dump'), path.join(root, 'linked.dump')); linkCreated = true; } catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
  const result = await listCampusBackupFiles({ directory: root, now });
  assert.equal(result.available, true); assert.equal(result.totalFiles, 2); assert.deepEqual(result.files.map(row => row.name).sort(), ['daylight-a.dump', 'daylight-b.json']);
  assert.equal(result.totalBytes, Buffer.byteLength(privateValue) * 2); assert.equal(JSON.stringify(result).includes(root), false); assert.equal(JSON.stringify(result).includes(privateValue), false);
  const limited = await listCampusBackupFiles({ directory: root, listLimit: 1 }); assert.equal(limited.files.length, 1); assert.equal(limited.truncated, true);
  assert.equal((await listCampusBackupFiles({ directory: '' })).status, 'unconfigured'); assert.equal((await listCampusBackupFiles({ directory: path.join(root, 'absent') })).status, 'unavailable');
  if (linkCreated) assert.equal(result.files.some(row => row.name === 'linked.dump'), false);
});

test('校园运维HTTP：匿名401、非管理403，账号/统计/备份仅读管理员且私有不可缓存', async t => {
  await fs.mkdir('work', { recursive: true }); const root = await fs.mkdtemp(path.resolve('work/campus-operations-http-'));
  const repository = createGuideRepository({ dataDir: root, pgRequired: false, pool: null });
  let operationsReads = 0, backupReads = 0;
  const app = express(); app.use('/api/campus-guide', createCampusGuideRouter({ repository, now: () => now,
    resolveUser: async header => header === 'Bearer admin' ? { id: 'admin', role: 'admin' } : header === 'Bearer user' ? { id: 'user', role: 'user' } : null,
    adminUser: user => user.role === 'admin', readOperations: async () => { operationsReads++; return { generatedAt: now.toISOString(), accounts: { total: 2 } }; },
    readBackups: async () => { backupReads++; return { files: [{ name: 'synthetic.dump', bytes: 20 }] }; },
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/campus-guide`;
  for (const endpoint of ['/admin/operations', '/admin/backups', '/admin/stats']) {
    for (const [token, status] of [[null, 401], ['user', 403]]) { const response = await fetch(base + endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); assert.equal(response.status, status); }
  }
  assert.equal(operationsReads, 0); assert.equal(backupReads, 0);
  for (const endpoint of ['/admin/operations', '/admin/backups', '/admin/stats']) { const response = await fetch(`${base}${endpoint}?directory=../../data`, { headers: { Authorization: 'Bearer admin' } }); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/); const data = await response.json(); if (endpoint === '/admin/stats') assert.equal(data.operations.accounts.total, 2); }
  assert.equal(operationsReads, 2); assert.equal(backupReads, 1);
});
