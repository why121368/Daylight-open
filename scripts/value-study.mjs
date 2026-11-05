#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { build } from 'vite';
import { isolatedEnvironment } from './lib/isolated-environment.mjs';
import { validateStudyDataset } from '../server/value-study-score.js';

const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(['--practice','--live','--help','--validate','--preflight'].includes(args[i]))options[args[i]]=true;
  else if(['--settings','--settings-user','--max-calls','--port'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))options[args[i]]=args[++i];
  else throw new Error('Unknown option; use --help.');
}
if(options['--validate']){console.log(JSON.stringify({mode:'dataset-validation',modelCalls:0,...validateStudyDataset()},null,2));process.exit(0);}
if(options['--help']||!args.length){
  console.log('Daylight paired user study\nPractice: npm run study -- --practice [--port 3190]\nLive: npm run study -- --live --settings <private-file> --max-calls <5..200> [--settings-user <id>] [--port 3190]\nDataset: npm run study -- --validate\nAutomated two-set model preflight: add --preflight to --live (10-call budget) or --practice.');
  process.exit(0);
}
if(Boolean(options['--practice'])===Boolean(options['--live']))throw new Error('Choose --practice or --live.');
const limit=options['--live']?Number(options['--max-calls']):0;
if(options['--live']&&(!options['--settings']||!Number.isInteger(limit)||limit<5||limit>200))throw new Error('Live mode requires a private settings file and --max-calls 5..200.');
const port=Number(options['--port']||3190);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port.');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const directory=fs.mkdtempSync(path.join(root,'work','value-study-'));
fs.mkdirSync(path.join(directory,'data'));
fs.writeFileSync(path.join(directory,'data','infra.json'),JSON.stringify({postgres:{enabled:false},redis:{enabled:false},mq:{enabled:false,provider:'local'},oss:{enabled:false,provider:'local'},systemMail:{enabled:false}}));
const owner=randomBytes(24).toString('hex');
fs.writeFileSync(path.join(directory,'study-owner.json'),JSON.stringify({owner}));
if(!options['--preflight'])await build({root,configFile:path.join(root,'vite.config.js'),publicDir:false,
  build:{outDir:path.join(directory,'ui'),emptyOutDir:false,rollupOptions:{input:path.join(root,'study.html')}}});
const childArgs=['scripts/value-study-server.mjs','--run-dir',directory,'--owner',owner,'--port',String(port),
  options['--live']?'--live':'--practice','--max-calls',String(limit)];
for(const flag of ['--settings','--settings-user'])if(options[flag])childArgs.push(flag,flag==='--settings'?path.resolve(options[flag]):options[flag]);
if(options['--preflight'])childArgs.push('--preflight');
const child=spawn(process.execPath,childArgs,{cwd:root,windowsHide:true,stdio:['inherit','inherit','inherit','ipc'],
  env:isolatedEnvironment({DAYLIGHT_DATA_DIR:path.join(directory,'data'),DAYLIGHT_VALUE_STUDY:'1'})});
let stopping=false;
const stop=()=>{
  if(stopping)return;stopping=true;
  if(child.connected)child.send({type:'study-stop'});else child.kill('SIGTERM');
  setTimeout(()=>child.kill('SIGTERM'),7000).unref();
};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
child.once('error',()=>{console.error('Study process could not start.');process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
