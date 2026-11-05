import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, Database, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { guideRequest } from '@/lib/campus-guide-client';

const stamp = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚无记录';
const number = value => value === undefined || value === null ? '—' : Number(value).toLocaleString('zh-CN');
const bytes = value => { const count = Number(value) || 0; return count >= 1073741824 ? `${(count / 1073741824).toFixed(2)} GiB` : count >= 1048576 ? `${(count / 1048576).toFixed(1)} MiB` : count >= 1024 ? `${(count / 1024).toFixed(1)} KiB` : `${count} B`; };
const duration = value => { const seconds = Math.max(0, Math.floor(Number(value) || 0)), days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60; return `${days ? `${days} 天 ` : ''}${hours} 小时 ${minutes} 分钟`; };
const COLLECTION_NAMES = { places: '地点', nodes: '道路节点', edges: '道路', events: '活动', venues: '食堂', menus: '菜品', indoorPlans: '室内平面图', parcelStations: '快递站', streetViews: '道路实景' };

function useAdminSnapshot(path) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(previous => previous + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    guideRequest(path).then(next => { if (active) { setData(next); setError(''); } }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, version]);
  return { data, error, loading, refresh };
}

function SnapshotHeader({ title, description, data, error, loading, refresh }) {
  return <><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p><p className="mt-1 text-[11px] text-muted-foreground">{data ? `更新于 ${stamp(data.generatedAt)}` : loading ? '正在读取…' : '尚未载入'}</p></div><Button type="button" variant="outline" size="icon-sm" disabled={loading} aria-label={`刷新${title}`} onClick={refresh}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button></div>{error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}。请点击刷新重试。</p>}</>;
}

function CountGrid({ items }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-lg border bg-background p-3"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-1 block text-xl font-semibold">{number(value)}</strong></div>)}</div>;
}

function OperationsOverview({ data }) {
  if (!data) return null;
  const { accounts, sessions, process: current, configuration: config, backups } = data;
  const flags = [['requireAuth', '要求账号登录'], ['allowLocalDemoLogin', '本地演示登录'], ['postgresEnabled', '数据库配置'], ['redisEnabled', 'Redis 配置'], ['queueEnabled', '任务队列配置'], ['objectStorageEnabled', '对象存储配置'], ['systemMailEnabled', '系统发信'], ['systemMailFieldsReady', 'SMTP 必填字段齐全']];
  const backupStatus = { unconfigured: '尚未配置备份清单目录。请按部署文档设置只读备份挂载。', 'invalid-directory': '备份目录不可用于清单，请在服务器核对配置。', unavailable: '备份目录暂时不可读取，请在服务器核对挂载与权限。' };
  return <>
    <section className="space-y-3"><h3 className="text-sm font-medium">账号与认证会话</h3>{accounts?.available ? <CountGrid items={[
      ['账号', accounts.total], ['管理员角色账号', accounts.admins], ...(sessions?.available ? [['存续会话', sessions.surviving], ['近 24h 活跃会话', sessions.active24h], ['近 24h 活跃账号', sessions.activeUsers24h]] : []),
    ]} /> : <p className="text-xs text-muted-foreground">{accounts?.notice || '账号统计暂不可用。'}</p>}{sessions && <p className={`text-xs leading-relaxed ${sessions.available ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}>{sessions.notice}</p>}</section>
    {current && <section className="space-y-3"><h3 className="text-sm font-medium">API 进程</h3><dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-xs"><div><dt className="text-muted-foreground">运行时间</dt><dd className="mt-1 font-medium">{duration(current.uptimeSeconds)}</dd></div><div><dt className="text-muted-foreground">运行模式</dt><dd className="mt-1 font-medium">{current.runtime === 'production' ? '生产' : '本地'}</dd></div><div><dt className="text-muted-foreground">进程驻留内存 RSS</dt><dd className="mt-1 font-medium">{bytes(current.memoryBytes?.rss)}</dd></div><div><dt className="text-muted-foreground">JS 堆已用 / 总量</dt><dd className="mt-1 font-medium">{bytes(current.memoryBytes?.heapUsed)} / {bytes(current.memoryBytes?.heapTotal)}</dd></div></dl><p className="text-xs leading-relaxed text-muted-foreground">{current.notice}</p></section>}
    {config && <section className="space-y-3"><h3 className="text-sm font-medium">配置状态</h3>{config.available && <div className="grid gap-2 sm:grid-cols-2">{flags.map(([key, label]) => <div key={key} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"><span>{label}</span><Badge variant={config[key] ? 'secondary' : 'outline'}>{config[key] ? '是' : '否'}</Badge></div>)}</div>}<p className="text-xs leading-relaxed text-muted-foreground">{config.notice}</p></section>}
    {backups && <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">备份文件清单</h3>{backups.available && <span className="text-xs text-muted-foreground">{backups.scanComplete ? `${number(backups.totalFiles)} 个文件 · ${bytes(backups.totalBytes)}` : '部分清单'}</span>}</div>{backups.available ? backups.files?.length ? <ul className="divide-y rounded-lg border">{backups.files.map(file => <li key={file.name} className="space-y-1 p-3 text-xs"><p className="break-all font-medium">{file.name}</p><p className="text-muted-foreground">{stamp(file.modifiedAt)} · {bytes(file.bytes)}</p></li>)}</ul> : <p className="text-xs text-muted-foreground">当前目录没有可列出的备份文件。</p> : <p className="text-xs text-muted-foreground">{backupStatus[backups.status] || '备份清单暂不可用。'}</p>}{backups.truncated && <p className="text-xs text-amber-700 dark:text-amber-300">清单已达到展示或扫描上限，请在服务器查看其余文件。</p>}<p className="text-xs leading-relaxed text-muted-foreground">{backups.notice}</p><p className="text-xs leading-relaxed text-muted-foreground">“导出目录”只含校园目录。全系统恢复还需数据库、附件、私有配置与证书的一致备份，请按部署文档在独立环境恢复核验。</p></section>}
  </>;
}

export function MaintenanceOverview() {
  const snapshot = useAdminSnapshot('/admin/stats'), { data } = snapshot;
  return <section className="space-y-5"><SnapshotHeader {...snapshot} title="维护概览" description="汇总公开目录、内容维护与活动互动；点击刷新获取最新统计。" />{data && <>
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3 text-xs"><Database className="size-4" /><span>{data.storage?.shared ? '共享数据库存储' : '本地存储'}</span><Badge variant="outline">目录修订 {data.catalog?.revision}</Badge>{data.catalog?.isDemo && <Badge variant="outline">含示例资料</Badge>}<span className="text-muted-foreground">目录更新 {stamp(data.catalog?.updatedAt)}</span></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">目录资料</h3><CountGrid items={Object.entries(COLLECTION_NAMES).map(([key, label]) => [label, data.catalog?.counts?.[key]])} /><p className="text-xs text-muted-foreground">隐藏活动 {number(data.catalog?.hiddenEvents)} · 置顶活动 {number(data.catalog?.pinnedEvents)}</p></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">内容与互动</h3><CountGrid items={[
      ['公开帖子', data.engagement?.publishedPosts], ['隐藏帖子', data.engagement?.hiddenPosts], ['评论', data.engagement?.comments],
      ['点赞', data.engagement?.likes], ['收藏', data.engagement?.bookmarks], ['社区图片', data.engagement?.images],
      ['30 分钟有效排队报告', data.engagement?.activeQueueReports], ['菜品评价', data.engagement?.menuRatings], ['活动签到', data.engagement?.checkins],
      ['待处理反馈', data.engagement?.feedbackOpen], ['已解决反馈', data.engagement?.feedbackResolved],
    ]} /></div>
    {data.queue24h && <section className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">最近 24 小时排队反馈</h3><Badge variant="outline">{data.queue24h.complete ? '已覆盖完整 24 小时' : data.queue24h.trackingStartedAt ? '记录未满 24 小时' : '尚未开始记录'}</Badge></div><CountGrid items={[
      ['成功接收次数', data.queue24h.acceptedReports], ['有反馈的餐厅', data.queue24h.venuesWithReports],
      ...(data.queue24h.levels || []).map(level => [`${level.label}提交`, level.count]),
    ]} /><p className="text-xs leading-relaxed text-muted-foreground">{data.queue24h.coverageStartedAt ? `本次覆盖从 ${stamp(data.queue24h.coverageStartedAt)} 起至本次刷新。` : '从首次成功接收反馈开始记录，已有的 30 分钟反馈不会倒推成历史。'}{data.queue24h.notice}</p>{!!data.queue24h.venues?.length && <ul className="divide-y rounded-lg border">{data.queue24h.venues.map(venue => <li key={venue.venueId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span>{venue.name}</span><span className="text-muted-foreground">{number(venue.count)} 次</span></li>)}</ul>}</section>}
    <div className="space-y-3"><h3 className="text-sm font-medium">活动来源</h3><CountGrid items={[
      ['已配置来源', data.sources?.configured], ['定时开启', data.sources?.enabled], ['待审核草案', data.sources?.pendingDrafts], ['最近失败来源', data.sources?.failedSources], ['执行中来源', data.sources?.running],
    ]} /><p className="text-xs text-muted-foreground">最近同步成功 {stamp(data.sources?.lastSuccessAt)}。抓取结果需在“数据来源”审核发布。</p></div>
    <OperationsOverview data={data.operations} />
  </>}</section>;
}

function IssueList({ title, items, render, empty = '未发现此类问题。' }) {
  return <section className="space-y-2 rounded-xl border p-4"><h3 className="text-sm font-medium">{title}<Badge className="ml-2" variant="outline">{number(items.length)}</Badge></h3>{!items.length ? <p className="text-xs text-muted-foreground">{empty}</p> : <ul className="max-h-64 space-y-2 overflow-y-auto">{items.map((item, index) => <li key={index} className="break-words rounded-md bg-muted/40 p-2 text-xs leading-relaxed">{render(item)}</li>)}</ul>}</section>;
}

export function RoadNetworkDiagnostics({ catalog }) {
  const snapshot = useAdminSnapshot('/admin/diagnostics'), { data } = snapshot;
  const name = id => catalog.places.find(place => place.id === id)?.name || id;
  return <section className="space-y-5"><SnapshotHeader {...snapshot} title="路网诊断" description="检查已录入的道路连接和建筑轮廓，辅助维护导航。诊断使用目录坐标，现场可达性仍需核对。" />{data && <>
    <CountGrid items={[
      ['节点', data.summary?.nodes], ['可通行道路', data.summary?.walkableEdges], ['停用道路', data.summary?.closedEdges],
      ['独立连通区域', data.summary?.connectedComponents], ['孤立节点', data.summary?.isolatedNodes], ['未连路网地点', data.summary?.unconnectedPlaces],
    ]} />
    <div className="flex gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed"><Activity className="mt-0.5 size-4 shrink-0" /><p>一个完整步行网络通常属于同一连通区域。独立建筑或封闭区域可按实际情况保留；死胡同、相邻未连线只是核查候选，不会自动修改目录。</p></div>
    {data.truncated && <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 p-3 text-xs"><AlertCircle className="size-4 shrink-0" />部分候选结果已达到数量上限，请分区域检查并修复后刷新。</p>}
    <IssueList title="地点未连接路网" items={data.unconnectedPlaces || []} render={item => <><strong>{item.name || name(item.id)}</strong><span className="ml-2 text-muted-foreground">{item.id}</span><p className="mt-1">{item.reason}</p></>} />
    <div className="grid gap-3 sm:grid-cols-2"><IssueList title="孤立节点" items={data.isolatedNodeIds || []} render={item => item} /><IssueList title="道路尽头节点" items={data.deadEndNodeIds || []} empty="没有单一连接的道路尽头。" render={item => item} /></div>
    <IssueList title="邻近但未连线的节点" items={data.nearMisses || []} render={item => <>{item.from} → {item.to}<span className="ml-2 text-muted-foreground">约 {Math.round(item.distanceMeters)} 米</span></>} />
    <IssueList title="道路资料问题" items={data.edgeIssues || []} render={item => <><strong>{item.edgeId}</strong><p className="mt-1">{item.message}</p></>} />
    <IssueList title="建筑轮廓问题" items={data.polygonIssues || []} render={item => <><strong>{name(item.placeId)}</strong><span className="ml-2 text-muted-foreground">{item.polygonId}</span><p className="mt-1">{item.message}</p></>} />
    <IssueList title="连通区域" items={data.components || []} empty="尚无道路节点。" render={item => <><strong>{item.id}</strong><p className="mt-1 text-muted-foreground">节点 {item.nodeIds.length} · 地点 {item.placeIds.length}</p><p className="mt-1">{item.placeIds.map(name).join('、') || '没有关联地点'}</p></>} />
    <section className="space-y-2 rounded-xl border p-4"><h3 className="text-sm font-medium">无障碍路网</h3><p className="text-xs text-muted-foreground">独立连通区域 {number(data.accessible?.connectedComponents)} · 未接入无障碍路网地点 {number(data.accessible?.unconnectedPlaceIds?.length)}</p>{!!data.accessible?.unconnectedPlaceIds?.length && <p className="break-words text-xs leading-relaxed">{data.accessible.unconnectedPlaceIds.map(name).join('、')}</p>}<p className="text-[11px] leading-relaxed text-muted-foreground">结果取决于道路与入口的无障碍标记；请核对台阶、电梯、坡道和实际开放情况。</p></section>
  </>}</section>;
}
