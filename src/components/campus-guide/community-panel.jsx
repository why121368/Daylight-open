import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, ChevronLeft, ChevronRight, Heart, ImagePlus, MessageSquare, Plus, Reply, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { guideRequest, TOPIC_LABELS, dayLabel, clock } from '@/lib/campus-guide-client';
import { getAuthToken } from '@/lib/auth-api';
import { useGuide } from './guide-context';
import { PanelHeading } from './guide-panels';

const BOARDS = { campus: '校园广场', events: '活动交流', food: '美食交流', places: '地点交流' };
const EMPTY_FILTER = { board: '', placeId: '', eventId: '', venueId: '', windowId: '' };
const SELECT_CLASS = 'h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm disabled:opacity-50';

export function CommunityImage({ src, alt = '校园笔记配图', className = '', ...props }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '', active = true;
    setUrl(''); setFailed(false);
    const timeout = setTimeout(() => { if (active) { setFailed(true); controller.abort(); } }, 20000);
    fetch(src, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('图片暂时无法读取'); return response.blob(); })
      .then(blob => { if (active && !controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => { if (active) setFailed(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (failed) return <span className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border bg-muted p-3 text-xs text-muted-foreground ${className}`} role="img" aria-label={`${alt}加载失败`}><span>图片暂时无法显示</span><span className="text-[10px]">可稍后重新打开查看</span></span>;
  return url ? <img src={url} alt={alt} className={className} {...props} onError={() => setFailed(true)} /> : <span className={`grid min-h-20 place-items-center rounded-lg border bg-muted text-[10px] text-muted-foreground ${className}`} role="status" aria-label={`正在加载${alt}`}>图片加载中</span>;
}

function AssociationFields({ value, onChange, catalog, prefix = '关联' }) {
  const set = (key, next) => onChange({ ...value, [key]: next, ...(key === 'venueId' ? { windowId: '' } : {}) });
  const windows = catalog.venues.find(venue => venue.id === value.venueId)?.windows || [];
  const select = (key, label, options, disabled = false) => <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{label}</span><select className={SELECT_CLASS} aria-label={label} value={value[key] || ''} disabled={disabled} onChange={event => set(key, event.target.value)}><option value="">不限 / 不关联</option>{options.map(row => <option key={row.id} value={row.id}>{row.name || row.title}</option>)}</select></label>;
  return <div className="grid gap-3 sm:grid-cols-2">
    {select('placeId', `${prefix}地点`, catalog.places)}
    {select('eventId', `${prefix}活动`, catalog.events.filter(event => !event.hidden))}
    {select('venueId', `${prefix}食堂`, catalog.venues)}
    {select('windowId', `${prefix}窗口`, windows, !value.venueId)}
  </div>;
}

function PostAssociations({ post, catalog }) {
  const venue = catalog.venues.find(row => row.id === post.venueId);
  const labels = [catalog.places.find(row => row.id === post.placeId)?.name, catalog.events.find(row => row.id === post.eventId)?.title, venue?.name, venue?.windows.find(row => row.id === post.windowId)?.name].filter(Boolean);
  return <div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline">{BOARDS[post.board || 'campus'] || BOARDS.campus}</Badge><Badge variant="secondary">{TOPIC_LABELS[post.topic]}</Badge>{[...new Set(labels)].map(label => <span key={label} className="max-w-full break-words text-xs text-muted-foreground">{label}</span>)}</div>;
}

function PostComposer({ open, onOpenChange, onPublished }) {
  const { user, catalog, selectedPlaceId, communityFilter = EMPTY_FILTER, run, busy } = useGuide();
  const emptyForm = () => ({ title: '', body: '', topic: 'share', images: [], board: communityFilter.board || 'campus', placeId: communityFilter.placeId || selectedPlaceId || '', eventId: communityFilter.eventId || '', venueId: communityFilter.venueId || '', windowId: communityFilter.windowId || '' });
  const [form, setForm] = useState(emptyForm);
  useEffect(() => { if (open) setForm(emptyForm()); }, [open]);
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  async function upload(files) {
    return run('上传社区图片', async () => {
      if (form.images.length + files.length > 4) throw new Error('每篇笔记最多选择 4 张图片。');
      if (files.some(file => file.size > 5 * 1024 * 1024)) throw new Error('单张图片最大 5 MB。');
      for (const file of files) {
        const response = await fetch('/api/campus-guide/community/images', { method: 'POST', headers: { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '上传失败');
        setForm(previous => ({ ...previous, images: [...previous.images, result.url] }));
      }
    });
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90svh] overflow-y-auto"><DialogHeader><DialogTitle>写一篇校园笔记</DialogTitle><DialogDescription>发布后所有访客可见。请仅分享可公开的文字和图片，勿填写取件码、手机号或私人邮件。</DialogDescription></DialogHeader>{!user ? <Button asChild><Link to="/login" state={{ from: { pathname: '/campus', search: '?tab=community' } }}>登录后发布</Link></Button> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); run('发布校园笔记', async () => { await guideRequest('/community/posts', 'POST', form); onOpenChange(false); await onPublished(); toast.success('笔记已发布'); }); }}>
    <Input required value={form.title} onChange={event => set('title', event.target.value)} maxLength={150} aria-label="笔记标题" placeholder="给这篇笔记起个标题" />
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground"><span>交流分区</span><select className={SELECT_CLASS} value={form.board} onChange={event => set('board', event.target.value)} aria-label="笔记交流分区">{Object.entries(BOARDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="space-y-1 text-xs text-muted-foreground"><span>笔记类型</span><select className={SELECT_CLASS} value={form.topic} onChange={event => set('topic', event.target.value)} aria-label="笔记类型">{Object.entries(TOPIC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <AssociationFields value={form} onChange={setForm} catalog={catalog} />
    <Textarea required value={form.body} maxLength={15000} className="min-h-36" onChange={event => set('body', event.target.value)} placeholder="分享发现、经验，或一个想和大家讨论的问题…" aria-label="笔记正文" />
    <label className="grid gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><ImagePlus className="size-4" />最多 4 张 PNG / JPEG / WebP，每张 5 MB</span><Input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!busy} aria-label="上传社区图片" onChange={event => { const files = [...(event.target.files || [])]; if (files.length) upload(files); event.target.value = ''; }} /></label>
    {form.images.length > 0 && <div className="flex flex-wrap gap-2">{form.images.map(url => <div key={url} className="relative"><CommunityImage src={url} className="size-20 rounded-lg border object-cover" alt="待发布图片" /><button type="button" aria-label="移除待发布图片" className="absolute top-0 right-0 rounded bg-background p-1 text-xs" onClick={() => set('images', form.images.filter(item => item !== url))}>×</button></div>)}</div>}
    <Button type="submit" disabled={!!busy}>发布笔记</Button>
  </form>}</DialogContent></Dialog>;
}

export function CommunityPanel() {
  const { user, isAdmin, catalog, run, busy, communityFilter = EMPTY_FILTER, setCommunityFilter } = useGuide();
  const [result, setResult] = useState({ posts: [], total: 0 }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [query, setQuery] = useState(''), [topic, setTopic] = useState(''), [sort, setSort] = useState('latest'), [page, setPage] = useState(1), [view, setView] = useState('');
  const [composer, setComposer] = useState(false), [detail, setDetail] = useState(null), [comment, setComment] = useState(''), [parentId, setParentId] = useState('');
  const [summary, setSummary] = useState(null), [summaryConsent, setSummaryConsent] = useState(false), [deletePost, setDeletePost] = useState(null), [gallery, setGallery] = useState(null);
  const loadSequence = useRef(0), detailSequence = useRef(0);
  const filterSignature = JSON.stringify({ ...EMPTY_FILTER, ...communityFilter });
  const params = useMemo(() => new URLSearchParams({ q: query, topic, sort, filter: view, page: String(page), ...JSON.parse(filterSignature) }).toString(), [query, topic, sort, view, page, filterSignature]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current; setLoading(true);
    try { const data = await guideRequest(`/community/posts?${params}`); if (sequence === loadSequence.current) { setResult(data); setError(''); if (page > 1 && !data.posts.length) setPage(Math.max(1, Math.ceil(data.total / (data.pageSize || 20)))); } return data; }
    catch (failure) { if (sequence === loadSequence.current) setError(failure.message); throw failure; }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [params, page, user?.id]);
  useEffect(() => { detailSequence.current++; setResult({ posts: [], total: 0 }); setDetail(null); setGallery(null); setSummary(null); setView(''); setPage(1); }, [user?.id]);
  useEffect(() => { setPage(1); }, [query, topic, sort, view, filterSignature]);
  useEffect(() => { setLoading(true); const timer = setTimeout(() => load().catch(() => {}), 180); return () => { clearTimeout(timer); loadSequence.current++; }; }, [load]);
  async function openPost(id) { const sequence = ++detailSequence.current, next = await guideRequest(`/community/posts/${id}`); if (sequence === detailSequence.current) { setDetail(next); setComment(''); setParentId(''); } }
  async function reaction(post, kind) {
    if (!user) { toast.message('登录后可点赞、收藏和评论。'); return; }
    await run('保存互动', async () => {
      const data = await guideRequest(`/community/posts/${post.id}/${kind}`, 'PUT', { active: !(kind === 'like' ? post.liked : post.bookmarked) });
      setResult(previous => ({ ...previous, posts: previous.posts.map(item => item.id === post.id ? data.post : item) }));
      setDetail(previous => previous?.post.id === post.id ? { ...previous, post: data.post } : previous);
      if (view === 'bookmarked' && kind === 'bookmark' && !data.post.bookmarked) await load();
    });
  }
  function changeBoard(board) { setCommunityFilter?.({ ...EMPTY_FILTER, board }); setView(''); setPage(1); }
  function personalView(next) { setView(view === next ? '' : next); setCommunityFilter?.({ ...EMPTY_FILTER }); setTopic(''); setQuery(''); setPage(1); }
  const posts = result.posts, hasReferences = ['placeId', 'eventId', 'venueId', 'windowId'].some(key => communityFilter[key]);
  const discussionSignature = JSON.stringify({ params, posts: posts.map(post => [post.id, post.updatedAt, post.commentCount, post.status]) });
  const summaryStale = summary && summary.sourceSignature !== discussionSignature;
  const moveGallery = direction => setGallery(previous => previous ? { ...previous, index: (previous.index + direction + previous.images.length) % previous.images.length } : previous);

  return <>
    <PanelHeading eyebrow="CAMPUS CONVERSATIONS" title="校园里，一起聊聊" description="好吃的窗口、活动见闻和实用攻略，都可以成为下一次出发的参考。"><Button size="icon" variant="outline" aria-label="发布校园笔记" onClick={() => setComposer(true)}><Plus className="size-4" /></Button></PanelHeading>
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="交流分区"><Button size="sm" variant={!communityFilter.board ? 'secondary' : 'outline'} aria-pressed={!communityFilter.board} onClick={() => changeBoard('')}>全部分区</Button>{Object.entries(BOARDS).map(([id, label]) => <Button key={id} size="sm" variant={communityFilter.board === id ? 'secondary' : 'outline'} aria-pressed={communityFilter.board === id} onClick={() => changeBoard(id)}>{label}</Button>)}</div>
    <details open={hasReferences || undefined} className="rounded-lg border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">按地点、活动、食堂或窗口筛选{hasReferences ? ' · 已限定关联' : ''}</summary><div className="mt-3 space-y-3"><AssociationFields value={communityFilter} onChange={value => { setCommunityFilter?.(value); setPage(1); }} catalog={catalog} prefix="筛选" />{hasReferences && <Button size="sm" variant="ghost" onClick={() => setCommunityFilter?.({ ...EMPTY_FILTER, board: communityFilter.board || '' })}>清除关联条件</Button>}</div></details>
    <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索校园交流" placeholder="搜索笔记或问题" />
    <div className="flex flex-wrap gap-1.5"><Button size="sm" variant={!topic ? 'secondary' : 'outline'} onClick={() => setTopic('')}>全部类型</Button>{Object.entries(TOPIC_LABELS).map(([id, label]) => <Button key={id} variant={topic === id ? 'secondary' : 'outline'} size="sm" onClick={() => setTopic(topic === id ? '' : id)}>{label}</Button>)}</div>
    <div className="flex flex-wrap items-center gap-2"><Button variant={sort === 'latest' && !view ? 'secondary' : 'ghost'} size="sm" onClick={() => { setSort('latest'); setView(''); }}>最新</Button><Button variant={sort === 'popular' && !view ? 'secondary' : 'ghost'} size="sm" onClick={() => { setSort('popular'); setView(''); }}>热门</Button>{user && <><Button variant={view === 'bookmarked' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'bookmarked'} onClick={() => personalView('bookmarked')}>我的收藏</Button><Button variant={view === 'mine' ? 'secondary' : 'ghost'} size="sm" onClick={() => personalView('mine')}>我的笔记</Button></>}<Button variant="outline" size="sm" className="ml-auto" onClick={() => setSummaryConsent(true)}><Sparkles className="size-3.5" />总结讨论</Button></div>
    {view === 'bookmarked' && <p className="text-xs text-muted-foreground">查看所有分区的个人收藏；筛选和搜索可继续缩小范围。</p>}
    {error && <p role="alert" className="rounded-lg border p-4 text-sm text-destructive">{error}<Button size="sm" variant="ghost" onClick={() => load().catch(() => {})}>重试</Button></p>}
    {summary && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30"><h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" />讨论摘要{summaryStale && <Badge variant="outline">内容已变化</Badge>}</h2>{summaryStale && <p className="text-xs text-amber-800 dark:text-amber-200">列表或讨论已更新，这份摘要仍基于生成时的内容。需要时可重新总结当前页。</p>}<p className="whitespace-pre-wrap text-sm leading-relaxed">{summary.summary}</p>{summary.references?.length > 0 && <div className="flex flex-wrap gap-1">{summary.references.map(id => <Button key={id} size="sm" variant="outline" onClick={() => run('读取引用笔记', () => openPost(id))}>{summary.sourceTitles[id] || '查看引用笔记'}</Button>)}</div>}{summary.openQuestions?.length > 0 && <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">{summary.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>}<p className="text-[11px] text-muted-foreground">基于 {summary.postCount} 篇公开笔记 · {summary.mode === 'model' ? '已调用配置模型' : '提取摘要'}</p></section>}
    {loading && <p role="status" className="text-xs text-muted-foreground">正在读取笔记…</p>}
    {!loading && !error && !posts.length && <div className="rounded-xl border border-dashed p-8 text-center"><MessageSquare className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">这里还没有匹配的笔记。</p><Button variant="ghost" size="sm" className="mt-2" onClick={() => setComposer(true)}>分享第一个发现</Button></div>}
    <div className="space-y-4">{posts.map(post => <article key={post.id} className="space-y-3 rounded-xl border p-4"><button type="button" className="w-full space-y-2 text-left" onClick={() => run('读取笔记', () => openPost(post.id))}><PostAssociations post={post} catalog={catalog} /><h2 className="break-words text-base font-semibold">{post.title}</h2><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{post.body}</p>{post.images.length > 0 && <div className="grid grid-cols-3 gap-2">{post.images.slice(0, 3).map(url => <CommunityImage key={url} src={url} alt="校园笔记配图" loading="lazy" className="aspect-square w-full rounded-lg border object-cover" />)}</div>}</button><div className="flex flex-wrap items-center justify-between gap-1"><p className="min-w-0 truncate text-[11px] text-muted-foreground">{post.authorName} · {dayLabel(post.createdAt)}</p><div className="flex shrink-0"><Button variant="ghost" size="sm" aria-label="点赞笔记" aria-pressed={post.liked} disabled={!!busy} onClick={() => reaction(post, 'like')}><Heart className="size-3.5" fill={post.liked ? 'currentColor' : 'none'} />{post.likeCount}</Button><Button variant="ghost" size="sm" aria-label={post.bookmarked ? '取消收藏笔记' : '收藏笔记'} aria-pressed={post.bookmarked} disabled={!!busy} onClick={() => reaction(post, 'bookmark')}><Bookmark className="size-3.5" fill={post.bookmarked ? 'currentColor' : 'none'} />{post.bookmarked && <span className="text-xs">已收藏</span>}</Button><Button variant="ghost" size="sm" aria-label="查看评论" onClick={() => run('读取评论', () => openPost(post.id))}><MessageSquare className="size-3.5" />{post.commentCount}</Button></div></div></article>)}</div>
    {result.total > 20 && <div className="flex items-center justify-between"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>上一页</Button><span className="text-xs text-muted-foreground">{page} / {Math.ceil(result.total / 20)}</span><Button size="sm" variant="outline" disabled={page * 20 >= result.total || loading} onClick={() => setPage(page + 1)}>下一页</Button></div>}
    <PostComposer open={composer} onOpenChange={setComposer} onPublished={load} />
    <Dialog open={!!detail} onOpenChange={open => { if (!open) { detailSequence.current++; setDetail(null); } }}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">{detail && <>
      <DialogHeader><DialogTitle className="break-words leading-relaxed">{detail.post.title}</DialogTitle><DialogDescription>{detail.post.authorName} · {dayLabel(detail.post.createdAt)} {clock(detail.post.createdAt)}</DialogDescription></DialogHeader>
      <PostAssociations post={detail.post} catalog={catalog} /><p className="whitespace-pre-wrap break-words text-sm leading-7">{detail.post.body}</p>
      <div className="grid gap-3 sm:grid-cols-2">{detail.post.images.map((url, index) => <button key={url} type="button" aria-label={`查看第 ${index + 1} 张图片`} onClick={() => setGallery({ images: detail.post.images, index, title: detail.post.title })}><CommunityImage src={url} alt={`校园笔记图片 ${index + 1}`} className="max-h-96 w-full rounded-lg border object-contain" /></button>)}</div>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" aria-label="点赞笔记" aria-pressed={detail.post.liked} disabled={!!busy || detail.post.status !== 'published'} onClick={() => reaction(detail.post, 'like')}><Heart className="size-4" fill={detail.post.liked ? 'currentColor' : 'none'} />{detail.post.likeCount}</Button><Button size="sm" variant="outline" aria-pressed={detail.post.bookmarked} disabled={!!busy || detail.post.status !== 'published'} onClick={() => reaction(detail.post, 'bookmark')}><Bookmark className="size-4" fill={detail.post.bookmarked ? 'currentColor' : 'none'} />{detail.post.bookmarked ? '已收藏' : '收藏'}</Button>{(detail.post.authorId === user?.id || isAdmin) && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDeletePost(detail.post.id)}><Trash2 className="size-3.5" />删除笔记</Button>}</div>
      <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">{detail.comments.length} 条评论</h3>{detail.comments.map(item => <div key={item.id} className={`space-y-1 rounded-lg bg-muted/60 p-3 ${item.parentId ? 'ml-5' : ''}`}><div className="flex justify-between gap-3"><p className="text-xs font-medium">{item.authorName}{item.parentId && ' · 回复评论'}</p><button type="button" className="text-xs text-muted-foreground disabled:opacity-40" aria-label={`回复${item.authorName}的评论`} disabled={!user || detail.post.status !== 'published'} onClick={() => setParentId(item.id)}><Reply className="size-3.5" /></button></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.body}</p>{(item.authorId === user?.id || isAdmin) && <button type="button" className="text-[10px] text-muted-foreground underline" onClick={() => run('删除评论', async () => { await guideRequest(`/community/posts/${detail.post.id}/comments/${item.id}`, 'DELETE'); await openPost(detail.post.id); await load(); })}>删除评论</button>}</div>)}</section>
      {user && detail.post.status === 'published' ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); run('发布评论', async () => { await guideRequest(`/community/posts/${detail.post.id}/comments`, 'POST', { body: comment, parentId }); await openPost(detail.post.id); await load(); }); }}>{parentId && <button type="button" className="text-left text-xs text-muted-foreground" onClick={() => setParentId('')}>正在回复评论 · 点击取消</button>}<Textarea required maxLength={3000} value={comment} onChange={event => setComment(event.target.value)} aria-label="评论内容" placeholder="写下你的想法…" /><Button type="submit" disabled={!!busy}>发布评论</Button></form> : <p className="text-xs text-muted-foreground">{user ? '这篇笔记暂不开放互动。' : '登录后可以评论和回复。'}</p>}
    </>}</DialogContent></Dialog>
    <Dialog open={!!gallery} onOpenChange={open => !open && setGallery(null)}><DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-3xl" onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); moveGallery(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); moveGallery(1); } }}>{gallery && <><DialogHeader><DialogTitle>笔记图片 · {gallery.index + 1} / {gallery.images.length}</DialogTitle><DialogDescription>{gallery.title}</DialogDescription></DialogHeader><CommunityImage key={gallery.images[gallery.index]} src={gallery.images[gallery.index]} alt={`笔记图片 ${gallery.index + 1}`} className="max-h-[65svh] w-full rounded-lg object-contain" /><div className="flex items-center justify-between"><Button variant="outline" aria-label="上一张图片" disabled={gallery.images.length < 2} onClick={() => moveGallery(-1)}><ChevronLeft />上一张</Button><Button variant="outline" aria-label="下一张图片" disabled={gallery.images.length < 2} onClick={() => moveGallery(1)}>下一张<ChevronRight /></Button></div></>}</DialogContent></Dialog>
    <Dialog open={summaryConsent} onOpenChange={setSummaryConsent}><DialogContent><DialogHeader><DialogTitle>总结当前讨论</DialogTitle><DialogDescription>会把当前页筛选的公开笔记和评论提交给你配置的模型，可能产生费用。摘要附原帖引用；没有模型时会明确提示。</DialogDescription></DialogHeader><Button disabled={!user || !!busy || loading || !posts.some(post => post.status === 'published')} onClick={() => run('总结校园讨论', async () => { const result = await guideRequest('/community/summary', 'POST', { postIds: posts.filter(post => post.status === 'published').map(post => post.id) }); setSummary({ ...result, sourceSignature: discussionSignature, sourceTitles: Object.fromEntries(posts.map(post => [post.id, post.title])) }); setSummaryConsent(false); })}>{user ? '提交当前讨论并生成摘要' : '请先登录并配置模型'}</Button></DialogContent></Dialog>
    <Dialog open={!!deletePost} onOpenChange={open => !open && setDeletePost(null)}><DialogContent><DialogHeader><DialogTitle>删除这篇笔记？</DialogTitle><DialogDescription>笔记与配图将不再对游客公开，评论也随笔记隐藏。</DialogDescription></DialogHeader><Button variant="destructive" disabled={!!busy} onClick={() => run('删除笔记', async () => { await guideRequest(`/community/posts/${deletePost}`, 'DELETE'); setDeletePost(null); setDetail(null); await load(); })}>确认删除</Button></DialogContent></Dialog>
  </>;
}
