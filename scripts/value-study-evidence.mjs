#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STUDY_SETS, participantSet } from '../shared/value-study-fixtures.js';

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(!args.includes('--run-dir')||!args.includes('--out'))throw new Error('Use --run-dir <automated live preflight> --out <evidence directory>.');
const directory=path.resolve(option('--run-dir')),out=path.resolve(option('--out'));
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const preflight=JSON.parse(fs.readFileSync(path.join(directory,'preflight.json'),'utf8'));
const pricesPath=path.resolve(args.includes('--prices')?option('--prices'):'docs/competition-2026-11-04/evidence/official-model-price.json');
const prices=JSON.parse(fs.readFileSync(pricesPath,'utf8'));
if(prices.model!==manifest.model||![prices.inputCnyPerMillion,prices.outputCnyPerMillion].every(v=>Number.isFinite(v)&&v>=0))throw new Error('Pricing snapshot must match the configured model; use --prices <snapshot.json>.');
const cachePrice=prices.cachedInputCnyPerMillion??prices.inputCnyPerMillion;
if(!Number.isFinite(cachePrice)||cachePrice<0)throw new Error('Invalid cache input price.');
if(manifest.kind!=='automated-fixture-preflight'||manifest.mode!=='live'||preflight.mode!=='live')throw new Error('Only automated live synthetic preflight may be exported with this script.');
if(preflight.results.length!==2||new Set(preflight.results.map(r=>r.set)).size!==2)throw new Error('Both fixed sets are required.');
const rows=[];
for(const result of preflight.results){
  const set=STUDY_SETS.find(set=>set.id===result.set),ids=new Set(set?.emails.map(e=>e.id));
  if(!set||result.kind!=='automated-fixture-preflight'||result.store.emails.some(e=>!ids.has(e.id)))throw new Error('Unexpected study identity.');
  for(const trace of [...result.evidence.traces].sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at))){
    for(const span of trace.spans.filter(span=>span.llm_request)){
      for(const field of ['llm_tokens_in','llm_tokens_out','llm_tokens_cached_in','latency_ms'])if(!Number.isFinite(span[field])||span[field]<0)throw new Error('Incomplete call metrics.');
      rows.push({set:set.id,subject:trace.subject,latencyMs:span.latency_ms,inputTokens:span.llm_tokens_in,outputTokens:span.llm_tokens_out,
        cachedInputTokens:span.llm_tokens_cached_in,estimatedCny:((span.llm_tokens_in-span.llm_tokens_cached_in)*prices.inputCnyPerMillion
          +span.llm_tokens_cached_in*cachePrice+span.llm_tokens_out*prices.outputCnyPerMillion)/1000000});
    }
  }
}
if(rows.length!==preflight.realModelCalls||rows.length>manifest.maxModelCalls)throw new Error('Call count mismatch.');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const total=key=>rows.reduce((n,row)=>n+row[key],0),cost=Number(total('estimatedCny').toFixed(6));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const summary={kind:'automated-fixture-preflight',sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,
  model:manifest.model,endpointOrigin:manifest.endpointOrigin,createdAt:manifest.createdAt,realModelCalls:rows.length,
  inputTokens:total('inputTokens'),outputTokens:total('outputTokens'),cachedInputTokens:total('cachedInputTokens'),
  modelCallLatency:{p50Ms:median(rows.map(r=>r.latencyMs)),p95Ms:[...rows].sort((a,b)=>a.latencyMs-b.latencyMs)[Math.ceil(rows.length*.95)-1].latencyMs},
  estimatedCny:cost,price:{inputPerMillionCny:prices.inputCnyPerMillion,outputPerMillionCny:prices.outputCnyPerMillion,cachedInputPerMillionCny:cachePrice,
    source:prices.source,observedAt:prices.observedAt,sha256:hash(fs.readFileSync(pricesPath)),kind:'published-list-price-estimate'},
  sets:preflight.results.map(row=>({set:row.set,durationMs:row.durationMs,passed:row.score.passed,total:row.score.total,
    processed:row.processed,errors:row.errors.length,duplicate:row.evidence.result.duplicate,conflicts:row.evidence.result.conflicts,
    rescheduled:row.evidence.result.rescheduled,cancelled:row.evidence.result.cancelled})),
  participants:0,measurement:'Two fixed synthetic mail sets; sequential model extraction and production tools. Participant reading and review are measured in the separate facilitated tool.',
  rawHashes:Object.fromEntries(['manifest.json','preflight.json'].map(name=>[name,hash(fs.readFileSync(path.join(directory,name)))]))};
fs.mkdirSync(out,{recursive:true});
for(const name of ['manifest.json','preflight.json'])fs.copyFileSync(path.join(directory,name),path.join(out,name));
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const fields=Object.keys(rows[0]);const csv=v=>'"'+String(v).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(out,'calls.csv'),fields.map(csv).join(',')+'\n'+rows.map(row=>fields.map(key=>csv(row[key])).join(',')).join('\n')+'\n');
fs.writeFileSync(path.join(out,'study-inputs.json'),JSON.stringify({version:manifest.version,sets:STUDY_SETS.map(participantSet)},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
