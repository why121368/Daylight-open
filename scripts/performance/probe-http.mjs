import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { bootInfra } from '/app/server/infra/index.js';
import { getPostgresPool } from '/app/server/infra/postgres.js';
import { createUserSession, revokeUserSession } from '/app/server/infra/sessions.js';
import { readInfraConfig } from '/app/server/infra/config.js';
import jwt from '/app/node_modules/jsonwebtoken/index.js';
const phase=process.argv[2]||'before';
await bootInfra();
const pool=getPostgresPool();
if (!process.env.PERF_USERNAME) throw new Error('Set PERF_USERNAME to the authorized benchmark account');
const user=(await pool.query('SELECT * FROM users WHERE username=$1',[process.env.PERF_USERNAME])).rows[0];
const raw=(await pool.query("SELECT payload FROM app_settings WHERE id='default'")).rows[0].payload;
const boxes=raw.mailboxes.filter(b=>(b.ownerUserId||b.userId)===user.id);
const original=raw.userPrefs?.[user.id]?.activeMailboxId||boxes[0].id;
const session=await createUserSession(user,{userAgent:'Daylight performance benchmark'});
const token=jwt.sign({sub:user.id,email:user.email,username:user.username,role:user.role,jti:session.jti,sv:Number(user.session_version)||0},readInfraConfig().auth.jwtSecret,{expiresIn:'45m'});
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const samples=[];
const origin=process.env.PERF_ORIGIN||'https://daylight.yunforis.com';
async function call(path,method='GET',data){
 const start=performance.now();
 try{
  const r=await fetch(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(90000)});
  const ttfb=performance.now()-start;const body=await r.arrayBuffer();
  return {ms:performance.now()-start,ttfb,status:r.status,bytes:body.byteLength,encoding:r.headers.get('content-encoding'),body};
 }catch{return {ms:performance.now()-start,status:0,bytes:0};}
}
async function measure(name,fn,n=12){
 for(let i=0;i<n;i++){
  const start=performance.now();const results=await fn(i);
  samples.push({name,i,ms:performance.now()-start,success:results.every(r=>r.status>=200&&r.status<300),requests:results.map(({body,...r})=>r)});
 }
 console.log(JSON.stringify({phase,finished:name,n}));
}
const stats=async()=> (await pool.query('SELECT xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,temp_bytes FROM pg_stat_database WHERE datname=current_database()')).rows[0];
const begin=await stats();
try{
 const sizes=(await pool.query('SELECT octet_length(payload::text) AS bytes,jsonb_array_length(payload->\'emails\') AS emails FROM mailbox_calendars WHERE mailbox_id=ANY($1)',[boxes.map(b=>b.id)])).rows;
 const calendars=(await pool.query('SELECT payload FROM mailbox_calendars WHERE mailbox_id=ANY($1)',[boxes.map(b=>b.id)])).rows;
 const files=calendars.flatMap(r=>(r.payload.emails||[]).flatMap(e=>e.attachments||[]));
 const file=files.find(f=>f.key&&/pdf/i.test(f.contentType||f.filename||f.name||''))||files.find(f=>f.key);
 await measure('captcha',async()=>[await call('/api/auth/captcha')]);
 await measure('auth_me',async()=>[await call('/api/auth/me')]);
 await measure('workspace',()=>Promise.all([call('/api/state'+(phase==='before'?'':'?view=summary')),call('/api/traces')]));
 await measure('workspace_all',()=>Promise.all([call('/api/state?scope=all'+(phase==='before'?'':'&view=summary')),call('/api/traces?scope=all')]),6);
 if(file)await measure('attachment',async()=>[await call('/api/attachments/'+file.key.split('/').map(encodeURIComponent).join('/'))]);
 await measure('switch_mailbox',async i=>{
  const box=boxes[i%boxes.length];const activate=await call('/api/mailboxes/'+encodeURIComponent(box.id)+'/activate','POST',phase==='before'?{}:{sync:false});
  return [activate,...await Promise.all([call('/api/state'+(phase==='before'?'':'?view=summary')),call('/api/traces')])];
 },6);
 // Read-only HTTP concurrency scenario; four simultaneous logical workspace loads.
 await measure('workspace_c4',()=>Promise.all(Array.from({length:4},()=>Promise.all([call('/api/state'+(phase==='before'?'':'?view=summary')),call('/api/traces')]))).then(r=>r.flat()),3);
 const end=await stats();
 const report={phase,date:new Date().toISOString(),origin,sampleMethod:'HTTPS from server, decoded full response; nearest-rank percentile',sizes,attachment:file?{type:file.contentType||'',size:file.size||null}:null,dbBefore:begin,dbAfter:end,samples};
 await fs.writeFile('/tmp/perf-'+phase+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({phase,samples:samples.length,failures:samples.filter(s=>!s.success).length}));
}catch(error){console.log(JSON.stringify({phase,failure:error.code||error.name}));process.exitCode=1;}
finally{
 await call('/api/mailboxes/'+encodeURIComponent(original)+'/activate','POST',{sync:false});
 await revokeUserSession(user.id,session.jti);await pool.end();process.exit(process.exitCode||0);
}
