import test from 'node:test';
import assert from 'node:assert/strict';
import { traceReplyFields } from './trace-reply.js';

const trace = () => ({ trace_id: 'synthetic-trace', mode: 'qq', draft_reply: '原始合成回复。' });
const email = () => ({ id: 'synthetic-email', trace_id: 'synthetic-trace', mode: 'qq', subject: '合成面试通知',
  sender: 'Sender <sender@example.invalid>', replyTo: '招聘团队 <reply@example.invalid>',
  messageId: '<source@example.invalid>', references: ['<previous@example.invalid>'] });

test('trace reply uses source Reply-To and preserves source identity and thread headers', () => {
  const result = traceReplyFields(trace(), [email()]);
  assert.deepEqual(result, { to: ['reply@example.invalid'], subject: 'Re: 合成面试通知', body: '原始合成回复。',
    sourceTraceId: 'synthetic-trace', sourceEmailId: 'synthetic-email', inReplyTo: '<source@example.invalid>',
    references: ['<previous@example.invalid>', '<source@example.invalid>'] });
});

test('trace reply handles named addresses, groups and source draft precedence', () => {
  const source = { ...email(), replyTo: 'Team: One <one@example.invalid>, Two <two@example.invalid>;',
    subject: 'Re: 已有主题', userDraft: '本人已修改的合成草稿。', draftReply: '邮箱内原草稿。' };
  const result = traceReplyFields({ ...trace(), user_draft: '执行记录中的修改。' }, [source]);
  assert.deepEqual(result.to, ['one@example.invalid', 'two@example.invalid']);
  assert.equal(result.subject, 'Re: 已有主题');
  assert.equal(result.body, source.userDraft);
});

test('trace reply falls back to the original sender and leaves source records intact', () => {
  const source = { ...email(), replyTo: '', senderAddress: 'sender@example.invalid', references: '<one@example.invalid> <two@example.invalid>' };
  const original = structuredClone(source);
  const result = traceReplyFields(trace(), [source]);
  assert.deepEqual(result.to, ['sender@example.invalid']);
  assert.deepEqual(result.references, ['<one@example.invalid>', '<two@example.invalid>', '<source@example.invalid>']);
  assert.deepEqual(source, original);
});

test('trace reply requires a unique owned source and keeps preset and legacy-sent flows separate', () => {
  assert.throws(() => traceReplyFields(null, [email()]), { status: 404 });
  assert.throws(() => traceReplyFields(trace(), []), { status: 409 });
  assert.throws(() => traceReplyFields(trace(), [email(), email()]), { status: 409 });
  assert.throws(() => traceReplyFields({ ...trace(), mode: 'demo' }, [email()]), { status: 409 });
  assert.throws(() => traceReplyFields(trace(), [{ ...email(), mode: 'demo' }]), { status: 409 });
  assert.throws(() => traceReplyFields({ ...trace(), reply_delivery: { status: 'sent' } }, [email()]), { status: 409 });
  assert.throws(() => traceReplyFields({ ...trace(), reply_delivery: { status: 'failed' } }, [email()]), { status: 409 });
});

test('trace reply rejects malformed Reply-To instead of silently choosing a different recipient', () => {
  for (const replyTo of ['address\r\nBcc:other@example.invalid', 'bad\0address', '仅有姓名']) {
    assert.throws(() => traceReplyFields(trace(), [{ ...email(), replyTo }]), /地址|收件人/);
  }
});

test('trace reply bounds thread history and filters invalid header identities', () => {
  const source = { ...email(), references: [null, 5, '<bad\0id@example.invalid>', 'not-an-id',
    ...Array.from({ length: 70 }, (_, i) => `<ref-${i}@example.invalid>`), '<source@example.invalid>'] };
  const result = traceReplyFields(trace(), [source]);
  assert.equal(result.references.length, 50);
  assert.equal(result.references.at(-1), '<source@example.invalid>');
  assert.equal(new Set(result.references).size, 50);
  assert.equal(traceReplyFields(trace(), [{ ...email(), messageId: '<bad\r\nId>' }]).inReplyTo, '');
});
