import { raw } from 'express';
import { randomUUID } from 'node:crypto';
import { putAttachment, getAttachmentObject } from '../infra/oss.js';
import { MEDIA_KEY } from './repository.js';
import { guideError, publicCampusCatalog } from '../../shared/campus-guide.js';

export const CAMPUS_MEDIA_LIMIT = 20 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const mediaPath = id => `/api/campus-guide/media/${id}`;
const missing = () => guideError('图片不存在或尚未公开。', 404, 'CAMPUS_GUIDE_MEDIA_NOT_FOUND');
const storageFailure = () => guideError('校园图片存储暂时不可用，请稍后重试。', 503, 'CAMPUS_GUIDE_MEDIA_UNAVAILABLE');
const privateKey = key => typeof key === 'string' && /^campus-media\/[a-zA-Z0-9/_\-.]+$/.test(key) && !key.split('/').some(segment => !segment || segment === '.' || segment === '..');

function requestOrigin(req) {
  // Express only trusts the deployment's explicitly configured proxy. Never use
  // Origin or X-Forwarded-Host to choose a stored media address.
  const protocol = req.protocol, host = req.get('Host') || '';
  if (!['http', 'https'].includes(protocol) || !host || /[\s\\/@?#]/.test(host)) throw guideError('当前访问地址无效，请从 Daylight 页面重新上传。');
  try { const value = new URL(`${protocol}://${host}`); if (value.username || value.password || value.pathname !== '/' || value.search || value.hash || !value.hostname) throw Error(); return value.origin; }
  catch { throw guideError('当前访问地址无效，请从 Daylight 页面重新上传。'); }
}

function uploadFilename(req) {
  let filename;
  try { filename = decodeURIComponent(req.get('X-Filename') || ''); } catch { throw guideError('图片文件名编码无效。'); }
  if (!filename || filename.length > 180 || filename !== filename.trim() || /[\u0000-\u001f\u007f/\\:|]/.test(filename) || !/\.(png|jpe?g|webp)$/i.test(filename)) throw guideError('请提供不含路径的 PNG、JPEG 或 WebP 文件名（最多 180 字）。');
  return filename;
}

function imageType(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString('ascii') === 'IHDR') return { contentType: 'image/png', extension: 'png' };
  if (buffer.length > 12 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length > 16 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.subarray(12, 16).toString('ascii'))) return { contentType: 'image/webp', extension: 'webp' };
  throw guideError('只支持具有有效文件标识的 PNG、JPEG 或 WebP 图片。');
}

/** Only image fields exposed by the anonymous catalog can publish a media file. */
export function campusMediaIsPublic(catalog, media) {
  const projected = publicCampusCatalog(catalog), values = [];
  for (const key of ['streetViews', 'indoorPlans', 'events', 'menus']) for (const row of projected[key] || []) { values.push(row.imageUrl); if (key === 'menus') values.push(row.menuImageUrl); }
  for (const venue of projected.venues || []) { values.push(venue.menuImageUrl); for (const window of venue.windows || []) values.push(window.menuImageUrl); }
  for (const edge of projected.edges || []) values.push(edge.sceneImageUrl);
  return values.some(value => {
    if (typeof value !== 'string' || !value) return false;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === media.origin && url.pathname === mediaPath(media.id) && !url.username && !url.password && !url.search && !url.hash; }
    catch { return false; }
  });
}

export function installCampusMediaRoutes(router, { repository, route, requireAdmin, optionalUser, isAdminUser, now, attachments = { put: putAttachment, get: getAttachmentObject } }) {
  // Authenticate before reading a potentially large binary body.
  const gate = async (req, res, next) => {
    try { req.campusMediaAdmin = await requireAdmin(req); if (Number(req.get('Content-Length')) > CAMPUS_MEDIA_LIMIT) throw guideError('每张图片最多 20 MiB。', 413); next(); }
    catch (error) { next(error); }
  };
  router.post('/admin/media', gate, raw({ type: 'application/octet-stream', limit: CAMPUS_MEDIA_LIMIT }), route(async (req, res) => {
    const filename = uploadFilename(req), origin = requestOrigin(req), buffer = req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw guideError('请用二进制请求上传图片文件。');
    if (buffer.length > CAMPUS_MEDIA_LIMIT) throw guideError('每张图片最多 20 MiB。', 413);
    const { contentType, extension } = imageType(buffer), id = randomUUID();
    const state = (await repository.read(MEDIA_KEY)).payload;
    if (state.files.length >= 30000) throw guideError('校园图片记录已达容量，请联系管理员。', 409);
    let stored;
    try { stored = await attachments.put({ filename: `${id}.${extension}`, buffer, contentType, userId: req.campusMediaAdmin.id, prefix: 'campus-media' }); }
    catch { throw storageFailure(); }
    if (!privateKey(stored?.key)) throw storageFailure();
    await repository.mutate(MEDIA_KEY, draft => {
      if (draft.files.length >= 30000) throw guideError('校园图片记录已达容量，请联系管理员。', 409);
      draft.files.push({ id, filename, path: mediaPath(id), origin, key: stored.key, contentType, size: buffer.length, uploadedBy: req.campusMediaAdmin.id, createdAt: now().toISOString() });
    });
    res.status(201).setHeader('Cache-Control', 'private, no-store');
    return { id, filename, url: `${origin}${mediaPath(id)}`, contentType, size: buffer.length };
  }));
  router.get('/media/:id', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      if (!UUID.test(req.params.id)) throw missing();
      const user = await optionalUser(req), media = (await repository.read(MEDIA_KEY)).payload.files.find(row => row.id === req.params.id);
      if (!media || !privateKey(media.key)) throw missing();
      if (!(user?.id && isAdminUser(user)) && !campusMediaIsPublic(await repository.readCatalog(), media)) throw missing();
      let stored;
      try { stored = await attachments.get(media.key); } catch { throw storageFailure(); }
      if (!Buffer.isBuffer(stored?.buffer)) throw storageFailure();
      res.setHeader('Content-Type', media.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.send(stored.buffer);
    } catch (error) { next(error); }
  });
}
