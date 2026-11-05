import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, LoaderCircle, QrCode, Share2 } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { inspectShareUrl } from '../../../shared/public-url.js';

export function ShareDialog({ url, title = 'Daylight 校园指南', open, onOpenChange, description, footer, downloadName, downloadUrl }) {
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [nativeSupported, setNativeSupported] = useState(false);
  const [sharing, setSharing] = useState(false);
  const share = useMemo(() => inspectShareUrl(url || '/campus',
    typeof window === 'undefined' ? undefined : window.location.origin), [url]);

  useEffect(() => { setNativeSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function'); }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setImageUrl('');
    setError('');
    setCopied(false);
    if (!share.valid) {
      setError(share.error);
      return undefined;
    }
    QRCode.toDataURL(share.url, {
      errorCorrectionLevel: 'M', width: 768, margin: 4,
      color: { dark: '#102e32', light: '#ffffff' },
    }).then((result) => {
      if (!cancelled) setImageUrl(result);
    }).catch(() => {
      if (!cancelled) setError('二维码生成失败，请缩短地址后重试。');
    });
    return () => { cancelled = true; };
  }, [open, share]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      toast.success('链接已复制');
    } catch {
      toast.error('浏览器未允许复制，请长按下方地址复制。');
    }
  }

  async function nativeShare() {
    if (!share.valid || sharing || !nativeSupported) return;
    setSharing(true);
    try { await navigator.share({ title, url: share.url }); }
    catch (failure) { if (failure?.name !== 'AbortError') toast.error('浏览器暂时无法打开分享菜单，请复制链接或下载二维码。'); }
    finally { setSharing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="size-5" />分享{title}</DialogTitle>
          <DialogDescription>
            {description || '扫码打开当前页面；私人邮箱与工作区仍需各自登录。'}
          </DialogDescription>
        </DialogHeader>
        {share.valid && !share.publicCandidate && (
          <div role="status" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            {share.local
              ? '本地预览：这个地址仅在本机或相应局域网可用，其他人的手机通常无法访问。部署到公网 HTTPS 后再正式分享。'
              : '当前地址使用 HTTP。正式分享前，请为站点配置 HTTPS，并用手机移动网络确认可以打开。'}
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
        ) : (
          <div className="mx-auto flex aspect-square w-64 max-w-full items-center justify-center rounded-xl border bg-white p-2">
            {imageUrl
              ? <img src={imageUrl} alt={`${title}的二维码`} className="h-full w-full" width="768" height="768" />
              : <LoaderCircle className="size-6 animate-spin text-slate-600" aria-label="正在生成二维码" />}
          </div>
        )}
        {share.valid && (
          <div className="space-y-3">
            <Input aria-label="分享地址" value={share.url} readOnly onFocus={(event) => event.target.select()} className="min-h-11 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={copyLink}>
                {copied ? <Check /> : <Copy />}复制链接
              </Button>
              {imageUrl ? <Button asChild className="min-h-11"><a href={downloadUrl || imageUrl} download={downloadName || (share.publicCandidate ? 'daylight-campus-qr.png' : 'daylight-campus-local-preview-qr.png')}><Download />下载 PNG</a></Button>
                : <Button type="button" className="min-h-11" disabled><Download />下载 PNG</Button>}
            </div>
            {nativeSupported && <Button type="button" variant="outline" className="min-h-11 w-full" onClick={nativeShare} disabled={sharing}><Share2 />{sharing ? '正在分享…' : '打开手机分享菜单'}</Button>}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {footer || (share.publicCandidate
                ? '二维码在浏览器内生成。请用另一部手机的移动网络试扫，确认域名、证书和页面均可访问。'
                : '二维码内容就是上方地址，生成二维码不会把本地服务自动发布到互联网。')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ShareButton({ url, title, children, onClick, ...props }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" {...props} onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(true);
      }}>
        {children ?? <><Share2 />分享指南</>}
      </Button>
      <ShareDialog url={url} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

export default ShareDialog;
