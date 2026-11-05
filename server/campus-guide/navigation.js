import { findRoute, guideError } from '../../shared/campus-guide.js';
import { navigationEndpoint, walkingNavigationUrl, usableGps } from '../../shared/campus-navigation.js';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../../shared/campus-coordinates.js';

export async function planGroundNavigation(catalog, input = {}, { key = process.env.DAYLIGHT_AMAP_WALKING_KEY, fetcher = fetch, now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw guideError('请提供起点和终点。');
  const to = navigationEndpoint(catalog, input.to);
  if (input.from?.source === 'gps' && !usableGps(input.from, now)) throw guideError('定位已过期或精度超过 100 米，请重新定位或手动选择起点。', 422);
  const from = input.from ? navigationEndpoint(catalog, input.from) : null;
  const externalNavigationUrl = walkingNavigationUrl(catalog, input.to, input.from);
  const base = { from: input.from || null, to: input.to, fromName: from?.name || '我的位置', toName: to.name, mode: 'ground', externalNavigationUrl };
  if (from && catalog.edges.some(e => e.walkable && !e.closed && e.level === 'ground')) {
    try { return { ...findRoute(catalog, { ...input, mode: 'ground' }), externalNavigationUrl, provider: 'campus' }; }
    catch (error) { if (![404, 422].includes(error.status)) throw error; }
  }
  if (!key || !from) return { ...base, provider: 'tencent-handoff', externalOnly: true, points: [], steps: [], notice: '点击“打开腾讯步行导航”继续规划和实时引导。站内尚无核验后的该段道路；腾讯地图可能缺少部分校内小路，请按现场通行标识行走。' };
  if (input.avoidRain || input.accessible) throw guideError('地图服务未提供避雨或无障碍保证，请关闭偏好，或使用已核验的校园道路。', 422);
  const a = wgs84ToGcj02(from), b = wgs84ToGcj02(to);
  const url = new URL('https://restapi.amap.com/v3/direction/walking');
  url.search = new URLSearchParams({ key, origin: `${a.lng},${a.lat}`, destination: `${b.lng},${b.lat}` });
  let result;
  try { const response = await fetcher(url, { signal: AbortSignal.timeout(12000) }); if (!response.ok) throw Error('http'); result = await response.json(); }
  catch { throw guideError('步行地图服务暂时不可用，可使用腾讯步行导航继续。', 503); }
  const path = result.status === '1' && result.route?.paths?.[0];
  if (!path || !Number.isFinite(Number(path.distance)) || !Number.isFinite(Number(path.duration))) throw guideError('地图服务未返回可用步行路线，可使用腾讯步行导航继续。', 422);
  const points = [], steps = (path.steps || []).map((step, index) => {
    for (const pair of String(step.polyline || '').split(';')) { const [lng, lat] = pair.split(',').map(Number); if (Number.isFinite(lat) && Number.isFinite(lng)) points.push(gcj02ToWgs84({ lat, lng })); }
    return { id: `amap-${index}`, description: String(step.instruction || '沿步行道路前行').slice(0, 500), distanceMeters: Number(step.distance) || 0, level: 'ground' };
  });
  if (points.length < 2) throw guideError('步行地图服务没有返回路线几何数据。', 422);
  return { ...base, provider: 'amap', points, steps, distanceMeters: Number(path.distance), durationMinutes: Math.ceil(Number(path.duration) / 60), notice: '高德步行路线；可能缺少校园内部小路，临时封闭与入口以现场为准。' };
}
