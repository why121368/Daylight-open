import { STUDY_SETS, STUDY_VERSION, studyOrder } from '../shared/value-study-fixtures.js';

const instant = value => {
  if (typeof value !== 'string') return null;
  const parts = value.match(/^2026-11-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:\+08:00|Z)$/);
  if (!parts || Number(parts[1]) < 1 || Number(parts[1]) > 30 || Number(parts[2]) > 23
    || Number(parts[3]) > 59 || Number(parts[4] || 0) > 59) return null;
  return Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
};
const same = (a,b) => instant(a)!==null&&instant(a)===instant(b);
const active = rows => rows.filter(e=>e.status!=='cancelled');
const sourceIds = row => [...(row.sources||[]).map(s=>typeof s==='string'?s:s?.emailId),row.sourceId,row.emailId].filter(Boolean);
const location = v => String(v||'').normalize('NFKC').replace(/\s+/g,'');
export function validateStudyAnswers(input, set) {
  if (!input||!Array.isArray(input.events)||!Array.isArray(input.tasks)||input.events.length>30||input.tasks.length>30
    ||typeof input.conflictNotes!=='string'||input.conflictNotes.length>2000) throw new Error('请检查安排、待办与冲突说明。');
  const ids=new Set(set.emails.map(e=>e.id));
  const text=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
  const date=v=>v===''||v===null||v===undefined?null:instant(v)!==null?v:(()=>{throw new Error('时间请使用2026年11月的北京时间。');})();
  const project=(row,kind)=>{
    if (!row||typeof row!=='object') throw new Error('条目格式不正确。');
    const result={title:text(row.title),sourceId:ids.has(row.sourceId)?row.sourceId:'',
      sources:[...new Set(sourceIds(row).filter(s=>ids.has(s)))].map(emailId=>({emailId})),
      status:row.status==='cancelled'?'cancelled':'active'};
    if(kind==='event') Object.assign(result,{start:date(row.start),end:date(row.end),location:text(row.location)});
    else Object.assign(result,{dueAt:date(row.dueAt),status:row.status==='done'?'done':'pending'});
    return result;
  };
  return {events:input.events.map(r=>project(r,'event')),tasks:input.tasks.map(r=>project(r,'task')),conflictNotes:input.conflictNotes};
}

export function scoreStudyAnswers(input,set) {
  const answers=validateStudyAnswers(input,set);
  const events=active(answers.events),gold=set.golden,existing=set.initialEvents[0];
  const matchedInterview=events.filter(e=>same(e.start,gold.interview.start)&&same(e.end,gold.interview.end));
  const checks=[
    {id:'current_interview_time',label:'当前面试起止时间',pass:matchedInterview.length===1},
    {id:'interview_location',label:'当前面试地点',pass:matchedInterview.some(e=>location(e.location)===location(gold.interview.location))},
    {id:'initial_calendar_kept',label:'已有安排保留',pass:events.some(e=>same(e.start,existing.start)&&same(e.end,existing.end)&&e.title.trim())},
    {id:'old_interview_released',label:'原面试时间释放',pass:!events.some(e=>same(e.start,gold.oldInterview.start)&&same(e.end,gold.oldInterview.end))},
    {id:'cancelled_exchange_released',label:'已取消交流释放',pass:!events.some(e=>same(e.start,gold.exchange.start)&&same(e.end,gold.exchange.end))},
    {id:'active_event_count',label:'有效安排无多余或重复',pass:events.length===2},
    ...gold.tasks.map((t,i)=>({id:`deadline_${i+1}`,label:`材料${i+1}截止`,pass:answers.tasks.filter(r=>same(r.dueAt,t.dueAt)).length===1})),
    {id:'task_count',label:'两项材料分别登记',pass:answers.tasks.length===2},
    {id:'interview_source',label:'面试可回查通知',pass:matchedInterview.some(e=>sourceIds(e).some(id=>gold.interviewSources.includes(id)))},
    ...gold.tasks.map((t,i)=>({id:`task_source_${i+1}`,label:`材料${i+1}可回查通知`,pass:answers.tasks.some(r=>same(r.dueAt,t.dueAt)&&sourceIds(r).includes(t.sourceId))})),
  ];
  return {version:STUDY_VERSION,checks,passed:checks.filter(c=>c.pass).length,total:checks.length,
    reviewRequired:[{id:'conflict_recognition',label:'是否正确识别曾与已有安排冲突',response:answers.conflictNotes},
      {id:'title_meaning',label:'安排及材料标题是否与原文含义一致',response:'主持人按原文复核标题；自动评分只核对结构化时间、数量和来源。'}]};
}

const median=v=>{if(!v.length)return null;const a=[...v].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function studyDraftDifference(before, after, set) {
  const a=validateStudyAnswers(before,set),b=validateStudyAnswers(after,set);
  const signature=(row,kind)=>JSON.stringify({title:row.title,status:row.status,
    ...(kind==='events'?{start:instant(row.start),end:instant(row.end),location:row.location}:{dueAt:instant(row.dueAt)}),
    sources:[...new Set(sourceIds(row))].sort()});
  const compare=kind=>{
    const counts=new Map();for(const row of a[kind]){const key=signature(row,kind);counts.set(key,(counts.get(key)||0)+1);}
    let added=0;for(const row of b[kind]){const key=signature(row,kind),count=counts.get(key)||0;if(count)counts.set(key,count-1);else added++;}
    return {addedRows:added,removedRows:[...counts.values()].reduce((n,v)=>n+v,0)};
  };
  return {events:compare('events'),tasks:compare('tasks'),conflictNotesChanged:a.conflictNotes!==b.conflictNotes,
    meaning:'按完整条目多重集合比较模型草稿与最终结果；编辑一个条目记为移除旧条目、增加新条目。'};
}
export function summarizeStudy(sessions) {
  const eligible=sessions.filter(s=>s.mode==='live'&&s.kind==='participant'&&s.consented===true&&s.status==='completed'
    &&s.trials?.length===2&&s.trials.every(t=>t.status==='completed'&&Number.isFinite(t.elapsedSeconds)&&t.elapsedSeconds>0));
  const pairs=eligible.map(s=>{
    const manual=s.trials.find(t=>t.condition==='manual'),daylight=s.trials.find(t=>t.condition==='daylight');
    return {participant:s.participant,order:s.trials.map(t=>`${t.condition}-${t.set}`),
      manualSeconds:manual.elapsedSeconds,daylightSeconds:daylight.elapsedSeconds,
      differenceSeconds:manual.elapsedSeconds-daylight.elapsedSeconds,
      manualChecks:`${manual.score.passed}/${manual.score.total}`,daylightChecks:`${daylight.score.passed}/${daylight.score.total}`,
      manualReviewed:manual.review?.status==='reviewed',daylightReviewed:daylight.review?.status==='reviewed',
      manualReview:manual.review||null,daylightReview:daylight.review||null,
      manualHelpRequests:manual.helpRequests,daylightHelpRequests:daylight.helpRequests,
      manualEase:manual.ease,daylightEase:daylight.ease,
      manualFeedback:manual.interruptions,daylightFeedback:daylight.interruptions,
      daylightModelChecks:daylight.modelDraftScore?`${daylight.modelDraftScore.passed}/${daylight.modelDraftScore.total}`:null,
      daylightFinalDifferences:daylight.finalDifferences||null};
  });
  return {version:STUDY_VERSION,retainedSessions:sessions.length,completedLivePairs:pairs.length,pairs,
    medianManualSeconds:median(pairs.map(p=>p.manualSeconds)),medianDaylightSeconds:median(pairs.map(p=>p.daylightSeconds)),
    medianPairedDifferenceSeconds:median(pairs.map(p=>p.differenceSeconds)),
    manualSecondsRange:pairs.length?[Math.min(...pairs.map(p=>p.manualSeconds)),Math.max(...pairs.map(p=>p.manualSeconds))]:null,
    daylightSecondsRange:pairs.length?[Math.min(...pairs.map(p=>p.daylightSeconds)),Math.max(...pairs.map(p=>p.daylightSeconds))]:null,
    fullyReviewedPairs:pairs.filter(p=>p.manualReviewed&&p.daylightReviewed).length,
    excluded:sessions.filter(s=>!eligible.includes(s)).map(s=>({participant:s.participant,mode:s.mode,kind:s.kind,status:s.status})),
    interpretation:'逐人配对记录；计时包含阅读、模型等待、核验与修正。标题含义及冲突识别由主持人另行复核。'};
}

export function validateStudyDataset() {
  for(const set of STUDY_SETS){
    if(set.emails.length!==6||new Set(set.emails.map(e=>e.id)).size!==5)throw new Error('Expected six displayed mails, five identities.');
    if(set.golden.tasks.length!==2||!set.emails.every(e=>e.body&&e.subject&&Number.isFinite(Date.parse(e.receivedAt))))throw new Error('Invalid study data.');
    if(!set.golden.interviewSources.every(id=>set.emails.some(e=>e.id===id)))throw new Error('Unknown source.');
  }
  const lengths=STUDY_SETS.map(s=>s.emails.reduce((n,e)=>n+e.subject.length+e.body.length,0));
  if(Math.max(...lengths)/Math.min(...lengths)>1.1)throw new Error('Input lengths differ by more than ten percent.');
  return {sets:2,displayedMailsPerSet:6,uniqueMailsPerSet:5,characterCounts:lengths,
    counterbalance:['P01','P02','P03','P04'].map(p=>({participant:p,order:studyOrder(p)})),automaticChecks:12};
}
