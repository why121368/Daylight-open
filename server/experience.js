import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { processEmails, parseExtraction } from './agent.js';
import { createTraceRecorder } from './traces.js';
import { runStorageSnapshot, settingsKey } from './storage/index.js';
import { EXPERIENCE_STEPS, EXPERIENCE_VERSION } from '../shared/experience-fixtures.js';

const at = time => `2026-11-05T${time}:00+08:00`;
const event = (title, start, end) => ({ title, start: at(start), end: at(end), location: '线上会议室', category: 'work' });

function extractionFor(index, store) {
  const target = store.events.find(item => item.title === '研究助理面试' && item.status !== 'cancelled');
  const base = { summary: '原创示例的预置提取；没有调用实时模型', category: 'meeting', intent: 'calendar', events: [], tasks: [] };
  if (index === 0) return { ...base, events: [event('研究助理面试', '10:00', '10:30')],
    tasks: [{ title: '准备一页研究经历', dueAt: '2026-11-04T18:00:00+08:00', priority: 'normal' }] };
  if (index === 1) return { ...base, events: [{ ...event('实验室交流', '14:00', '14:30'), location: 'B楼会议室' }] };
  if (index === 2) return { ...base, events: [{ action: 'reschedule', targetEventId: target.id, start: at('15:00'), end: at('15:30'), reason: '通知调整面试时间' }] };
  if (index === 4) return { ...base, events: [event('不应部分写入的安排', '16:00', '16:30'), { title: '错误时间', start: 'invalid', end: at('17:00') }] };
  if (index === 5) return { ...base, events: [event('补充交流', '16:00', '16:30')] };
  if (index === 6) return { ...base, events: [{ action: 'cancel', targetEventId: target.id, reason: '收到面试取消通知' }] };
  return base;
}

function sourceEmail(index) {
  const step = EXPERIENCE_STEPS[index === 3 ? 0 : index === 5 ? 4 : index];
  return { id: `public-example:${step.id}`, subject: step.subject, body: step.body,
    sender: '示例通知 <demo@example.invalid>', receivedAt: step.receivedAt };
}

/** Replay bounded public fixtures through the real tool chain in request-local memory.
 * A synthetic read-only storage snapshot prevents readSettings() from consulting private
 * files or a logged-in user's PostgreSQL settings. Nothing is committed or persisted.
 */
export async function runExperience(stepCount = 0) {
  if (!Number.isInteger(stepCount) || stepCount < 0 || stepCount > EXPERIENCE_STEPS.length) throw new RangeError('Invalid experience step');
  const snapshot = { userId: null, identity: { userId: null }, readOnly: true,
    documents: new Map([[settingsKey('default'), { payload: { activeMailboxId: 'experience',
      mailboxes: [{ id: 'experience', email: 'demo@example.invalid' }], userPrefs: {}, mailFilters: [] } }]]),
    dirty: new Set(), newMailboxIds: new Set(), closed: false };
  return runStorageSnapshot(snapshot, async () => {
    const started = performance.now();
    const store = { events: [{ id: 'example-group-meeting', ...event('已有课题组例会', '14:00', '15:00'),
      location: 'A楼讨论室', source: 'demo', status: 'active' }], emails: [], tasks: [] };
    const recorder = createTraceRecorder();
    const steps = [];
    for (let index = 0; index < stepCount; index++) {
      const email = sourceEmail(index);
      const before = { events: store.events.length, tasks: store.tasks.length };
      const result = await processEmails(store, [email], async () => parseExtraction(JSON.stringify(extractionFor(index, store))), 'demo',
        { recorder, enrichAttachments: false, mailFilters: [] });
      const trace = recorder.traces.find(item => item.subject === email.subject);
      // Capture this attempt now: a later retry must not rewrite the failed step.
      const attempt = trace?.attempts?.length || 0;
      const spans = result.duplicate ? [] : (trace?.spans || []).filter(span => span.attempt === attempt).map(span => ({
        stage: span.stage, label: span.label, status: span.status, durationMs: span.latency_ms,
        observation: span.observation, tools: span.tool_calls.map(tool => ({ name: tool.name, arguments: tool.arguments })),
      }));
      steps.push({ id: EXPERIENCE_STEPS[index].id, result, before, after: { events: store.events.length, tasks: store.tasks.length },
        spans, email: { subject: email.subject, body: email.body, receivedAt: email.receivedAt },
        draft: result.duplicate ? '' : store.emails.find(item => item.id === email.id)?.draftReply || '',
        status: result.errors.length ? 'failed' : result.duplicate ? 'duplicate' : result.conflicts ? 'conflict' : 'completed' });
    }
    // Whitelisted public DTOs only; do not export snapshot documents or settings.
    return { version: EXPERIENCE_VERSION, step: stepCount, source: 'synthetic-preset-live-tools',
      modelCalls: 0, modelCostCny: 0, persisted: false, serverDurationMs: Math.round((performance.now() - started) * 100) / 100,
      events: store.events.map(({ id, title, start, end, status, location, previousEventId, replacementEventId, cancelReason, emailSubject, hasConflict }) =>
        ({ id, title, start, end, status, location, previousEventId, replacementEventId, cancelReason, emailSubject, hasConflict })),
      tasks: store.tasks.map(({ title, dueAt, status }) => ({ title, dueAt, status })), steps };
  });
}

export function createExperienceRouter({ run = runExperience, concurrency = 4 } = {}) {
  const router = Router();
  let inflight = 0;
  router.get('/', async (req, res) => {
    const raw = req.query.step ?? '0';
    if (Object.keys(req.query).some(key => key !== 'step') || typeof raw !== 'string' || !/^[0-7]$/.test(raw)) {
      return res.status(400).json({ error: '请选择有效的体验步骤。', code: 'EXPERIENCE_STEP_INVALID' });
    }
    if (inflight >= concurrency) return res.set('Retry-After', '1').status(429).json({ error: '体验人数较多，请稍后重试。', code: 'EXPERIENCE_BUSY' });
    inflight++;
    try { res.set('Cache-Control', 'no-store').json(await run(Number(raw))); }
    catch { res.status(503).json({ error: '体验暂时不可用，请重试或打开校园生活。', code: 'EXPERIENCE_UNAVAILABLE' }); }
    finally { inflight--; }
  });
  router.use((req, res) => res.status(404).json({ error: '体验接口不存在。' }));
  return router;
}
