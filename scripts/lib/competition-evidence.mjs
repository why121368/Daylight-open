import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// These sources already appear on the public technical page. Keep the build's
// input in src/, so the production Docker context need not contain all docs/.
export const evidenceSources = {
  costEvidence: 'docs/competition-2026-11-04/evidence/cost-estimate.json',
  reportManifest: 'docs/competition-submission-2026-11-04/evidence/report-manifest.json',
  ragLatency: 'docs/competition-rag-latency-2026-11-04/evidence/summary.json',
  currentBudget: 'docs/competition-container-2026-11-04/evidence/budget-total.json',
  recovery: 'docs/competition-recovery-2026-11-04/evidence/recovery-summary.json',
};
export const evidenceSnapshotPath = 'src/data/competition-evidence.json';

export function evidenceSnapshot(root) {
  const data = {}, sources = {};
  for (const [key, file] of Object.entries(evidenceSources)) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Expected a JSON object: ${file}`);
    data[key] = parsed;
    sources[key] = { path: file, canonicalSha256: createHash('sha256').update(JSON.stringify(parsed)).digest('hex') };
  }
  return JSON.stringify({ format: 1, sources, data }, null, 2) + '\n';
}

export function checkEvidenceSnapshot(root) {
  const expected = JSON.parse(evidenceSnapshot(root));
  const actual = JSON.parse(fs.readFileSync(path.join(root, evidenceSnapshotPath), 'utf8'));
  return { ok: JSON.stringify(actual) === JSON.stringify(expected), files: Object.keys(evidenceSources).length,
    path: evidenceSnapshotPath, sourcePaths: Object.values(evidenceSources) };
}
