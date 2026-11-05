import { focusQuote } from './retrieve.js';

const MAX_SOURCE_CHARACTERS = 1200;
const MAX_CONTEXT_CHARACTERS = 6400;

/** Keep answer context separate from the short excerpt used by the retrieval UI. */
export function buildAnswerSources(search, limit = 6) {
  const count = Math.min(8, Math.max(1, Number(limit) || 6));
  const hits = new Map((search.hits || []).map(hit => [hit.chunkId, hit]));
  let remaining = MAX_CONTEXT_CHARACTERS;
  return (search.citations || []).slice(0, count).flatMap((citation, index) => {
    if (remaining < 4) return [];
    const hit = hits.get(citation.chunkId);
    const raw = String(hit?.content || citation.quote || '').trim();
    const focus = String(citation.quote || '').replace(/^…|…$/g, '');
    const budget = Math.min(remaining, MAX_SOURCE_CHARACTERS);
    const text = focusQuote(raw, focus ? [focus] : [], budget).slice(0, budget);
    remaining -= text.length;
    if (!text) return [];
    return [{ sourceId: `S${index + 1}`, filename: String(citation.filename || '').slice(0, 200),
      page: citation.page, text, citation }];
  });
}

/** Validate IDs and verbatim quotes before assembling numbered answer text. */
export function validateAnswerEvidence(result, sources) {
  if (result?.answerable === false && (!result.claims || (Array.isArray(result.claims) && !result.claims.length))) {
    return { answer: '在当前检索到的片段中，还没有找到能回答这个问题的信息。可以补充关键词或调整检索范围。',
      citations: [], evidenceStatus: 'insufficient' };
  }
  if (result?.answerable !== true || !Array.isArray(result.claims) || !result.claims.length || result.claims.length > 6) return null;
  const allowed = new Map(sources.map(source => [source.sourceId, source]));
  const citations = [];
  const positions = new Map();
  const lines = [];
  for (const claim of result.claims) {
    if (typeof claim?.text !== 'string' || !claim.text.trim() || claim.text.length > 600
      || !Array.isArray(claim.evidence) || !claim.evidence.length || claim.evidence.length > 3) return null;
    const numbers = [];
    for (const entry of claim.evidence) {
      const source = allowed.get(entry?.sourceId);
      const quote = typeof entry?.quote === 'string' ? entry.quote.trim() : '';
      if (!source || quote.length < 4 || quote.length > 500 || !source.text.includes(quote)) return null;
      const key = `${source.sourceId}\0${quote}`;
      if (!positions.has(key)) {
        if (citations.length >= 8) return null;
        citations.push({ ...source.citation, sourceId: source.sourceId, quote, evidenceChecked: true });
        positions.set(key, citations.length);
      }
      numbers.push(positions.get(key));
    }
    const text = claim.text.replace(/\[\d+\]/g, '').trim();
    if (!text) return null;
    lines.push(`${text} ${[...new Set(numbers)].map(number => `[${number}]`).join(' ')}`);
  }
  return { answer: lines.join('\n\n'), citations, evidenceStatus: 'verified_quotes' };
}
