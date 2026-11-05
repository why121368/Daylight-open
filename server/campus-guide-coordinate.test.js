import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from './campus-guide/seed.js';
import { findRoute } from '../shared/campus-guide.js';

test('coordinates join a nearby road entry without drawing an unverified straight-line path', () => {
  const catalog = demoCatalog(), start = { lat: 31.1738, lng: 121.5895, name: '地图选点', privateData: 'discard-me' };
  const route = findRoute(catalog, { from: start, to: 'demo-library' });
  assert.deepEqual(route.from, { lat: start.lat, lng: start.lng, name: start.name });
  assert.equal(JSON.stringify(route).includes('discard-me'), false);
  assert.equal(route.points[0].nodeId, 'node-demo-gate');
  assert.notEqual(route.points[0].lat, start.lat);
  assert.equal(route.accessConnections[0].verified, false);
  assert.equal(route.steps[0].kind, 'access');
  assert.match(route.accessNotice, /接驳下限/);
  assert.equal(route.networkDistanceMeters, 310);
  assert.ok(route.distanceMeters > route.networkDistanceMeters);
});

test('coordinate endpoints cannot snap to distant, isolated, or underground-only nodes', () => {
  const catalog = demoCatalog();
  assert.throws(() => findRoute(catalog, { from: { lat: 31, lng: 121 }, to: 'demo-library' }), error => error.code === 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
  const undergroundOnly = structuredClone(catalog); undergroundOnly.nodes.forEach(node => node.level = 'underground');
  assert.throws(() => findRoute(undergroundOnly, { from: { lat: 31.175, lng: 121.5896 }, to: 'demo-library' }), error => error.code === 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
  const isolated = structuredClone(catalog); isolated.edges = [];
  assert.throws(() => findRoute(isolated, { from: { lat: 31.175, lng: 121.5896 }, to: 'demo-library' }), error => error.code === 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
});

test('coordinate routing honors directed edges, accessibility, and mode when choosing entries', () => {
  const catalog = demoCatalog(), point = { lat: 31.175, lng: 121.5896, name: '地面入口' };
  const underground = findRoute(catalog, { from: point, to: 'demo-library', mode: 'underground' });
  assert.equal(underground.points[0].nodeId, 'node-demo-teaching');
  assert.equal(underground.steps.filter(step => step.kind !== 'access').every(step => step.level === 'underground'), true);
  assert.throws(() => findRoute(catalog, { from: point, to: 'demo-library', mode: 'underground', accessible: true }), error => error.code === 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
  const directed = { ...catalog, nodes: [{ id: 'a', lat: 31, lng: 121, level: 'ground' }, { id: 'b', lat: 31, lng: 121.001, level: 'ground' }], edges: [{ id: 'one-way', from: 'a', to: 'b', distanceMeters: 100, level: 'ground', accessible: true, bidirectional: false, covered: false }] };
  const route = findRoute(directed, { from: { lat: 31, lng: 121.001 }, to: { lat: 31, lng: 121 } });
  assert.equal(route.accessConnections[0].nodeId, 'a');
  assert.equal(route.accessConnections[1].nodeId, 'b');
  assert.equal(route.networkDistanceMeters, 100);
});

test('invalid coordinate inputs fail validation and saved-place routes keep the original API', () => {
  const catalog = demoCatalog();
  for (const from of [{ lat: NaN, lng: 121 }, { lat: 100, lng: 121 }, { lat: '31', lng: 121 }, { lat: 31, lng: null }, []]) assert.throws(() => findRoute(catalog, { from, to: 'demo-library' }), error => error.status === 400);
  const placeRoute = findRoute(catalog, { from: 'demo-teaching', to: 'demo-library' });
  assert.equal(placeRoute.from, 'demo-teaching'); assert.equal(placeRoute.to, 'demo-library');
  assert.equal(placeRoute.distanceMeters, 150); assert.deepEqual(placeRoute.accessConnections, []);
  assert.equal(findRoute(catalog, { from: 'demo-gate', to: 'demo-gate' }).distanceMeters, 0);
});

test('routing and coordinate entry selection exclude closed roads, vehicle-only roads, and inaccessible stairs', () => {
  const catalog = {
    meta: {},
    places: [{ id: 'origin', name: '起点', nodeId: 'a', lat: 31, lng: 121 }, { id: 'destination', name: '终点', nodeId: 'b', lat: 31, lng: 121.001 }],
    nodes: [{ id: 'a', lat: 31, lng: 121, level: 'ground' }, { id: 'b', lat: 31, lng: 121.001, level: 'ground' }, { id: 'c', lat: 31.001, lng: 121.0005, level: 'ground' }],
    edges: [
      { id: 'closed', from: 'a', to: 'b', distanceMeters: 5, closed: true, accessible: true, bidirectional: true },
      { id: 'vehicle', from: 'a', to: 'b', distanceMeters: 7, kind: 'vehicle', accessible: true, bidirectional: true },
      { id: 'nonwalkable', from: 'a', to: 'b', distanceMeters: 9, walkable: false, accessible: true, bidirectional: true },
      { id: 'stairs', from: 'a', to: 'b', distanceMeters: 20, kind: 'stairs', accessible: true, bidirectional: true },
      { id: 'ramp-a', from: 'a', to: 'c', distanceMeters: 80, kind: 'ramp', walkable: true, accessible: true, bidirectional: true },
      { id: 'ramp-b', from: 'c', to: 'b', distanceMeters: 80, kind: 'ramp', walkable: true, accessible: true, bidirectional: true },
    ],
  };
  assert.deepEqual(findRoute(catalog, { from: 'origin', to: 'destination' }).steps.map(step => step.id), ['stairs']);
  assert.deepEqual(findRoute(catalog, { from: 'origin', to: 'destination', accessible: true }).steps.map(step => step.id), ['ramp-a', 'ramp-b']);
  catalog.edges = catalog.edges.filter(edge => ['closed', 'vehicle', 'nonwalkable'].includes(edge.id));
  assert.throws(() => findRoute(catalog, { from: 'origin', to: 'destination' }), error => error.code === 'CAMPUS_GUIDE_ROUTE_UNREACHABLE');
  assert.throws(() => findRoute(catalog, { from: { lat: 31, lng: 121 }, to: 'destination' }), error => error.code === 'CAMPUS_GUIDE_COORDINATE_OUTSIDE_NETWORK');
});
