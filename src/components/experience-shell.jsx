import React, { useLayoutEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PublicThemeControls } from '@/components/public-theme-controls';

export function ExperienceShell({ children, active }) {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Keep the literal fragment. */ }
    const section = id ? document.getElementById(id) : null;
    if (section) section.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return <div className="min-h-dvh bg-background text-foreground selection:bg-emerald-200/60">
    <a href="#experience-main" className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">跳到主要内容</a>
    <header className="border-b bg-background/95">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Sun className="size-6 text-amber-500" />Daylight</Link>
        <nav aria-label="体验导航" className="flex flex-wrap items-center gap-1 sm:gap-3">
          <Button asChild variant={active === 'experience' ? 'secondary' : 'ghost'} className="min-h-11 px-3"><Link to="/experience" aria-current={active === 'experience' ? 'page' : undefined}>三分钟体验</Link></Button>
          <Button asChild variant={active === 'evidence' ? 'secondary' : 'ghost'} className="min-h-11 px-3"><Link to="/evidence" aria-current={active === 'evidence' ? 'page' : undefined}>技术与实测</Link></Button>
          <span className="hidden sm:inline-flex"><PublicThemeControls /></span>
          <Button asChild variant="outline" className="min-h-11 px-3"><Link to="/login">登录<span className="hidden sm:inline">工作区</span><ArrowUpRight className="size-4" /></Link></Button>
        </nav>
      </div>
    </header>
    <main id="experience-main" className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-8 sm:pt-12">{children}</main>
    <footer className="border-t px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-center text-sm leading-7 text-muted-foreground">
      <p>让分散的信息，成为可追踪的下一步。</p>
      <div className="flex flex-wrap justify-center gap-x-5 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center"><Link to="/demo" className="underline underline-offset-4">分章讲解</Link><Link to="/campus" className="underline underline-offset-4">校园生活</Link><a href="/competition/technical-report.html" className="underline underline-offset-4">技术报告</a><Link to="/legal/privacy" className="underline underline-offset-4">隐私政策</Link><a href="/competition/reproduce.html" className="underline underline-offset-4">源码与复现</a></div>
    </footer>
  </div>;
}
