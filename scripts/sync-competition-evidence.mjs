#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evidenceSnapshot, evidenceSnapshotPath, checkEvidenceSnapshot } from './lib/competition-evidence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Usage: npm run evidence:sync -- [--check]');
if (args.includes('--check')) {
  const result = checkEvidenceSnapshot(root);
  console.log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.files} public evidence sources match ${result.path}.`);
  process.exitCode = result.ok ? 0 : 1;
} else {
  fs.mkdirSync(path.dirname(path.join(root, evidenceSnapshotPath)), { recursive: true });
  fs.writeFileSync(path.join(root, evidenceSnapshotPath), evidenceSnapshot(root));
  console.log(`Updated ${evidenceSnapshotPath}.`);
}
