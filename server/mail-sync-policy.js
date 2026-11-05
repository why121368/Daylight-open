/** Shared mailbox polling policy for local and distributed schedulers. */
export const DEFAULT_MAIL_POLL_INTERVAL_SEC = 600;

export function mailPollIntervalSec(value) {
  return Math.max(30, Math.min(3600, Number(value) || DEFAULT_MAIL_POLL_INTERVAL_SEC));
}

export function mailPollIntervalMs(mailbox) {
  const interval = mailPollIntervalSec(mailbox.pollIntervalSec) * 1000;
  return mailbox.syncStrategy === 'idle' ? Math.max(300_000, interval) : interval;
}
