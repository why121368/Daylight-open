import { chunkPages } from './chunk.js';
import { ingestAttachmentChunks, attachmentChunkPieces } from './ingest.js';
import { mailAttachmentKey, mailBodyKey, parseMailRef } from '../../shared/mail-ref.js';
import { listChunks } from './store.js';

function plainText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script>|$)/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style>|$)/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    // Older records capped raw HTML at 200k, sometimes in a base64 image tag.
    // Drop an unfinished tag too, so image bytes never become thousands of fake chunks.
    .replace(/<[a-z/!][^>]*(?:>|$)/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/\s+\n/g, '\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

function emailPlain(email) {
  const body = plainText(email?.body);
  const html = plainText(email?.html);
  if (!body) return html;
  if (!html) return body;
  const compact = value => value.replace(/\s+/g, '');
  if (compact(body).includes(compact(html))) return body;
  if (compact(html).includes(compact(body))) return html;
  // MIME alternatives sometimes differ; preserve the text unique to either version.
  return `${body}\n\n${html}`;
}

function receivedTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 8 * 3600_000).toISOString().replace(/Z$/, '+08:00') : '';
}

export function emailKnowledgeSources(email) {
  if (!email?.id) return [];
  const subject = String(email.subject || '').trim();
  const body = emailPlain(email);
  const header = [
    subject ? `主题：${subject}` : '',
    email.sender ? `发件人：${email.sender}` : '',
    receivedTime(email.receivedAt) ? `收信时间（北京时间，非活动时间）：${receivedTime(email.receivedAt)}` : '',
    email.summary ? `摘要：${email.summary}` : '',
  ].filter(Boolean).join('\n');
  const sources = [{
    id: mailBodyKey(email.id), filename: subject || '邮件正文',
    textPrefix: body ? header : '',
    pages: body || header ? [{ page: 1, text: body || header }] : [],
  }];
  for (const [index, file] of (email.attachmentTexts || []).entries()) {
    const pages = Array.isArray(file?.pages) && file.pages.length
      ? file.pages.map((page, index) => ({ page: page.page || index + 1, text: plainText(page.text) }))
      : [{ page: 1, text: plainText(file?.text) }];
    if (!pages.some(page => page.text)) continue;
    sources.push({
      id: mailAttachmentKey(email.id, file.attachmentId || file.filename || index),
      filename: file.filename || '附件',
      textPrefix: `附件：${file.filename || '未命名'}\n${header}`,
      pages,
    });
  }
  return sources;
}

function sourceIsCurrent(source, existing) {
  const expected = attachmentChunkPieces(source);
  return expected.length === existing.length && expected.every(piece => existing.some(chunk =>
    chunk.page === piece.page && chunk.chunkIndex === piece.chunkIndex && chunk.content === piece.content));
}

/** Repair the derived text index before retrieval. No model calls are made here. */
export async function repairMailboxEmailIndex({ mailboxId, emails = [], settings = {}, chunks } = {}) {
  const current = chunks ?? await listChunks(mailboxId);
  if (settings.ragEnabled === false) return current;
  let indexed = current;
  for (const email of emails) {
    for (const source of emailKnowledgeSources(email)) {
      const existing = indexed.filter(chunk => chunk.attachmentId === source.id);
      if (sourceIsCurrent(source, existing)) continue;
      await ingestAttachmentChunks({ mailboxId, attachment: source,
        settings: { ...settings, ragEmbeddings: false }, existingChunks: existing });
      indexed = indexed.filter(chunk => chunk.attachmentId !== source.id)
        .concat(await listChunks(mailboxId, { attachmentId: source.id }));
    }
  }
  return indexed;
}

export function mailboxKnowledgeCoverage({ emails = [], chunks = [] } = {}) {
  const saved = emails.filter(email => email?.id);
  const bodies = new Set(chunks.map(chunk => chunk.attachmentId));
  const indexedEmailCount = saved.filter(email => bodies.has(mailBodyKey(email.id))).length;
  const fullyIndexedEmailCount = saved.filter(email => emailKnowledgeSources(email).every(source =>
    sourceIsCurrent(source, chunks.filter(chunk => chunk.attachmentId === source.id)))).length;
  return {
    emailCount: saved.length, indexedEmailCount, fullyIndexedEmailCount,
    pendingEmailCount: saved.length - fullyIndexedEmailCount,
    // Old excerpts cannot recover characters that were never saved. Keep that boundary visible.
    limitedAttachmentCount: saved.reduce((count, email) => count + (email.attachments || []).filter(file =>
      ['truncated', 'failed', 'skipped_limit', 'skipped_size', 'unsupported'].includes(file.textStatus)
      && !(email.attachmentTexts || []).some(text => text.attachmentId === file.id && text.pages?.length)).length, 0),
  };
}

/**
 * 把一封已处理邮件的主题、正文和附件摘录写入当前邮箱的知识库。
 * 招聘 PDF 仍走原有按页入库；这里覆盖普通邮件，失败不抛给同步主流程。
 */
export async function ingestEmailKnowledge({ mailboxId, email, settings = {}, context } = {}) {
  if (!mailboxId || !email?.id) return { skipped: true, reason: 'missing_email', chunkCount: 0 };
  let chunkCount = 0;
  let embedded = 0;
  for (const attachment of emailKnowledgeSources(email)) {
    const result = await ingestAttachmentChunks({ mailboxId, attachment, settings, context });
    if (result.skipped) return { ...result, emailId: email.id };
    chunkCount += result.chunkCount || 0;
    embedded += result.embedded || 0;
  }
  return { skipped: false, chunkCount, embedded, emailId: email.id };
}

export async function reindexMailboxEmails({ mailboxId, emails = [], settings = {}, context } = {}) {
  let processed = 0;
  let chunkCount = 0;
  let embedded = 0;
  for (const email of emails) {
    if (!email?.id) continue;
    const result = await ingestEmailKnowledge({ mailboxId, email, settings, context });
    if (!result.skipped) {
      processed += 1;
      chunkCount += result.chunkCount || 0;
      embedded += result.embedded || 0;
    }
  }
  return { processed, chunkCount, embedded };
}

/** 只补尚未入库的历史邮件，已有片段的跳过，适合启动与登录后的后台回填。 */
export async function ensureMailboxEmailsIndexed({
  mailboxId,
  emails = [],
  settings = {},
  context,
} = {}) {
  if (!mailboxId) return { processed: 0, skipped: 0, chunkCount: 0, missing: 0 };
  const chunks = await listChunks(mailboxId);
  const indexed = new Set();
  for (const chunk of chunks) {
    const ref = parseMailRef(chunk.attachmentId);
    if (ref.emailId) indexed.add(ref.emailId);
  }
  const missing = (emails || []).filter((email) => email?.id && !indexed.has(email.id));
  if (!missing.length) {
    return { processed: 0, skipped: indexed.size, chunkCount: 0, missing: 0 };
  }
  const result = await reindexMailboxEmails({
    mailboxId,
    emails: missing,
    settings,
    context,
  });
  return { ...result, skipped: indexed.size, missing: missing.length };
}

export function chunkEmailPreview(email) {
  return chunkPages([{ page: 1, text: emailPlain(email) }]).length;
}
