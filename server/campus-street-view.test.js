import test from 'node:test';
import assert from 'node:assert/strict';
import { routeStreetViews } from '../shared/campus-geometry-actions.js';
import { streetViewMileage, streetViewPosition, streetViewRoutePoints } from '../shared/campus-street-view.js';

const catalog = {
  nodes: [{ id: 'a', lat: 31, lng: 121 }, { id: 'b', lat: 31, lng: 121.002 }],
  edges: [{ id: 'ab', from: 'a', to: 'b', distanceMeters: 200 }],
  places: [{ id: 'building', nodeId: 'b' }],
  streetViews: [{ id: 'first', edgeId: 'ab', offsetMeters: 50 }, { id: 'second', edgeId: 'ab', offsetMeters: 150 }],
};

test('switching ordered street photos changes map point and direction-aware mileage', () => {
  const forward = routeStreetViews(catalog, { steps: [{ id: 'ab', from: 'a', to: 'b' }] });
  const reverse = routeStreetViews(catalog, { steps: [{ id: 'ab', from: 'b', to: 'a' }] });
  assert.deepEqual(forward.map(row => row.id), ['first', 'second']);
  assert.deepEqual(reverse.map(row => row.id), ['second', 'first']);
  assert.equal(streetViewPosition(catalog, forward[0]).point.lng, 121.0005);
  assert.equal(streetViewPosition(catalog, forward[1]).point.lng, 121.0015);
  assert.deepEqual(streetViewPosition(catalog, forward[0]), streetViewPosition(catalog, reverse[1]));
  assert.equal(streetViewMileage(reverse[1]).remainingMeters, 50);
});

test('unknown photo locations are not invented from place association or route mileage', () => {
  assert.equal(streetViewPosition(catalog, { placeId: 'building' }), null);
  assert.equal(streetViewPosition(catalog, { edgeId: 'ab', routeMeters: 100, routeTotalMeters: 200 }), null);
  assert.equal(streetViewPosition(catalog, { edgeId: 'ab', offsetMeters: null }), null);
  assert.equal(streetViewPosition(catalog, { lat: null, lng: null }), null);
});

test('recorded coordinates and explicit nodes are supported, including zero coordinates', () => {
  assert.deepEqual(streetViewPosition(catalog, { lat: 0, lng: 0, edgeId: 'ab', offsetMeters: 100 }), { point: { lat: 0, lng: 0 }, basis: 'coordinate' });
  assert.deepEqual(streetViewPosition(catalog, { nodeId: 'b' }), { point: { lat: 31, lng: 121.002 }, basis: 'node' });
  assert.equal(streetViewPosition(catalog, { nodeId: 'missing' }), null);
});

test('last photo before the end retains remaining mileage and makes no arrival assertion', () => {
  const scenes = routeStreetViews(catalog, { steps: [{ id: 'ab', from: 'a', to: 'b' }] });
  assert.deepEqual(streetViewMileage(scenes.at(-1)), { meters: 150, totalMeters: 200, remainingMeters: 50 });
  assert.equal(streetViewMileage({ routeMeters: 0, routeTotalMeters: 0 }), null);
  assert.equal(streetViewMileage({ routeMeters: undefined, routeTotalMeters: 200 }), null);
});

test('route overview follows ordered nodes and honors recorded route geometry', () => {
  assert.deepEqual(streetViewRoutePoints(catalog, { steps: [{ id: 'ab', from: 'b', to: 'a' }] }), [{ lat: 31, lng: 121.002 }, { lat: 31, lng: 121 }]);
  assert.deepEqual(streetViewRoutePoints(catalog, { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] }), [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]);
  assert.deepEqual(streetViewRoutePoints(catalog, null), []);
});
