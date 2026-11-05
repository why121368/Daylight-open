import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { STUDY_SETS, presetStudyExtraction } from '../shared/value-study-fixtures.js';
import { scoreStudyAnswers } from './value-study-score.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-study-test-'));
process.env.DAYLIGHT_DATA_DIR = directory;
process.env.DAYLIGHT_RUNTIME = 'local';
process.env.DAYLIGHT_AUTO_PROXY = '0';
process.env.DAYLIGHT_METRICS = '0';
fs.writeFileSync(path.join(directory, 'infra.json'), JSON.stringify({ postgres: { enabled: false }, redis: { enabled: false },
  mq: { enabled: false, provider: 'local' }, oss: { enabled: false, provider: 'local' }, systemMail: { enabled: false } }));
const { createStudyRunner } = await import('./value-study-runner.js');
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('study practice runs production calendar/task semantics with conflicts, linked changes and no model calls', async () => {
  const before = fs.readFileSync(path.join(directory, 'infra.json'), 'utf8');
  let calls = 0;
  const run = createStudyRunner();
  for (const set of STUDY_SETS) {
    const progress = [];
    const result = await run(set, { mode: 'practice', beforeCall: () => { calls++; }, progress: count => progress.push(count) });
    assert.equal(scoreStudyAnswers(result.draft, set).passed, 12);
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.evidence.source, 'practice-preset');
    assert.equal(result.evidence.result.duplicate, 1);
    assert.equal(result.evidence.result.rescheduled, 1);
    assert.equal(result.evidence.result.cancelled, 1);
    assert.equal(result.evidence.result.conflicts, 1);
    assert.ok(result.observations.some(item => item.conflicts.some(text => text.includes('时间重叠'))));
    assert.equal(result.store.events.filter(event => event.status === 'cancelled').length, 2);
    const old = result.store.events.find(event => event.replacementEventId);
    assert.equal(result.store.events.find(event => event.id === old.replacementEventId).previousEventId, old.id);
    assert.ok(result.evidence.traces.every(trace => trace.spans.every(span => !span.llm_request)));
    const retry = await run(set, { mode: 'practice', prior: result.store, beforeCall: () => { calls++; }, progress: () => assert.fail('completed mail must not run again') });
    assert.equal(retry.evidence.result.duplicate, 6);
    assert.deepEqual(retry.draft, result.draft);
  }
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(path.join(directory, 'infra.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['infra.json']);
});

test('study runner retries a failed unique mail through the production extractor without replaying successful work', async t => {
  const set=STUDY_SETS[0],app=express();app.use(express.json());
  let requests=0,failed=false;
  app.post('/v1/chat/completions',(req,res)=>{
    requests++;
    const input=JSON.parse(req.body.messages[1].content),email=set.emails.find(e=>e.subject===input.subject);
    if(email.id.endsWith('-2')&&!failed){failed=true;return res.status(503).json({error:{message:'synthetic outage'}});}
    const actual=presetStudyExtraction(set,email,input.existingEvents);
    res.json({choices:[{message:{content:JSON.stringify(actual)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}});
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const run=createStudyRunner({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'synthetic-local-key',model:'synthetic-study'});
  let issued=0;const options={mode:'live',beforeCall:()=>{issued++;},progress:()=>{}};
  const first=await run(set,options);
  assert.equal(issued,5);assert.equal(requests,5);assert.equal(first.processed,4);
  assert.equal(first.errors.length,1);
  assert.equal(first.store.tasks.length,1);
  const second=await run(set,{...options,prior:first.store});
  assert.equal(issued,6);assert.equal(requests,6);
  assert.equal(scoreStudyAnswers(second.draft,set).passed,12);
  assert.equal(second.processed,5);assert.equal(second.errors.length,0);
  assert.equal(second.evidence.traces.filter(trace=>trace.spans.some(span=>span.llm_request)).length,1);
  assert.equal(JSON.stringify(second.evidence).includes('synthetic-local-key'),false);
});

test('study runner makes one model attempt per unique identity even when a failed original is repeated', async t => {
  const app=express();let requests=0;app.post('/v1/chat/completions',(req,res)=>{requests++;res.status(503).json({error:{message:'synthetic outage'}});});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const run=createStudyRunner({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'synthetic-local-key',model:'synthetic-study'});
  let issued=0;const result=await run(STUDY_SETS[0],{mode:'live',beforeCall:()=>{issued++;},progress:()=>{}});
  assert.equal(issued,5);assert.equal(requests,5);assert.equal(result.processed,0);
  assert.equal(result.store.events.length,1);assert.equal(result.store.emails.length,0);
});
