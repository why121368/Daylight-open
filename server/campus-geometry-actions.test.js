import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from './campus-guide/seed.js';
import { validateCatalog } from '../shared/campus-guide.js';
import { bindEntrancesByDistance, buildStreetViewBatch, findUndergroundVehicleCandidate, inferredRooms, insertRoadWithIntersections, parseStreetViewManifest, placeGroups, projectToSegment, removeIntermediateNode, routeStreetViews, searchParcelFacilities, snapEntranceToWall } from '../shared/campus-geometry-actions.js';

const node = (id, lat, lng, level = 'ground') => ({ id, lat, lng, level, kind: 'junction', isDemo: true });
const edge = (id, from, to, options = {}) => ({ id, from, to, distanceMeters: 100, level: 'ground', kind: 'walkway', walkable: true, closed: false, accessible: true, bidirectional: true, covered: false, isDemo: true, ...options });
const catalog = (nodes, edges, extra = {}) => ({ ...demoCatalog(), nodes, edges, places: [], streetViews: [], events: [], venues: [], menus: [], indoorPlans: [], parcelStations: [], ...extra });
const idFactory = () => { let count = 0; return prefix => `${prefix}-${++count}`; };

test('wall projection respects segment ends and the configured threshold without moving source data', () => {
  const place = { polygons: [{ id: 'wall', points: [{ lat: 31, lng: 121 }, { lat: 31, lng: 121.001 }, { lat: 31.001, lng: 121.001 }] }] };
  const point = { lat: 30.99998, lng: 121.0005 }, snap = snapEntranceToWall(place, point, { maxMeters: 5 });
  assert.equal(snap.snapped, true); assert.equal(snap.lat, 31); assert.ok(snap.distanceMeters > 2 && snap.distanceMeters < 3);
  assert.equal(snapEntranceToWall(place, point, { maxMeters: 1 }).snapped, false);
  assert.equal(projectToSegment({ lat: 31, lng: 120 }, place.polygons[0].points[0], place.polygons[0].points[1]).t, 0);
  assert.equal(point.lat, 30.99998);
});

test('entrance auto-binding is threshold-limited, connected, ground-level, and preserves explicit assignments', () => {
  const input = catalog([node('a', 31, 121), node('b', 31, 121.001), node('isolated', 31, 121.00001), node('basement', 31, 121.00001, 'underground')], [edge('ab', 'a', 'b')], { places: [{ id: 'place', entrances: [{ id: 'near', lat: 31, lng: 121.00001, nodeId: '' }, { id: 'far', lat: 32, lng: 121, nodeId: '' }, { id: 'explicit', lat: 31, lng: 121, nodeId: 'b' }] }] });
  const result = bindEntrancesByDistance(input, { maxMeters: 5 });
  assert.equal(result.bound[0].nodeId, 'a'); assert.equal(result.unmatched.length, 1); assert.deepEqual(result.retained, ['explicit']);
  assert.equal(input.places[0].entrances[0].nodeId, '');
});

test('same-level crossing roads split at a shared junction, preserve lengths and remap street offsets', () => {
  const input = catalog([node('w', 31, 121), node('e', 31, 121.002), node('s', 30.999, 121.001), node('n', 31.001, 121.001)], [edge('horizontal', 'w', 'e', { distanceMeters: 200 })], { streetViews: [{ id: 'scene', edgeId: 'horizontal', offsetMeters: 150, imageUrl: 'https://example.org/a.jpg' }] });
  const result = insertRoadWithIntersections(input, edge('vertical', 's', 'n', { distanceMeters: 300 }), { idFactory: idFactory() });
  assert.equal(result.junctionsAdded, 1); assert.equal(result.catalog.nodes.length, 5); assert.equal(result.catalog.edges.length, 4);
  assert.ok(Math.abs(result.catalog.edges.reduce((sum, row) => sum + row.distanceMeters, 0) - 500) < 0.00001);
  const scene = result.catalog.streetViews[0], containing = result.catalog.edges.find(row => row.id === scene.edgeId);
  assert.notEqual(scene.edgeId, 'horizontal'); assert.ok(Math.abs(scene.offsetMeters - 50) < 0.0001); assert.ok(scene.offsetMeters < containing.distanceMeters);
  assert.equal(input.edges.length, 1);
  const differentLevel = insertRoadWithIntersections(input, edge('underground', 's', 'n', { level: 'underground' }), { idFactory: idFactory() });
  assert.equal(differentLevel.junctionsAdded, 0); assert.equal(differentLevel.catalog.edges.length, 2);
});

test('T junction uses the existing endpoint and does not add a duplicate node', () => {
  const input = catalog([node('w', 31, 121), node('e', 31, 121.002), node('mid', 31, 121.001), node('north', 31.001, 121.001)], [edge('we', 'w', 'e')]);
  const result = insertRoadWithIntersections(input, edge('tn', 'mid', 'north'), { idFactory: idFactory() });
  assert.equal(result.junctionsAdded, 0); assert.equal(result.catalog.edges.length, 3); assert.equal(result.catalog.edges.filter(row => row.from === 'mid' || row.to === 'mid').length, 3);
});

test('road insertion rejects same-floor overlaps and unpublishable tiny pieces while allowing adjacent segments', () => {
  const input = catalog([node('a', 31, 121), node('b', 31, 121.002), node('mid', 31, 121.001), node('end', 31, 121.003), node('s', 30.999, 121.0000001), node('n', 31.001, 121.0000001)], [edge('ab', 'a', 'b')]);
  assert.throws(() => insertRoadWithIntersections(input, edge('overlap', 'mid', 'end')), /重叠/);
  assert.throws(() => insertRoadWithIntersections(input, edge('tiny', 's', 'n'), { snapMeters: 0.001 }), /不足 0.1 米/);
  const adjacent = insertRoadWithIntersections(input, edge('adjacent', 'b', 'end'));
  assert.equal(adjacent.catalog.edges.length, 2);
  assert.equal(input.edges.length, 1);
});

test('deleting a degree-two point preserves direction and distances, but blocks bends and referenced points', () => {
  const input = catalog([node('a', 31, 121), node('mid', 31, 121.001), node('b', 31, 121.002)], [edge('am', 'a', 'mid', { bidirectional: false, distanceMeters: 90 }), edge('mb', 'mid', 'b', { bidirectional: false, distanceMeters: 110 })], { streetViews: [{ id: 'scene', edgeId: 'mb', offsetMeters: 40, imageUrl: 'https://example.org/a.jpg' }] });
  const result = removeIntermediateNode(input, 'mid', { idFactory: idFactory() });
  assert.equal(result.catalog.nodes.length, 2); assert.equal(result.mergedEdge.distanceMeters, 200); assert.equal(result.mergedEdge.bidirectional, false); assert.equal(result.mergedEdge.from, 'a'); assert.equal(result.catalog.streetViews[0].offsetMeters, 130);
  const bend = structuredClone(input); bend.nodes[1].lat += 0.001;
  assert.throws(() => removeIntermediateNode(bend, 'mid'), /转弯/);
  assert.throws(() => removeIntermediateNode({ ...input, places: [{ id: 'p', nodeId: 'mid' }] }, 'mid'), /引用/);
  const opposed = structuredClone(input); opposed.edges[1].from = 'b'; opposed.edges[1].to = 'mid';
  assert.throws(() => removeIntermediateNode(opposed, 'mid'), /单向/);
  const unknown = structuredClone(input); unknown.streetViews[0].offsetMeters = null; unknown.edges[0].sceneImageUrl = 'https://example.org/legacy.jpg';
  assert.ok(removeIntermediateNode(unknown, 'mid').catalog.streetViews.every(scene => scene.offsetMeters === null));
});

test('vehicle candidates only use open underground vehicle edges and obey direction', () => {
  const input = catalog([node('a', 31, 121, 'underground'), node('b', 31, 121.001, 'underground'), node('c', 31, 121.002, 'underground')], [edge('ab', 'a', 'b', { level: 'underground', kind: 'vehicle', walkable: false, bidirectional: false }), edge('bc', 'b', 'c', { level: 'underground', kind: 'vehicle', walkable: false }), edge('shortcut', 'a', 'c', { distanceMeters: 1 })]);
  const route = findUndergroundVehicleCandidate(input, { fromNodeId: 'a', toNodeId: 'c' });
  assert.equal(route.distanceMeters, 200); assert.equal(route.isNavigation, false); assert.deepEqual(route.steps.map(row => row.id), ['ab', 'bc']);
  assert.throws(() => findUndergroundVehicleCandidate(input, { fromNodeId: 'c', toNodeId: 'a' }), /没有连通/);
  input.edges[1].closed = true;
  assert.throws(() => findUndergroundVehicleCandidate(input, { fromNodeId: 'a', toNodeId: 'c' }), /没有连通/);
});

test('filename manifest sorts numeric order and rejects duplicate indexes or credential-bearing URLs', () => {
  const images = parseStreetViewManifest('scene-10.jpg | https://example.org/10.jpg\nscene-2.jpg | https://example.org/2.jpg');
  assert.deepEqual(images.map(row => row.sequence), [2, 10]);
  assert.throws(() => parseStreetViewManifest('a-1.jpg|https://example.org/1\nb-1.jpg|https://example.org/2'), /重复/);
  assert.throws(() => parseStreetViewManifest('a-1.jpg|https://user:secret@example.org/1'), /凭据/);
  assert.throws(() => parseStreetViewManifest('a-51.jpg|https://example.org/1'), /1 至 50/);
  assert.deepEqual(parseStreetViewManifest('10-scene.jpg|https://example.org/10\n02-scene-49.jpg|https://example.org/2').map(row => row.sequence), [2, 10]);
});

test('HTTP street images require an explicit same-origin exact campus media ID without credentials, query or hash', () => {
  const mediaOrigin = 'http://127.0.0.1:3175', id = '10203040-5060-4780-9012-34567890abcd', own = `${mediaOrigin}/api/campus-guide/media/${id}`, manifest = url => `01-scene.jpg|${url}`;
  const options = { mediaOrigin };
  assert.equal(parseStreetViewManifest(manifest(own), options)[0].imageUrl, own);
  for (const bad of [own.replace(':3175', ':3176'), `${mediaOrigin}/api/campus-guide/media/not-a-uuid`, `${own}/extra`, `${own}?size=1`, `${own}#preview`, `${own}?`, `${own}#`, own.replace('127.0.0.1', 'user:secret@127.0.0.1'), `${mediaOrigin}/api/campus-guide/community/images/${id}`, `http://example.org/api/campus-guide/media/${id}`]) assert.throws(() => parseStreetViewManifest(manifest(bad), options));
  assert.throws(() => parseStreetViewManifest(manifest(own)), /HTTPS/);
  assert.throws(() => parseStreetViewManifest(manifest(own), { mediaOrigin: `${mediaOrigin}/not-an-origin` }), /HTTPS/);
  assert.equal(parseStreetViewManifest(manifest(`https://public.example.org/scene.jpg?width=800`), options).length, 1);
  const secureOrigin = 'https://daylight.example.org', secure = `${secureOrigin}/api/campus-guide/media/${id}`;
  assert.equal(parseStreetViewManifest(manifest(secure), { mediaOrigin: secureOrigin })[0].imageUrl, secure);
  assert.throws(() => parseStreetViewManifest(manifest(`${secure}#preview`), { mediaOrigin: secureOrigin }));
  const images = parseStreetViewManifest(manifest(own), options), input = demoCatalog();
  assert.throws(() => buildStreetViewBatch(input, { edgeIds: ['demo-road-1'], images }), /HTTPS/);
  const batch = buildStreetViewBatch(input, { edgeIds: ['demo-road-1'], images, mediaOrigin });
  assert.equal(validateCatalog(batch.catalog).streetViews[0].imageUrl, own);
  assert.throws(() => buildStreetViewBatch(input, { edgeIds: ['demo-road-1'], images: [{ ...images[0], imageUrl: `${own}?download=1` }], mediaOrigin }));
});

test('street views interpolate by recorded road mileage across a connected chain and reimport is idempotent', () => {
  const input = catalog([node('a', 31, 121), node('b', 31, 121.001), node('c', 31.002, 121.001)], [edge('ab', 'a', 'b', { distanceMeters: 100 }), edge('bc', 'b', 'c', { distanceMeters: 300 })]);
  const images = parseStreetViewManifest('s-1.jpg|https://example.org/1.jpg\ns-2.jpg|https://example.org/2.jpg\ns-3.jpg|https://example.org/3.jpg');
  const result = buildStreetViewBatch(input, { edgeIds: ['ab', 'bc'], images, idFactory: idFactory() });
  assert.equal(result.totalMeters, 400); assert.equal(result.generated[1].edgeId, 'bc'); assert.equal(result.generated[1].offsetMeters, 100); assert.ok(Math.abs(result.generated[1].lat - (31 + 0.002 / 3)) < 1e-8);
  assert.equal(buildStreetViewBatch(result.catalog, { edgeIds: ['ab', 'bc'], images }).generated.length, 0);
  assert.throws(() => buildStreetViewBatch(input, { edgeIds: ['ab'], images, startMeters: 101 }), /范围/);
});

test('geometry-generated crossings and filename-linked scenes survive the public catalog schema', () => {
  const crossingInput = catalog([node('w', 31, 121), node('e', 31, 121.002), node('s', 30.999, 121.001), node('n', 31.001, 121.001)], [edge('we', 'w', 'e')]);
  const crossing = insertRoadWithIntersections(crossingInput, edge('sn', 's', 'n'), { idFactory: idFactory() });
  const checked = validateCatalog(crossing.catalog);
  assert.equal(checked.nodes.length, 5); assert.equal(checked.edges.length, 4);
  const input = demoCatalog(), images = parseStreetViewManifest('walk-01.jpg|https://example.org/1.jpg\nwalk-02.jpg|https://example.org/2.jpg');
  const result = buildStreetViewBatch(input, { edgeIds: ['demo-road-1', 'demo-road-4'], images, sourceUrl: 'https://example.org/permission', idFactory: idFactory() });
  const published = validateCatalog(result.catalog);
  assert.equal(published.streetViews[1].sourceFilename, 'walk-02.jpg');
  assert.equal(published.streetViews[1].edgeId, 'demo-road-4');
  assert.equal(published.streetViews[1].offsetMeters, 150);
  assert.equal(published.streetViews[1].lat, input.nodes.find(row => row.id === 'node-demo-library').lat);
  assert.equal(published.streetViews[0].sourceUrl, 'https://example.org/permission');
});

test('route scenes follow edge traversal and mileage, exclude other edges, and retain place-only preview isolation', () => {
  const input = catalog([node('a', 31, 121), node('b', 31, 121.001), node('c', 31.002, 121.001)], [edge('ab', 'a', 'b'), edge('bc', 'b', 'c', { distanceMeters: 300 }), edge('other', 'a', 'c')], {
    places: [{ id: 'p', nodeId: 'b' }], streetViews: [
      { id: 'a25', edgeId: 'ab', offsetMeters: 25, imageUrl: 'https://example.org/25.jpg' },
      { id: 'a75', edgeId: 'ab', offsetMeters: 75, imageUrl: 'https://example.org/75.jpg' },
      { id: 'b100', edgeId: 'bc', offsetMeters: 100, imageUrl: 'https://example.org/b.jpg' },
      { id: 'nodeb', nodeId: 'b', imageUrl: 'https://example.org/node.jpg' },
      { id: 'wrong', edgeId: 'other', placeId: 'p', imageUrl: 'https://example.org/wrong.jpg' },
    ],
  });
  const reverse = { steps: [{ id: 'bc', from: 'c', to: 'b' }, { id: 'ab', from: 'b', to: 'a' }] };
  const scenes = routeStreetViews(input, reverse, 'p');
  assert.deepEqual(scenes.map(row => row.id), ['b100', 'nodeb', 'a75', 'a25']);
  assert.deepEqual(scenes.map(row => row.routeMeters), [200, 300, 325, 375]);
  assert.deepEqual(routeStreetViews(input, null, 'missing'), []);
  assert.deepEqual(routeStreetViews(input, null, 'p').map(row => row.id).sort(), ['nodeb', 'wrong']);
  input.edges[1].sceneImageUrl = 'https://example.org/legacy.jpg';
  const legacy = routeStreetViews(input, reverse).find(scene => scene.imageUrl.endsWith('legacy.jpg'));
  assert.equal(legacy.routeMeters, undefined, 'an old edge image has no measured position');
});

test('room suggestions retain evidence, exclude known rooms and years, and never become surveyed rooms', () => {
  const input = demoCatalog(), placeId = 'demo-teaching'; input.events = [
    { id: 'a', placeId, title: '2026 研究报告', locationText: '教学中心 3楼 305室', start: '', end: '' },
    { id: 'b', placeId, title: '101 教室讨论', locationText: '教学中心 101室', start: '', end: '' },
    { id: 'c', placeId, title: 'hidden 506室', hidden: true },
    { id: 'd', placeId, title: '预算 1000 元，2026 年开放 3000 名额', description: '提供 1500 元资助' },
  ];
  const hints = inferredRooms(input, placeId); assert.equal(hints.length, 1); assert.equal(hints[0].room, '305'); assert.equal(hints[0].floor, '3'); assert.equal(hints[0].inferred, true); assert.equal(hints[0].sourceEventId, 'a');
  assert.equal(input.indoorPlans[0].rooms.some(room => room.number === '305'), false);
  assert.equal(placeGroups([{ id: 'a', groupId: 'g', groupName: '楼群' }, { id: 'b', groupId: 'g' }, { id: 'c' }])[0].places.length, 2);
  assert.equal(searchParcelFacilities({ facilities: [{ id: 'a', name: '智能柜', type: 'locker' }, { id: 'b', name: '前台' }] }, '智能').length, 1);
});
