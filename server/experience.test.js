import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { runExperience, createExperienceRouter } from './experience.js';
import { estimateCost } from '../shared/cost-estimate.js';
import { runWithRequestContext } from './request-context.js';

test('public experience: state transition, conflict, linked reschedule, dedup, retry, cancel', async () => {
  const result = await runExperience(7);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.persisted, false);
  assert.deepEqual(result.steps.map(step => step.status), ['completed', 'conflict', 'completed', 'duplicate', 'failed', 'completed', 'completed']);
  const [initial, conflicting, changed, duplicate, failed, retry, cancelled] = result.steps;
  assert.equal(initial.after.tasks, 1);
  assert.equal(conflicting.result.conflicts, 1);
  assert.equal(changed.result.rescheduled, 1);
  assert.deepEqual(duplicate.before, duplicate.after);
  assert.equal(duplicate.result.duplicate, 1);
  assert.deepEqual(duplicate.spans, []);
  assert.deepEqual(failed.before, failed.after);
  assert.equal(failed.result.errors.length, 1);
  assert.ok(failed.spans.some(span => span.status === 'failed'));
  assert.equal(retry.result.errors.length, 0);
  assert.equal(retry.result.added, 1);
  assert.equal(cancelled.result.cancelled, 1);
  const interviews = result.events.filter(event => event.title === '研究助理面试');
  const old = interviews.find(event => event.replacementEventId);
  const replacement = interviews.find(event => event.previousEventId);
  assert.equal(old.replacementEventId, replacement.id);
  assert.equal(replacement.previousEventId, old.id);
  assert.equal(old.status, 'cancelled');
  assert.equal(replacement.status, 'cancelled');
  assert.equal(result.tasks.length, 1);
  assert.notEqual(result.tasks[0].status, 'done');
  assert.ok(result.steps.flatMap(step => step.spans).flatMap(span => span.tools).some(tool => tool.name === 'calendar.apply_actions'));
  assert.equal(JSON.stringify(result).includes('apiKey'), false);
});

test('public experience isolates concurrent visitors and ignores ambient account scope', async () => {
  const [full, empty, second] = await Promise.all([
    runWithRequestContext({ userId: 'private-owner', mailboxId: 'private-mailbox' }, () => runExperience(7)),
    runExperience(0), runExperience(1),
  ]);
  assert.equal(empty.events.length, 1);
  assert.equal(empty.tasks.length, 0);
  assert.equal(second.events.length, 2);
  assert.equal(full.events.length, 5);
  assert.equal(JSON.stringify(full).includes('private-owner'), false);
  assert.equal(JSON.stringify(full).includes('private-mailbox'), false);
  const repeated = await runExperience(1);
  assert.equal(repeated.events.length, 2);
  assert.notEqual(second.events[1].id, repeated.events[1].id);
});

test('public experience rejects arbitrary workload and untrusted input', async () => {
  for (const value of [-1, 8, 10000, NaN, Infinity, '1', 1.1]) await assert.rejects(runExperience(value), RangeError);
});

async function fixtureServer(t, router) {
  const app = express(); app.use('/api/experience', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/api/experience`;
}

test('experience HTTP validation, public access, no-store, safe unknown routes', async t => {
  const base = await fixtureServer(t, createExperienceRouter());
  const ok = await fetch(`${base}?step=1`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await ok.json()).events.length, 2);
  for (const query of ['step=8', 'step=-1', 'step=1.5', 'step=01', 'step=1&step=2', 'step=0&body=secret', 'step[x]=1']) {
    assert.equal((await fetch(`${base}?${query}`)).status, 400, query);
  }
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 404);
});

test('experience HTTP backpressure and failure never disclose runtime details', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const base = await fixtureServer(t, createExperienceRouter({ concurrency: 1, run: async () => { entered(); await pending; throw new Error('private secret'); } }));
  const first = fetch(base);
  await started;
  const busy = await fetch(base);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '1');
  release();
  const failed = await first;
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('private secret'), false);
  assert.equal((await fetch(base)).status, 503, 'slot released after failure');
});

test('cost estimates price cached tokens once and reject invalid or overflowing values', () => {
  const input = { messages: 1000, inputTokens: 4000, outputTokens: 500, cachePercent: 0, inputPrice: 1, outputPrice: 4, cachedInputPrice: 0.02, monthlyInfra: 100 };
  assert.deepEqual(estimateCost(input), { perMessage: 0.006, monthlyModel: 6, total: 106 });
  assert.equal(estimateCost({ ...input, cachePercent: 50 }).monthlyModel, 4.04);
  assert.equal(estimateCost({ ...input, messages: 0 }).total, 100);
  for (const changes of [{ cachePercent: 101 }, { inputTokens: -1 }, { outputPrice: NaN }, { monthlyInfra: Infinity }, { messages: Number.MAX_VALUE, inputTokens: Number.MAX_VALUE }]) assert.equal(estimateCost({ ...input, ...changes }), null);
});
