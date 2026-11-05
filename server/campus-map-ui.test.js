import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_CATEGORIES, clusterMapMarkers, findParcelShelf, layoutMapLabels, mapCoordinate, mapLabelText, mapProjection, routePlaybackPoint } from '../shared/campus-map-ui.js';
import { PLACE_CATEGORIES } from '../shared/campus-guide.js';

test('every public place category remains visible through the default map category controls', () => {
  assert.deepEqual(MAP_CATEGORIES.map(row => row.id).sort(), PLACE_CATEGORIES.map(row => row.id).sort());
});

const station = { shelves: [
  { id: 'shelf-15', label: '15 号货架', prefixes: ['15'], levels: 5 },
  { id: 'shelf-16', label: '16 号货架', aliases: ['十六号架'], prefixes: ['16'], levels: 4 },
] };

test('parcel code matches a configured shelf and level without retaining the full code', () => {
  const match = findParcelShelf(station, '１５－３－２０４５');
  assert.equal(match.status, 'found');
  assert.equal(match.matches[0].id, 'shelf-15');
  assert.equal(match.level, 3);
  assert.equal(JSON.stringify(match).includes('2045'), false);
  assert.equal(findParcelShelf(station, '十六号架').matches[0].id, 'shelf-16');
});

test('parcel lookup rejects absent shelves and flags invalid levels without inventing a result', () => {
  assert.equal(findParcelShelf(station, '99-3-2045').status, 'missing');
  assert.equal(findParcelShelf(station, '16-8-2045').status, 'invalid-level');
  assert.equal(findParcelShelf(station, '16-0-2045').status, 'invalid-level');
  assert.equal(findParcelShelf(station, '').status, 'empty');
  assert.equal(findParcelShelf(station, 'x'.repeat(101)).status, 'invalid');
});

test('ambiguous parcel prefixes require a user choice', () => {
  const result = findParcelShelf({ shelves: [...station.shelves, { id: 'other-15', label: '另一组 15', prefixes: ['15'], levels: 5 }] }, '15-3-2045');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matches.length, 2);
});

test('route simulation advances by traveled distance rather than node index', () => {
  const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.004 }];
  const half = routePlaybackPoint(points, 0.5);
  assert.ok(Math.abs(half.lng - 0.002) < 0.00000001);
  assert.deepEqual(routePlaybackPoint(points, -2), points[0]);
  assert.deepEqual(routePlaybackPoint(points, 2), points.at(-1));
  assert.equal(routePlaybackPoint([], 0.5), null);
});

test('coordinate projection accepts zero and rejects invalid coordinates', () => {
  assert.deepEqual(mapCoordinate({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  assert.equal(mapCoordinate({ lat: null, lng: 1 }), null);
  assert.equal(mapCoordinate({ lat: 91, lng: 1 }), null);
  const project = mapProjection([{ lat: 31.1, lng: 121.1 }, { lat: 31.2, lng: 121.2 }]);
  const southWest = project({ lat: 31.1, lng: 121.1 }), northEast = project({ lat: 31.2, lng: 121.2 });
  assert.ok(southWest.x < northEast.x && southWest.y > northEast.y);
  assert.ok(southWest.x >= 0 && northEast.x <= 1000 && northEast.y >= 0 && southWest.y <= 700);
  assert.deepEqual(project.invert(southWest), { lat: 31.1, lng: 121.1 });
  assert.deepEqual(project.invert(northEast), { lat: 31.2, lng: 121.2 });
  assert.equal(project.invert({ x: NaN, y: 0 }), null);
});

test('nearby markers keep all members and use the selected place as a stable anchor', () => {
  const items = [
    { id: 'ordinary', x: 100, y: 100 }, { id: 'selected', x: 102, y: 100, selected: true },
    { id: 'same-position', x: 102, y: 100 }, { id: 'far', x: 240, y: 100 },
  ];
  const snapshot = structuredClone(items), clusters = clusterMapMarkers(items);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].id, 'selected');
  assert.equal(clusters[0].members.length, 3);
  assert.deepEqual(clusters.flatMap(item => item.members.map(member => member.id)).sort(), items.map(item => item.id).sort());
  assert.deepEqual(clusterMapMarkers(items.toReversed()), clusters);
  assert.deepEqual(items, snapshot);
});

test('zooming separates nearby markers without losing coincident places', () => {
  const items = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 0 }, { id: 'd', x: 40, y: 0 }, { id: 'e', x: 60, y: 0 }];
  const overview = clusterMapMarkers(items), detail = clusterMapMarkers(items.map(item => ({ ...item, x: item.x * 4 })));
  assert.ok(overview.length > 1, 'a chain of neighbours must not merge the whole region');
  assert.ok(detail.length > overview.length);
  assert.equal(detail.find(item => item.id === 'b').members.length, 2);
});

const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
test('gate overview labels omit the repeated campus name while selection retains the full address', () => {
  const item = { name: '上海科技大学东门(中科路1号)', category: 'gate' };
  assert.equal(mapLabelText(item), '东门');
  assert.equal(mapLabelText({ ...item, selected: true }), item.name);
  assert.equal(mapLabelText({ name: 'KFC', category: 'dining' }), 'KFC');
});
test('smart labels avoid one another, markers, map controls and viewport edges', () => {
  const items = Array.from({ length: 35 }, (_, i) => ({ id: String(i), x: 55 + (i % 7) * 65, y: 50 + Math.floor(i / 7) * 65, labelWidth: 98, labelHeight: 22, radius: 12 }));
  const controls = { left: 442, top: 0, right: 500, bottom: 265 };
  const labels = layoutMapLabels(items, { width: 500, height: 400, zoom: 18, reserved: [controls] });
  assert.ok(labels.length > 2 && labels.length < items.length);
  for (const [i, label] of labels.entries()) {
    assert.ok(label.left >= 8 && label.right <= 492 && label.top >= 8 && label.bottom <= 392);
    assert.ok(!overlap(label, controls));
    for (const other of labels.slice(i + 1)) assert.ok(!overlap(label, other));
    for (const item of items) assert.ok(!overlap(label, { left: item.x - 12, right: item.x + 12, top: item.y - 12, bottom: item.y + 12 }));
  }
});

test('label budgets increase on zoom while selection and events get priority', () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ id: String(i), x: 50 + (i % 6) * 110, y: 45 + Math.floor(i / 6) * 100, labelWidth: 65 }));
  const overview = layoutMapLabels(items, { width: 700, height: 450, zoom: 16 });
  const detail = layoutMapLabels(items, { width: 700, height: 450, zoom: 19 });
  assert.ok(detail.length > overview.length);
  const crowded = [{ id: 'ordinary', x: 100, y: 100, labelWidth: 100 }, { id: 'event', x: 180, y: 100, labelWidth: 100, eventCount: 2 }, { id: 'selected', x: 250, y: 200, labelWidth: 200, labelHeight: 38, selected: true }];
  const labels = layoutMapLabels(crowded, { width: 340, height: 300, zoom: 16 });
  assert.deepEqual(labels.map(item => item.id), ['selected', 'event']);
  assert.deepEqual(layoutMapLabels(crowded, { width: 340, height: 300, enabled: false }).map(item => item.id), ['selected']);
  assert.deepEqual(layoutMapLabels(crowded, { width: 0, height: 0 }), []);
});
