import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { emptyCatalog, validateCatalog, withoutDemo } from '../shared/campus-guide.js';
import { geometryBounds, geometryProjection, inspectPolygon, diagnoseCampusNetwork } from '../shared/campus-geometry.js';
import { demoCatalog } from './campus-guide/seed.js';
import { createCampusGuideRouter } from './campus-guide/routes.js';
import { createGuideRepository, CATALOG_KEY, ACTIVITY_KEY, COMMUNITY_KEY, SOURCES_KEY } from './campus-guide/repository.js';
import { campusAdminStats } from './campus-guide/geometry.js';

// Only synthetic catalogs and private work/ directories are used. No user data or
// external mailbox, model, database, map or image provider is called.
const now = new Date('2026-10-26T18:30:00+08:00');
function networkCatalog() {
  const catalog = emptyCatalog();
  catalog.nodes = [
    { id: 'a', lat: 31.176, lng: 121.590 },
    { id: 'b', lat: 31.176, lng: 121.591 },
    { id: 'c', lat: 31.17605, lng: 121.591 },
    { id: 'd', lat: 31.179, lng: 121.595 },
    { id: 'underground', lat: 31.176, lng: 121.590, level: 'underground' },
  ];
  catalog.edges = [
    { id: 'ab', from: 'a', to: 'b', distanceMeters: 100 },
    { id: 'bd-closed', from: 'b', to: 'd', distanceMeters: 1000, closed: true },
    { id: 'bc-vehicle', from: 'b', to: 'c', distanceMeters: 6, kind: 'vehicle' },
  ];
  catalog.places = [
    { id: 'library', name: '合成图书馆', category: 'service', lat: 31.176, lng: 121.590, nodeId: 'a' },
    { id: 'isolated', name: '合成孤立地点', category: 'service', lat: 31.17605, lng: 121.591, nodeId: 'c' },
    { id: 'unmapped', name: '尚未测绘地点', category: 'service', lat: 31.179, lng: 121.595 },
  ];
  return validateCatalog(catalog);
}

test('校园几何目录：兼容旧资料、道路默认值、入口引用校验与清示例保持自有节点', () => {
  const old = demoCatalog();
  for (const place of old.places) { delete place.polygons; delete place.entrances; }
  for (const node of old.nodes) delete node.kind;
  for (const edge of old.edges) { delete edge.kind; delete edge.walkable; delete edge.closed; }
  const checked = validateCatalog(old);
  assert.deepEqual(checked.places[0].polygons, []);
  assert.deepEqual(checked.places[0].entrances, []);
  assert.equal(checked.nodes[0].kind, 'junction');
  assert.equal(checked.edges[0].kind, 'walkway');
  assert.equal(checked.edges[0].walkable, true);
  assert.equal(checked.edges[0].closed, false);
  checked.edges[0].kind = 'stairs'; delete checked.edges[0].accessible;
  checked.edges[1].kind = 'vehicle'; delete checked.edges[1].walkable;
  const defaults = validateCatalog(checked);
  assert.equal(defaults.edges[0].accessible, false);
  assert.equal(defaults.edges[1].walkable, false);
  checked.places[0].entrances = [{ id: 'missing-entry', name: '主入口', lat: 31.17, lng: 121.59, nodeId: 'missing' }];
  assert.throws(() => validateCatalog(checked), /入口节点不存在/);
  checked.places[0].entrances[0].nodeId = '';
  checked.places[0].polygons = [{ id: 'invalid-outline', points: [{ lat: 31, lng: 121 }, { lat: 31.1, lng: 121 }] }];
  assert.throws(() => validateCatalog(checked), /至少需要三个点/);
  checked.places[0].polygons[0].points.push(null);
  assert.throws(() => validateCatalog(checked), error => error.status === 400 && /坐标/.test(error.message));
  const demo = demoCatalog();
  demo.nodes.push({ id: 'custom-node', lat: 31.18, lng: 121.60, isDemo: false });
  demo.places.push({ ...demo.places[1], id: 'custom-building', isDemo: false, nodeId: 'custom-node' });
  const clean = withoutDemo(demo);
  assert.deepEqual(clean.nodes.map(node => node.id), ['custom-node']);
  assert.equal(clean.places[0].nodeId, 'custom-node');
  assert.equal(clean.places[0].entrances[0].nodeId, '');
});

test('校园几何投影：包括轮廓与入口的边界、经纬度往返稳定，无图时可编辑', () => {
  const catalog = networkCatalog();
  catalog.places[0].polygons = [{ id: 'outline', points: [{ lat: 31.17, lng: 121.58 }, { lat: 31.17, lng: 121.60 }, { lat: 31.18, lng: 121.60 }] }];
  catalog.places[0].entrances = [{ id: 'entry', lat: 31.19, lng: 121.61 }];
  const bounds = geometryBounds(catalog), projection = geometryProjection(bounds);
  assert.ok(bounds.minLng < 121.58 && bounds.maxLng > 121.61 && bounds.maxLat > 31.19);
  for (const point of [...catalog.nodes, { lat: 31.1712345, lng: 121.5898765 }]) {
    const pixel = projection.project(point), roundtrip = projection.unproject(pixel);
    assert.ok(pixel.x >= 24 && pixel.x <= 976 && pixel.y >= 24 && pixel.y <= 576);
    assert.ok(Math.abs(point.lat - roundtrip.lat) < 1e-7);
    assert.ok(Math.abs(point.lng - roundtrip.lng) < 1e-7);
  }
  assert.ok(Number.isFinite(geometryProjection(geometryBounds(emptyCatalog())).project({ lat: 31.176, lng: 121.59 }).x));
});

test('校园建筑轮廓诊断：退化、共线、小尺度自相交与闭合环，不修改输入', () => {
  const square = [{ lat: 31.176, lng: 121.590 }, { lat: 31.176, lng: 121.59005 }, { lat: 31.17605, lng: 121.59005 }, { lat: 31.17605, lng: 121.590 }];
  const snapshot = structuredClone(square);
  assert.deepEqual(inspectPolygon(square), []);
  assert.deepEqual(inspectPolygon([...square, square[0]]), []);
  assert.ok(inspectPolygon([square[0], square[0], square[1]]).some(issue => issue.kind === 'degenerate'));
  assert.ok(inspectPolygon([{ lat: 31, lng: 121 }, { lat: 31.01, lng: 121.01 }, { lat: 31.02, lng: 121.02 }]).some(issue => issue.kind === 'zero_area'));
  assert.ok(inspectPolygon([square[0], square[2], square[1], square[3]]).some(issue => issue.kind === 'self_intersection'));
  assert.deepEqual(square, snapshot);
});

test('校园路网诊断：隔离/断点线索、不同层不误连、封闭与车行排除，绝不自动补路', () => {
  const catalog = networkCatalog(), before = structuredClone(catalog), result = diagnoseCampusNetwork(catalog);
  assert.equal(result.summary.connectedComponents, 4);
  assert.equal(result.summary.walkableEdges, 1);
  assert.equal(result.summary.closedEdges, 1);
  assert.deepEqual(result.deadEndNodeIds.sort(), ['a', 'b']);
  assert.deepEqual(result.isolatedNodeIds.sort(), ['c', 'd', 'underground']);
  assert.deepEqual(result.components.find(component => component.nodeIds.includes('a')).placeIds, ['library']);
  assert.ok(result.nearMisses.some(pair => [pair.from, pair.to].sort().join(',') === 'b,c'));
  assert.equal(result.nearMisses.some(pair => pair.from === 'underground' || pair.to === 'underground'), false);
  assert.deepEqual(result.unconnectedPlaces.map(place => place.id).sort(), ['isolated', 'unmapped']);
  assert.deepEqual(catalog, before);
});

test('校园路网诊断：楼梯无障碍、重复道路、明显短于直线的长度可解释', () => {
  const catalog = networkCatalog();
  catalog.edges.push({ ...catalog.edges[0], id: 'duplicate', distanceMeters: 1 }, { id: 'bc-stairs', from: 'b', to: 'c', distanceMeters: 6, kind: 'stairs', accessible: true });
  const result = diagnoseCampusNetwork(catalog);
  assert.equal(result.summary.connectedComponents, 3);
  assert.equal(result.accessible.connectedComponents, 4);
  assert.ok(result.edgeIssues.some(issue => issue.edgeId === 'duplicate' && issue.kind === 'duplicate_link'));
  assert.ok(result.edgeIssues.some(issue => issue.edgeId === 'duplicate' && issue.kind === 'distance_shorter_than_straight_line'));
  assert.ok(result.edgeIssues.some(issue => issue.edgeId === 'bc-stairs' && issue.kind === 'stairs_accessible'));
});

test('校园路网诊断：密集节点比较有预算并标记截断，仍不改变原始数据', () => {
  const catalog = emptyCatalog();
  catalog.nodes = Array.from({ length: 730 }, (_, index) => ({ id: `dense-${index}`, lat: 31.176, lng: 121.590, level: 'ground' }));
  const result = diagnoseCampusNetwork(catalog, { maxIssues: 7 });
  assert.equal(result.truncated, true);
  assert.equal(result.nearMisses.length, 7);
  assert.equal(result.summary.connectedComponents, 730);
  assert.equal(catalog.edges.length, 0);
});

async function fixture(t) {
  await fs.mkdir('work', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('work/campus-geometry-')), repository = createGuideRepository({ dataDir: directory, pgRequired: false, pool: null });
  const users = { user: { id: 'synthetic-user', role: 'user' }, admin: { id: 'synthetic-admin', role: 'admin' } }, app = express();
  app.use('/api/campus-guide', createCampusGuideRouter({ repository, resolveUser: async header => users[header?.replace('Bearer ', '')] || null, adminUser: user => user?.role === 'admin', now: () => now, readOperations: async () => ({ generatedAt: now.toISOString(), scope: 'synthetic-test' }) }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { repository, async call(route, user) { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/campus-guide${route}`, { headers: user ? { Authorization: `Bearer ${user}` } : {} }); return { status: response.status, body: await response.json() }; } };
}

test('校园维护API：诊断/概览管理员门禁，统计只输出聚合、无私密正文身份密钥', async t => {
  const { repository, call } = await fixture(t);
  await repository.mutate(CATALOG_KEY, catalog => { catalog.events[0].hidden = true; catalog.events[1].pinned = true; });
  await repository.mutate(ACTIVITY_KEY, state => { state.feedback.push({ userId: 'secret-user-id', message: 'secret-feedback-body', status: 'open' }); state.menuReports.push({ menuId: 'demo-menu-rice', userId: 'secret-user-id', rating: 5 }); state.checkinCodes.secret = { hash: 'secret-checkin-hash', salt: 'secret-checkin-salt' }; state.checkinCount = 3; });
  await repository.mutate(COMMUNITY_KEY, state => { state.posts.push({ id: 'private-post-id', userId: 'secret-user-id', body: 'secret-community-body', status: 'published' }); state.comments.push({ body: 'secret-comment-body', status: 'published' }); state.reactions.push({ userId: 'secret-user-id', like: true, bookmark: true }); });
  await repository.mutate(SOURCES_KEY, state => { state.sources.push({ id: 'secret-source-id', url: 'https://secret-source.example.invalid/feed', enabled: true, lastError: 'secret-source-error', runningUntil: '2026-10-26T19:00:00+08:00', lastSuccessAt: '2026-10-25T12:00:00Z' }); state.drafts.push({ emailBody: 'secret-email-body', status: 'pending' }); });
  for (const route of ['/admin/stats', '/admin/diagnostics']) { assert.equal((await call(route)).status, 401); assert.equal((await call(route, 'user')).status, 403); assert.equal((await call(route, 'admin')).status, 200); }
  const stats = (await call('/admin/stats', 'admin')).body, serialized = JSON.stringify(stats);
  assert.equal(stats.storage.mode, 'local'); assert.equal(stats.storage.shared, false);
  assert.equal(stats.catalog.hiddenEvents, 1); assert.equal(stats.catalog.pinnedEvents, 1);
  assert.equal(stats.engagement.posts, 1); assert.equal(stats.engagement.likes, 1); assert.equal(stats.engagement.bookmarks, 1); assert.equal(stats.engagement.checkins, 3); assert.equal(stats.engagement.menuRatings, 1); assert.equal(stats.engagement.feedbackOpen, 1);
  assert.equal(stats.sources.failedSources, 1); assert.equal(stats.sources.pendingDrafts, 1); assert.equal(stats.sources.running, 1);
  assert.equal(serialized.includes('secret-'), false); assert.equal(serialized.includes('private-post-id'), false); assert.equal(serialized.includes('example.invalid'), false);
  const diagnostics = (await call('/admin/diagnostics', 'admin')).body;
  assert.equal(diagnostics.summary.nodes, demoCatalog().nodes.length);
  assert.match(diagnostics.notice, /不会自动补路/);
  assert.equal((await repository.read(CATALOG_KEY)).version, 1);
});

test('校园统计存储模式：来自实际仓库依赖，聚合函数支持共享存储', async () => {
  const local = createGuideRepository({ dataDir: path.resolve('work/campus-geometry-mode'), pool: null, pgRequired: false });
  assert.deepEqual(local.storageStatus(), { mode: 'local', shared: false });
  assert.deepEqual(createGuideRepository({ pool: {}, pgRequired: true }).storageStatus(), { mode: 'postgres', shared: true });
  assert.throws(() => createGuideRepository({ pool: null, pgRequired: true }).storageStatus(), error => error.status === 503);
  const catalog = demoCatalog(), activity = (await local.read(ACTIVITY_KEY)).payload, community = (await local.read(COMMUNITY_KEY)).payload, sources = (await local.read(SOURCES_KEY)).payload;
  assert.deepEqual(campusAdminStats({ catalog, activity, community, sources, shared: true, now }).storage, { mode: 'postgres', shared: true });
});
