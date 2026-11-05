import { chunkPages, normalizeChunkText } from './chunk.js';
import { embedTexts } from './embed.js';
import { makeChunkId, replaceChunks, reassignCandidate, listChunks } from './store.js';
import { isRagEmbeddings } from './flags.js';
import { getRequestUserId } from '../request-context.js';

function ragEnabled(settings) {
  return settings?.ragEnabled !== false;
}

export function attachmentChunkPieces(attachment) {
  const prefix = normalizeChunkText(attachment?.textPrefix);
  return chunkPages(attachment?.pages).map(piece => ({
    ...piece, content: prefix ? `${prefix}\n\n${piece.content}` : piece.content,
  }));
}

/**
 * 将附件页文本分块入库；可选 embedding。attachment.pages 来自 pdf.js。
 */
export async function ingestAttachmentChunks({
  mailboxId,
  attachment,
  candidateId = null,
  settings = {},
  context,
  ownerUserId = null,
  existingChunks,
} = {}) {
  if (!ragEnabled(settings)) {
    return { skipped: true, reason: 'rag_disabled', chunkCount: 0 };
  }
  if (!mailboxId || !attachment?.id) {
    throw new Error('RAG 入库缺少 mailboxId 或 attachmentId');
  }
  const pages = Array.isArray(attachment.pages) ? attachment.pages : [];
  const pieces = attachmentChunkPieces(attachment);
  if (!pieces.length) {
    await replaceChunks(mailboxId, attachment.id, []);
    return { skipped: false, chunkCount: 0, reason: 'no_text' };
  }

  const owner = ownerUserId || getRequestUserId() || null;
  const previous = existingChunks ?? await listChunks(mailboxId, { attachmentId: attachment.id });
  const byPosition = new Map(previous.map(chunk => [`${chunk.page}:${chunk.chunkIndex}`, chunk]));
  // A retry or keyword repair must not erase successfully embedded, unchanged chunks.
  const embeddings = pieces.map(piece => {
    const old = byPosition.get(`${piece.page}:${piece.chunkIndex}`);
    return old?.content === piece.content && Array.isArray(old.embedding) && old.embedding.length
      ? old.embedding : null;
  });
  // 向量检索默认开启（显式 false 才关闭）：默认 embedding 模型会从供应商模型列表自动挑，
  // 挑不到就静默退回关键词，所以开启不会因为少填一个字段而报错。
  if (isRagEmbeddings(settings)) {
    const missing = pieces.map((piece, index) => ({ ...piece, index })).filter(piece => !embeddings[piece.index]);
    const generated = await embedTexts(
      settings,
      missing.map((item) => item.content),
      { context, label: 'RAG 分块向量化' },
    );
    missing.forEach((piece, index) => { embeddings[piece.index] = generated[index] || null; });
  }

  const chunks = pieces.map((piece, index) => ({
    id: makeChunkId({
      mailboxId,
      attachmentId: attachment.id,
      page: piece.page,
      chunkIndex: piece.chunkIndex,
    }),
    mailboxId,
    ownerUserId: owner,
    candidateId: candidateId || attachment.candidateId || null,
    attachmentId: attachment.id,
    filename: attachment.filename || '',
    page: piece.page,
    chunkIndex: piece.chunkIndex,
    content: piece.content,
    embedding: embeddings[index] || null,
    updatedAt: new Date().toISOString(),
  }));

  const span = context?.startSpan('rag_ingest', '知识分块入库', {
    thought: '按页分块写入检索索引，供邮件问答、招聘助手与小 D 引用原文。',
    input_snapshot: { attachmentId: attachment.id, pages: pages.length, chunks: chunks.length },
  });
  await replaceChunks(mailboxId, attachment.id, chunks);
  if (span) {
    context.finishSpan(span, {
      observation: `已写入 ${chunks.length} 个分块`,
      output_snapshot: {
        chunkCount: chunks.length,
        embedded: chunks.filter((item) => item.embedding).length,
      },
    });
  }
  return {
    skipped: false,
    chunkCount: chunks.length,
    embedded: chunks.filter((item) => item.embedding).length,
  };
}

export async function bindChunksToCandidate(mailboxId, attachmentId, candidateId) {
  await reassignCandidate(mailboxId, attachmentId, candidateId);
}

/**
 * 按当前邮箱已保存的附件页文本重建索引（不重新 OCR）。
 * attachments 来自 recruitment-store，需带 pages。
 */
export async function reindexMailboxAttachments({
  mailboxId,
  attachments = [],
  settings = {},
  context,
} = {}) {
  if (!ragEnabled(settings)) {
    return { skipped: true, reason: 'rag_disabled', processed: 0, chunkCount: 0 };
  }
  let processed = 0;
  let chunkCount = 0;
  let embedded = 0;
  for (const attachment of attachments) {
    if (!attachment?.id) continue;
    const pages = Array.isArray(attachment.pages) ? attachment.pages : [];
    if (!pages.length) continue;
    const result = await ingestAttachmentChunks({
      mailboxId,
      attachment,
      candidateId: attachment.candidateId || null,
      settings,
      context,
    });
    if (!result.skipped) {
      processed += 1;
      chunkCount += result.chunkCount || 0;
      embedded += result.embedded || 0;
    }
  }
  return { skipped: false, processed, chunkCount, embedded };
}
