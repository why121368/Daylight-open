import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareManifests, hashObject } from '../scripts/recovery-manifest.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = () => ({ format: 'daylight-recovery-manifest-v1',
  tables: [{ name: '"public"."calendar"', rows: 2, sha256: sha('rows') }],
  sequences: [{ name: '"public"."sequence"', sha256: sha('sequence') }],
  objects: [{ name: 'private/person@example.invalid/resume.pdf', bytes: 5, sha256: sha('hello') }] });

test('recovery proof accepts identical inventories and counts every table row and object byte', () => {
  const proof = compareManifests(fixture(), structuredClone(fixture()));
  assert.equal(proof.ok, true); assert.equal(proof.tables.rows, 2);
  assert.equal(proof.tables.verified, 1); assert.equal(proof.objects.bytes, 5);
  assert.equal(JSON.stringify(proof).includes('person@example.invalid'), false);
});

test('row, sequence and object corruption each fail verification without exposing private names', () => {
  for (const kind of ['tables', 'sequences', 'objects']) {
    const changed = fixture(); changed[kind][0].sha256 = sha('changed');
    const proof = compareManifests(fixture(), changed);
    assert.equal(proof.ok, false); assert.equal(proof[kind].mismatchCount, 1);
    assert.equal(JSON.stringify(proof).includes('person@example.invalid'), false);
  }
});

test('missing and unexpected relations and objects are detected even when counts match', () => {
  for (const kind of ['tables', 'sequences', 'objects']) {
    const changed = fixture(); changed[kind][0].name = 'replacement';
    const proof = compareManifests(fixture(), changed);
    assert.equal(proof.ok, false); assert.equal(proof[kind].mismatchCount, 2);
    assert.equal(proof[kind].verified, 0);
  }
});

test('invalid hashes, counts and duplicate names cannot produce a successful proof', () => {
  for (const change of [m => m.tables.push(m.tables[0]), m => m.objects[0].bytes = -1,
    m => m.tables[0].rows = 1.5, m => m.sequences[0].sha256 = 'not-a-hash']) {
    const invalid = fixture(); change(invalid);
    assert.throws(() => compareManifests(invalid, fixture()), /INVALID_RECOVERY_MANIFEST/);
  }
});

test('object digest covers all chunks and a changed final byte', async () => {
  async function* chunks(last) { yield Buffer.from('first'); yield Buffer.alloc(65537, 42); yield Buffer.from(last); }
  const a = await hashObject(chunks('A')), b = await hashObject(chunks('B'));
  assert.equal(a.bytes, 65543); assert.equal(b.bytes, a.bytes); assert.notEqual(a.sha256, b.sha256);
});
