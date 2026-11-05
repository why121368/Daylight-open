#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyDeliveryIntegrity } from './lib/delivery-integrity.mjs';

const args = process.argv.slice(2);
const usage = 'node scripts/verify-delivery.mjs <extracted-directory> [--out receipt.json]';
try {
  const [directory, option, output] = args;
  if (!directory || directory.startsWith('--') || (args.length !== 1 && (args.length !== 3 || option !== '--out' || !output))) throw new Error(usage);
  const report = verifyDeliveryIntegrity(directory);
  if (output) {
    const target = path.resolve(output);
    const source = path.resolve(directory);
    if (target === source || target.startsWith(source + path.sep) && !target.startsWith(path.join(source, 'work') + path.sep)) {
      throw new Error('Write the receipt outside the delivery files, or under its work directory.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
