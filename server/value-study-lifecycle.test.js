import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isolatedEnvironment } from '../scripts/lib/isolated-environment.mjs';

test('study server IPC shutdown preserves interrupted records on Windows and releases its port', { timeout: 15000 }, async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'daylight-study-lifecycle-'));
  const root=path.resolve(import.meta.dirname,'..'),data=path.join(directory,'data');fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'infra.json'),JSON.stringify({postgres:{enabled:false},redis:{enabled:false},mq:{enabled:false,provider:'local'},oss:{enabled:false,provider:'local'}}));
  fs.writeFileSync(path.join(directory,'study-owner.json'),JSON.stringify({owner:'synthetic-test-owner'}));
  const child=spawn(process.execPath,['scripts/value-study-server.mjs','--run-dir',directory,'--owner','synthetic-test-owner','--port','0','--practice','--max-calls','0'],
    {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:isolatedEnvironment({DAYLIGHT_DATA_DIR:data,DAYLIGHT_VALUE_STUDY:'1'})});
  t.after(()=>{if(child.exitCode===null)child.kill();fs.rmSync(directory,{recursive:true,force:true});});
  let stdout='',stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const origin=await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/Daylight user study: (http:\/\/127\.0\.0\.1:\d+)/);if(match)resolve(match[1]);});
    child.once('exit',()=>reject(new Error('Study exited before ready: '+stderr)));
  });
  const config=await (await fetch(`${origin}/api/study/config`)).json();
  const request=async(route,body)=>{
    const response=await fetch(origin+'/api/study'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-study-csrf':config.csrf},body:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  };
  const session=await request('/sessions',{participant:'P01',consented:true});
  await request(`/sessions/${session.id}/start`,{});
  const exit=once(child,'exit');child.send({type:'study-stop'});
  assert.deepEqual(await exit,[0,null]);
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'session-P01.json'),'utf8'));
  assert.equal(saved.status,'interrupted');assert.equal(saved.trials[0].status,'interrupted');
  assert.ok(saved.trials[0].elapsedSeconds>0);
  const summary=JSON.parse(fs.readFileSync(path.join(directory,'summary.json'),'utf8'));
  assert.equal(summary.completedLivePairs,0);assert.equal(summary.excluded.length,1);
  await assert.rejects(fetch(origin+'/api/study/config'));
});
