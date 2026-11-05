import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { getPostgresPool, postgresMode } from '../infra/postgres.js';
import { readInfraConfig } from '../infra/config.js';
import { isProductionRuntime } from '../runtime-mode.js';
import { guideError, emptyPersonal } from '../../shared/campus-guide.js';
import { demoCatalog } from './seed.js';
import { withWeeklyMenu } from './weekly-menu.js';
import { shanghaitechCatalog } from './shanghaitech.js';

export const CATALOG_KEY = 'campus-guide:catalog';
export const ACTIVITY_KEY = 'campus-guide:activity';
export const COMMUNITY_KEY = 'campus-guide:community';
export const SOURCES_KEY = 'campus-guide:sources';
export const MEDIA_KEY = 'campus-media:index';
export const personalKey = userId => { if (typeof userId !== 'string' || !userId) throw guideError('请先登录', 401); return `campus-guide:me:${createHash('sha256').update(userId).digest('hex')}`; };
export const emptyActivity = () => ({ revision: 0, queueReports: [], queueReportHistory: [], queueHistoryStartedAt: '', menuReports: [], feedback: [], checkinCodes: {}, checkinAttempts: {} });
export const emptyCommunity = () => ({ revision: 0, posts: [], comments: [], reactions: [], images: [] });
export const emptySources = () => ({ revision: 0, sources: [], runs: [], drafts: [] });
export const emptyMedia = () => ({ revision: 0, files: [] });
export const initialDocument = key => key === CATALOG_KEY ? demoCatalog() : key === ACTIVITY_KEY ? emptyActivity() : key === COMMUNITY_KEY ? emptyCommunity() : key === SOURCES_KEY ? emptySources() : key === MEDIA_KEY ? emptyMedia() : key.startsWith('campus-guide:me:') ? emptyPersonal() : (() => { throw guideError('无效的校园存储空间。'); })();
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const pendingFiles = new Map();
const clone = value => structuredClone(value);
const conflict = () => guideError('数据已在其他页面更新，请刷新后重试。', 409, 'CAMPUS_GUIDE_VERSION_CONFLICT');
const checkKey = key => { if (![CATALOG_KEY, ACTIVITY_KEY, COMMUNITY_KEY, SOURCES_KEY, MEDIA_KEY].includes(key) && !/^campus-guide:me:[a-f0-9]{64}$/.test(key)) throw guideError('无效的校园存储空间。'); };
async function replaceLocalFile(temporary, target) {
  // Windows scanners/read handles can briefly deny a replacement. Keep the same
  // fully-written temporary file and retry rename; never unlink the live target.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, target); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

/** Independent shared CAS documents: safe to mount before mailbox storage middleware. */
export function createGuideRepository({ dataDir, pool, pgRequired, initialize = initialDocument, supplement = catalog => catalog } = {}) {
  const directory = path.join(dataDir || process.env.DAYLIGHT_DATA_DIR || path.join(root, 'data'), 'campus-guide');
  const getPool = () => typeof pool === 'function' ? pool() : pool === undefined ? getPostgresPool() : pool;
  const requiresPg = () => typeof pgRequired === 'function' ? pgRequired() : pgRequired === undefined ? isProductionRuntime() || postgresMode() === 'postgres' || readInfraConfig().postgres.enabled : pgRequired;
  const filename = key => path.join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  const initial = key => clone(initialize(key));
  const usePg = () => { const current = getPool(); if (requiresPg() && !current) throw guideError('校园共享存储暂时不可用。', 503, 'CAMPUS_GUIDE_STORAGE_UNAVAILABLE'); return current; };
  async function fileRead(key) {
    try { const document = JSON.parse(await fs.readFile(filename(key), 'utf8')); if (!document || typeof document.version !== 'number' || !document.payload) throw Error('invalid'); return document; }
    catch (error) { if (error.code === 'ENOENT') return { version: 0, payload: initial(key) }; throw guideError('校园资料文件损坏或不可读，请联系管理员恢复。', 503, 'CAMPUS_GUIDE_STORAGE_INVALID'); }
  }
  async function read(key) {
    checkKey(key); const db = usePg();
    if (db) { try { const { rows } = await db.query('SELECT payload, version FROM app_settings WHERE id = $1', [key]); return rows.length ? { version: Number(rows[0].version), payload: clone(rows[0].payload) } : { version: 0, payload: initial(key) }; } catch (error) { throw Object.assign(guideError('校园共享存储读取失败。', 503, 'CAMPUS_GUIDE_STORAGE_UNAVAILABLE'), { cause: error }); } }
    return fileRead(key);
  }
  async function fileLocked(keys, fn) {
    const lockKeys = [...new Set(keys)].map(key => filename(key)).sort(), releases = [], tails = [];
    for (const key of lockKeys) { const previous = pendingFiles.get(key) || Promise.resolve(); let release; const tail = new Promise(resolve => { release = resolve; }); pendingFiles.set(key, tail); tails.push([key, tail]); await previous.catch(() => {}); releases.push(release); }
    try { return await fn(); } finally { releases.reverse().forEach(release => release()); for (const [key, tail] of tails) if (pendingFiles.get(key) === tail) pendingFiles.delete(key); }
  }
  async function mutateMany(keys, change, { expected = {} } = {}) {
    keys = [...new Set(keys)].sort(); keys.forEach(checkKey); const db = usePg();
    const apply = documents => {
      for (const key of keys) if (expected[key] !== undefined && Number(expected[key]) !== documents.get(key).version) throw conflict();
      const drafts = new Map([...documents].map(([key, value]) => [key, clone(value.payload)]));
      const value = change(drafts);
      if (value && typeof value.then === 'function') { Promise.resolve(value).catch(() => {}); throw guideError('校园存储写入必须为同步回调。'); }
      for (const key of keys) { const payload = drafts.get(key), next = documents.get(key).version + 1; if (key === CATALOG_KEY) { payload.meta.revision = next; payload.meta.updatedAt = new Date().toISOString(); } else payload.revision = next; }
      return { drafts, value };
    };
    if (db) {
      let client; try { client = await db.connect(); } catch (error) { throw Object.assign(guideError('校园共享存储连接失败。', 503, 'CAMPUS_GUIDE_STORAGE_UNAVAILABLE'), { cause: error }); } let committed = false;
      try {
        await client.query('BEGIN');
        const documents = new Map();
        for (const key of keys) { await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`daylight:storage:settings:${key}`]); const { rows } = await client.query('SELECT payload, version FROM app_settings WHERE id = $1 FOR UPDATE', [key]); documents.set(key, rows.length ? { version: Number(rows[0].version), payload: clone(rows[0].payload) } : { version: 0, payload: initial(key) }); }
        const { drafts, value } = apply(documents);
        for (const key of keys) { const version = documents.get(key).version, payload = drafts.get(key), result = version
          ? await client.query('UPDATE app_settings SET payload = $2::jsonb, version = version + 1, updated_at = clock_timestamp() WHERE id = $1 AND version = $3::bigint RETURNING version', [key, JSON.stringify(payload), String(version)])
          : await client.query('INSERT INTO app_settings (id, payload, updated_at, version) VALUES ($1, $2::jsonb, clock_timestamp(), 1) ON CONFLICT DO NOTHING RETURNING version', [key, JSON.stringify(payload)]);
          if (!result.rows.length) throw conflict(); }
        await client.query('COMMIT'); committed = true;
        return { documents: new Map([...drafts].map(([key, payload]) => [key, { payload: clone(payload), version: documents.get(key).version + 1 }])), value: clone(value) };
      } catch (error) { if (!committed) try { await client.query('ROLLBACK'); } catch {} if (error.status) throw error; throw Object.assign(guideError('校园共享存储提交失败，未确认保存。', 503, 'CAMPUS_GUIDE_STORAGE_UNAVAILABLE'), { cause: error }); }
      finally { client.release(); }
    }
    return fileLocked(keys, async () => {
      const documents = new Map(await Promise.all(keys.map(async key => [key, await fileRead(key)]))), { drafts, value } = apply(documents), staged = [];
      await fs.mkdir(directory, { recursive: true });
      // Local demonstration mode is serialized in one process; PG is required across replicas.
      try { for (const key of keys) { const temp = `${filename(key)}.${randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify({ version: documents.get(key).version + 1, payload: drafts.get(key) }, null, 2), { mode: 0o600 }); staged.push([temp, filename(key)]); } for (const [temp, target] of staged) await replaceLocalFile(temp, target); }
      finally { for (const [temp] of staged) await fs.unlink(temp).catch(() => {}); }
      return { documents: new Map([...drafts].map(([key, payload]) => [key, { payload: clone(payload), version: documents.get(key).version + 1 }])), value: clone(value) };
    });
  }
  async function mutate(key, change, options = {}) { const result = await mutateMany([key], drafts => change(drafts.get(key)), { expected: options.expectedRevision === undefined ? {} : { [key]: options.expectedRevision } }); return { ...result.documents.get(key), value: result.value }; }
  async function readCatalog() {
    for (let attempt = 0; ; attempt++) {
      const { payload } = await read(CATALOG_KEY);
      if (supplement(payload) === payload) return payload;
      try {
        return (await mutate(CATALOG_KEY, current => Object.assign(current, supplement(current)), { expectedRevision: payload.meta.revision })).payload;
      } catch (error) { if (error.status !== 409 || attempt >= 3) throw error; }
    }
  }
  return { read, mutate, mutateMany, storageStatus: () => { const shared = Boolean(usePg()); return { mode: shared ? 'postgres' : 'local', shared }; }, readCatalog, readPersonal: async userId => (await read(personalKey(userId))).payload };
}
// The public application starts with the imported university map. Tests and the
// explicitly isolated demo can still opt into the original synthetic catalog.
export const guideRepository = createGuideRepository({ supplement: withWeeklyMenu, initialize: key => key === CATALOG_KEY && process.env.DAYLIGHT_DEMO !== '1' ? shanghaitechCatalog() : initialDocument(key) });
