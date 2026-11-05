/** Private backup inventory and public recovery proof. Never prints stored business values. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const ordered = values => [...values].sort((a, b) => a.name.localeCompare(b.name, 'en'));
const aggregate = values => sha([...values].sort().join('\n'));

export async function hashObject(body) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of body) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

function validate(manifest) {
  if (manifest?.format !== 'daylight-recovery-manifest-v1'
    || !Array.isArray(manifest.tables) || !Array.isArray(manifest.sequences)
    || !Array.isArray(manifest.objects)) fail('INVALID_RECOVERY_MANIFEST');
  for (const [kind, entries] of [['tables', manifest.tables], ['sequences', manifest.sequences], ['objects', manifest.objects]]) {
    const seen = new Set();
    for (const entry of entries) {
      if (typeof entry.name !== 'string' || !entry.name || seen.has(entry.name)
        || !/^[a-f0-9]{64}$/.test(entry.sha256)
        || (kind === 'tables' && (!Number.isSafeInteger(entry.rows) || entry.rows < 0))
        || (kind === 'objects' && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0))) fail('INVALID_RECOVERY_MANIFEST');
      seen.add(entry.name);
    }
  }
}

export function compareManifests(expected, actual) {
  validate(expected); validate(actual);
  const compare = (kind, fields) => {
    const before = new Map(expected[kind].map(entry => [entry.name, entry]));
    const after = new Map(actual[kind].map(entry => [entry.name, entry]));
    const mismatches = [];
    for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(name), b = after.get(name);
      if (!a || !b || fields.some(field => a[field] !== b[field])) {
        // Object keys can contain personal filenames. Only their digest leaves this process.
        mismatches.push({ ...(kind === 'objects' ? { keySha256: sha(name) } : { name }),
          reason: !a ? 'unexpected' : !b ? 'missing' : 'content' });
      }
    }
    return { expected: before.size, actual: after.size, verified: before.size - mismatches.filter(m => m.reason !== 'unexpected').length,
      mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 20) };
  };
  const tables = compare('tables', ['rows', 'sha256']);
  tables.rows = expected.tables.reduce((sum, entry) => sum + entry.rows, 0);
  tables.details = ordered(expected.tables).map(entry => ({ ...entry,
    match: actual.tables.some(item => item.name === entry.name && item.rows === entry.rows && item.sha256 === entry.sha256) }));
  const objects = compare('objects', ['bytes', 'sha256']);
  objects.bytes = expected.objects.reduce((sum, entry) => sum + entry.bytes, 0);
  return { ok: [tables, objects].every(item => item.mismatchCount === 0)
      && compare('sequences', ['sha256']).mismatchCount === 0,
    checkedAt: new Date().toISOString(), tables, sequences: compare('sequences', ['sha256']), objects,
    comparison: 'exact relation and object sets; sorted SHA-256 of every database row; full SHA-256 of every object' };
}

export async function captureManifest(env = process.env) {
  if (!env.DAYLIGHT_DATABASE_URL || !env.DAYLIGHT_OSS_ENDPOINT || !env.DAYLIGHT_OSS_BUCKET
    || !env.DAYLIGHT_OSS_ACCESS_KEY || !env.DAYLIGHT_OSS_SECRET_KEY) fail('MISSING_RECOVERY_CONFIGURATION');
  const pool = new pg.Pool({ connectionString: env.DAYLIGHT_DATABASE_URL, max: 1,
    connectionTimeoutMillis: 10000, query_timeout: 120000 });
  const s3 = new S3Client({ endpoint: env.DAYLIGHT_OSS_ENDPOINT,
    region: env.DAYLIGHT_OSS_REGION || 'us-east-1', forcePathStyle: env.DAYLIGHT_OSS_FORCE_PATH_STYLE !== '0',
    credentials: { accessKeyId: env.DAYLIGHT_OSS_ACCESS_KEY, secretAccessKey: env.DAYLIGHT_OSS_SECRET_KEY }, maxAttempts: 2 });
  const manifest = { format: 'daylight-recovery-manifest-v1', startedAt: new Date().toISOString(), tables: [], sequences: [], objects: [] };
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      const { rows: relations } = await client.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'S') ORDER BY n.nspname, c.relname`);
      for (const relation of relations) {
        const name = `${quote(relation.schema)}.${quote(relation.name)}`;
        const { rows } = await client.query(relation.kind === 'S'
          ? `SELECT to_jsonb(s)::text AS value FROM (SELECT last_value, is_called FROM ${name}) s`
          : `SELECT to_jsonb(t)::text AS value FROM ${name} t`);
        const digest = { name, sha256: aggregate(rows.map(row => sha(row.value))) };
        if (relation.kind === 'S') manifest.sequences.push(digest);
        else manifest.tables.push({ ...digest, rows: rows.length });
      }
      await client.query('COMMIT');
    } finally { client.release(); }
    let continuation;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: env.DAYLIGHT_OSS_BUCKET,
        MaxKeys: 1000, ContinuationToken: continuation }), { abortSignal: AbortSignal.timeout(60000) });
      for (const item of page.Contents || []) {
        const result = await s3.send(new GetObjectCommand({ Bucket: env.DAYLIGHT_OSS_BUCKET, Key: item.Key }),
          { abortSignal: AbortSignal.timeout(120000) });
        const content = await hashObject(result.Body);
        if (content.bytes !== item.Size) fail('OBJECT_CHANGED_DURING_CAPTURE');
        manifest.objects.push({ name: item.Key, ...content });
      }
      if (page.IsTruncated && !page.NextContinuationToken) fail('INVALID_OBJECT_PAGE');
      continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuation);
    manifest.tables = ordered(manifest.tables); manifest.sequences = ordered(manifest.sequences);
    manifest.objects = ordered(manifest.objects); manifest.finishedAt = new Date().toISOString();
    validate(manifest);
    return manifest;
  } finally { await pool.end(); s3.destroy(); }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (args.length || !['capture', 'verify'].includes(mode)) fail('USAGE_RECOVERY_CAPTURE_OR_VERIFY');
  let input = '';
  if (mode === 'verify') for await (const chunk of process.stdin) input += chunk;
  const expected = mode === 'verify' ? JSON.parse(input) : null;
  if (expected) validate(expected);
  const started = performance.now(), actual = await captureManifest();
  const result = expected ? { ...compareManifests(expected, actual), durationMs: Math.round(performance.now() - started) } : actual;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Driver errors can include URLs, values or object keys. Export only a stable code.
    process.stderr.write(`Recovery operation failed: ${/^[A-Z][A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'RECOVERY_IO_ERROR'}\n`);
    process.exitCode = 1;
  });
}
