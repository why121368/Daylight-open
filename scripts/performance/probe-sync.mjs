import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { bootInfra } from '/app/server/infra/index.js';
import { getPostgresPool } from '/app/server/infra/postgres.js';
import { createUserSession, revokeUserSession } from '/app/server/infra/sessions.js';
import { readInfraConfig } from '/app/server/infra/config.js';
import jwt from '/app/node_modules/jsonwebtoken/index.js';
await bootInfra();const pool=getPostgresPool();const phase=process.argv[2]||'before';
if (!process.env.PERF_USERNAME) throw new Error('Set PERF_USERNAME to the authorized benchmark account');
const user=(await pool.query('SELECT * FROM users WHERE username=$1',[process.env.PERF_USERNAME])).rows[0];
const raw=(await pool.query("SELECT payload FROM app_settings WHERE id='default'")).rows[0].payload;
const boxes=raw.mailboxes.filter(b=>(b.ownerUserId||b.userId)===user.id);
const sizes=(await pool.query('SELECT mailbox_id,octet_length(payload::text) AS bytes FROM mailbox_calendars WHERE mailbox_id=ANY($1) ORDER BY bytes DESC',[boxes.map(b=>b.id)])).rows;
const mailboxId=sizes[0].mailbox_id;
const session=await createUserSession(user,{userAgent:'Daylight real sync performance benchmark'});
const token=jwt.sign({sub:user.id,email:user.email,username:user.username,role:user.role,jti:session.jti,sv:Number(user.session_version)||0},readInfraConfig().auth.jwtSecret,{expiresIn:'45m'});
const samples=[];
try{
 const history=(await pool.query("SELECT status,created_at,finished_at,extract(epoch from (finished_at-created_at))*1000 AS total_ms FROM daylight_jobs WHERE owner_id=$1 AND mailbox_id=$2 AND kind='mailbox.sync' AND finished_at IS NOT NULL ORDER BY created_at DESC LIMIT 12",[user.id,mailboxId])).rows;
 for(let i=0;i<3;i++){
  const start=performance.now();const response=await fetch('https://daylight.yunforis.com/api/sync/qq',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':`perf-${phase}-${i}-${Date.now()}`},body:JSON.stringify({mailboxId}),signal:AbortSignal.timeout(90000)});
  const data=await response.json();const ackMs=performance.now()-start;
  if(!data.job){samples.push({i,status:response.status,ackMs,success:false});continue;}
  let row;
  do{
   await new Promise(r=>setTimeout(r,1000));
   row=(await pool.query('SELECT status,attempts,created_at,finished_at FROM daylight_jobs WHERE id=$1',[data.job.id])).rows[0];
  }while(!['succeeded','failed','cancelled','dead'].includes(row.status)&&performance.now()-start<600000);
  samples.push({i,httpStatus:response.status,ackMs,status:row.status,attempts:row.attempts,success:row.status==='succeeded',observedMs:performance.now()-start,totalMs:row.finished_at?new Date(row.finished_at)-new Date(row.created_at):null,queueMs:row.started_at?new Date(row.started_at)-new Date(row.created_at):null});
  console.log(JSON.stringify({phase,...samples.at(-1)}));
 }
 await fs.writeFile('/tmp/perf-sync-'+phase+'.json',JSON.stringify({phase,date:new Date().toISOString(),note:'Real IMAP sync, existing mailbox; not a new-mail model throughput benchmark',history,samples},null,2));
}catch(error){console.log(JSON.stringify({phase,failure:error.code||error.name}));process.exitCode=1;}
finally{await revokeUserSession(user.id,session.jti);await pool.end();process.exit(process.exitCode||0);}
