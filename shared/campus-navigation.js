import { wgs84ToGcj02 } from './campus-coordinates.js';
import { guideError } from './campus-guide.js';

export function navigationEndpoint(catalog, value) {
  const point = typeof value === 'string' ? catalog.places.find(p => p.id === value) : value;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw guideError('请选择有效的导航地点或定位坐标。');
  return { lat: point.lat, lng: point.lng, name: String(point.name || '地图位置').slice(0, 120) };
}

/** Tencent URI uses GCJ-02; browser fixes and our stored campus data use WGS84. */
export function walkingNavigationUrl(catalog, to, from) {
  const target = navigationEndpoint(catalog, to), end = wgs84ToGcj02(target);
  const params = new URLSearchParams({ type: 'walk', to: target.name, tocoord: `${end.lat.toFixed(7)},${end.lng.toFixed(7)}`, policy: '1' });
  if (from) {
    const origin = navigationEndpoint(catalog, from), start = wgs84ToGcj02(origin);
    params.set('from', origin.name); params.set('fromcoord', `${start.lat.toFixed(7)},${start.lng.toFixed(7)}`);
  } else params.set('from', '我的位置');
  return `https://apis.map.qq.com/uri/v1/routeplan?${params}`;
}

export function usableGps(point, now = Date.now()) {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 && Number.isFinite(point.accuracy) && point.accuracy <= 100 && point.accuracy >= 0 && Number.isFinite(point.timestamp) && now - point.timestamp <= 60000 && point.timestamp <= now + 10000);
}
