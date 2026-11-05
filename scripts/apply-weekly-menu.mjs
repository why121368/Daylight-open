#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { createGuideRepository, CATALOG_KEY } from '../server/campus-guide/repository.js';
import { shanghaitechCatalog } from '../server/campus-guide/shanghaitech.js';

import { withWeeklyMenu } from '../server/campus-guide/weekly-menu.js';

const root = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, 'environment-file': { type: 'string' } } });
// Read only the chosen runtime's storage settings. Never print service credentials.
const settings = values['environment-file'] ? JSON.parse((await fs.readFile(path.resolve(root, values['environment-file']), 'utf8')).replace(/^\uFEFF/, '')) : process.env;
const dataDir = path.resolve(root, settings.DAYLIGHT_DATA_DIR || 'data');
if (settings.DAYLIGHT_RUNTIME === 'production' && !settings.DAYLIGHT_DATABASE_URL) throw new Error('生产运行需要明确的 PostgreSQL 配置。');
const pool = settings.DAYLIGHT_DATABASE_URL ? new pg.Pool({ connectionString: settings.DAYLIGHT_DATABASE_URL, ssl: settings.DAYLIGHT_DATABASE_SSL === '1' ? { rejectUnauthorized: true } : undefined, max: 1, connectionTimeoutMillis: 10000 }) : null;
pool?.on('error', () => {});
try {
  const repository = createGuideRepository({ dataDir, pool, pgRequired: Boolean(pool) });
  const current = await repository.read(CATALOG_KEY);
  // A revision-zero catalog has never been saved. Start with the real map alone.
  const base = current.version === 0 ? shanghaitechCatalog() : current.payload;
  const catalog = withWeeklyMenu(base);
  const plan = { catalog, added: catalog.menus.length - base.menus.length, retained: base.menus.length };
  let revision = current.version, backup = null;
  const changed = current.version === 0 || JSON.stringify(plan.catalog) !== JSON.stringify(current.payload);
  if (values.apply && changed) {
    const backupDir = path.join(dataDir, 'campus-guide', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    backup = path.join(backupDir, `before-weekly-menu-${new Date().toISOString().replace(/[:.]/g, '-')}-r${current.version}.json`);
    await fs.writeFile(backup, JSON.stringify(current, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const result = await repository.mutate(CATALOG_KEY, data => { Object.keys(data).forEach(key => delete data[key]); Object.assign(data, plan.catalog); }, { expectedRevision: current.version });
    revision = result.version;
  }
  console.log(JSON.stringify({ ok: true, applied: Boolean(values.apply && changed), preview: !values.apply, storage: pool ? 'postgres' : 'local', revision, menus: plan.catalog.menus.length, added: plan.added, retained: plan.retained, backup: backup ? path.relative(root, backup) : null }));
} catch (error) {
  console.error(`食堂周菜单导入失败（${error.code || error.name || 'unknown'}）；未确认完成，请检查存储状态与版本。`);
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
