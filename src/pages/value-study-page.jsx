import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Download, Loader2, Mail, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { studyLocalTime as localTime, studyWireTime } from '../../shared/value-study-time.js';

const sessionKey = 'daylight-value-study-session';
const conditionName = value => value === 'manual' ? '人工整理' : 'Daylight 辅助';
const selectClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';
function displayTime(value) { return localTime(value).replace('T', ' ') || '未填写'; }
function duration(value) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function Field({ label, children, className = '' }) {
  return <label className={`grid min-w-0 gap-2 text-sm ${className}`}><span className="font-medium">{label}</span>{children}</label>;
}

function AnswerRows({ kind, rows, emails, disabled, onChange }) {
  const events = kind === 'events';
  const noun = events ? '安排' : '待办';
  const update = (index, fields) => onChange(rows.map((row, i) => i === index ? { ...row, ...fields } : row));
  const sources = [...new Map(emails.map(email => [email.id, email])).values()];
  return <section className="grid min-w-0 gap-3" aria-label={`${noun}编辑`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{noun} <span className="text-muted-foreground">{rows.length}</span></h3>
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || rows.length >= 30}
        onClick={() => onChange([...rows, events ? { title: '', start: null, end: null, location: '', status: 'active', sourceId: '' }
          : { title: '', dueAt: null, status: 'pending', sourceId: '' }])}><Plus />添加{noun}</Button>
    </div>
    {rows.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">在这里登记{noun}。</p>}
    {rows.map((row, index) => <fieldset key={index} disabled={disabled} className="grid min-w-0 gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{noun} {index + 1}</legend>
      <Field label="标题"><Input aria-label={`${noun}${index + 1}标题`} className="h-11" maxLength={200} value={row.title}
        onChange={e => update(index, { title: e.target.value })} /></Field>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(events ? ['start', 'end'] : ['dueAt']).map(key => <Field key={key} label={key === 'start' ? '开始 · 北京时间' : key === 'end' ? '结束 · 北京时间' : '截止 · 北京时间'}>
          <Input className="h-11 max-w-full" type="datetime-local" min="2026-11-01T00:00" max="2026-11-30T23:59"
            aria-label={`${noun}${index + 1}${key === 'start' ? '开始' : key === 'end' ? '结束' : '截止'}`}
            value={localTime(row[key])} onInput={e => update(index, { [key]: studyWireTime(e.currentTarget.value) })}
            onChange={e => update(index, { [key]: studyWireTime(e.currentTarget.value) })} />
        </Field>)}
        {events && <Field label="地点"><Input className="h-11" aria-label={`安排${index + 1}地点`} maxLength={200}
          value={row.location} onChange={e => update(index, { location: e.target.value })} /></Field>}
        <Field label="状态"><select className={selectClass} aria-label={`${noun}${index + 1}状态`} value={row.status}
          onChange={e => update(index, { status: e.target.value })}>
          {events ? <><option value="active">有效</option><option value="cancelled">已取消</option></>
            : <><option value="pending">待完成</option><option value="done">已完成</option></>}
        </select></Field>
      </div>
      <Field label="来源通知"><select className={selectClass} aria-label={`${noun}${index + 1}来源`} value={row.sourceId || row.sources?.[0]?.emailId || ''}
        onChange={e => update(index, { sourceId: e.target.value, sources: [] })}>
        <option value="">已有安排／未指定</option>
        {sources.map(email => <option key={email.id} value={email.id}>{emails.findIndex(item => item.id === email.id) + 1}. {email.subject}</option>)}
      </select></Field>
      <Button type="button" variant="ghost" className="min-h-11 justify-self-end" aria-label={`删除${noun}${index + 1}`}
        onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 />删除{noun}</Button>
    </fieldset>)}
  </section>;
}

function Review({ trial, index, save, disabled }) {
  const [conflict, setConflict] = useState(trial.review ? String(trial.review.conflictCorrect) : '');
  const [titles, setTitles] = useState(trial.review ? String(trial.review.titleMeaningCorrect) : '');
  const [notes, setNotes] = useState(trial.review?.notes || '');
  return <details className="rounded-lg border p-4">
    <summary className="min-h-11 cursor-pointer font-medium">主持人复核 · {trial.review ? '已记录' : '待填写'}</summary>
    <div className="mt-3 grid gap-4">
      <div className="grid gap-3 text-sm leading-6">
        {trial.answers.events.map((row, i) => <p key={`event-${i}`}><strong>{row.title || '未命名安排'}</strong> · {row.status === 'cancelled' ? '已取消' : '有效'}<br />{displayTime(row.start)} → {displayTime(row.end)} · {row.location}</p>)}
        {trial.answers.tasks.map((row, i) => <p key={`task-${i}`}><strong>{row.title || '未命名待办'}</strong><br />截止 {displayTime(row.dueAt)}</p>)}
        <details><summary className="min-h-11 cursor-pointer">复核通知原文</summary>{trial.materials.emails.map((email, i) => <p className="mb-3" key={i}><strong>{email.subject}</strong><br />{email.body}</p>)}</details>
      </div>
      {trial.score.reviewRequired.map(item => <p key={item.id} className="break-words text-sm"><strong>{item.label}</strong><br />{item.response || '未填写'}</p>)}
      <Field label="曾发生的冲突判断是否正确"><select className={selectClass} value={conflict} onChange={e => setConflict(e.target.value)}>
        <option value="">请选择</option><option value="true">正确</option><option value="false">需修正</option>
      </select></Field>
      <Field label="安排和材料标题是否准确"><select className={selectClass} value={titles} onChange={e => setTitles(e.target.value)}>
        <option value="">请选择</option><option value="true">正确</option><option value="false">需修正</option>
      </select></Field>
      <Field label="复核依据"><Textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <Button className="min-h-12" disabled={disabled || !conflict || !titles}
        onClick={() => save(index, { conflictCorrect: conflict === 'true', titleMeaningCorrect: titles === 'true', notes })}>保存复核</Button>
    </div>
  </details>;
}

export default function ValueStudyPage() {
  const [config, setConfig] = useState(null);
  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [participant, setParticipant] = useState('P01');
  const [kind, setKind] = useState('participant');
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [helpRequests, setHelpRequests] = useState('0');
  const [interruptions, setInterruptions] = useState('');
  const [ease, setEase] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState(null);
  const csrf = useRef('');
  const busyRef = useRef(false);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`/api/study${route}`, { method, cache: 'no-store', headers: method === 'GET' ? {}
      : { 'Content-Type': 'application/json', 'x-study-csrf': csrf.current }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '请求未完成，请重试。');
    return value;
  };
  const applySession = value => {
    setSession(value);
    setAnswers(value.trial?.draft || null);
    setElapsed(value.trial?.elapsedSeconds || 0);
    setSaveState(value.trial?.draft ? '草稿已保存' : '');
    if (value.storageFault) setError(value.storageFault);
    if (value.id) localStorage.setItem(sessionKey, value.id);
  };
  const perform = async action => {
    if (busyRef.current) return;
    busyRef.current = true; setPending(true); setError('');
    try { await action(); } catch (err) { setError(err.message || '请求未完成，请重试。'); }
    finally { busyRef.current = false; setPending(false); }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const c = await request('/config');
        if (!active) return;
        csrf.current = c.csrf; setConfig(c);
        const id = localStorage.getItem(sessionKey);
        if (id) {
          try { const saved = await request(`/sessions/${id}`); if (active) applySession(saved); }
          catch { localStorage.removeItem(sessionKey); }
        }
      } catch (err) { if (active) setError(err.message); }
    })();
    return () => { active = false; };
  }, []);
  const trial = session?.trial;
  const analyzing = trial?.analysis?.status === 'running';
  const running = session?.status === 'running' && trial?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const base = trial.elapsedSeconds || 0, started = performance.now();
    const timer = setInterval(() => setElapsed(base + (performance.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [running, session?.index, trial?.elapsedSeconds]);
  useEffect(() => {
    if (!analyzing) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await request(`/sessions/${session.id}`);
        if (active) { applySession(next); setError(next.storageFault || ''); }
      } catch (err) { if (active) setError(err.message); }
    };
    let polling = false;
    const timer = setInterval(async () => { if (polling) return; polling = true; try { await poll(); } finally { polling = false; } }, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [analyzing, session?.id]);
  useEffect(() => {
    setConfirmed(false); setHelpRequests('0'); setInterruptions(''); setEase('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [session?.id, session?.index, session?.status]);
  const edit = fields => { setAnswers(current => ({ ...current, ...fields })); setSaveState('有修改待保存'); setConfirmed(false); };
  const disabled = pending || analyzing || Boolean(session?.storageFault);
  const exportData = () => perform(async () => {
    const value = await request('/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'daylight-value-study-records.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div><p className="text-xs font-semibold tracking-widest text-muted-foreground">DAYLIGHT / VALUE STUDY</p>
          <h1 className="mt-1 text-xl font-semibold">把通知整理成下一步</h1></div>
        <span className="rounded-full bg-secondary px-3 py-2 text-sm">{config?.mode === 'live' ? '真实模型 · 本地主持' : '预置练习 · 本地主持'}</span>
      </div>
    </header>
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-8">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}</div>}
      {!config && <p role="status">正在连接本地对照服务…</p>}
      {config?.mode === 'practice' && <p className="rounded-lg border bg-secondary/40 p-4 text-sm leading-6">本次使用预置提取结果，模型调用为 0。练习记录用于熟悉流程，汇总时单独列出。</p>}
      {config && !session && <Card className="mx-auto w-full max-w-2xl">
        <CardHeader><CardTitle>开始前，先了解任务</CardTitle><CardDescription className="leading-6">每人两轮，使用两套通知。每轮预计 3–5 分钟，完成时自行确认。</CardDescription></CardHeader>
        <CardContent className="grid gap-5">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>阅读六封通知，把当前有效安排和材料截止登记在结果区，并关联通知来源。</li>
            <li>保留已有安排，处理改期、重复和取消；写下你发现的时间冲突。</li>
            <li>人工轮自行整理；Daylight 轮点击分析，再核验和修正结果。两轮使用同一个编辑器。</li>
            <li>点击“开始本轮”即计时，阅读、模型等待、核验和修正都计入。两轮结束后查看检查结果。</li>
          </ol>
          <Field label="匿名编号 · P01–P999"><Input className="h-12" value={participant} maxLength={4} onChange={e => setParticipant(e.target.value.toUpperCase())} /></Field>
          <Field label="记录用途"><select className={selectClass} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="participant">目标用户参与</option><option value="self-check">项目成员自查</option>
          </select></Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm leading-6"><Checkbox className="mt-1 size-5" checked={consented}
            onCheckedChange={value => setConsented(value === true)} /><span>我自愿参与，知道将记录匿名编号、耗时、操作结果和反馈，用于项目体验对照。原始记录保存在主持人的电脑，可随时结束参与。</span></label>
          <Button className="min-h-12" disabled={!consented || pending} onClick={() => perform(async () => applySession(await request('/sessions', 'POST', { participant, kind, consented })))}>领取两轮任务</Button>
        </CardContent>
      </Card>}
      {session?.status === 'running' && trial?.status === 'ready' && <Card className="mx-auto w-full max-w-2xl">
        <CardHeader><CardTitle>第 {session.index + 1} / 2 轮 · {conditionName(trial.condition)}</CardTitle>
          <CardDescription>{session.participant} · 通知组 {trial.set} · 北京时间</CardDescription></CardHeader>
        <CardContent className="grid gap-5"><p className="text-sm leading-6">{trial.condition === 'manual' ? '阅读通知后，自行在右侧编辑器整理安排与待办。' : '开始后可用 Daylight 分析通知，再核验、补充或修正结果。'} 准备好后开始，计时持续到你确认完成。</p>
          <Button className="min-h-12" disabled={pending} onClick={() => perform(async () => applySession(await request(`/sessions/${session.id}/start`, 'POST', {})))}><Clock3 />开始本轮</Button>
        </CardContent>
      </Card>}
      {running && answers && <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <div><h2 className="font-semibold">第 {session.index + 1} / 2 轮 · {conditionName(trial.condition)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{session.participant} · 通知组 {trial.set} · 所有时间均为北京时间</p></div>
          <div role="timer" className="flex items-center gap-2 font-mono text-2xl tabular-nums"><Clock3 className="size-5" />{duration(elapsed)}</div>
          <nav aria-label="本轮内容定位" className="flex w-full gap-3 lg:hidden"><Button asChild variant="outline" className="min-h-11 flex-1"><a href="#study-mails">通知原文</a></Button><Button asChild variant="outline" className="min-h-11 flex-1"><a href="#study-results">整理结果</a></Button></nav>
        </div>
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section id="study-mails" className="grid min-w-0 scroll-mt-4 gap-4" aria-label="通知原文">
            <Card><CardHeader><CardTitle className="text-base">已有日历</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm">
              {trial.materials.initialEvents.map(event => <div key={event.id}><strong>{event.title}</strong><p className="mt-1 text-muted-foreground">{displayTime(event.start)} → {displayTime(event.end)}<br />{event.location}</p></div>)}
            </CardContent></Card>
            <h2 className="flex items-center gap-2 font-semibold"><Mail className="size-4" />通知原文 · 按接收时间</h2>
            {trial.materials.emails.map((email, index) => <details key={`${email.id}-${index}`} className="min-w-0 rounded-xl border bg-card p-4" open={index === 0}>
              <summary className="min-h-11 cursor-pointer break-words text-sm font-medium">{index + 1}. {email.subject}</summary>
              <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{email.sender}<br />收到于 {displayTime(email.receivedAt)} · ID {email.id}</p>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{email.body}</p>
            </details>)}
          </section>
          <Card id="study-results" className="min-w-0 scroll-mt-4"><CardHeader><CardTitle>我的整理结果</CardTitle><CardDescription>两轮完成后统一核对。取消的安排可以删除或标记为已取消。</CardDescription></CardHeader>
            <CardContent className="grid min-w-0 gap-6">
              {trial.condition === 'daylight' && <div className="grid gap-3 rounded-lg border bg-secondary/30 p-4">
                <Button className="min-h-12" disabled={disabled || trial.analysis?.attempts >= 2 || trial.analysis?.status === 'completed' && !trial.analysis.errors.length}
                  onClick={() => perform(async () => applySession(await request(`/sessions/${session.id}/analyze`, 'POST', {})))}>
                  {analyzing ? <Loader2 className="animate-spin" /> : <Sparkles />}{analyzing ? `正在处理 · 已完成 ${trial.analysis.processed}/5` : trial.analysis?.status === 'completed' && !trial.analysis.errors.length ? '五封通知已处理完成' : trial.analysis ? '重试未处理通知' : '分析通知'}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">{config.mode === 'live' ? '使用本次配置的真实模型；逐封处理五封唯一通知。' : '使用预置提取，实时执行日历和待办工具。'} 分析完成后请核验结果。</p>
                {trial.analysis?.errors.map((message, i) => <p key={i} className="text-sm" role="status">{message}</p>)}
                {trial.analysis?.observations?.length > 0 && <details><summary className="min-h-11 cursor-pointer text-sm font-medium">查看处理记录与冲突</summary>
                  <ul className="space-y-3 text-sm leading-6">{trial.analysis.observations.map((item, i) => <li key={i} className="rounded-md border bg-background p-3"><strong>{item.subject}</strong><p>{item.summary}</p>{item.conflicts.map((text, j) => <p key={j}>{text}</p>)}</li>)}</ul>
                </details>}
              </div>}
              <AnswerRows kind="events" rows={answers.events} emails={trial.materials.emails} disabled={disabled} onChange={events => edit({ events })} />
              <AnswerRows kind="tasks" rows={answers.tasks} emails={trial.materials.emails} disabled={disabled} onChange={tasks => edit({ tasks })} />
              <Field label="时间冲突说明"><Textarea aria-label="时间冲突说明" disabled={disabled} maxLength={2000} className="min-h-24" value={answers.conflictNotes}
                placeholder="说明你发现的冲突，或写下没有冲突的依据。" onChange={e => edit({ conflictNotes: e.target.value })} /></Field>
              <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => perform(async () => {
                const saved = await request(`/sessions/${session.id}/draft`, 'PUT', answers); applySession(saved);
              })}><Save />保存草稿</Button><p className="text-xs text-muted-foreground" role="status">{saveState} · 完成本轮时会保存全部结果</p></div>
              <div className="grid gap-4 border-t pt-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="向主持人求助次数"><Input type="number" min="0" max="99" step="1" className="h-11" disabled={disabled} value={helpRequests} onChange={e => setHelpRequests(e.target.value)} /></Field>
                  <Field label="本轮容易程度"><select className={selectClass} disabled={disabled} value={ease} onChange={e => setEase(e.target.value)}><option value="">可选</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} · {['很难','较难','一般','较容易','很容易'][value - 1]}</option>)}</select></Field>
                </div>
                <Field label="中断或体验反馈 · 可选"><Textarea disabled={disabled} value={interruptions} maxLength={2000} onChange={e => setInterruptions(e.target.value)} /></Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-6"><Checkbox className="size-5" disabled={disabled} checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} />我已核验当前结果，可以结束本轮。</label>
                <Button className="min-h-12" disabled={disabled || !confirmed || helpRequests === ''} onClick={() => perform(async () => applySession(await request(`/sessions/${session.id}/finish`, 'POST', {
                  answers, confirmed, helpRequests: Number(helpRequests), interruptions, ease: ease === '' ? null : Number(ease),
                })))}><Check />完成本轮并保存</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>}
      {session?.status === 'completed' && <>
        <Card><CardHeader><CardTitle>两轮已完成</CardTitle><CardDescription>{session.participant} · 耗时包含本轮的全部阅读、等待、核验与修正</CardDescription></CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
          {session.trials.map((item, index) => <section key={index} className="grid content-start gap-4 rounded-lg border p-4">
            <h2 className="font-semibold">{conditionName(item.condition)} · 通知组 {item.set}</h2>
            <p className="text-2xl font-semibold tabular-nums">{duration(item.elapsedSeconds)} <span className="text-sm font-normal text-muted-foreground">{item.score.passed}/{item.score.total} 项自动核对通过</span></p>
            {item.modelDraftScore && <p className="text-sm leading-6 text-muted-foreground">模型草稿通过 {item.modelDraftScore.passed}/{item.modelDraftScore.total} 项。最终相对模型草稿：安排增加 {item.finalDifferences.events.addedRows}、移除 {item.finalDifferences.events.removedRows}；待办增加 {item.finalDifferences.tasks.addedRows}、移除 {item.finalDifferences.tasks.removedRows}。修改一项按移除旧项、增加新项记录。</p>}
            <ul className="grid gap-2 text-sm">{item.score.checks.map(check => <li key={check.id} className="flex gap-2"><span aria-label={check.pass ? '通过' : '需核对'}>{check.pass ? '✓' : '○'}</span>{check.label}</li>)}</ul>
            <Review trial={item} index={index} disabled={pending} save={(i, body) => perform(async () => applySession(await request(`/sessions/${session.id}/review/${i}`, 'POST', body)))} />
          </section>)}
        </CardContent></Card>
      </>}
      {session?.status === 'interrupted' && <p className="rounded-xl border p-5">本次参与已结束，已保存的草稿和中断状态保留在记录中。</p>}
      <footer className="grid gap-4 border-t pt-5">
        <div className="flex flex-wrap gap-3">
          {session?.status === 'running' && <Button variant="ghost" className="min-h-11" disabled={pending || analyzing || session.storageFault}
            onClick={() => perform(async () => applySession(await request(`/sessions/${session.id}/interrupt`, 'POST', {})))}>结束参与并保留记录</Button>}
          {session && session.status !== 'running' && <Button className="min-h-11" variant="outline" onClick={() => { setSession(null); setAnswers(null); setSummary(null); setConsented(false); localStorage.removeItem(sessionKey); }}>下一位参与者</Button>}
          <Button className="min-h-11" variant="outline" disabled={!config || pending || session?.status === 'running' && !session.storageFault} onClick={exportData}><Download />主持人导出记录</Button>
          {(!session || session.status !== 'running') && <Button className="min-h-11" variant="outline" disabled={!config || pending} onClick={() => perform(async () => setSummary(await request('/summary')))}>查看本场汇总</Button>}
        </div>
        {summary && <div className="grid gap-2 rounded-lg border p-4 text-sm leading-6"><strong>已完成真实用户配对：{summary.completedLivePairs} · 两轮均复核：{summary.fullyReviewedPairs}</strong>
          <p>人工耗时中位数 {summary.medianManualSeconds === null ? '待采集' : `${summary.medianManualSeconds.toFixed(1)} 秒`}；Daylight 耗时中位数 {summary.medianDaylightSeconds === null ? '待采集' : `${summary.medianDaylightSeconds.toFixed(1)} 秒`}。</p>
          <p>保留记录 {summary.retainedSessions} 条，其中练习、自查与中断等单独保留 {summary.excluded.length} 条。{summary.interpretation}</p>
        </div>}
        <p className="text-xs leading-6 text-muted-foreground">{config?.version} · 本地独立记录 · 同一轮使用当前设备完成。刷新前请保存草稿。</p>
      </footer>
    </main>
  </div>;
}
