import fs from 'node:fs/promises';
import path from 'node:path';
import { getPostgresPool, listUsers, postgresMode } from '../infra/postgres.js';
import { redisGet, redisKeys, redisMode } from '../infra/redis.js';
import { readInfraConfig } from '../infra/config.js';
import { runtimeMode } from '../runtime-mode.js';

const SESSION_LIMIT = 10000;
const BACKUP_SCAN_LIMIT = 5000;
const BACKUP_LIST_LIMIT = 100;
const BACKUP_EXTENSION = /\.(?:dump|backup|sql(?:\.gz)?|json|tar(?:\.gz)?|tgz|zip|enc)$/i;
const SESSION_NOTICE = '仅统计仍存续、账号未删除且会话版本有效的认证会话；近 24 小时活跃不包含已注销或过期会话，不能作为完整日活或当前在线人数。';

async function readAccountRows() {
  const pool = getPostgresPool();
  if (pool) return (await pool.query('SELECT id, role, session_version FROM users')).rows;
  // File fallback is available only in explicit local runtime, enforced by listUsers.
  return (await listUsers()).map(row => ({ id: row.id, role: row.role, session_version: row.session_version }));
}

/** Aggregate only: IDs, session tokens, IPs, emails and password hashes never leave this module. */
export async function campusAccountStats({ now = new Date(), readAccounts = readAccountRows, keys = redisKeys, get = redisGet,
  accountSource = () => postgresMode() === 'postgres' ? 'postgres' : 'local', sessionSource = redisMode,
  sessionLimit = SESSION_LIMIT } = {}) {
  let users;
  try { users = await readAccounts(); if (!Array.isArray(users)) throw new Error('Unavailable accounts'); }
  catch { return { accounts: { available: false, notice: '账号存储暂时不可用，未提供估算数量。' }, sessions: { available: false, notice: SESSION_NOTICE } }; }
  const accounts = { available: true, source: accountSource(), total: users.length, admins: users.filter(user => user.role === 'admin').length };
  try {
    const found = await keys('session:');
    if (found.length > sessionLimit) return { accounts, sessions: { available: false, source: sessionSource(), complete: false, scanLimit: sessionLimit, notice: `存续会话超过 ${sessionLimit} 条，本次未提供不完整数量。${SESSION_NOTICE}` } };
    const byId = new Map(users.map(user => [user.id, user])), activeUsers = new Set();
    let surviving = 0, active24h = 0;
    // Bound concurrent Redis reads so a statistics refresh cannot flood the client.
    for (let start = 0; start < found.length; start += 20) {
      const rows = await Promise.all(found.slice(start, start + 20).map(async key => ({ key, raw: await get(key) })));
      for (const { key, raw } of rows) {
        if (!raw) continue;
        let row; try { row = JSON.parse(raw); } catch { continue; }
        if (!row || typeof row !== 'object') continue;
        const user = byId.get(row.userId);
        if (!user || !row.jti || key !== `session:${row.userId}:${row.jti}` || Number(row.sessionVersion) !== (Number(user.session_version) || 0)) continue;
        surviving++;
        const seen = Date.parse(row.lastSeenAt || row.createdAt || '');
        if (Number.isFinite(seen) && seen <= now.getTime() && seen >= now.getTime() - 86400000) { active24h++; activeUsers.add(row.userId); }
      }
    }
    return { accounts, sessions: { available: true, complete: true, source: sessionSource(), surviving, active24h, activeUsers24h: activeUsers.size, windowHours: 24, notice: SESSION_NOTICE } };
  } catch { return { accounts, sessions: { available: false, notice: `会话存储暂时不可用，未提供估算数量。${SESSION_NOTICE}` } }; }
}

/** Static allowlist of booleans; never spread a config object into an HTTP response. */
export function campusConfigurationFlags(config) {
  return { available: true, requireAuth: Boolean(config.auth?.requireAuth), allowLocalDemoLogin: Boolean(config.auth?.allowLocalDemoLogin),
    postgresEnabled: Boolean(config.postgres?.enabled), redisEnabled: Boolean(config.redis?.enabled), queueEnabled: Boolean(config.mq?.enabled),
    objectStorageEnabled: Boolean(config.oss?.enabled), systemMailEnabled: Boolean(config.systemMail?.enabled),
    systemMailFieldsReady: Boolean(config.systemMail?.enabled && config.systemMail?.host && config.systemMail?.user && config.systemMail?.pass),
    notice: '开关与 SMTP 字段齐全状态只反映配置；依赖连通、邮件投递与生产验收需分别验证。' };
}

/** Metadata only, from a server-configured directory. No request may choose a path or download content. */
export async function listCampusBackupFiles({ directory = process.env.DAYLIGHT_BACKUP_DIR || '', now = new Date(),
  scanLimit = BACKUP_SCAN_LIMIT, listLimit = BACKUP_LIST_LIMIT } = {}) {
  const base = { generatedAt: now.toISOString(), configured: Boolean(directory), available: false, files: [],
    notice: '仅列出备份文件元信息；文件存在不代表备份完整、可恢复或已复制到其他故障域。此接口不读取或下载备份正文。' };
  if (!directory) return { ...base, status: 'unconfigured' };
  try {
    const root = path.resolve(directory), rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { ...base, status: 'invalid-directory' };
    const files = [], handle = await fs.opendir(root);
    let scanned = 0, scanTruncated = false;
    for await (const entry of handle) {
      if (++scanned > scanLimit) { scanTruncated = true; break; }
      if (!entry.isFile() || entry.isSymbolicLink() || entry.name.startsWith('.') || !BACKUP_EXTENSION.test(entry.name)) continue;
      const stat = await fs.lstat(path.join(root, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      files.push({ name: entry.name, modifiedAt: stat.mtime.toISOString(), bytes: stat.size });
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
    return { ...base, available: true, status: 'ready', files: files.slice(0, listLimit), totalFiles: scanTruncated ? null : files.length,
      listedFiles: Math.min(files.length, listLimit), truncated: scanTruncated || files.length > listLimit, scanComplete: !scanTruncated,
      totalBytes: scanTruncated ? null : files.reduce((total, file) => total + file.bytes, 0) };
  } catch { return { ...base, status: 'unavailable' }; }
}

export async function campusOperationsSnapshot({ now = new Date(), readAccounts, keys, get, accountSource, sessionSource,
  readConfig = readInfraConfig, readBackups = listCampusBackupFiles, getRuntime = runtimeMode, uptime = () => process.uptime(), memory = () => process.memoryUsage() } = {}) {
  const [identity, backups] = await Promise.all([
    campusAccountStats({ now, readAccounts, keys, get, accountSource, sessionSource }), readBackups({ now }),
  ]);
  let configuration; try { configuration = campusConfigurationFlags(await readConfig()); } catch { configuration = { available: false, notice: '配置无法读取，请在服务器核对环境与配置文件。' }; }
  const usage = memory(), duration = Math.max(0, Math.floor(uptime()));
  return { generatedAt: now.toISOString(), ...identity, configuration, backups,
    process: { scope: 'current-api-process', runtime: getRuntime(), uptimeSeconds: duration, startedAt: new Date(now.getTime() - duration * 1000).toISOString(),
      memoryBytes: { rss: Number(usage.rss) || 0, heapUsed: Number(usage.heapUsed) || 0, heapTotal: Number(usage.heapTotal) || 0, external: Number(usage.external) || 0 },
      notice: '运行时间与内存仅属于当前响应的 API 进程，不汇总 Worker、Scheduler、依赖容器或其他 API 副本。' } };
}

export function registerCampusOperationsRoutes(router, { route, requireAdmin, now = () => new Date(), readOperations = campusOperationsSnapshot, readBackups = listCampusBackupFiles } = {}) {
  router.get('/admin/operations', route(async (req, res) => { await requireAdmin(req); res.setHeader('Cache-Control', 'private, no-store'); return readOperations({ now: now() }); }));
  router.get('/admin/backups', route(async (req, res) => { await requireAdmin(req); res.setHeader('Cache-Control', 'private, no-store'); return readBackups({ now: now() }); }));
}
