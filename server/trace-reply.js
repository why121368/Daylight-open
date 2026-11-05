import addressparser from 'nodemailer/lib/addressparser';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const messageId = value => typeof value === 'string' && /^<[^<>\s\x00-\x1f\x7f]{1,998}>$/.test(value.trim()) ? value.trim() : '';

/** Resolve reply identity from the persisted source record. */
export function traceReplyFields(trace, emails) {
  if (!trace?.trace_id) fail('处理记录不存在或不属于当前邮箱。', 404);
  const matches = (emails || []).filter(email => email.trace_id === trace.trace_id);
  if (matches.length !== 1) fail('未找到唯一的原邮件，请从邮件页面核对后准备回复。', 409);
  const email = matches[0];
  if (trace.mode !== 'qq' || email.mode !== 'qq') fail('预置示例使用采纳记录，请选择本人邮箱的邮件准备回复。', 409);
  if (trace.reply_delivery?.status === 'sent') fail('这封回复已有发送回执，请核对执行记录。', 409);
  if (trace.reply_delivery?.status) fail('这条记录已有回复发送尝试，请先在发件箱核对回执。', 409);
  const recipient = String(email.replyTo || email.senderAddress || email.sender || '');
  if (/[\r\n\0]/.test(recipient)) fail('原邮件回复地址格式不正确，请在邮件收发页面核对收件人。');
  const to = addressparser(recipient, { flatten: true }).map(item => item.address).filter(Boolean);
  if (!to.length) fail('原邮件没有可识别的回复地址，请在邮件收发页面填写收件人。');
  const originalSubject = String(email.subject || '（无主题）');
  const subject = /^\s*re\s*:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
  const body = email.userDraft ?? trace.user_draft ?? email.draftReply ?? trace.draft_reply ?? '';
  const inReplyTo = messageId(email.messageId);
  const references = Array.isArray(email.references) ? email.references : String(email.references || '').split(/\s+/);
  return { to, subject, body, sourceTraceId: trace.trace_id, sourceEmailId: email.id,
    inReplyTo, references: [...new Set([...references.map(messageId).filter(Boolean), inReplyTo].filter(Boolean))].slice(-50) };
}
