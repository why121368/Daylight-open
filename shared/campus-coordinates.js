// Campus storage and browser GPS use WGS84. The university GIS publishes BD-09.
const PI = Math.PI, X_PI = PI * 3000 / 180;
const A = 6378245, EE = 0.006693421622965943;
const rad = PI / 180;

function gcjDelta({ lat, lng }) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat: 0, lng: 0 };
  const x = lng - 105, y = lat - 35;
  let dy = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  dy += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  dy += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  dy += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  let dx = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dx += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  dx += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  dx += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  const sin = Math.sin(lat * rad), magic = 1 - EE * sin * sin, root = Math.sqrt(magic);
  return { lat: dy * 180 / ((A * (1 - EE)) / (magic * root) * PI), lng: dx * 180 / (A / root * Math.cos(lat * rad) * PI) };
}

export function wgs84ToGcj02(point) {
  const delta = gcjDelta(point);
  return { lat: point.lat + delta.lat, lng: point.lng + delta.lng };
}
export function gcj02ToWgs84(point) {
  let result = { ...point };
  for (let i = 0; i < 6; i++) {
    const delta = gcjDelta(result);
    result = { lat: point.lat - delta.lat, lng: point.lng - delta.lng };
  }
  return result;
}

export function wgs84ToBd09(point) {
  const delta = gcjDelta(point), lat = point.lat + delta.lat, lng = point.lng + delta.lng;
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return { lat: z * Math.sin(theta) + 0.006, lng: z * Math.cos(theta) + 0.0065 };
}

export function bd09ToWgs84(point) {
  const x = point.lng - 0.0065, y = point.lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  const gcj = { lat: z * Math.sin(theta), lng: z * Math.cos(theta) };
  let result = { ...gcj };
  // Invert the GCJ offset iteratively instead of treating BD-09 as browser GPS.
  for (let i = 0; i < 5; i++) {
    const delta = gcjDelta(result);
    result = { lat: gcj.lat - delta.lat, lng: gcj.lng - delta.lng };
  }
  return result;
}

// Baidu's published LL -> MC polynomial for the 30–45°N band, containing this campus.
// Deliberately reject other latitudes: this is a campus importer, not a world CRS.
export function campusBd09Mercator({ lat, lng }) {
  if (!Number.isFinite(lng) || lng < 110 || lng > 130 || !Number.isFinite(lat) || lat < 30 || lat >= 45) throw new Error('地图坐标不在支持的校园投影范围内。');
  const c = [0.00220636496208, 111320.7020209128, 51751.86112841131, 3796837.749470245, 992013.7397791013, -1221952.21711287, 1340652.697009075, -620943.6990984312, 144416.9293806241, 37.5];
  const t = lat / c[9];
  return { x: c[0] + c[1] * lng, y: c[2] + c[3] * t + c[4] * t ** 2 + c[5] * t ** 3 + c[6] * t ** 4 + c[7] * t ** 5 + c[8] * t ** 6 };
}

export const webMercator = ({ lat, lng }) => ({ x: 6378137 * lng * rad, y: 6378137 * Math.log(Math.tan(PI / 4 + lat * rad / 2)) });
export const fromWebMercator = ({ x, y }) => ({ lng: x / 6378137 / rad, lat: (2 * Math.atan(Math.exp(y / 6378137)) - PI / 2) / rad });
