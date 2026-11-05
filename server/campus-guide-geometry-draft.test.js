import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from './campus-guide/seed.js';
import { discardGeometryDraft, geometryDraftKey, geometryDraftSnapshot, readGeometryDrafts, restoreGeometryDraft, writeGeometryDraft } from '../shared/campus-geometry-draft.js';

const now = new Date('2026-10-23T12:34:56+08:00');
function memoryStorage() {
  const data = new Map(), reads = [];
  return { data, reads, get length() { return data.size; }, key: index => [...data.keys()][index] || null, getItem: key => { reads.push(key); return data.get(key) ?? null; }, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
function changedCatalog() {
  const base = demoCatalog(), draft = structuredClone(base);
  draft.places[0].polygons.push({ id: 'synthetic-outline', points: [{ lat: 31.1736, lng: 121.5894 }, { lat: 31.1736, lng: 121.5896 }, { lat: 31.1738, lng: 121.5895 }] });
  draft.nodes[0].lat += 0.0001; draft.edges[0].covered = !draft.edges[0].covered;
  draft.streetViews.push({ id: 'synthetic-scene', nodeId: draft.nodes[0].id, imageUrl: 'https://synthetic.invalid/scene-01.png', sourceFilename: 'scene-01.png' });
  return { base, draft };
}

test('地图本机草稿：按账号和目录版本隔离，列表不读取其他账号值', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog();
  writeGeometryDraft(storage, 'synthetic:admin-A', base, draft, now);
  writeGeometryDraft(storage, 'synthetic:admin-B', base, draft, now);
  const newer = structuredClone(base); newer.meta.revision = 2;
  const newerDraft = structuredClone(draft); newerDraft.meta.revision = 2;
  writeGeometryDraft(storage, 'synthetic:admin-A', newer, newerDraft, now);
  storage.reads.length = 0;
  assert.deepEqual(readGeometryDrafts(storage, 'synthetic:admin-A').map(record => record.baseRevision), [2, 0]);
  assert.deepEqual(storage.reads.sort(), [geometryDraftKey('synthetic:admin-A', 0), geometryDraftKey('synthetic:admin-A', 2)].sort());
  assert.equal(readGeometryDrafts(storage, 'synthetic:admin-C').length, 0);
  assert.throws(() => readGeometryDrafts(storage, ''), /登录/);
  assert.throws(() => geometryDraftKey('synthetic:admin-A', -1), /版本/);
});

test('地图本机草稿：只持久化几何字段，完整管理员目录与凭据不进入记录', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog();
  base.venues[0].adminNote = draft.venues[0].adminNote = 'synthetic-private-note-marker';
  base.events[0].description = draft.events[0].description = 'synthetic-activity-body-marker';
  draft.authorization = 'synthetic-secret-token-marker'; draft.nodes[0].privateCredential = 'synthetic-private-node-marker';
  const record = writeGeometryDraft(storage, 'synthetic-admin', base, draft, now), raw = storage.getItem(geometryDraftKey('synthetic-admin', 0));
  assert.deepEqual(Object.keys(record.geometry).sort(), ['edges', 'nodes', 'places', 'streetViews']);
  assert.deepEqual(Object.keys(record.geometry.places[0]).sort(), ['entrances', 'id', 'nodeId', 'polygons']);
  assert.doesNotMatch(raw, /private-note-marker|activity-body-marker|secret-token-marker|private-node-marker|authorization|adminNote/);
  const recovered = restoreGeometryDraft(record, 'synthetic-admin', base);
  assert.equal(recovered.venues[0].adminNote, 'synthetic-private-note-marker');
  assert.equal(recovered.events[0].description, 'synthetic-activity-body-marker');
  assert.equal(recovered.authorization, undefined);
  const latestAdminProjection = structuredClone(base); latestAdminProjection.events[0].hidden = true; latestAdminProjection.venues[0].adminNote = 'synthetic-current-admin-note';
  const publishProjection = restoreGeometryDraft(record, 'synthetic-admin', latestAdminProjection);
  assert.equal(publishProjection.events[0].hidden, true); assert.equal(publishProjection.venues[0].adminNote, 'synthetic-current-admin-note');
});

test('地图本机草稿：同版恢复几何且保留基线，可继续修改，写入/恢复不修改输入', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog(), originalBase = structuredClone(base), originalDraft = structuredClone(draft);
  const record = writeGeometryDraft(storage, 'synthetic-admin', base, draft, now);
  assert.equal(record.savedAt, now.toISOString());
  const loaded = readGeometryDrafts(storage, 'synthetic-admin')[0].document, recovered = restoreGeometryDraft(loaded, 'synthetic-admin', base);
  assert.deepEqual(geometryDraftSnapshot(recovered), record.geometry);
  assert.notDeepEqual(geometryDraftSnapshot(recovered), geometryDraftSnapshot(base));
  recovered.nodes[0].lng += 0.0002;
  assert.notEqual(recovered.nodes[0].lng, loaded.geometry.nodes[0].lng);
  assert.deepEqual(base, originalBase); assert.deepEqual(draft, originalDraft);
  assert.equal(recovered.meta.revision, base.meta.revision);
});

test('地图本机草稿：旧版本和错账号不可恢复，地点不一致不会自动重定版本', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog(), record = writeGeometryDraft(storage, 'synthetic-admin', base, draft, now);
  const latest = structuredClone(base); latest.meta.revision = 1;
  assert.throws(() => restoreGeometryDraft(record, 'synthetic-admin', latest), /版本已经改变/);
  assert.throws(() => restoreGeometryDraft(record, 'other-admin', base), /不属于当前账号/);
  const mismatched = structuredClone(record); mismatched.geometry.places.pop();
  assert.throws(() => restoreGeometryDraft(mismatched, 'synthetic-admin', base), /地点与当前目录不一致/);
  const wrongVersion = structuredClone(draft); wrongVersion.meta.revision = 9;
  assert.throws(() => writeGeometryDraft(storage, 'synthetic-admin', base, wrongVersion, now), /版本不一致/);
  assert.equal(storage.length, 1); assert.equal(readGeometryDrafts(storage, 'synthetic-admin')[0].baseRevision, 0);
});

test('地图本机草稿：损坏/错账号记录仅显示安全错误，可按当前账号丢弃', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog(), record = writeGeometryDraft(storage, 'admin-A', base, draft, now);
  storage.setItem(geometryDraftKey('admin-A', 0), '{invalid json');
  storage.setItem(geometryDraftKey('admin-A', 1), JSON.stringify({ ...record, baseRevision: 1, ownerId: 'admin-B', secret: 'synthetic-hidden-record' }));
  storage.setItem(geometryDraftKey('admin-B', 0), JSON.stringify({ ...record, ownerId: 'admin-B' }));
  const rows = readGeometryDrafts(storage, 'admin-A');
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.error && row.document === null && !row.savedAt));
  assert.doesNotMatch(JSON.stringify(rows), /synthetic-hidden-record|admin-B/);
  discardGeometryDraft(storage, 'admin-A', 1);
  assert.equal(storage.getItem(geometryDraftKey('admin-A', 1)), null);
  assert.notEqual(storage.getItem(geometryDraftKey('admin-B', 0)), null);
});

test('地图本机草稿：额度/禁用存储报错，保留之前记录且无静默成功', () => {
  const storage = memoryStorage(), { base, draft } = changedCatalog();
  writeGeometryDraft(storage, 'synthetic-admin', base, draft, now);
  const original = storage.getItem(geometryDraftKey('synthetic-admin', 0));
  storage.setItem = () => { throw Object.assign(Error('synthetic quota detail'), { name: 'QuotaExceededError' }); };
  assert.throws(() => writeGeometryDraft(storage, 'synthetic-admin', base, draft, now), /尚未保存在本机/);
  assert.equal(storage.getItem(geometryDraftKey('synthetic-admin', 0)), original);
  assert.throws(() => readGeometryDrafts({ get length() { throw Error('synthetic denied'); } }, 'synthetic-admin'), /禁止读取本机草稿/);
  assert.throws(() => discardGeometryDraft({ removeItem() { throw Error('synthetic denied'); } }, 'synthetic-admin', 0), /未能清理/);
});
