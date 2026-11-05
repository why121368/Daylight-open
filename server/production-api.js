import { storageHttpMiddleware } from './storage-http.js';
import { readSettings, readStore } from './store.js';
import { readRecruitment } from './recruitment-store.js';
import { getPostgresPool } from './infra/postgres.js';
import { publicJob } from './job-api.js';

const sharedRoots = /^\/(auth(?:\/|$)|state$|emails\/[^/]+\/detail$|settings$|mailboxes(?:\/|$)|scenarios(?:\/|$)|jobs(?:\/|$)|sync(?:\/|$)|infra\/public$|tasks(?:\/|$)|events(?:\/|$)|material-kinds$|traces(?:\/|$)|recruitment(?:\/|$)|assistant(?:\/|$)|calendar-sync(?:\/|$))/;
const reads = new Set(['GET', 'HEAD']);
const attachmentRead = /^\/(?:attachments\/.+|recruitment\/attachments\/[^/]+\/?)$/;
const sharedRead = /^\/(?:attachments\/.+|rag\/status|infra|persistence|prompts(?:\/revisions)?|report-prompts|onboarding\/guide)$/;
const adminRead = /^\/admin\/(?:overview|monitor|users(?:\/[^/]+)?|mailboxes|infra|settings|mail-templates|onboarding-guide|search)$/;

/** Only workflows whose state is held by shared storage may run in production. */
export function productionWorkflowMiddleware(req, res, next) {
  const { path, method } = req;
  if (/^\/traces\/[^/]+\/send$/.test(path)) {
    return res.status(503).json({ code: 'WORKFLOW_NOT_MIGRATED', error: '此旧版直接发信入口尚未迁移，请使用助手的审核发送流程。' });
  }
  const safe = sharedRoots.test(path)
    || (reads.has(method) && (sharedRead.test(path) || adminRead.test(path)))
    || (method === 'POST' && /^\/(?:rag\/(?:search|reindex)|test\/(?:mailbox|model)|prompts\/reset|report-prompts\/(?:reset|presets)|emails\/[^/]+\/(?:extract-invoices|resolve-match))$/.test(path))
    || (method === 'PUT' && /^\/(?:prompts|report-prompts|calendar-categories|mail-filters)$/.test(path))
    || (method === 'DELETE' && /^\/report-prompts\/presets\/[^/]+$/.test(path))
    || (method === 'POST' && /^\/admin\/users(?:\/[^/]+\/force-logout)?$/.test(path))
    || (['PUT', 'DELETE'].includes(method) && /^\/admin\/users\/[^/]+$/.test(path))
    || (method === 'DELETE' && /^\/admin\/users\/[^/]+\/sessions\/[^/]+$/.test(path))
    || (method === 'PUT' && /^\/admin\/(?:settings|mail-templates|onboarding-guide)$/.test(path))
    || (method === 'POST' && /^\/admin\/(?:mail-templates\/(?:reset|preview)|onboarding-guide\/reset)$/.test(path));
  if (safe) return next();
  const managed = /^\/(?:admin\/)?infra(?:\/reload)?$/.test(path);
  return res.status(503).json({ code: managed ? 'PRODUCTION_CONFIG_MANAGED' : 'WORKFLOW_NOT_MIGRATED',
    error: managed ? '生产基础设施由部署环境变量管理，请更新部署配置并重启服务。' : '此流程尚未迁入共享存储任务执行，生产模式暂不开放。' });
}

/** Authentication populates req.user before this middleware is installed. */
export function productionStorageMiddleware(options = {}) {
  const owned = storageHttpMiddleware(options);
  // Profiles keep hot reads independent of unrelated mailbox/history documents.
  // Legacy workflows retain the full snapshot and commit-before-response guard.
  const system = storageHttpMiddleware({ ...options, system: true });
  return (req, res, next) => {
    if (!/^\/admin(?:\/|$)/.test(req.path)) {
      // These handlers use Redis/auth tables only. Never hydrate business history.
      if (/^\/auth\/(?:captcha|config|me|login|register|reset-password)\/?$/.test(req.path)
        || req.path === '/infra/public') return next();
      const query = req.query || {};
      let profile;
      if (req.path.startsWith('/auth/')) profile = 'auth-mail';
      else if (req.path === '/settings' && reads.has(req.method)
        || /^\/mailboxes\/[^/]+\/activate\/?$/.test(req.path)
        || req.path.startsWith('/jobs') || /^\/sync\//.test(req.path)) profile = 'settings';
      else if (reads.has(req.method) && /^\/state\/?$/.test(req.path)) profile = query.view === 'summary' ? 'workspace-summary' : 'workspace';
      else if (reads.has(req.method) && req.path === '/traces') profile = 'traces';
      else if (reads.has(req.method) && attachmentRead.test(req.path)) profile = 'attachment';
      else if (reads.has(req.method) && /^\/emails\/[^/]+\/detail$/.test(req.path)) profile = 'email-detail';
      if (profile) {
        const single = ['workspace','workspace-summary','traces','email-detail'].includes(profile)
          && query.scope !== 'all' && !query.tag;
        // Mailbox identity is checked against authoritative ownership by the loader.
        const mailboxId = query.mailbox || (profile === 'email-detail' ? req.get('X-Mailbox-Id') : undefined);
        return storageHttpMiddleware({ ...options, profile,
          ...(single ? { selectMailbox: 'active' } : {}),
          ...(mailboxId ? { mailboxId: String(mailboxId) } : {}),
          ...(profile === 'email-detail' ? { emailId: decodeURIComponent(req.path.split('/')[2]) } : {}),
          maxBufferBytes: profile === 'attachment' ? 64 * 1024 * 1024
            : ['workspace','workspace-summary','email-detail'].includes(profile) ? 32 * 1024 * 1024 : 8 * 1024 * 1024,
        })(req, res, next);
      }
      return owned(req, res, next);
    }
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (req.user.isAdmin !== true) return res.status(403).json({ error: '需要管理员权限' });
    return system(req, res, next);
  };
}

/** A bucket key alone is not permission to read a private attachment. */
export function ownsAttachmentKey(key, { settings = readSettings(), calendar = readStore, recruitment = readRecruitment } = {}) {
  for (const mailbox of settings.mailboxes || []) {
    const store = calendar(mailbox.id);
    if ((store.emails || []).some(email => (email.attachments || []).some(file => file.key === key))) return true;
    if ((store.events || []).some(event => (event.materials || []).some(file => file.storageKey === key))) return true;
    if ((recruitment(mailbox.id).attachments || []).some(file => file.key === key)) return true;
  }
  return false;
}

/** Called only after administrator authentication; omit task inputs and raw errors. */
export async function readProductionAdminJobs(limit = 40, pool = getPostgresPool()) {
  if (!pool) throw Object.assign(new Error('共享任务存储不可用。'), { status: 503 });
  const { rows } = await pool.query(`SELECT id, mailbox_id, kind, status, attempts, max_attempts, generation,
    created_at, updated_at, finished_at, available_at, error FROM daylight_jobs
    ORDER BY created_at DESC, id DESC LIMIT $1`, [Math.min(80, Math.max(1, Number(limit) || 40))]);
  return rows.map(row => ({ ...publicJob(row), name: row.kind, topic: row.kind,
    error: row.error ? '任务未完成，请查看执行记录或重试。' : null }));
}
