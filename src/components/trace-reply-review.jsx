import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mail, RefreshCw } from 'lucide-react';
import { AssistantDraftReview } from '@/components/assistant-draft-review';
import { Button } from '@/components/ui/button';
import { request } from '@/lib/api';

/** Each selected trace owns its request scope and opens the durable review card. */
export function TraceReplyReview({ traceId, mailboxId, hasSourceDraft = true }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);

  async function refresh(signal) {
    const result = await request('/assistant/drafts', 'GET', undefined, { mailboxId, scope: false, signal });
    const items = result.drafts || [];
    if (mounted.current && !signal?.aborted) {
      setDraft(items.find(item => item.kind === 'trace_reply' && item.sourceTraceId === traceId) || null);
      setError('');
    }
    return items;
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    refresh(controller.signal)
      .catch(failure => { if (mounted.current && !controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (mounted.current && !controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [traceId, mailboxId]);

  async function prepare() {
    if (pending.current || loading) return;
    pending.current = true;
    setPreparing(true);
    setError('');
    try {
      const result = await request('/assistant/drafts', 'POST', { mailboxId, kind: 'trace_reply', sourceTraceId: traceId }, { mailboxId, scope: false });
      if (!mounted.current) return;
      if (result.draft?.sourceTraceId !== traceId) throw new Error('未取得对应原邮件的草稿，请刷新核对。');
      setDraft(result.draft);
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      pending.current = false;
      if (mounted.current) setPreparing(false);
    }
  }

  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try { await refresh(); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { pending.current = false; if (mounted.current) setLoading(false); }
  }

  return <section className="min-w-0 space-y-3" aria-label="原邮件回复审核">
    <h3 className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4" />回复审核</h3>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取审核记录…</p>
      : draft ? <AssistantDraftReview key={draft.id} draft={draft} mailboxId={mailboxId} onChanged={setDraft} onRefresh={() => refresh()} />
        : <p className="text-sm leading-relaxed text-muted-foreground">{hasSourceDraft
          ? '将原邮件的回复地址、主题和当前草稿放入审核卡，核对后确认发送。'
          : '这封邮件没有生成回复草稿。可在邮件收发中撰写回复。'}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!loading && hasSourceDraft && (!draft || draft.status === 'discarded') && <Button className="min-h-11" disabled={preparing || Boolean(error)} onClick={prepare}>
      {preparing ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}{draft ? '重新准备回复审核' : '准备回复审核'}
    </Button>}
    {error && <Button variant="outline" className="min-h-11" disabled={loading || preparing} onClick={retry}><RefreshCw className="size-4" />重新读取审核记录</Button>}
  </section>;
}
