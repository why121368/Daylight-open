import { useEffect, useState } from 'react';
import { request } from '@/lib/api';

/** Only the open message is retained; leaving a mailbox/account unmounts or clears it. */
export function useEmailDetail(summary, fallbackMailboxId) {
  const mailboxId = summary?.mailboxId || fallbackMailboxId;
  const id = summary?.id;
  const needsDetail = summary?.detailLoaded === false;
  const key = id ? JSON.stringify([mailboxId, id]) : '';
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!needsDetail || !id || !mailboxId) return;
    const controller = new AbortController();
    request(`/emails/${encodeURIComponent(id)}/detail?mailbox=${encodeURIComponent(mailboxId)}`,
      'GET', undefined, { scope: false, mailboxId, signal: controller.signal })
      .then(email => { if (!controller.signal.aborted) setResult({ key, email }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [id, mailboxId, key, needsDetail, attempt]);
  const current = result?.key === key ? result : null;
  return { email: current?.email ? { ...current.email, ...summary, detailLoaded: true } : summary,
    loading: Boolean(needsDetail && !current), error: current?.error || '',
    retry: () => setAttempt(value => value + 1) };
}
