import React, { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CaptchaField } from '@/components/captcha-field';
import { AuthShell } from '@/pages/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authRequest, setAuthToken } from '@/lib/auth-api';
import { useAuthUser } from '@/lib/auth-session';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const requested = location.state?.from;
  const returnTo = requested?.pathname === '/campus' ? `/campus${typeof requested.search === 'string' && requested.search.startsWith('?') ? requested.search : ''}` : '/app';
  const { refresh, demo } = useAuthUser();
  const captchaRef = useRef(null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [busy, setBusy] = useState(false);

  async function enterDemo() {
    setBusy(true);
    try {
      const challenge = await authRequest('/auth/captcha');
      const result = await authRequest('/auth/login', 'POST', {
        account: demo.account, password: demo.password, captchaId: challenge.id, captchaText: challenge.text,
      });
      setAuthToken(result.token);
      await refresh();
      localStorage.setItem('daylight.onboarding.v2', JSON.stringify({ tourDone: true, syncPromptDone: true }));
      navigate('/app', { replace: true });
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await authRequest('/auth/login', 'POST', {
        account, password, captchaId, captchaText: captcha,
      });
      setAuthToken(result.token);
      await refresh();
      // 仅新用户（从未完成指引）才在登录后提示；老用户刷新/重登不再闪弹窗
      try {
        const progress = JSON.parse(localStorage.getItem('daylight.onboarding.v2')
          || localStorage.getItem('daylight.onboarding.v1')
          || '{}');
        if (!(progress.tourDone && progress.syncPromptDone)) {
          localStorage.setItem('daylight.pending-onboarding', '1');
        }
      } catch { /* ignore */ }
      toast.success(`欢迎回来，${result.user.username}`);
      navigate(returnTo, { replace: true });
    } catch (error) {
      toast.error(error.message);
      captchaRef.current?.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="欢迎回来"
      subtitle="使用邮箱或用户名登录，进入 Daylight 工作空间。"
      footer={(
        <>
          还没有账号？{' '}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/register" state={location.state}>免费注册</Link>
        </>
      )}
    >
      {!demo && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-semibold">登录体验账号</p>
        <p>体验账号用户名：<strong className="whitespace-nowrap">why</strong>，密码：<strong className="whitespace-nowrap">why12345</strong></p>
      </div>}
      {!demo && <div className="mb-5 rounded-xl border bg-muted/40 p-4 text-sm leading-7"><p className="font-medium">先了解 Daylight 如何工作</p><p className="mt-1 text-muted-foreground">用真实页面认识日历、待办、校园生活、发票、招聘与小 D，无需连接私人邮箱。</p><Button asChild variant="outline" className="mt-3 min-h-11 w-full"><Link to="/experience">三分钟体验 · 免登录</Link></Button></div>}
      {demo && <div className="mb-5 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-medium">隔离演示 · 预置结果</p>
        <p>体验邮件、改期、冲突、待办、招聘、发票和校园地图。数据来自原创样例，演示进程已屏蔽外部调用。</p>
        <Button className="w-full" disabled={busy} onClick={enterDemo}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}进入演示工作区</Button>
      </div>}
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="account">邮箱 / 用户名</Label>
          <Input
            id="account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
            autoComplete="username"
            className="h-11"
            placeholder="name@example.com"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">密码</Label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">忘记密码？</Link>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="h-11"
          />
        </div>
        <CaptchaField ref={captchaRef} value={captcha} onChange={setCaptcha} onCaptchaId={setCaptchaId} />
        <Button className="h-11 w-full" disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
          登录
        </Button>
      </form>
    </AuthShell>
  );
}

export { AuthShell } from '@/pages/auth-shell';
