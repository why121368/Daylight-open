import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { STUDY_SETS, STUDY_VERSION, participantSet, studyOrder } from '../shared/value-study-fixtures.js';
import { scoreStudyAnswers, studyDraftDifference, summarizeStudy, validateStudyAnswers } from './value-study-score.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const blankDraft=set=>({events:structuredClone(set.initialEvents),tasks:[],conflictNotes:''});
export function createValueStudyService({mode='practice',maxCalls=0,run,save=()=>{},clock=()=>performance.now(),wall=()=>new Date().toISOString()}={}) {
  if(!['practice','live'].includes(mode)||!Number.isInteger(maxCalls)||maxCalls<0||maxCalls>200||typeof run!=='function')throw new Error('Invalid study configuration.');
  const sessions=new Map();let used=0,reserved=0,busy=false,closed=false,storageFault=null;
  const get=id=>{const s=sessions.get(id);if(!s)throw fail('对照记录不存在。',404);return s;};
  const persist=s=>{try{save(structuredClone(s));}catch{
    storageFault='记录写入失败，本场已停止。请主持人检查保存目录并导出已有记录。';closed=true;
    throw fail(storageFault,503);
  }sessions.set(s.id,s);return s;};
  const update=(id,fn)=>{const next=structuredClone(get(id));fn(next);return persist(next);};
  const current=s=>s.trials[s.index];
  const setFor=t=>STUDY_SETS.find(s=>s.id===t.set);
  function view(s) {
    const t=current(s),finished=s.status==='completed';
    return {id:s.id,participant:s.participant,kind:s.kind,mode:s.mode,version:STUDY_VERSION,status:s.status,index:s.index,
      storageFault,
      trials:s.trials.map(x=>({condition:x.condition,set:x.set,status:x.status,elapsedSeconds:x.elapsedSeconds??null,
        ...(finished?{score:x.score,review:x.review||null,answers:x.draft,materials:participantSet(setFor(x)),
          modelDraftScore:x.modelDraftScore||null,finalDifferences:x.finalDifferences||null}:{} )})),
      trial:t?{condition:t.condition,set:t.set,status:t.status,startedAt:t.startedAt||null,
        elapsedSeconds:t.status==='running'?Math.max(0,(clock()-t.startedTick)/1000):t.elapsedSeconds??null,
        ...(t.status!=='ready'?{materials:participantSet(setFor(t)),draft:t.draft}:{}),
        analysis:t.analysis?{status:storageFault?'failed':t.analysis.status,processed:t.analysis.processed||0,
          errors:storageFault?[storageFault]:t.analysis.errors||[],observations:t.analysis.observations||[],attempts:t.analysis.attempts}:null}:null};
  }
  return {
    config:()=>({version:STUDY_VERSION,mode,maxCalls,usedCalls:used,reservedCalls:reserved,busy,closed,storageFault,
      targetSecondsPerTrial:300,counterbalance:'按匿名编号依次轮换四种顺序；两轮完成后展示评分。'}),
    create({participant,consented,kind='participant'}={}) {
      if(closed)throw fail('对照服务已结束。',503);
      const order=studyOrder(participant);
      if(consented!==true)throw fail('请先确认自愿参与和匿名记录说明。');
      if(!['participant','self-check','practice'].includes(kind))throw fail('参与类型不正确。');
      if([...sessions.values()].some(s=>s.participant===participant))throw fail('这个编号已有记录，请使用新的匿名编号。',409);
      if(busy||[...sessions.values()].some(s=>s.status==='running'))throw fail('请先完成当前参与者的两轮任务。',409);
      if(sessions.size>=32)throw fail('本次主持的记录已满，请结束并导出。',429);
      const s={id:randomUUID(),participant,consented:true,kind:mode==='practice'?'practice':kind,mode,
        createdAt:wall(),status:'running',index:0,trials:order.map(t=>({...t,status:'ready'}))};
      persist(s);return view(s);
    },
    read:id=>view(get(id)),
    start(id) {
      if(closed)throw fail('对照服务已结束。',503);
      const s=get(id),t=current(s);if(s.status!=='running'||t.status!=='ready')throw fail('这一轮已经开始或结束。',409);
      return view(update(id,s=>Object.assign(current(s),{status:'running',startedTick:clock(),startedAt:wall(),draft:blankDraft(setFor(t))})));
    },
    draft(id,answers) {
      const s=get(id),t=current(s);if(closed||s.status!=='running'||t.status!=='running'||t.analysis?.status==='running')throw fail('当前不能修改结果。',409);
      const valid=validateStudyAnswers(answers,setFor(t));
      return view(update(id,s=>{current(s).draft=valid;}));
    },
    async analyze(id) {
      const s=get(id),t=current(s);
      if(closed||s.status!=='running'||t.status!=='running'||t.condition!=='daylight')throw fail('请在Daylight这一轮开始后分析。',409);
      if(busy||t.analysis?.status==='running')throw fail('分析正在进行，请等待结果。',409);
      if((t.analysis?.attempts||0)>=2)throw fail('本轮已完成两次分析尝试，请保留结果并结束本轮。',409);
      if(t.analysis?.status==='completed'&&!t.analysis.errors.length)throw fail('通知已处理完成，请核验当前结果。',409);
      const done=new Set((t.executionStore?.emails||[]).map(e=>e.id));
      const count=mode==='live'?new Set(setFor(t).emails.filter(e=>!done.has(e.id)).map(e=>e.id)).size:0;
      if(used+reserved+count>maxCalls)throw fail('本次模型调用额度不足，请主持人调整后另开一轮。',409);
      reserved+=count;busy=true;let left=count;
      let job;
      try{job=update(id,s=>{const trial=current(s);trial.analysis={status:'running',processed:0,errors:[],attempts:(trial.analysis?.attempts||0)+1};});}
      catch(error){reserved-=left;busy=false;throw error;}
      const index=s.index;
      const task=(async()=>{
        try {
          const result=await run(setFor(t),{mode,prior:t.executionStore,
            beforeCall:()=>{
              if(closed||get(id).status!=='running'||left<=0)throw fail('对照已停止或额度已用完。',409);
              update(id,s=>{const analysis=s.trials[index].analysis;analysis.callsIssued=(analysis.callsIssued||0)+1;});
              left--;reserved--;used++;
            },
            progress:processed=>{if(!closed&&get(id).status==='running')update(id,s=>{s.trials[index].analysis.processed=processed;});},
          });
          if(!closed&&get(id).status==='running')update(id,s=>{const trial=s.trials[index];trial.draft=validateStudyAnswers(result.draft,setFor(t));
            trial.automatedDraft=structuredClone(trial.draft);
            trial.executionStore=result.store;trial.evidence=result.evidence;
            trial.analysis={...trial.analysis,status:'completed',processed:result.processed??5,errors:result.errors||[],
              observations:result.observations||[],completedAt:wall()};});
        } catch(error) {
          if(!closed&&get(id).status==='running')update(id,s=>{const trial=s.trials[index];trial.analysis={...trial.analysis,status:'failed',errors:['分析失败，请核对当前记录，可重试一次或结束本轮。']};});
        } finally {reserved-=left;busy=false;}
      })();
      task.catch(()=>{});
      return view(job);
    },
    finish(id,{answers,confirmed,helpRequests=0,interruptions='',ease=null}={}) {
      const s=get(id),t=current(s);
      if(closed||s.status!=='running'||t.status!=='running'||t.analysis?.status==='running')throw fail('请等待分析结束，再确认本轮结果。',409);
      if(confirmed!==true||!Number.isInteger(helpRequests)||helpRequests<0||helpRequests>99
        ||typeof interruptions!=='string'||interruptions.length>2000||!(ease===null||Number.isInteger(ease)&&ease>=1&&ease<=5))throw fail('请确认结果并填写有效反馈。');
      const draft=validateStudyAnswers(answers,setFor(t));
      return view(update(id,s=>{const trial=current(s);Object.assign(trial,{draft,status:'completed',finishedAt:wall(),
        elapsedSeconds:Math.max(.001,(clock()-trial.startedTick)/1000),score:scoreStudyAnswers(draft,setFor(t)),helpRequests,interruptions,ease});
        if(trial.automatedDraft){trial.modelDraftScore=scoreStudyAnswers(trial.automatedDraft,setFor(t));
          trial.finalDifferences=studyDraftDifference(trial.automatedDraft,draft,setFor(t));}
        if(s.index===0)s.index=1;else{s.status='completed';s.finishedAt=wall();}}));
    },
    review(id,index,{conflictCorrect,titleMeaningCorrect,notes=''}={}) {
      if(closed)throw fail('本场记录已停止。',503);
      const s=get(id);if(s.status!=='completed'||![0,1].includes(index)||typeof conflictCorrect!=='boolean'||typeof titleMeaningCorrect!=='boolean'||typeof notes!=='string'||notes.length>2000)throw fail('请在两轮完成后复核标题和冲突。');
      return view(update(id,s=>{s.trials[index].review={status:'reviewed',conflictCorrect,titleMeaningCorrect,notes,reviewedAt:wall()};}));
    },
    interrupt(id) {
      const s=get(id);if(closed||s.status!=='running')throw fail('本次参与已结束。',409);
      return view(update(id,s=>{s.status='interrupted';s.interruptedAt=wall();const t=current(s);
        if(t.status==='running'){t.elapsedSeconds=Math.max(.001,(clock()-t.startedTick)/1000);t.status='interrupted';}
        if(t.analysis?.status==='running')t.analysis.status='interrupted';}));
    },
    summary:()=>({...summarizeStudy([...sessions.values()]),modelCallAttempts:used,storageFault}),
    records:()=>structuredClone([...sessions.values()]),
    export() {
      if([...sessions.values()].some(s=>s.status==='running')&&!storageFault)throw fail('请在两轮完成或结束参与后导出记录。',409);
      return {summary:this.summary(),sessions:this.records()};
    },
    close() {
      closed=true;
      for(const s of sessions.values())if(s.status==='running')update(s.id,next=>{
        next.status='interrupted';next.interruptedAt=wall();const t=current(next);
        if(t.status==='running'){t.elapsedSeconds=Math.max(.001,(clock()-t.startedTick)/1000);t.status='interrupted';}
        if(t.analysis?.status==='running')t.analysis.status='interrupted';
      });
    },
  };
}
