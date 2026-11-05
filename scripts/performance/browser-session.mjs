import fs from 'node:fs/promises';
import { bootInfra } from '/app/server/infra/index.js';
import { getPostgresPool } from '/app/server/infra/postgres.js';
import { createUserSession, revokeUserSession } from '/app/server/infra/sessions.js';
import { readInfraConfig } from '/app/server/infra/config.js';
import jwt from '/app/node_modules/jsonwebtoken/index.js';
await bootInfra();const pool=getPostgresPool();
if(process.argv[2]==='close'){
 const info=JSON.parse(await fs.readFile('/tmp/perf-browser-session.json','utf8'));
 await revokeUserSession(info.userId,info.jti);await fs.unlink('/tmp/perf-browser-session.json');
}else{
 if (!process.env.PERF_USERNAME) throw new Error('Set PERF_USERNAME to the authorized benchmark account');
 const user=(await pool.query('SELECT * FROM users WHERE username=$1',[process.env.PERF_USERNAME])).rows[0];
 const session=await createUserSession(user,{userAgent:'Daylight isolated browser performance verification'});
 const token=jwt.sign({sub:user.id,email:user.email,username:user.username,role:user.role,jti:session.jti,sv:Number(user.session_version)||0},readInfraConfig().auth.jwtSecret,{expiresIn:'45m'});
 await fs.writeFile('/tmp/perf-browser-session.json',JSON.stringify({token,userId:user.id,jti:session.jti}),{mode:0o600});
}
console.log('BENCHMARK_SESSION_OK');await pool.end();process.exit();
