import { randomUUID, createHash } from 'node:crypto';
import { raw } from 'express';
import { putAttachment, getAttachmentObject } from '../infra/oss.js';
import { guideError } from '../../shared/campus-guide.js';
import { COMMUNITY_KEY, CATALOG_KEY } from './repository.js';

export const COMMUNITY_TOPICS = ['share', 'review', 'question', 'guide', 'meetup'];
export const COMMUNITY_BOARDS = ['campus', 'events', 'food', 'places'];
const clean = (value, max) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const bodyText = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw guideError(`请填写${label}（最多 ${max} 字）。`); return clean(value, max); };
const publicImageUrl = id => `/api/campus-guide/community/images/${id}`;
const username = user => clean(user.username || user.email?.split('@')[0] || '校园用户', 80);
function visiblePost(state, id, user, isAdmin) { const post = state.posts.find(p => p.id === id && p.status !== 'deleted'); if (!post || (post.status !== 'published' && post.authorId !== user?.id && !isAdmin)) throw guideError('帖子不存在。', 404); return post; }
export function publicPost(post, state, user) {
  const reactions = state.reactions.filter(r => r.postId === post.id);
  return { id: post.id, title: post.title, body: post.body, topic: post.topic, board: post.board || 'campus', placeId: post.placeId, eventId: post.eventId, venueId: post.venueId, windowId: post.windowId || '', images: [...post.images], authorId: post.authorId, authorName: post.authorName, createdAt: post.createdAt, updatedAt: post.updatedAt, status: post.status,
    likeCount: reactions.filter(r => r.like).length, commentCount: state.comments.filter(c => c.postId === post.id && c.status === 'published').length, liked: Boolean(user && reactions.some(r => r.userId === user.id && r.like)), bookmarked: Boolean(user && reactions.some(r => r.userId === user.id && r.bookmark)) };
}
const publicComment = row => ({ id: row.id, postId: row.postId, parentId: row.parentId, body: row.body, authorId: row.authorId, authorName: row.authorName, createdAt: row.createdAt, status: row.status });
function validatePost(input, catalog, state, user) {
  if (!input || typeof input !== 'object') throw guideError('帖子内容无效。');
  if (!COMMUNITY_TOPICS.includes(input.topic)) throw guideError('请选择有效的帖子分类。');
  const board = input.board === undefined ? 'campus' : input.board;
  if (!COMMUNITY_BOARDS.includes(board)) throw guideError('请选择有效的交流分区。');
  const references = [['placeId', catalog.places], ['eventId', catalog.events.filter(event => !event.hidden)], ['venueId', catalog.venues]], result = { title: bodyText(input.title, 150, '标题'), body: bodyText(input.body, 15000, '帖子内容'), topic: input.topic, board, windowId: '', images: [] };
  for (const [key, rows] of references) { result[key] = ''; if (input[key] !== undefined && input[key] !== null && input[key] !== '') { if (typeof input[key] !== 'string' || !rows.some(row => row.id === input[key])) throw guideError('关联的校园资料已更新，请刷新。'); result[key] = input[key]; } }
  if (input.windowId !== undefined && input.windowId !== null && input.windowId !== '') {
    if (typeof input.windowId !== 'string' || !result.venueId || !catalog.venues.find(venue => venue.id === result.venueId)?.windows.some(window => window.id === input.windowId)) throw guideError('请为窗口选择其所属食堂，关联的窗口需存在。');
    result.windowId = input.windowId;
  }
  if (!Array.isArray(input.images || []) || (input.images || []).length > 6) throw guideError('每篇帖子最多 6 张图片。');
  result.images = [...new Set(input.images || [])].map(value => { const image = state.images.find(row => publicImageUrl(row.id) === value && row.ownerId === user.id); if (!image) throw guideError('仅能使用自己上传的校园社区图片。'); return value; });
  return result;
}
function limited(state, userId, now) { const recent = state.posts.filter(p => p.authorId === userId && Date.parse(p.createdAt) > now - 60000); if (recent.length >= 5) throw guideError('发布过于频繁，请一分钟后再试。', 429); }
function imageType(buffer) {
  if (buffer.length > 12 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', 'png'];
  if (buffer.length > 12 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return ['image/jpeg', 'jpg'];
  if (buffer.length > 12 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return ['image/gif', 'gif'];
  if (buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  throw guideError('仅支持 PNG、JPEG、GIF 或 WebP 图片，不支持 SVG/HTML。');
}

export function installCommunityRoutes(router, { repository, route, requireUser, optionalUser, requireAdmin, now, isAdminUser, attachments = { put: putAttachment, get: getAttachmentObject } }) {
  router.get('/community/posts', route(async req => {
    const user = await optionalUser(req), state = (await repository.read(COMMUNITY_KEY)).payload;
    const query = clean(req.query.q, 150).toLowerCase(), topic = clean(req.query.topic, 30), board = clean(req.query.board, 30), references = Object.fromEntries(['placeId', 'eventId', 'venueId', 'windowId'].map(key => [key, clean(req.query[key], 100)])), sort = req.query.sort === 'popular' ? 'popular' : 'latest', filter = clean(req.query.filter, 20);
    if (board && !COMMUNITY_BOARDS.includes(board)) throw guideError('交流分区筛选无效。');
    if (filter && !['bookmarked', 'mine', 'liked'].includes(filter)) throw guideError('帖子筛选条件无效。');
    if (filter && !user?.id) throw guideError('请先登录后查看自己的笔记和收藏。', 401);
    const selected = new Set(filter === 'bookmarked' || filter === 'liked' ? state.reactions.filter(reaction => reaction.userId === user.id && reaction[filter === 'bookmarked' ? 'bookmark' : 'like']).map(reaction => reaction.postId) : []);
    const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1))), pageSize = 20;
    let posts = state.posts.filter(post => (filter === 'mine' ? post.authorId === user.id && post.status !== 'deleted' : post.status === 'published') && (!(filter === 'bookmarked' || filter === 'liked') || selected.has(post.id)) && (!topic || post.topic === topic) && (!board || (post.board || 'campus') === board) && Object.entries(references).every(([key, value]) => !value || post[key] === value) && (!query || `${post.title} ${post.body}`.toLowerCase().includes(query))).map(post => publicPost(post, state, user));
    posts.sort((a, b) => (sort === 'popular' ? b.likeCount - a.likeCount : 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    return { posts: posts.slice((page - 1) * pageSize, page * pageSize), total: posts.length, page, pageSize };
  }));
  router.get('/community/me', route(async req => { const user = await requireUser(req), state = (await repository.read(COMMUNITY_KEY)).payload; return { posts: state.posts.filter(p => p.authorId === user.id && p.status !== 'deleted').map(p => publicPost(p, state, user)), likedPostIds: state.reactions.filter(r => r.userId === user.id && r.like).map(r => r.postId), bookmarkedPostIds: state.reactions.filter(r => r.userId === user.id && r.bookmark).map(r => r.postId) }; }));
  router.get('/community/posts/:id', route(async req => { const user = await optionalUser(req), state = (await repository.read(COMMUNITY_KEY)).payload, post = visiblePost(state, req.params.id, user, isAdminUser(user)); return { post: publicPost(post, state, user), comments: state.comments.filter(c => c.postId === post.id && c.status === 'published').map(publicComment) }; }));
  router.post('/community/posts', route(async req => {
    const user = await requireUser(req), catalog = await repository.readCatalog(), timestamp = now().toISOString();
    const result = await repository.mutate(COMMUNITY_KEY, state => { if (state.posts.length >= 10000) throw guideError('校园社区已达容量，请联系管理员。', 409); limited(state, user.id, Date.parse(timestamp)); const post = { id: randomUUID(), ...validatePost(req.body, catalog, state, user), authorId: user.id, authorName: username(user), createdAt: timestamp, updatedAt: timestamp, status: 'published' }; state.posts.push(post); return publicPost(post, state, user); });
    return { post: result.value };
  }));
  router.delete('/community/posts/:id', route(async req => {
    const user = await requireUser(req); return (await repository.mutate(COMMUNITY_KEY, state => { const post = visiblePost(state, req.params.id, user, isAdminUser(user)); if (post.authorId !== user.id && !isAdminUser(user)) throw guideError('仅能删除自己的帖子。', 403); post.status = 'deleted'; post.updatedAt = now().toISOString(); return { deleted: true }; })).value;
  }));
  for (const kind of ['like', 'bookmark']) router.put(`/community/posts/:id/${kind}`, route(async req => {
    const user = await requireUser(req); if (typeof req.body?.active !== 'boolean') throw guideError('请提供 active 布尔值。');
    return (await repository.mutate(COMMUNITY_KEY, state => { const post = visiblePost(state, req.params.id, user, false); if (post.status !== 'published') throw guideError('该帖子暂不开放互动。', 409); let reaction = state.reactions.find(r => r.postId === post.id && r.userId === user.id); if (!reaction) { if (state.reactions.length >= 100000) throw guideError('互动记录已达容量。', 409); reaction = { postId: post.id, userId: user.id, like: false, bookmark: false }; state.reactions.push(reaction); } reaction[kind] = req.body.active; return { post: publicPost(post, state, user) }; })).value;
  }));
  router.post('/community/posts/:id/comments', route(async req => {
    const user = await requireUser(req), body = bodyText(req.body?.body, 3000, '评论');
    return (await repository.mutate(COMMUNITY_KEY, state => { const post = visiblePost(state, req.params.id, user, false); if (post.status !== 'published') throw guideError('该帖子暂不开放评论。', 409); if (state.comments.length >= 30000) throw guideError('评论已达容量。', 409); if (state.comments.filter(c => c.authorId === user.id && Date.parse(c.createdAt) > now().getTime() - 60000).length >= 15) throw guideError('评论过于频繁，请一分钟后再试。', 429); const parentId = req.body.parentId || ''; if (parentId && !state.comments.some(c => c.id === parentId && c.postId === post.id && c.status === 'published')) throw guideError('回复的评论不存在。', 404); const comment = { id: randomUUID(), postId: post.id, parentId, body, authorId: user.id, authorName: username(user), createdAt: now().toISOString(), status: 'published' }; state.comments.push(comment); return { comment: publicComment(comment) }; })).value;
  }));
  router.delete('/community/posts/:id/comments/:commentId', route(async req => {
    const user = await requireUser(req); return (await repository.mutate(COMMUNITY_KEY, state => { visiblePost(state, req.params.id, user, isAdminUser(user)); const comment = state.comments.find(c => c.postId === req.params.id && c.id === req.params.commentId && c.status !== 'deleted'); if (!comment) throw guideError('评论不存在。', 404); if (comment.authorId !== user.id && !isAdminUser(user)) throw guideError('仅能删除自己的评论。', 403); comment.status = 'deleted'; return { deleted: true }; })).value;
  }));
  router.get('/admin/community/posts', route(async req => { await requireAdmin(req); const state = (await repository.read(COMMUNITY_KEY)).payload; return { posts: state.posts.filter(p => p.status !== 'deleted').map(p => publicPost(p, state, null)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) }; }));
  router.patch('/admin/community/posts/:id', route(async req => { await requireAdmin(req); if (!['published', 'hidden'].includes(req.body?.status)) throw guideError('帖子状态无效。'); return (await repository.mutate(COMMUNITY_KEY, state => { const post = state.posts.find(p => p.id === req.params.id && p.status !== 'deleted'); if (!post) throw guideError('帖子不存在。', 404); post.status = req.body.status; post.updatedAt = now().toISOString(); return { post: publicPost(post, state, null) }; })).value; }));
  router.post('/community/images', raw({ type: 'application/octet-stream', limit: '5mb' }), route(async req => {
    const user = await requireUser(req); if (!Buffer.isBuffer(req.body) || !req.body.length) throw guideError('请上传图片文件。'); const [contentType, extension] = imageType(req.body), state = (await repository.read(COMMUNITY_KEY)).payload;
    if (state.images.filter(img => img.ownerId === user.id && Date.parse(img.createdAt) > now().getTime() - 3600000).length >= 30) throw guideError('上传过于频繁，请稍后再试。', 429);
    const id = randomUUID(), ownerHash = createHash('sha256').update(user.id).digest('hex').slice(0, 20);
    const stored = await attachments.put({ filename: `${id}.${extension}`, buffer: req.body, contentType, userId: user.id, prefix: `campus-community/${ownerHash}` });
    await repository.mutate(COMMUNITY_KEY, draft => { if (draft.images.length >= 30000) throw guideError('图片记录已达容量。', 409); draft.images.push({ id, ownerId: user.id, key: stored.key, contentType, size: req.body.length, createdAt: now().toISOString() }); });
    return { id, url: publicImageUrl(id), contentType, size: req.body.length };
  }));
  router.get('/community/images/:id', async (req, res, next) => {
    try { const user = await optionalUser(req), state = (await repository.read(COMMUNITY_KEY)).payload, image = state.images.find(row => row.id === req.params.id); if (!image) throw guideError('图片不存在。', 404);
      const usedPublicly = state.posts.some(post => post.status === 'published' && post.images.includes(publicImageUrl(image.id))); if (!usedPublicly && image.ownerId !== user?.id && !isAdminUser(user)) throw guideError('图片不存在。', 404);
      const stored = await attachments.get(image.key); if (!stored?.buffer) throw guideError('图片暂时无法读取。', 404); res.setHeader('Content-Type', image.contentType); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store'); res.send(stored.buffer);
    } catch (error) { next(error); }
  });
}
