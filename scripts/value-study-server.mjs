import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { STUDY_SETS, STUDY_VERSION } from '../shared/value-study-fixtures.js';
import { validateStudyDataset, scoreStudyAnswers } from '../server/value-study-score.js';
import { createValueStudyService } from '../server/value-study-service.js';
import { createValueStudyRouter } from '../server/value-study-router.js';

if(process.env.DAYLIGHT_VALUE_STUDY!=='1'||process.env.DAYLIGHT_RUNTIME!=='local')throw new Error('Use npm run study.');
const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1];
const directory=path.resolve(option('--run-dir'));
if(JSON.parse(fs.readFileSync(path.join(directory,'study-owner.json'),'utf8')).owner!==option('--owner'))throw new Error('Invalid study directory.');
const mode=args.includes('--live')?'live':'practice',maxCalls=Number(option('--max-calls'));
let settings={};
if(mode==='live'){
  try{
    const input=JSON.parse(fs.readFileSync(option('--settings'),'utf8').replace(/^\uFEFF/,''));
    const selected=args.includes('--settings-user')?input.userPrefs?.[option('--settings-user')]:input;
    settings=Object.fromEntries(['baseUrl','apiKey','model','tokenPriceIn','tokenPriceOut','tokenPriceCachedIn'].map(k=>[k,selected?.[k]]));
    const url=new URL(settings.baseUrl);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||typeof settings.apiKey!=='string'||!settings.apiKey||typeof settings.model!=='string'||!settings.model)throw new Error();
  }catch{throw new Error('Selected model settings require baseUrl, apiKey and model.');}
}
const { createStudyRunner }=await import('../server/value-study-runner.js');
const run=createStudyRunner(settings),root=path.resolve(import.meta.dirname,'..');
const digest=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const sourceFiles=['shared/value-study-fixtures.js','server/value-study-score.js','server/value-study-service.js','server/value-study-runner.js',
  'server/value-study-router.js','server/agent.js','scripts/value-study.mjs','scripts/value-study-server.mjs','src/pages/value-study-page.jsx'];
sourceFiles.push('study.html','src/study-main.jsx','shared/value-study-time.js');
const git=argv=>{try{return execFileSync('git',argv,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
const manifest={version:STUDY_VERSION,createdAt:new Date().toISOString(),mode,kind:args.includes('--preflight')?'automated-fixture-preflight':'facilitated-user-study',
  node:process.version,platform:process.platform,sourceCommit:git(['rev-parse','HEAD']),sourceDirty:Boolean(git(['status','--porcelain'])),
  sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,digest(p)])),dataset:validateStudyDataset(),maxModelCalls:maxCalls,
  model:mode==='live'?settings.model:null,endpointOrigin:mode==='live'?new URL(settings.baseUrl).origin:null,
  scope:'Original synthetic mail, production extraction/calendar/task tools in an isolated local process; no IMAP or SMTP.'};
const write=(name,value)=>{
  const target=path.join(directory,name),temp=target+'.tmp';
  const fd=fs.openSync(temp,'w',0o600);try{fs.writeSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,target);
};
write('manifest.json',manifest);
if(args.includes('--preflight')){
  if(mode==='live'&&maxCalls<10)throw new Error('Two-set live preflight requires --max-calls 10 or more.');
  let calls=0;const results=[];
  for(const set of STUDY_SETS){
    const started=performance.now();
    const actual=await run(set,{mode,beforeCall:()=>{if(calls>=maxCalls)throw new Error('Call cap');calls++;},progress:()=>{}});
    const score=scoreStudyAnswers(actual.draft,set);
    const row={set:set.id,kind:'automated-fixture-preflight',durationMs:performance.now()-started,score,
      errors:actual.errors,processed:actual.processed,store:actual.store,evidence:actual.evidence};
    results.push(row);write('preflight.json',{mode,realModelCalls:calls,results});
    console.log(`Study set ${set.id}: ${score.passed}/${score.total}, processed=${actual.processed}, errors=${actual.errors.length}`);
  }
  console.log('STUDY_PREFLIGHT_SAVED',path.relative(root,directory),'realModelCalls='+calls);
  if(results.some(r=>r.score.passed!==r.score.total||r.errors.length))process.exitCode=1;
}else{
  const service=createValueStudyService({mode,maxCalls,run,save:s=>write(`session-${s.participant}.json`,s)});
  const app=express();app.disable('x-powered-by');let origin;
  app.use('/api/study',createValueStudyRouter(service,{origin:()=>origin}));
  app.use('/assets',express.static(path.join(directory,'ui/assets')));
  app.get('/',(req,res)=>res.set('Cache-Control','no-store').sendFile(path.join(directory,'ui/study.html')));
  app.use((req,res)=>res.status(404).send('Not found'));
  const server=app.listen(Number(option('--port')),'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  origin=`http://127.0.0.1:${server.address().port}`;
  console.log(`Daylight user study: ${origin}\nMode: ${mode}; max live calls: ${maxCalls}\nRecords: ${path.relative(root,directory)}\nUse anonymous participant IDs; Ctrl+C saves interrupted sessions and stops.`);
  let stopped=false;
  const stop=()=>{
    if(stopped)return;stopped=true;
    let code=0;
    try{service.close();write('summary.json',service.summary());}
    catch{code=1;console.error('Study save failed. Check the run directory; records already written remain available.');}
    server.close(()=>process.exit(code));server.closeIdleConnections();setTimeout(()=>process.exit(code),5000).unref();
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  process.on('message',message=>{if(message?.type==='study-stop')stop();});
}
