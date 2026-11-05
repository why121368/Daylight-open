import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAuthToken } from '@/lib/auth-api';
import { apiErrorMessage } from '@/lib/api-error';

const MAX_BYTES = 20 * 1024 * 1024;
const numericNames = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const MEDIA_PATH = /^\/api\/campus-guide\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LABELS = { pending: '待上传', uploading: '上传中', success: '已上传', error: '失败' };

function fileError(file) {
  if (!file.size) return '文件为空，请重新选择。';
  if (file.size > MAX_BYTES) return '超过每张 20 MiB 上限，请压缩后重新选择。';
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return '只支持 PNG、JPEG 和 WebP。';
  if (file.name.length > 180 || file.name !== file.name.trim() || /[\u0000-\u001f\u007f/\\:|]/.test(file.name)) return '文件名不能包含路径或清单分隔符，最多 180 字。';
  return '';
}

function safeUploadedMedia(result, file) {
  try {
    const url = new URL(result.url);
    if (url.origin !== window.location.origin || !MEDIA_PATH.test(url.pathname) || url.pathname.split('/').at(-1) !== result.id || url.username || url.password || url.search || url.hash || result.filename !== file.name) throw Error();
    return { id: result.id, filename: result.filename, url: url.href };
  } catch { throw new Error('服务器返回的图片地址无效，请重新打开 Daylight 后重试。'); }
}

/** Uploading only supplies authorized URLs; placement and publication stay in the editor draft. */
export function CampusMediaUpload({ disabled, onUploaded }) {
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(false);
  const busyRef = useRef(false), mounted = useRef(true), controller = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const update = (id, patch) => { if (mounted.current) setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row)); };
  const choose = event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (busyRef.current || disabled) return;
    if (!files.length) return;
    if (files.length > 50) { toast.error('每批可选择 1–50 张图片，请分批选择。'); return; }
    setRows(files.sort((a, b) => numericNames.compare(a.name, b.name)).map((file, index) => { const error = fileError(file); return { id: `${index}:${file.name}`, file, status: error ? 'error' : 'pending', message: error, retryable: !error }; }));
  };
  const upload = async selected => {
    if (disabled || busyRef.current || !selected.length) return;
    busyRef.current = true; setBusy(true); let succeeded = 0;
    try {
      for (const row of selected) {
        if (!mounted.current) break;
        update(row.id, { status: 'uploading', message: '' });
        const abort = new AbortController(); controller.current = abort;
        const deadline = setTimeout(() => abort.abort(), 180000);
        try {
          const token = getAuthToken(); if (!token) throw new Error('请先以管理员身份登录。');
          const response = await fetch('/api/campus-guide/admin/media', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(row.file.name) }, body: row.file, signal: abort.signal });
          let result; try { result = await response.json(); } catch { throw new Error('上传服务返回了无法解析的结果，请重试。'); }
          if (!response.ok) throw new Error(apiErrorMessage(result, `图片上传失败（HTTP ${response.status}）。`));
          const media = safeUploadedMedia(result, row.file);
          if (mounted.current) { onUploaded(media); update(row.id, { status: 'success', message: '已加入下方清单；预览布点并保存目录后公开。', retryable: false }); succeeded++; }
        } catch (error) {
          update(row.id, { status: 'error', message: error.name === 'AbortError' ? '上传超时，请重试。' : (error.message === 'Failed to fetch' ? '网络连接失败，请重试。' : error.message || '上传失败，请重试。'), retryable: true });
        } finally { clearTimeout(deadline); }
      }
    } finally {
      busyRef.current = false; controller.current = null;
      if (mounted.current) { setBusy(false); if (succeeded) toast.success(`已上传 ${succeeded} 张图片并加入清单，请继续预览布点`); }
    }
  };
  const pending = rows.filter(row => row.status === 'pending'), failed = rows.filter(row => row.status === 'error' && row.retryable);
  return <section className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-label="管理员街景图片批量上传">
    <div className="space-y-1"><p className="text-xs font-medium">本机图片批量上传</p><p className="text-xs leading-relaxed text-muted-foreground">每批 1–50 张 PNG / JPEG / WebP，每张最多 20 MiB，按文件名数字排序。请使用 1–50 的序号，如 scene-01.jpg。上传成功会加入下方清单，仍需核对里程、应用草稿并保存目录。</p></div>
    <label className="grid gap-1.5 text-xs">选择有权公开的图片<Input type="file" multiple accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={choose} disabled={disabled || busy} aria-label="选择批量街景图片" className="h-auto min-h-10 py-2" /></label>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled || busy || !pending.length} onClick={() => upload(pending)}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}上传待处理图片{pending.length ? `（${pending.length}）` : ''}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || busy || !failed.length} onClick={() => upload(failed)}><RotateCcw className="size-3.5" />重试失败图片{failed.length ? `（${failed.length}）` : ''}</Button></div>
    <div aria-live="polite" className="text-xs text-muted-foreground">{rows.length ? `本批 ${rows.length} 张 · 已上传 ${rows.filter(row => row.status === 'success').length} 张 · 失败 ${rows.filter(row => row.status === 'error').length} 张` : '图片尚未被公开目录引用时，仅管理员可读取。撤下公开引用后恢复为仅管理员可读。'}</div>
    {rows.length > 0 && <ol className="max-h-60 space-y-2 overflow-y-auto text-xs">{rows.map(row => <li key={row.id} className="rounded-md border bg-background p-2"><div className="flex items-start justify-between gap-2"><span className="min-w-0 break-all">{row.file.name}<span className="ml-2 text-muted-foreground">{(row.file.size / 1048576).toFixed(2)} MiB</span></span><span className="flex shrink-0 items-center gap-1">{row.status === 'success' && <Check className="size-3.5 text-emerald-600" />}{row.status === 'uploading' && <Loader2 className="size-3.5 animate-spin" />}{LABELS[row.status]}</span></div>{row.message && <p className={`mt-1 leading-relaxed ${row.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{row.message}</p>}{row.status === 'error' && row.retryable && <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" disabled={disabled || busy} onClick={() => upload([row])} aria-label={`重试上传 ${row.file.name}`}><RotateCcw className="size-3" />重试这一张</Button>}</li>)}</ol>}
  </section>;
}
