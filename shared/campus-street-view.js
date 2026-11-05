import { mapCoordinate } from './campus-map-ui.js';

/** A photo has a map point only when its own coordinate, edge mileage, or node is recorded. */
export function streetViewPosition(catalog, scene) {
  if (!scene) return null;
  const recorded = mapCoordinate(scene);
  if (recorded) return { point: recorded, basis: 'coordinate' };
  if (scene.edgeId && Number.isFinite(scene.offsetMeters)) {
    const edge = (catalog?.edges || []).find(row => row.id === scene.edgeId);
    const from = mapCoordinate((catalog?.nodes || []).find(row => row.id === edge?.from));
    const to = mapCoordinate((catalog?.nodes || []).find(row => row.id === edge?.to));
    if (from && to && Number.isFinite(edge?.distanceMeters) && edge.distanceMeters > 0) {
      const ratio = Math.max(0, Math.min(1, scene.offsetMeters / edge.distanceMeters));
      return { point: { lat: from.lat + (to.lat - from.lat) * ratio, lng: from.lng + (to.lng - from.lng) * ratio }, basis: 'edge' };
    }
  }
  const node = scene.nodeId && mapCoordinate((catalog?.nodes || []).find(row => row.id === scene.nodeId));
  return node ? { point: node, basis: 'node' } : null;
}

/** Recorded route mileage describes the picture, never a user's live position or arrival. */
export function streetViewMileage(scene) {
  if (!Number.isFinite(scene?.routeMeters) || !Number.isFinite(scene?.routeTotalMeters) || scene.routeTotalMeters <= 0) return null;
  const meters = Math.max(0, Math.min(scene.routeTotalMeters, scene.routeMeters));
  return { meters, totalMeters: scene.routeTotalMeters, remainingMeters: Math.max(0, scene.routeTotalMeters - meters) };
}

export function streetViewRoutePoints(catalog, route) {
  const recorded = (route?.points || []).map(mapCoordinate).filter(Boolean);
  if (recorded.length) return recorded;
  const steps = route?.steps || [];
  if (!steps.length) return [];
  const nodes = new Map((catalog?.nodes || []).map(row => [row.id, row]));
  return [steps[0].from, ...steps.map(row => row.to)].map(id => mapCoordinate(nodes.get(id))).filter(Boolean);
}
