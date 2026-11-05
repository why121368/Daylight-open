export { chunkPages, normalizeChunkText } from './chunk.js';
export { listChunks, deleteChunksByAttachment, replaceChunks, reassignCandidate } from './store.js';
export {
  embedTexts,
  cosineSimilarity,
  pickEmbeddingModel,
  resolveEmbeddingModel,
  listProviderModels,
} from './embed.js';
export { ragSearch, focusQuote, redundancyBetween } from './retrieve.js';
export {
  ingestAttachmentChunks,
  bindChunksToCandidate,
  reindexMailboxAttachments,
} from './ingest.js';
export {
  ingestEmailKnowledge,
  reindexMailboxEmails,
  ensureMailboxEmailsIndexed,
  mailboxKnowledgeCoverage,
} from './mail-index.js';
export { askMailboxKnowledge } from './ask.js';
export { knowledgeStatus } from './status.js';
export { isRagEnabled, isRagEmbeddings } from './flags.js';

import { isRagEnabled, isRagEmbeddings } from './flags.js';

export function ragPublicSettings(settings = {}) {
  return {
    ragEnabled: isRagEnabled(settings),
    ragEmbeddings: isRagEmbeddings(settings),
    embeddingModel: settings.embeddingModel || '',
  };
}
