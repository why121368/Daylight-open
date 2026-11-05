import { GUIDE_COLLECTIONS, queueSummaries } from '../../shared/campus-guide.js';
import { diagnoseCampusNetwork } from '../../shared/campus-geometry.js';
import { ACTIVITY_KEY, COMMUNITY_KEY, SOURCES_KEY } from './repository.js';
import { campusOperationsSnapshot } from './operations.js';
import { campusQueueHistoryStats } from './queue-history.js';

/** Explicit aggregate projection: no message bodies, images, user IDs, tokens or source URLs. */
export function campusAdminStats({ catalog, activity, community, sources, shared = false, now = new Date() }) {
  const events = catalog.events, reports = queueSummaries(activity.queueReports, now), sourceRows = sources.sources;
  return { generatedAt: now.toISOString(), storage: { mode: shared ? 'postgres' : 'local', shared }, catalog: { revision: catalog.meta.revision, isDemo: catalog.meta.isDemo, updatedAt: catalog.meta.updatedAt, counts: Object.fromEntries(GUIDE_COLLECTIONS.map(key => [key, (catalog[key] || []).length])), hiddenEvents: events.filter(e => e.hidden).length, pinnedEvents: events.filter(e => e.pinned).length },
    engagement: { posts: community.posts.length, publishedPosts: community.posts.filter(post => post.status === 'published').length, hiddenPosts: community.posts.filter(post => post.status === 'hidden').length, comments: community.comments.filter(comment => comment.status === 'published').length, likes: community.reactions.filter(reaction => reaction.like).length, bookmarks: community.reactions.filter(reaction => reaction.bookmark).length, images: community.images.length, activeQueueReports: reports.reduce((sum, report) => sum + report.reportCount, 0), menuRatings: (activity.menuReports || []).filter(report => report.rating).length, feedbackOpen: activity.feedback.filter(f => f.status === 'open').length, feedbackResolved: activity.feedback.filter(f => f.status === 'resolved').length, checkins: Number(activity.checkinCount) || 0 },
    queue24h: campusQueueHistoryStats(catalog, activity, now),
    sources: { configured: sourceRows.length, enabled: sourceRows.filter(source => source.enabled).length, pendingDrafts: sources.drafts.filter(draft => draft.status === 'pending').length, failedSources: sourceRows.filter(source => source.lastError).length, running: sourceRows.filter(source => Date.parse(source.runningUntil || '') > now.getTime()).length, lastSuccessAt: sourceRows.map(source => source.lastSuccessAt || '').filter(Boolean).sort().at(-1) || '' } };
}
export function installGeometryRoutes(router, { repository, route, requireAdmin, now, readOperations = campusOperationsSnapshot }) {
  router.get('/admin/diagnostics', route(async req => { await requireAdmin(req); return { ...diagnoseCampusNetwork(await repository.readCatalog()), generatedAt: now().toISOString(), notice: '连通性按已录入的可通行步行道路作无向分量诊断；单向限制、施工与现场通行仍需核验。接近而未连接的点仅是人工检查线索，不会自动补路。' }; }));
  router.get('/admin/stats', route(async (req, res) => { await requireAdmin(req); res.setHeader('Cache-Control', 'private, no-store'); const instant = now(); const [catalog, activity, community, sources, operations] = await Promise.all([repository.readCatalog(), repository.read(ACTIVITY_KEY), repository.read(COMMUNITY_KEY), repository.read(SOURCES_KEY), readOperations({ now: instant })]); return { ...campusAdminStats({ catalog, activity: activity.payload, community: community.payload, sources: sources.payload, shared: repository.storageStatus().shared, now: instant }), operations }; }));
}
