import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Copy, GraduationCap, LayoutDashboard, ListTodo, LoaderCircle, Mail, Map, Maximize2, Paperclip, QrCode, Receipt, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ExperienceShell } from '@/components/experience-shell';
import { TOUR_CHAPTERS, TOUR_SCENES } from '@/lib/experience-tour';

const ICONS = { overview: LayoutDashboard, calendar: CalendarDays, todos: ListTodo, mail: Mail, campus: Map, traces: Activity, jobs: LoaderCircle, assistant: Sparkles, invoices: Receipt, recruitment: Users, 'work-assistant': Sparkles };
const DESTINATIONS = { overview: '/app', calendar: '/app/calendar', todos: '/app/todos', mail: '/app/mail', campus: '/campus', traces: '/app/traces', jobs: '/app/jobs', assistant: '/app', invoices: '/app/invoices', recruitment: '/app/recruitment', 'work-assistant': '/app' };

export default function ExperiencePage() {
  const [params, setParams] = useSearchParams();
  const chapter = TOUR_CHAPTERS.find(item => item.id === params.get('view')) || TOUR_CHAPTERS[0];
  const scene = TOUR_SCENES.find(item => item.id === chapter.scene);
  const chapters = TOUR_CHAPTERS.filter(item => item.scene === scene.id);
  const index = TOUR_CHAPTERS.indexOf(chapter);
  const [imageIndex, setImageIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState('');
  const [ShareDialog, setShareDialog] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const panel = useRef(null);
  const image = chapter.images[imageIndex] || chapter.images[0];
  const Icon = ICONS[chapter.id];

  useEffect(() => {
    const previous = document.title;
    document.title = '三分钟认识 Daylight · 功能导览';
    return () => { document.title = previous; };
  }, []);
  useEffect(() => { setImageIndex(0); setImageError(false); setCopied(''); setZoom(false); }, [chapter.id]);
  useEffect(() => { setImageError(false); }, [image.src]);

  function select(id, focus = false) {
    setParams({ view: id }, { preventScrollReset: true });
    if (focus) requestAnimationFrame(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  }
  async function copyPrompt(prompt) {
    try { await navigator.clipboard.writeText(prompt); setCopied(prompt); }
    catch { setCopied('复制失败，请选中文字复制。'); }
  }
  async function share() {
    setShareBusy(true); setShareError('');
    try {
      if (!ShareDialog) {
        const module = await import('@/components/campus-guide/share-dialog');
        setShareDialog(() => module.ShareDialog);
      }
      setShareOpen(true);
    } catch { setShareError('分享组件加载失败，请重试。'); }
    finally { setShareBusy(false); }
  }

  return <ExperienceShell active="experience">
    <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-amber-50 via-background to-background p-6 dark:from-amber-950/25 sm:p-10">
      <div className="pointer-events-none absolute -right-12 -top-20 size-72 rounded-full bg-amber-200/20 blur-3xl" aria-hidden="true" />
      <p className="relative text-xs font-semibold tracking-[.18em] text-amber-800 dark:text-amber-300">DAYLIGHT · 三分钟功能导览</p>
      <h1 className="relative mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">你的邮箱，<br className="sm:hidden" />不止一个收件箱。</h1>
      <p className="relative mt-5 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">从每天的安排，到校园里的去处，再到报销与招聘。跟着真实页面走一遍，找到 Daylight 能帮你做的事。</p>
      <div className="relative mt-6 flex flex-wrap gap-2">
        <Button className="min-h-11 rounded-full px-5" onClick={() => select(chapter.id, true)}>开始浏览<ArrowDown className="size-4" /></Button>
        <Button asChild variant="outline" className="min-h-11 rounded-full px-5"><Link to="/app">打开工作区<ArrowUpRight className="size-4" /></Link></Button>
        <Button variant="ghost" className="min-h-11 rounded-full" disabled={shareBusy} onClick={share}>{shareBusy ? <LoaderCircle className="size-4 animate-spin" /> : <QrCode className="size-4" />}手机接着看</Button>
      </div>
      {shareError && <p role="alert" className="mt-2 text-sm text-destructive">{shareError}</p>}
      <p className="relative mt-5 text-xs leading-6 text-muted-foreground">免登录浏览 · 截图来自实际页面 · 校园日常以上科大邮箱为例，工作事务以 QQ 邮箱为例</p>
    </div>

    <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="选择导览场景">
      {TOUR_SCENES.map((item, i) => <button key={item.id} onClick={() => select(TOUR_CHAPTERS.find(c => c.scene === item.id).id)} aria-pressed={scene.id === item.id} className={`group flex min-h-24 min-w-0 items-center gap-4 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5 ${scene.id === item.id ? 'border-foreground/70 bg-foreground text-background' : 'bg-background hover:bg-muted/50'}`}>
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${scene.id === item.id ? 'bg-background/15' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{i ? <Receipt className="size-5" /> : <GraduationCap className="size-5" />}</span>
        <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{item.title}<span className="ml-2 text-xs font-normal opacity-65">{item.mailbox}</span></span><span className="mt-1 block text-xs leading-6 opacity-70">{item.description}</span></span>
        <ArrowRight className="size-4 shrink-0" />
      </button>)}
    </div>

    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6">
        <p className="mb-3 hidden text-xs font-medium tracking-wider text-muted-foreground lg:block">{scene.title} / {chapters.length} 个入口</p>
        <nav aria-label={`${scene.title}功能目录`} className="hidden space-y-1 lg:block">
          {chapters.map((item, i) => { const ItemIcon = ICONS[item.id]; return <Button key={item.id} variant={chapter.id === item.id ? 'secondary' : 'ghost'} className="min-h-12 w-full justify-start gap-3 px-3" aria-current={chapter.id === item.id ? 'step' : undefined} onClick={() => select(item.id)}><ItemIcon className="size-4" />{item.label}<span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{String(i + 1).padStart(2, '0')}</span></Button>; })}
        </nav>
        <label className="block lg:hidden"><span className="mb-2 block text-xs text-muted-foreground">选择想了解的功能 · {scene.mailbox}</span><select className="h-12 w-full min-w-0 rounded-xl border bg-background px-3 text-sm" value={chapter.id} onChange={event => select(event.target.value)}>{chapters.map((item, i) => <option key={item.id} value={item.id}>{String(i + 1).padStart(2, '0')} · {item.label}</option>)}</select></label>
        <div className="mt-5 hidden border-t pt-5 text-xs leading-6 text-muted-foreground lg:block"><p className="font-medium text-foreground">先认路，再动手</p><p className="mt-1">按顺序浏览，或直接选择感兴趣的功能。每张截图都可放大查看。</p></div>
      </aside>

      <section ref={panel} tabIndex={-1} aria-label="当前功能介绍" className="min-w-0 scroll-mt-6 outline-none">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40"><Icon className="size-5" /></span>
          <div className="min-w-0"><p className="text-xs leading-5 text-muted-foreground">{scene.mailbox} · {chapter.label}</p><h2 className="mt-1 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{chapter.title}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{chapter.description}</p></div>
        </div>

        <figure className="overflow-hidden rounded-2xl border bg-muted/20">
          <div className="flex min-h-10 items-center gap-3 border-b bg-background px-4 py-2"><span className="flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-amber-400" /><span className="size-2 rounded-full bg-muted-foreground/20" /><span className="size-2 rounded-full bg-muted-foreground/20" /></span><span className="min-w-0 flex-1 text-xs text-muted-foreground">Daylight / {image.label}</span><span className="shrink-0 text-[10px] text-muted-foreground">实际页面</span></div>
          <button className="group relative block w-full cursor-zoom-in bg-white text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => setZoom(true)} aria-label={`放大查看：${image.label}`}>
            {imageError ? <span className="flex aspect-video items-center justify-center p-6 text-sm">图片暂时无法加载，点击查看原图。</span> : <img key={image.src} src={image.preview} srcSet={`${image.preview} 1280w, ${image.src} ${image.width}w`} sizes="(min-width: 1280px) 960px, (min-width: 1024px) calc(100vw - 320px), calc(100vw - 32px)" alt={image.alt} width={image.width} height={image.height} loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} onError={() => setImageError(true)} className="h-auto w-full" />}
            <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border bg-white/95 px-3 py-2 text-xs shadow-sm"><Maximize2 className="size-3.5" />放大查看</span>
          </button>
          <figcaption className="border-t bg-background px-4 py-3 text-xs leading-6 text-muted-foreground">{image.caption}</figcaption>
        </figure>
        {chapter.images.length > 1 && <div className="mt-3 flex flex-wrap gap-2" aria-label="选择页面截图">{chapter.images.map((item, i) => <Button key={item.src} variant={i === imageIndex ? 'secondary' : 'outline'} className="min-h-11 rounded-full text-xs" aria-pressed={i === imageIndex} onClick={() => setImageIndex(i)}>{item.label}</Button>)}</div>}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">{chapter.points.map((point, i) => <Card key={point.title} className="gap-0 rounded-xl py-0 shadow-none"><CardContent className="p-4"><span className="text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300">0{i + 1}</span><h3 className="mt-2 text-sm font-semibold">{point.title}</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">{point.text}</p></CardContent></Card>)}</div>

        {chapter.prompts && <div className="mt-5 rounded-2xl border bg-muted/25 p-4 sm:p-5"><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-amber-600" />可以这样问小 D</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">复制后粘贴到对应邮箱的小 D 中，按需修改日期、收件人和时间。</p><div className="mt-3 space-y-2">{chapter.prompts.map(prompt => <button key={prompt} className="flex min-h-12 w-full items-start gap-3 rounded-xl border bg-background p-3 text-left text-sm leading-6 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => copyPrompt(prompt)}><span className="min-w-0 flex-1">{prompt}</span>{copied === prompt ? <Check className="mt-1 size-4 shrink-0 text-emerald-600" /> : <Copy className="mt-1 size-4 shrink-0 text-muted-foreground" />}<span className="sr-only">复制示例问法</span></button>)}</div><p role="status" className="mt-2 min-h-5 text-xs text-muted-foreground">{copied ? copied.startsWith('复制失败') ? copied : '已复制，打开小 D 即可使用。' : ''}</p></div>}

        <div className="mt-5 flex items-start gap-2 text-xs leading-6 text-muted-foreground"><Paperclip className="mt-1 size-3.5 shrink-0" /><p>{chapter.note}</p></div>
        <Button asChild variant="outline" className="mt-4 min-h-11"><Link to={DESTINATIONS[chapter.id]}>{chapter.id === 'campus' ? '打开校园生活' : `在工作区打开${chapter.label}`}<ArrowUpRight className="size-4" /></Link></Button>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button variant="ghost" className="min-h-11 px-2" disabled={index === 0} onClick={() => select(TOUR_CHAPTERS[index - 1].id, true)}><ArrowLeft className="size-4" />上一站</Button>
          <span className="text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')} / {TOUR_CHAPTERS.length}</span>
          {index < TOUR_CHAPTERS.length - 1 ? <Button className="min-h-11 max-w-full" onClick={() => select(TOUR_CHAPTERS[index + 1].id, true)}>下一站 · {TOUR_CHAPTERS[index + 1].label}<ArrowRight className="size-4" /></Button> : <Button asChild className="min-h-11"><Link to="/app">去工作区试试<ArrowUpRight className="size-4" /></Link></Button>}
        </div>
      </section>
    </div>

    <section className="mt-12 rounded-2xl border bg-muted/25 p-6 sm:p-8" aria-label="开始使用"><h2 className="text-xl font-semibold">把这些能力，接到你自己的邮箱。</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">登录后在设置中连接邮箱、配置模型，完成第一次同步；日程、待办与来源邮件会在工作区关联起来。校园地图与菜单，也可以先直接逛逛。</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild className="min-h-11"><Link to="/login">连接我的邮箱<Mail className="size-4" /></Link></Button><Button asChild variant="outline" className="min-h-11"><Link to="/campus">探索校园生活<Map className="size-4" /></Link></Button><Button asChild variant="ghost" className="min-h-11"><Link to="/evidence">查看技术与实测<ArrowUpRight className="size-4" /></Link></Button></div></section>

    <Dialog open={zoom} onOpenChange={setZoom}><DialogContent className="w-[calc(100%-1rem)] max-w-none gap-3 p-3 sm:max-w-[min(96vw,1600px)] sm:p-5"><DialogTitle className="pr-8 text-base">{image.label}</DialogTitle><DialogDescription className="text-xs leading-6">{image.caption} 窄屏可左右滑动查看完整页面。</DialogDescription><div className="overflow-auto rounded-lg border bg-white"><img src={image.src} alt={image.alt} width={image.width} height={image.height} className="h-auto w-full min-w-[1000px]" /></div><a href={image.src} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 text-sm underline underline-offset-4">在新标签页查看原图<ArrowUpRight className="size-4" /></a></DialogContent></Dialog>
    {ShareDialog && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} url={`${window.location.origin}/experience?view=${chapter.id}`} title={`三分钟认识 Daylight · ${chapter.label}`} description={`扫码继续了解${scene.mailbox}的${chapter.label}功能。`} footer="当前功能已包含在链接中，可在手机继续浏览。" downloadName={`daylight-tour-${chapter.id}.png`} />}
  </ExperienceShell>;
}
