import { processEmails, extractEvents, parseExtraction } from './agent.js';
import { createTraceRecorder } from './traces.js';
import { runStorageSnapshot, settingsKey } from './storage/index.js';
import { presetStudyExtraction } from '../shared/value-study-fixtures.js';

export function createStudyRunner(settings={}) {
  return async(set,{mode,prior,beforeCall,progress})=>{
    const snapshot={userId:null,identity:{userId:null},readOnly:true,
      documents:new Map([[settingsKey('default'),{payload:{mailboxes:[{id:'value-study',email:'study@example.invalid'}],
        activeMailboxId:'value-study',userPrefs:{},mailFilters:[]}}],[settingsKey('prompts'),{payload:{}}]]),
      dirty:new Set(),newMailboxIds:new Set(),closed:false};
    return runStorageSnapshot(snapshot,async()=>{
      const store=prior?structuredClone(prior):{events:structuredClone(set.initialEvents).map(e=>({...e,source:mode==='practice'?'demo':e.source})),tasks:[],emails:[]};
      const recorder=createTraceRecorder({settings});let processed=store.emails.length;
      const attempted=new Set();
      const result=await processEmails(store,structuredClone(set.emails),async(email,events,context,tasks)=>{
        if(mode==='live'){
          if(attempted.has(email.id))throw new Error('同一轮不重复调用失败通知；可在结果页重试。');
          attempted.add(email.id);beforeCall();return extractEvents(email,settings,events,context,tasks);
        }
        return parseExtraction(JSON.stringify(presetStudyExtraction(set,email,events)));
      },mode==='live'?'qq':'demo',{recorder,enrichAttachments:false,mailFilters:[],onProcessed:()=>progress(++processed)});
      const draft={events:store.events.map(({title,start,end,location,status,emailId})=>({title,start,end,location:location||'',status:status||'active',sourceId:emailId||''})),
        tasks:store.tasks.map(({title,dueAt,status,sources})=>({title,dueAt,status,sources})),conflictNotes:''};
      const observations=[...store.emails].sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt)).map(email=>({
        subject:email.subject,summary:email.summary,
        conflicts:(email.conflicts||[]).map(conflict=>`${conflict.event.title} 与 ${conflict.existingEvents.map(e=>e.title).join('、')} 时间重叠。`),
      }));
      return {draft,store,processed,observations,errors:result.errors.map(()=> '一封通知未处理成功，请核对原文和当前结果。'),
        evidence:{source:mode==='live'?'live-model-synthetic-mail':'practice-preset',result,traces:recorder.traces,
          model:mode==='live'?settings.model:null,endpointOrigin:mode==='live'?new URL(settings.baseUrl).origin:null}};
    });
  };
}
