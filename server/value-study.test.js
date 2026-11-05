import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { STUDY_SETS, participantSet, studyOrder } from '../shared/value-study-fixtures.js';
import { scoreStudyAnswers, studyDraftDifference, summarizeStudy, validateStudyAnswers, validateStudyDataset } from './value-study-score.js';
import { createValueStudyService } from './value-study-service.js';
import { createValueStudyRouter } from './value-study-router.js';
import { studyLocalTime, studyWireTime } from '../shared/value-study-time.js';

const set = STUDY_SETS[0];
function goldenAnswers(group = set) {
  return { events: [{ ...group.initialEvents[0] }, { title: group.emails[0].subject.replace('邀请', ''),
    ...group.golden.interview, sourceId: group.golden.interviewSources[1] }],
  tasks: group.golden.tasks.map(task => ({ title: task.topic, dueAt: task.dueAt, sourceId: task.sourceId })),
  conflictNotes: `${group.emails[2].subject}曾与已有例会重叠，后续已取消。` };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled(service) {
  for (let i = 0; i < 30 && service.config().busy; i++) await tick();
  assert.equal(service.config().busy, false, 'analysis must settle');
}
function fixture(overrides = {}) {
  let now = 1000;
  const written = [];
  const service = createValueStudyService({ mode: 'live', maxCalls: 10,
    run: async group => ({ draft: goldenAnswers(group), store: { emails: group.emails.filter((mail, i) => i !== 4) }, processed: 5, errors: [] }),
    save: row => written.push(row), clock: () => now, wall: () => '2026-11-04T00:00:00Z', ...overrides });
  return { service, written, advance: milliseconds => { now += milliseconds; } };
}
function begin(service, participant = 'P02', kind = 'participant') {
  const created = service.create({ participant, kind, consented: true });
  return service.start(created.id);
}

test('study materials balance four assignments and hide fixed answers from participants', () => {
  const validation = validateStudyDataset();
  assert.deepEqual(validation.characterCounts, [572, 575]);
  assert.equal(validation.automaticChecks, 12);
  const orders = ['P01', 'P02', 'P03', 'P04'].map(studyOrder);
  assert.equal(new Set(orders.flatMap(order => order.map(t => `${t.condition}-${t.set}`))).size, 4);
  assert.equal(new Set(orders.map(order => `${order[0].condition}-${order[0].set}`)).size, 4);
  assert.deepEqual(studyOrder('P05'), studyOrder('P01'));
  assert.deepEqual(Object.keys(participantSet(set)).sort(), ['emails','id','initialEvents','timezone','title']);
  for (const invalid of ['P00','P1','P1000','P001','anonymous',null]) assert.throws(() => studyOrder(invalid));
});

test('study scoring catches deadlines, stale and repeated calendar entries and missing sources', () => {
  assert.equal(scoreStudyAnswers(goldenAnswers(), set).passed, 12);
  const wrong = goldenAnswers();
  wrong.events.push({ title: '旧面试', ...set.golden.oldInterview });
  wrong.tasks[0].dueAt = set.golden.tasks[1].dueAt;
  wrong.tasks[1].sourceId = '';
  const checks = Object.fromEntries(scoreStudyAnswers(wrong, set).checks.map(check => [check.id, check.pass]));
  assert.equal(checks.old_interview_released, false);
  assert.equal(checks.active_event_count, false);
  assert.equal(checks.deadline_1, false);
  assert.equal(checks.deadline_2, false);
  assert.equal(checks.task_source_2, false);
  const cancelled = goldenAnswers();
  cancelled.events.push({ title: '历史交流', ...set.golden.exchange, status: 'cancelled' });
  assert.equal(scoreStudyAnswers(cancelled, set).passed, 12, 'cancelled history is retained without occupying the calendar');
});

test('study time validation treats UTC and Beijing equally and rejects invalid dates and oversized records', () => {
  const utc = goldenAnswers();
  utc.events[1].start = new Date(utc.events[1].start).toISOString();
  utc.events[1].end = new Date(utc.events[1].end).toISOString();
  assert.equal(scoreStudyAnswers(utc, set).passed, 12);
  for (const date of ['2026-11-31T10:00:00+08:00','2026-11-10T24:00:00+08:00','2026-11-10T10:00','2026-12-01T10:00:00Z']) {
    const input = goldenAnswers(); input.events[0].start = date;
    assert.throws(() => validateStudyAnswers(input, set), /时间/);
  }
  assert.throws(() => validateStudyAnswers({ ...goldenAnswers(), events: Array(31).fill({}) }, set));
  assert.throws(() => validateStudyAnswers({ ...goldenAnswers(), conflictNotes: 'a'.repeat(2001) }, set));
});

test('study input conversion normalizes native seconds and UTC results without shifting Beijing wall time', () => {
  for (const input of ['2026-11-12T13:30','2026-11-12T13:30:00','2026-11-12T13:30:00.000']) {
    assert.equal(studyWireTime(input), '2026-11-12T13:30:00+08:00');
  }
  assert.equal(studyLocalTime('2026-11-12T05:30:00.000Z'), '2026-11-12T13:30');
  for (const input of ['',null,'2026-11-31T12:00','2026-11-12T24:00','2026-11-12T12:61']) assert.equal(studyWireTime(input), null);
});

test('study draft comparison counts row changes independently of row order and timezone formatting', () => {
  const before=goldenAnswers(),after=goldenAnswers();
  after.events.reverse();after.events[0].start=new Date(after.events[0].start).toISOString();
  assert.deepEqual(studyDraftDifference(before,after,set).events,{addedRows:0,removedRows:0});
  after.tasks[0].title='修正标题';
  assert.deepEqual(studyDraftDifference(before,after,set).tasks,{addedRows:1,removedRows:1});
});

test('study sessions require consent, one active participant, unique IDs and delayed scoring', () => {
  const { service } = fixture();
  assert.throws(() => service.create({ participant: 'P01' }), /确认/);
  const started = begin(service, 'P01');
  assert.equal(started.trial.condition, 'manual');
  assert.equal(JSON.stringify(started).includes('golden'), false);
  assert.equal(JSON.stringify(started).includes('current_interview_time'), false);
  assert.equal(started.trials[1].materials, undefined);
  assert.throws(() => service.export(), /两轮完成/);
  assert.throws(() => service.create({ participant: 'P02', consented: true }), /当前参与者/);
  service.interrupt(started.id);
  assert.equal(service.export().sessions[0].status, 'interrupted');
  assert.throws(() => service.create({ participant: 'P01', consented: true }), /已有记录/);
});

test('study clock includes model waiting and verification until explicit completion', async () => {
  let release;
  const { service, advance } = fixture({ run: async group => { await new Promise(resolve => { release = resolve; }); return { draft: goldenAnswers(group), processed: 5, store: { emails: [] } }; } });
  const started = begin(service);
  await service.analyze(started.id);
  advance(8000);
  assert.equal(service.read(started.id).trial.elapsedSeconds, 8);
  assert.throws(() => service.finish(started.id, { answers: goldenAnswers(), confirmed: true }), /等待/);
  release(); await settled(service); advance(12000);
  const next = service.finish(started.id, { answers: goldenAnswers(), confirmed: true });
  assert.equal(next.trials[0].elapsedSeconds, 20);
  assert.equal(next.trials[0].score, undefined, 'first-round scores remain hidden');
  assert.equal(next.trial.materials, undefined);
  service.start(started.id); advance(30000);
  const completed = service.finish(started.id, { answers: goldenAnswers(STUDY_SETS[1]), confirmed: true, ease: 4 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.trials[0].score.passed, 12);
  assert.equal(completed.trials[1].elapsedSeconds, 30);
  assert.equal(service.summary().completedLivePairs, 1);
});

test('study quota is reserved before work, dispatches at most the limit and releases unused calls', async () => {
  let release;
  const { service } = fixture({ maxCalls: 5, run: async (group, options) => {
    options.beforeCall(); await new Promise(resolve => { release = resolve; });
    options.beforeCall();
    return { draft: goldenAnswers(group), processed: 5, errors: [], store: { emails: [] } };
  } });
  const started = begin(service);
  await service.analyze(started.id);
  assert.equal(service.config().usedCalls, 1);
  assert.equal(service.config().reservedCalls, 4);
  await assert.rejects(service.analyze(started.id), /正在进行/);
  assert.throws(() => service.draft(started.id, goldenAnswers()), /不能修改/);
  release(); await settled(service);
  assert.equal(service.config().usedCalls, 2);
  assert.equal(service.config().reservedCalls, 0);
  assert.equal(service.records()[0].trials[0].analysis.callsIssued, 2);
  await assert.rejects(service.analyze(started.id), /核验/);
  service.close();
  await assert.rejects(service.analyze(started.id));
});

test('study retries only unprocessed identities and preserves completed work', async () => {
  let calls = 0;
  const savedMail = { id: set.emails[0].id };
  const { service } = fixture({ maxCalls: 5, run: async (group, options) => {
    calls++;
    if (calls === 1) { options.beforeCall(); return { draft: goldenAnswers(group), processed: 1, errors: ['one failed'], store: { emails: [savedMail] } }; }
    assert.deepEqual(options.prior.emails, [savedMail]);
    for (let i = 0; i < 4; i++) options.beforeCall();
    return { draft: goldenAnswers(group), processed: 5, errors: [], store: { emails: [] } };
  } });
  const started = begin(service);
  await service.analyze(started.id); await settled(service);
  await service.analyze(started.id); await settled(service);
  assert.equal(service.config().usedCalls, 5);
  assert.equal(service.read(started.id).trial.analysis.status, 'completed');
  assert.equal(service.read(started.id).trial.analysis.attempts, 2);
});

test('study rejects insufficient quota before making a call', async () => {
  let called = false;
  const { service } = fixture({ maxCalls: 4, run: async () => { called = true; } });
  const started = begin(service);
  await assert.rejects(service.analyze(started.id), /额度不足/);
  assert.equal(called, false);
  assert.equal(service.config().reservedCalls, 0);
});

test('study analysis failures release reservations, return safe status and allow one retry', async () => {
  const { service } = fixture({ run: async () => { throw new Error('private-key-must-not-appear'); } });
  const started = begin(service);
  await service.analyze(started.id); await settled(service);
  assert.equal(service.read(started.id).trial.analysis.status, 'failed');
  assert.equal(JSON.stringify(service.read(started.id)).includes('private-key'), false);
  await service.analyze(started.id); await settled(service);
  await assert.rejects(service.analyze(started.id), /两次/);
  assert.equal(service.config().reservedCalls, 0);
});

test('study persistence failure closes the run visibly and retains the last saved draft', async () => {
  let writable = true, calls = 0;
  const { service } = fixture({ save: () => { if (!writable) throw new Error('disk-secret'); },
    run: async (group, options) => { writable = false; options.beforeCall(); calls++; return { draft: goldenAnswers(group) }; } });
  const started = begin(service);
  await service.analyze(started.id); await settled(service);
  assert.equal(calls, 0, 'failed call journal prevents dispatch');
  assert.equal(service.config().usedCalls, 0);
  assert.equal(service.config().reservedCalls, 0);
  assert.equal(service.config().closed, true);
  const state = service.read(started.id);
  assert.equal(state.trial.analysis.status, 'failed');
  assert.match(state.storageFault, /写入失败/);
  assert.equal(state.trial.draft.events.length, 1);
  assert.equal(JSON.stringify(state).includes('disk-secret'), false);
});

test('study interruption preserves elapsed time and prevents completion or further model dispatch', async () => {
  const { service, advance } = fixture();
  const started = begin(service); advance(4200);
  const stopped = service.interrupt(started.id);
  assert.equal(stopped.status, 'interrupted');
  assert.equal(stopped.trial.elapsedSeconds, 4.2);
  assert.throws(() => service.finish(started.id, { answers: goldenAnswers(), confirmed: true }));
  assert.equal(service.summary().excluded.length, 1);
  assert.equal(service.summary().completedLivePairs, 0);
});

test('study interruption during an in-flight call preserves interruption and blocks late result overwrite', async () => {
  let release;
  const {service}=fixture({run:async(group,options)=>{
    options.beforeCall();await new Promise(resolve=>{release=resolve;});
    options.progress(1);assert.throws(()=>options.beforeCall(),/停止/);
    return {draft:goldenAnswers(group),processed:1,store:{emails:[]}};
  }});
  const started=begin(service);await service.analyze(started.id);
  service.interrupt(started.id);release();await settled(service);
  const view=service.read(started.id);
  assert.equal(view.status,'interrupted');assert.equal(view.trial.analysis.status,'interrupted');
  assert.equal(view.trial.draft.events.length,1);assert.equal(service.config().usedCalls,1);
  assert.equal(service.config().reservedCalls,0);
});

test('study summary excludes presets, project self-checks and incomplete participants', () => {
  const pair = (participant, manual, daylight) => ({ participant, mode: 'live', kind: 'participant', consented: true, status: 'completed',
    trials: [{ condition: 'manual', set: 'A', status: 'completed', elapsedSeconds: manual, score: { passed: 11, total: 12 } },
      { condition: 'daylight', set: 'B', status: 'completed', elapsedSeconds: daylight, score: { passed: 12, total: 12 } }] });
  const summary = summarizeStudy([pair('P01', 200, 100), pair('P02', 140, 120),
    { ...pair('P03', 1, 1), mode: 'practice' }, { ...pair('P04', 1, 1), kind: 'self-check' },
    { ...pair('P05', 1, 1), status: 'interrupted' }]);
  assert.equal(summary.completedLivePairs, 2);
  assert.equal(summary.medianManualSeconds, 170);
  assert.equal(summary.medianDaylightSeconds, 110);
  assert.equal(summary.medianPairedDifferenceSeconds, 60);
  assert.deepEqual(summary.manualSecondsRange, [140, 200]);
  assert.equal(summary.excluded.length, 3);
  assert.equal(summary.fullyReviewedPairs, 0);
});

test('study practice records remain labeled and all mutations save before acknowledgement', () => {
  const { service, written } = fixture({ mode: 'practice', maxCalls: 0 });
  const started = begin(service);
  assert.equal(started.kind, 'practice');
  service.draft(started.id, goldenAnswers());
  assert.deepEqual(written.at(-1).trials[0].draft, service.read(started.id).trial.draft);
  const copy = service.records(); copy[0].trials[0].draft.events.length = 0;
  assert.equal(service.read(started.id).trial.draft.events.length, 2);
  service.close();
  assert.equal(service.read(started.id).status, 'interrupted');
});

test('study HTTP rejects cross-origin writes and invalid bodies while exposing no server error details', async t => {
  const { service } = fixture();
  const app = express(); let origin;
  app.use('/api/study', createValueStudyRouter(service, { origin: () => origin, csrf: 'local-token' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(`${origin}/api/study${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'x-study-csrf': 'local-token', ...headers }, body });
  const config = await fetch(`${origin}/api/study/config`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await config.json()).csrf, 'local-token');
  const input = JSON.stringify({ participant: 'P01', consented: true });
  assert.equal((await post('/sessions', input, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post('/sessions', input, { 'x-study-csrf': 'wrong' })).status, 403);
  assert.equal((await post('/sessions', '{')).status, 400);
  assert.equal((await post('/sessions', 'a'.repeat(70000))).status, 413);
  assert.equal((await post('/sessions', input)).status, 200);
  assert.equal((await fetch(`${origin}/api/study/sessions/unknown`)).status, 404);
  assert.equal((await fetch(`${origin}/api/study/unknown`)).status, 404);
});
