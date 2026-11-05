/** Read exact first-party public entry bytes over HTTPS, preserving wire encoding. */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';

const [originArg, inventoryArg, distArg, outputArg] = process.argv.slice(2);
if (!outputArg) throw new Error('Usage: node scripts/performance/probe-entry-resources.mjs ORIGIN INVENTORY DIST OUTPUT');
const origin = new URL(originArg).origin;
const inventoryBytes = await fs.readFile(inventoryArg);
const inventory = JSON.parse(inventoryBytes);
const sha = data => createHash('sha256').update(data).digest('hex');
const get = requestPath => new Promise((resolve, reject) => {
  const started = performance.now();
  const url = new URL(requestPath, origin);
  const request = (url.protocol === 'https:' ? https : http).get(url, { headers: { 'Accept-Encoding': 'gzip', 'Cache-Control': 'no-cache' } }, response => {
    const chunks = [];
    response.on('data', bytes => chunks.push(bytes));
    response.on('error', reject);
    response.on('end', () => {
      const wire = Buffer.concat(chunks);
      const encoding = response.headers['content-encoding'] || 'identity';
      const decoded = encoding === 'gzip' ? gunzipSync(wire) : encoding === 'br' ? brotliDecompressSync(wire) : wire;
      resolve({ requestPath, status: response.statusCode, encoding, contentType: response.headers['content-type'],
        cacheControl: response.headers['cache-control'] || null, wireBytes: wire.length, decodedBytes: decoded.length,
        wireSha256: sha(wire), decodedSha256: sha(decoded), elapsedMs: +(performance.now() - started).toFixed(3), decoded });
    });
  });
  request.setTimeout(15000, () => request.destroy(new Error('HTTPS entry resource timeout')));
  request.on('error', reject);
});
const html = await get('/experience');
assert.equal(html.status, 200);
assert.ok(html.decoded.toString().includes('/' + inventory.entry), 'Live HTML must reference this inventory entry');
const mark = html.decoded.toString().includes('/logo-small.webp') ? 'logo-small.webp' : 'logo.png';
const route = inventory.routes['experience-page'];
const files = [...route.javaScript.files.map(file => ({file,group:'javaScript'})),
  ...route.css.files.map(file => ({file,group:'css'})), {file:mark,group:'startupImage'}];
const checks = [];
for (let index = 0; index < files.length; index += 3) {
  const batch = await Promise.all(files.slice(index,index+3).map(async ({file,group}) => {
    const result = await get('/' + file);
    assert.equal(result.status, 200, file);
    assert.equal(result.decodedSha256, sha(await fs.readFile(path.join(distArg, file))), file);
    const {decoded,...record} = result;
    return {...record,group};
  }));
  checks.push(...batch);
}
const totals = Object.fromEntries(['javaScript','css','startupImage'].map(group => [group,{
  resources: checks.filter(row=>row.group===group).length,
  wireBytes: checks.filter(row=>row.group===group).reduce((n,row)=>n+row.wireBytes,0),
  decodedBytes: checks.filter(row=>row.group===group).reduce((n,row)=>n+row.decodedBytes,0),
}]));
const {decoded,...htmlRecord} = html;
const report = { checkedAt:new Date().toISOString(), origin, transport:'Node HTTPS, direct, standard TLS validation, Accept-Encoding: gzip',
  scope:'Wire body bytes for the experience static import closure, CSS and startup image; response headers excluded; no browser latency claim.',
  inventorySha256:sha(inventoryBytes),entry:inventory.entry,html:htmlRecord,totals,checks };
await fs.mkdir(path.dirname(outputArg),{recursive:true});
await fs.writeFile(outputArg,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,entry:inventory.entry,totals}));
