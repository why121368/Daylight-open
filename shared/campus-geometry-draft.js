import { validateCatalog } from './campus-guide.js';

const PREFIX = 'daylight-campus-map-draft:v1:';
const MAX_LENGTH = 2 * 1024 * 1024;
const fields = {
  node: ['id', 'lat', 'lng', 'level', 'kind', 'isDemo'],
  edge: ['id', 'from', 'to', 'distanceMeters', 'covered', 'accessible', 'bidirectional', 'description', 'level', 'kind', 'walkable', 'closed', 'sceneImageUrl', 'isDemo'],
  scene: ['id', 'sourceFilename', 'edgeId', 'offsetMeters', 'lat', 'lng', 'nodeId', 'placeId', 'imageUrl', 'description', 'sourceUrl', 'isDemo'],
  entrance: ['id', 'name', 'lat', 'lng', 'nodeId', 'accessible', 'kind'],
};
const fail = message => { throw new Error(message); };
const pick = (row, names) => Object.fromEntries(names.filter(name => Object.hasOwn(row || {}, name)).map(name => [name, structuredClone(row[name])]));
const revision = value => Number.isSafeInteger(value) && value >= 0;
function ownerPrefix(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 200) fail('请以管理员账号登录后使用本机地图草稿。');
  return `${PREFIX}${encodeURIComponent(ownerId)}:`;
}
export function geometryDraftKey(ownerId, baseRevision) {
  if (!revision(baseRevision)) fail('地图草稿的目录版本无效。');
  return `${ownerPrefix(ownerId)}${baseRevision}`;
}

/** Allowlist only the fields this editor changes; never persist full admin catalogs. */
export function geometryDraftSnapshot(catalog) {
  return {
    places: (catalog.places || []).map(place => ({ id: place.id, nodeId: place.nodeId || '', polygons: (place.polygons || []).map(polygon => ({ id: polygon.id, points: (polygon.points || []).map(point => pick(point, ['lat', 'lng'])) })), entrances: (place.entrances || []).map(entrance => pick(entrance, fields.entrance)) })),
    nodes: (catalog.nodes || []).map(node => pick(node, fields.node)),
    edges: (catalog.edges || []).map(edge => pick(edge, fields.edge)),
    streetViews: (catalog.streetViews || []).map(scene => pick(scene, fields.scene)),
  };
}

function checkDocument(input, ownerId, baseRevision) {
  if (!input || input.schemaVersion !== 1 || input.ownerId !== ownerId || input.baseRevision !== baseRevision || !revision(input.baseRevision) || typeof input.savedAt !== 'string' || !Number.isFinite(Date.parse(input.savedAt))) fail('这份本机草稿已损坏或不属于当前账号，请导出其他草稿或丢弃此记录。');
  const geometry = input.geometry;
  if (!geometry || !Array.isArray(geometry.places) || !Array.isArray(geometry.nodes) || !Array.isArray(geometry.edges) || !Array.isArray(geometry.streetViews) || geometry.places.length > 5000 || geometry.nodes.length > 30000 || geometry.edges.length > 60000 || geometry.streetViews.length > 3000) fail('本机地图草稿的几何结构无效。');
  return { schemaVersion: 1, ownerId, baseRevision, savedAt: input.savedAt, geometry: geometryDraftSnapshot(geometry) };
}

export function restoreGeometryDraft(input, ownerId, catalog) {
  if (input?.baseRevision !== catalog.meta.revision) fail('公共目录版本已经改变，旧草稿只能导出或丢弃，请在最新目录重新核对修改。');
  const document = checkDocument(input, ownerId, catalog.meta.revision), next = validateCatalog(catalog), places = new Map(document.geometry.places.map(place => [place.id, place]));
  if (places.size !== document.geometry.places.length || places.size !== next.places.length || next.places.some(place => !places.has(place.id))) fail('草稿中的地点与当前目录不一致，请导出后重新核对。');
  next.places = next.places.map(place => ({ ...place, ...places.get(place.id) }));
  for (const key of ['nodes', 'edges', 'streetViews']) next[key] = structuredClone(document.geometry[key]);
  return validateCatalog(next);
}

export function writeGeometryDraft(storage, ownerId, baseCatalog, draft, now = new Date()) {
  const baseRevision = baseCatalog.meta.revision, key = geometryDraftKey(ownerId, baseRevision);
  if (draft.meta.revision !== baseRevision) fail('地图草稿与其公共目录版本不一致，请导出后重新核对。');
  const checked = validateCatalog(draft), document = { schemaVersion: 1, ownerId, baseRevision, savedAt: now.toISOString(), geometry: geometryDraftSnapshot(checked) };
  restoreGeometryDraft(document, ownerId, baseCatalog);
  const serialized = JSON.stringify(document);
  if (serialized.length > MAX_LENGTH) fail('地图草稿过大，无法保存在本机；请导出草稿文件留存。');
  try { storage.setItem(key, serialized); }
  catch { fail('浏览器空间不足或禁止本机存储，草稿尚未保存在本机；请导出草稿文件留存。'); }
  return document;
}

/** Read values only after the key matches the authenticated account namespace. */
export function readGeometryDrafts(storage, ownerId) {
  const prefix = ownerPrefix(ownerId), records = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length), baseRevision = Number(suffix);
      if (!/^\d+$/.test(suffix) || !revision(baseRevision) || geometryDraftKey(ownerId, baseRevision) !== key) continue;
      try {
        const raw = storage.getItem(key); if (!raw || raw.length > MAX_LENGTH) throw Error();
        const document = checkDocument(JSON.parse(raw), ownerId, baseRevision);
        records.push({ key, baseRevision, savedAt: document.savedAt, document, error: '' });
      } catch { records.push({ key, baseRevision, savedAt: '', document: null, error: '这份本机草稿已损坏或账号信息不匹配，无法恢复。' }); }
    }
  } catch { fail('浏览器禁止读取本机草稿，当前编辑仅保留在本页；请导出草稿文件留存。'); }
  return records.sort((a, b) => b.baseRevision - a.baseRevision);
}

export function discardGeometryDraft(storage, ownerId, baseRevision) {
  const key = geometryDraftKey(ownerId, baseRevision);
  try { storage.removeItem(key); }
  catch { fail('浏览器未能清理这份本机草稿，请稍后重试。'); }
}
