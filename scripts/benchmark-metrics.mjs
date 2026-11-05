/** Same-source off/on instrumentation benchmark. Each child uses a fresh temporary sink. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const flag = (name,fallback) => args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3) ?? fallback;
const samples = Math.max(1000,Math.min(100000,Number(flag('samples',20000))));
const runs = Math.max(1,Math.min(10,Number(flag('runs',5))));
if (args.includes('--child')) {
  const m = await import('../server/metrics.js');
  m.startMetrics({role:'benchmark'});
  const cpuStart=process.cpuUsage();
  let peakRss=process.memoryUsage().rss;
  let recordMs=0,flushMs=0;
  const started=performance.now();
  for(let first=0;first<samples;first+=1000) {
    const tick=performance.now();
    for(let index=first;index<Math.min(first+1000,samples);index+=1) {
      m.observe('benchmark.latency.ms',index%200,'ms',{route:'experience',status:200});
    }
    recordMs+=performance.now()-tick;
    const flushing=performance.now();
    await m.flushMetrics();
    flushMs+=performance.now()-flushing;
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
  }
  await m.stopMetrics();
  const elapsedMs=performance.now()-started;
  const cpu=process.cpuUsage(cpuStart);
  const s=m.metricsStatus();
  const files=fs.readdirSync(process.env.DAYLIGHT_METRICS_DIR);
  const sinkBytes=files.reduce((total,file)=>total+fs.statSync(path.join(process.env.DAYLIGHT_METRICS_DIR,file)).size,0);
  console.log(JSON.stringify({enabled:m.metricsEnabled(),samples,recordMs,recordUsPerSample:recordMs/samples*1000,flushMs,elapsedMs,
    cpuMs:(cpu.user+cpu.system)/1000,sampledPeakRssBytes:peakRss,sinkBytes,written:s.written,dropped:s.dropped,sinkError:s.sinkError}));
} else {
  const benchmarkUrl=fileURLToPath(import.meta.url);
  const invoke=async(enabled,iteration,warmup=false) => {
    const sink=fs.mkdtempSync(path.join(os.tmpdir(),'daylight-metrics-bench-'));
    try {
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[benchmarkUrl,'--child',`--samples=${samples}`],{
          env:{...process.env,DAYLIGHT_METRICS:enabled?'1':'0',DAYLIGHT_METRICS_SAMPLE:'1',DAYLIGHT_METRICS_DIR:sink,
            DAYLIGHT_GIT_SHA:process.env.DAYLIGHT_GIT_SHA||'benchmark-source-manifest',DAYLIGHT_GIT_DIRTY:'0'},stdio:['ignore','pipe','pipe']});
        let out='',err='';
        child.stdout.on('data',data=>{out+=data;});child.stderr.on('data',data=>{err+=data;});
        child.once('error',reject);child.once('exit',code=>code?reject(new Error(`benchmark exit ${code}: ${err.slice(0,200)}`)):resolve(JSON.parse(out)));
      });
      return {iteration,warmup,...result};
    } finally { fs.rmSync(sink,{recursive:true,force:true}); }
  };
  const results=[];
  results.push(await invoke(false,0,true),await invoke(true,0,true));
  for(let iteration=1;iteration<=runs;iteration+=1) {
    for(const mode of iteration%2?[false,true]:[true,false]) results.push(await invoke(mode,iteration));
  }
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const summary=[false,true].map(enabled=>{
    const rows=results.filter(row=>row.enabled===enabled&&!row.warmup);
    return {enabled,runs:rows.length,...Object.fromEntries(['recordUsPerSample','flushMs','elapsedMs','cpuMs','sampledPeakRssBytes','sinkBytes'].map(key=>[key,median(rows.map(row=>row[key]))])),
      dropped:rows.reduce((total,row)=>total+row.dropped,0),sinkErrors:rows.filter(row=>row.sinkError).length};
  });
  const root=new URL('../',import.meta.url);
  const hashes=Object.fromEntries(['server/metrics.js','server/metrics-sink.js','scripts/benchmark-metrics.mjs'].map(name=>[name,createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]));
  const report={measuredAt:new Date().toISOString(),scope:'Isolated metric recording and real temporary-file IO on the current host. No HTTP, mailbox or model workload.',
    environment:{node:process.version,os:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},
    config:{samplesPerRun:samples,runsPerMode:runs,warmupRunsPerMode:1,order:'alternating',sampleRate:1,batch:1000,sinkRoot:os.tmpdir()},hashes,summary,results};
  const destination=flag('out',null);
  if(destination) fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(args.includes('--json') ? report : summary,null,2));
}
