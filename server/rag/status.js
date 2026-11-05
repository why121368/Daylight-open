import { readStore } from '../store.js';
import { listChunks } from './store.js';
import { mailboxKnowledgeCoverage } from './mail-index.js';
import { isRagEnabled, isRagEmbeddings } from './flags.js';

/** Read actual index coverage; configuration alone never proves vector availability. */
export async function knowledgeStatus({ mailboxIds, settings = {} }) {
  const perMailbox = await Promise.all(mailboxIds.map(async mailboxId => {
    const chunks = await listChunks(mailboxId);
    return { mailboxId, ...mailboxKnowledgeCoverage({ emails: readStore(mailboxId).emails || [], chunks }),
      chunkCount: chunks.length,
      attachmentCount: new Set(chunks.map(chunk => chunk.attachmentId)).size,
      embeddedCount: chunks.filter(chunk => Array.isArray(chunk.embedding) && chunk.embedding.length).length };
  }));
  const counts = Object.fromEntries(['emailCount', 'indexedEmailCount', 'fullyIndexedEmailCount', 'pendingEmailCount',
    'limitedAttachmentCount', 'chunkCount', 'attachmentCount', 'embeddedCount']
    .map(key => [key, perMailbox.reduce((sum, box) => sum + box[key], 0)]));
  return { mailboxId: mailboxIds[0], mailboxIds, mailboxCount: mailboxIds.length,
    enabled: isRagEnabled(settings), embeddings: isRagEmbeddings(settings),
    keywordOnly: settings.ragEmbeddings === false, embeddingModel: settings.embeddingModel || '',
    ...counts, retrievalMode: isRagEmbeddings(settings) && counts.embeddedCount > 0 ? 'hybrid' : 'keyword',
    perMailbox };
}
