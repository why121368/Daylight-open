/** Generate exact public step QR downloads as static assets. No runtime API work. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { EXPERIENCE_STEPS } from '../shared/experience-fixtures.js';
import { experienceShareUrl } from '../shared/experience-progress.js';
import { inspectShareUrl } from '../shared/public-url.js';

const input = process.argv[2] || 'https://daylight.yunforis.com';
const target = inspectShareUrl(experienceShareUrl(input, 0));
if (!target.valid || !target.publicCandidate) throw new Error('Use the public HTTPS deployment origin.');
const origin = new URL(target.url).origin;
const directory = path.resolve(import.meta.dirname, '../public/competition');
const records = [];
await fs.mkdir(directory, { recursive: true });
for (let step = 0; step <= EXPERIENCE_STEPS.length; step++) {
  const url = experienceShareUrl(origin, step);
  const file = `experience-step-${step}-qr.png`;
  const bytes = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', width: 768, margin: 4,
    color: { dark: '#102e32', light: '#ffffff' } });
  await fs.writeFile(path.join(directory, file), bytes);
  records.push({ step, url, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const catalog = { origin, size: 768, margin: 4, errorCorrectionLevel: 'M', records };
await fs.writeFile(path.join(directory, 'experience-step-qr.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ origin, files: records.length, totalPngBytes: records.reduce((sum, row) => sum + row.bytes, 0) }));
