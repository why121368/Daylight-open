#!/usr/bin/env node
/**
 * Generate a QR for a deployed Daylight public page, with honest reachability checks.
 * Run on an external computer after deployment, not just inside the server's network.
 * Usage: node scripts/public-qr.mjs --url https://daylight.your-domain.cn/campus
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { inspectShareUrl, isPrivateHost } from '../shared/public-url.js';

const HELP = `Generate a Daylight public-page QR code.

  node scripts/public-qr.mjs --url https://your-real-domain.cn/campus
    [--output work/daylight-campus-qr.png] [--timeout-ms 12000]
    [--skip-verify] [--allow-local-preview]

Default: require public HTTPS, check the page, /health/ready, and anonymous
/api/state, then write PNG + a JSON verification report. Verification failure
exits nonzero without writing a new QR.

--skip-verify creates an explicitly UNVERIFIED QR (no network checks).
--allow-local-preview allows HTTP/local URLs and creates a LOCAL PREVIEW QR;
it performs no network checks and does not publish a local server.
Never put tokens, passwords, private calendar subscriptions or API keys in URLs.
`;

export function parseArgs(argv) {
  const args = { timeoutMs: 12000, skipVerify: false, allowLocalPreview: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    if (flag === '--url') args.url = next();
    else if (flag === '--output') args.output = next();
    else if (flag === '--timeout-ms') args.timeoutMs = Number(next());
    else if (flag === '--skip-verify') args.skipVerify = true;
    else if (flag === '--allow-local-preview') args.allowLocalPreview = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (args.help) return args;
  if (!args.url) throw new Error('--url is required.');
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 100 || args.timeoutMs > 60000) {
    throw new Error('--timeout-ms must be an integer between 100 and 60000.');
  }
  const share = inspectShareUrl(args.url);
  if (!share.valid) throw new Error(share.error);
  if (!share.publicCandidate && !args.allowLocalPreview) {
    throw new Error('Public QR codes require a public HTTPS URL. For a local-only preview, explicitly add --allow-local-preview.');
  }
  args.url = share.url;
  args.preview = args.allowLocalPreview;
  args.skipVerify ||= args.allowLocalPreview;
  args.output ||= args.preview ? 'work/daylight-campus-local-preview-qr.png'
    : args.skipVerify ? 'work/daylight-campus-unverified-qr.png' : 'work/daylight-campus-qr.png';
  if (path.extname(args.output).toLowerCase() !== '.png') throw new Error('--output must end in .png.');
  return args;
}

async function assertPublicDns(url) {
  if (isPrivateHost(url.hostname)) throw new Error('The verification target is a local or reserved hostname.');
  const records = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!records.length || records.some(({ address }) => isPrivateHost(address))) {
    throw new Error('DNS resolves to a local or reserved address; it cannot be certified as a public URL.');
  }
}

async function publicGet(value, timeoutMs, redirects = 0) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Verification requires HTTPS on every redirect.');
  await assertPublicDns(url);
  const response = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'Daylight-Public-QR-Verification/1.0', accept: 'application/json,text/html;q=0.9' },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects >= 4) throw new Error('Too many redirects or a missing Location header.');
    const destination = new URL(location, url);
    if (destination.origin !== url.origin) throw new Error('Public probes must stay on the requested origin.');
    return publicGet(destination.href, timeoutMs, redirects + 1);
  }
  return response;
}

export async function verifyPublicUrl(value, timeoutMs = 12000) {
  const url = new URL(value);
  const probes = [];
  const page = await publicGet(url.href, timeoutMs);
  probes.push({ path: `${url.pathname}${url.search}`, status: page.status });
  await page.body?.cancel();
  if (page.status !== 200) throw new Error(`The public page returned HTTP ${page.status}; expected 200.`);

  const ready = await publicGet(new URL('/health/ready', url).href, timeoutMs);
  probes.push({ path: '/health/ready', status: ready.status });
  if (ready.status !== 200) {
    await ready.body?.cancel();
    throw new Error(`Readiness returned HTTP ${ready.status}; expected 200.`);
  }
  const health = await ready.json().catch(() => null);
  if (health?.ok !== true) throw new Error('Readiness did not return the Daylight JSON field ok:true.');

  const state = await publicGet(new URL('/api/state', url).href, timeoutMs);
  probes.push({ path: '/api/state', status: state.status, authenticated: false });
  await state.body?.cancel();
  if (state.status !== 401) throw new Error(`Anonymous /api/state returned HTTP ${state.status}; expected 401 to protect private workspaces.`);

  const config = await publicGet(new URL('/api/auth/config', url).href, timeoutMs);
  probes.push({ path: '/api/auth/config', status: config.status });
  const auth = config.status === 200 ? await config.json().catch(() => null) : null;
  if (!auth) await config.body?.cancel();
  if (auth?.requireAuth !== true || auth?.allowLocalDemoLogin !== false) {
    throw new Error('Production authentication must require login and disable local demo login.');
  }
  return probes;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return; }
  const status = args.preview ? 'local-preview' : args.skipVerify ? 'unverified' : 'verified-from-this-machine';
  let probes = [];
  if (!args.skipVerify) {
    console.log('Checking public HTTPS, application readiness, and anonymous access boundaries...');
    probes = await verifyPublicUrl(args.url, args.timeoutMs);
  }
  const { default: QRCode } = await import('qrcode');
  const output = path.resolve(args.output);
  const reportPath = `${output}.json`;
  const png = await QRCode.toBuffer(args.url, {
    type: 'png', errorCorrectionLevel: 'M', width: 1024, margin: 4,
    color: { dark: '#102e32', light: '#ffffff' },
  });
  const generatedAt = new Date().toISOString();
  const report = {
    url: args.url, status, generatedAt, checkedAt: probes.length ? generatedAt : null,
    timezone: 'Asia/Shanghai', probes,
    note: args.preview ? 'Local preview only; this does not make a server public.'
      : args.skipVerify ? 'No reachability checks were performed; online availability is unverified.'
        : 'Reachable from this machine at the recorded time. Independently scan with a phone on mobile data.',
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  // Reserve both files before writing, so a stale report cannot label a new QR.
  const imageFile = await fs.open(output, 'wx');
  let reportFile;
  try {
    reportFile = await fs.open(reportPath, 'wx');
  } catch (error) {
    await imageFile.close();
    await fs.unlink(output);
    throw error;
  }
  try {
    await imageFile.writeFile(png);
    await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await Promise.all([imageFile.close(), reportFile.close()]);
  }
  console.log(`${status.toUpperCase()}: ${args.url}`);
  for (const probe of probes) console.log(`  ${probe.path}: HTTP ${probe.status}`);
  console.log(`PNG: ${output}\nReport: ${reportPath}\n${report.note}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`QR not verified/generated: ${error.message}`);
    process.exitCode = 1;
  });
}
