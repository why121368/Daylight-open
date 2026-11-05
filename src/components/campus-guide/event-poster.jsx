import React, { useEffect, useState } from 'react';
import { Download, ImageDown, LoaderCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { inspectShareUrl } from '../../../shared/public-url.js';
import { EVENT_CATEGORIES } from '../../../shared/campus-guide.js';
import { allDayRange } from '../../../shared/campus-guide-ui.js';

const WIDTH = 1080, HEIGHT = 1760;
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif';
const clean = (value, limit = 2000) => String(value ?? '').slice(0, limit).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
const font = (context, size, weight = 400) => { context.font = `${weight} ${size}px ${FONT}`; };
const graphemes = value => typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)].map(item => item.segment) : Array.from(value);

/** Measured wrapping works for Chinese text, long URLs and unspaced Latin text. */
export function wrapPosterText(context, value, maxWidth, maxLines = 1) {
  const characters = graphemes(clean(value)), lines = [];
  let line = '', index = 0;
  while (index < characters.length && lines.length < maxLines) {
    const character = characters[index];
    if (character === '\n') { lines.push(line.trimEnd()); line = ''; index += 1; continue; }
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) { lines.push(line.trimEnd()); line = ''; continue; }
    line = candidate; index += 1;
  }
  if (line && lines.length < maxLines) lines.push(line.trimEnd());
  const truncated = index < characters.length;
  if (truncated && lines.length) {
    let last = graphemes(lines.at(-1));
    while (last.length && context.measureText(`${last.join('')}…`).width > maxWidth) last.pop();
    lines[lines.length - 1] = `${last.join('')}…`;
  }
  return { lines, truncated };
}

function textBlock(context, value, { x, y, width, size, lineHeight, lines = 1, weight = 400, color = '#173d3d' }) {
  font(context, size, weight); context.fillStyle = color;
  const wrapped = wrapPosterText(context, value, width, lines);
  wrapped.lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return wrapped;
}

function roundRect(context, x, y, width, height, radius, color) {
  context.fillStyle = color; context.beginPath(); context.roundRect(x, y, width, height, radius); context.fill();
}

function dateParts(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value), format = options => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...options }).format(date);
  return { date: format({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }), clock: format({ hour: '2-digit', minute: '2-digit', hour12: false }), key: format({ year: 'numeric', month: '2-digit', day: '2-digit' }) };
}

function eventTime(event) {
  const start = dateParts(event.start), end = dateParts(event.end);
  if (!start) return ['时间待确认', '请核对原始活动通知'];
  if (event.allDay) return [allDayRange(event), '北京时间'];
  if (!end) return [start.date, `${start.clock} 开始（北京时间）`];
  return start.key === end.key ? [start.date, `${start.clock} — ${end.clock}（北京时间）`] : [`${start.date} ${start.clock}`, `至 ${end.date} ${end.clock}（北京时间）`];
}

function eventUrl(event, value) {
  if (value) return inspectShareUrl(value, typeof window === 'undefined' ? undefined : window.location.origin);
  if (typeof window === 'undefined') throw new Error('请提供活动的完整分享地址。');
  const url = new URL('/campus', window.location.origin);
  url.searchParams.set('tab', 'events'); url.searchParams.set('event', event.id);
  return inspectShareUrl(url.href);
}

/** Draw only text, geometry and local QR modules: no remote image can taint the canvas. */
export function createEventPoster({ event, place, url, canvasFactory = () => document.createElement('canvas') }) {
  if (!event?.id || !clean(event.title)) throw new Error('请先保存完整的活动标题和编号。');
  const share = eventUrl(event, url);
  if (!share.valid) throw new Error(share.error);
  const qr = QRCode.create(share.url, { errorCorrectionLevel: 'M' });
  const moduleSize = Math.floor(296 / (qr.modules.size + 8));
  if (moduleSize < 3) throw new Error('活动链接过长，二维码会难以识别。请使用简短的公开活动链接。');
  const canvas = canvasFactory(); canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器暂不支持海报绘制，请尝试更新浏览器。');
  context.textBaseline = 'top';
  context.fillStyle = '#f4f2e9'; context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#103b3a'; context.fillRect(0, 0, WIDTH, 650);
  context.strokeStyle = '#2d5950'; context.lineWidth = 2;
  for (const radius of [88, 126, 164]) { context.beginPath(); context.arc(1000, 85, radius, 0, Math.PI * 2); context.stroke(); }
  roundRect(context, 72, 69, 30, 30, 8, '#e5b65e');
  context.strokeStyle = '#103b3a'; context.lineWidth = 3;
  context.beginPath(); context.arc(87, 84, 7, Math.PI, Math.PI * 2); context.moveTo(78, 86); context.lineTo(96, 86); context.stroke();
  textBlock(context, 'DAYLIGHT', { x: 120, y: 67, width: 450, size: 32, lineHeight: 40, weight: 700, color: '#f8f6ed' });
  textBlock(context, '校园活动', { x: 72, y: 137, width: 580, size: 22, lineHeight: 30, color: '#bfd0c7' });

  const category = EVENT_CATEGORIES.find(item => item.id === event.category)?.label || '校园活动';
  const badges = [category, ...(event.isDemo ? ['示例活动 · 非真实通知'] : []), ...(event.status === 'cancelled' ? ['已取消'] : []), ...(event.hidden ? ['未公开 · 维护预览'] : [])];
  let badgeX = 72;
  font(context, 23, 500);
  for (const label of badges) {
    const badgeWidth = Math.ceil(context.measureText(label).width) + 32;
    roundRect(context, badgeX, 185, badgeWidth, 45, 22, event.status === 'cancelled' && label === '已取消' ? '#f3c6bc' : '#e7dcb6');
    textBlock(context, label, { x: badgeX + 16, y: 195, width: badgeWidth - 32, size: 23, lineHeight: 30, weight: 500 });
    badgeX += badgeWidth + 12;
  }
  let titleSize = 64, title;
  while (titleSize >= 40) {
    font(context, titleSize, 700); title = wrapPosterText(context, event.title, 936, 5);
    if ((!title.truncated && title.lines.length * (titleSize + 12) <= 320) || titleSize === 40) break;
    titleSize -= 4;
  }
  const titleHeight = title.lines.length * (titleSize + 12);
  const titleY = 272 + Math.max(0, (320 - titleHeight) / 2);
  textBlock(context, event.title, { x: 72, y: titleY, width: 936, size: titleSize, lineHeight: titleSize + 12, lines: 5, weight: 700, color: '#fffdf4' });
  context.fillStyle = '#e5b65e'; context.fillRect(72, 610, 74, 5);

  textBlock(context, '活动时间', { x: 72, y: 704, width: 900, size: 23, lineHeight: 30, color: '#657b70' });
  const times = eventTime(event);
  times.forEach((line, index) => textBlock(context, line, { x: 72, y: 750 + index * 51, width: 936, size: index ? 32 : 38, lineHeight: 46, weight: index ? 400 : 600 }));
  context.fillStyle = '#d7dfd4'; context.fillRect(72, 866, 936, 1);
  textBlock(context, '活动地点', { x: 72, y: 899, width: 900, size: 23, lineHeight: 30, color: '#657b70' });
  const placeName = typeof place === 'string' ? place : place?.name;
  textBlock(context, placeName || event.location || '地点待确认', { x: 72, y: 944, width: 936, size: 40, lineHeight: 53, lines: 2, weight: 600 });
  textBlock(context, '主办方', { x: 72, y: 1084, width: 900, size: 23, lineHeight: 30, color: '#657b70' });
  textBlock(context, event.organizer || '主办方待补充', { x: 72, y: 1127, width: 936, size: 30, lineHeight: 41, lines: 2 });

  roundRect(context, 54, 1250, 972, 378, 28, '#ffffff');
  textBlock(context, event.status === 'cancelled' ? '活动已取消' : '扫码查看活动详情', { x: 94, y: 1297, width: 540, size: 35, lineHeight: 46, weight: 700 });
  const summary = event.summary || event.description || '在 Daylight 查看活动详情、会场位置与原始通知。';
  textBlock(context, summary, { x: 94, y: 1363, width: 520, size: 27, lineHeight: 40, lines: 3, color: '#567367' });
  textBlock(context, event.isDemo ? '功能演示，请勿作为真实通知' : event.hidden ? '维护预览，游客暂不可见' : '时间地点与正式报名以原通知为准', { x: 94, y: 1543, width: 540, size: 23, lineHeight: 31, lines: 2, color: event.isDemo || event.hidden ? '#9a651d' : '#657b70' });
  const qrSide = (qr.modules.size + 8) * moduleSize;
  const qrLeft = Math.round(692 + (296 - qrSide) / 2), qrTop = Math.round(1291 + (296 - qrSide) / 2);
  context.fillStyle = '#ffffff'; context.fillRect(qrLeft, qrTop, qrSide, qrSide);
  context.fillStyle = '#102e32';
  for (let row = 0; row < qr.modules.size; row++) for (let column = 0; column < qr.modules.size; column++) {
    if (qr.modules.get(row, column)) context.fillRect(qrLeft + (column + 4) * moduleSize, qrTop + (row + 4) * moduleSize, moduleSize, moduleSize);
  }
  const origin = new URL(share.url).host;
  textBlock(context, origin, { x: 72, y: 1668, width: 936, size: 23, lineHeight: 31, color: '#657b70' });
  textBlock(context, share.publicCandidate ? 'Daylight 校园指南 · 分享前请用手机移动网络试扫' : share.local ? '本地预览 · 此二维码尚不能供公众访问' : 'HTTP 预览 · 正式分享前请配置 HTTPS', { x: 72, y: 1712, width: 936, size: 22, lineHeight: 30, color: share.publicCandidate ? '#657b70' : '#9a651d' });
  const preview = !share.publicCandidate || event.hidden;
  return { dataUrl: canvas.toDataURL('image/png'), filename: `daylight-event-${String(event.id).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 70)}${preview ? '-preview' : ''}.png`, width: WIDTH, height: HEIGHT, share };
}

export function EventPosterButton({ event, place, url, children, disabled, onClick, ...props }) {
  const [open, setOpen] = useState(false), [poster, setPoster] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPoster(null); setError('');
    Promise.resolve().then(() => createEventPoster({ event, place, url })).then(result => { if (active) setPoster(result); }).catch(failure => { if (active) setError(failure.message || '海报生成失败，请稍后重试。'); });
    return () => { active = false; };
  }, [open, event, place, url]);
  const download = () => {
    if (!poster) return;
    const anchor = document.createElement('a'); anchor.href = poster.dataUrl; anchor.download = poster.filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
  };
  return <><Button type="button" variant="outline" {...props} disabled={disabled || !event} onClick={click => { onClick?.(click); if (!click.defaultPrevented) setOpen(true); }}>{children ?? <><ImageDown />活动海报</>}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>下载活动海报</DialogTitle><DialogDescription>本机生成 {WIDTH} × {HEIGHT} PNG，二维码打开活动详情。长文本自动折行，完整信息请查看原始通知。</DialogDescription></DialogHeader>{error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : poster ? <><img src={poster.dataUrl} alt={`${event.title}的活动海报预览`} width={poster.width} height={poster.height} className="mx-auto max-h-[58svh] w-auto max-w-full rounded-lg border" /><Button type="button" onClick={download}><Download />下载 PNG</Button>{(event.isDemo || event.hidden || !poster.share.publicCandidate) && <p role="status" className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">{event.isDemo && '此海报展示示例活动。'}{event.hidden && '活动尚未公开，游客无法通过二维码查看。'}{!poster.share.publicCandidate && '当前是本地或 HTTP 预览，请在完成公网 HTTPS 部署后重新生成。'}</p>}<p className="text-xs text-muted-foreground">二维码在本机绘制，不代表网站已通过公网连通验证。</p></> : <div className="grid h-64 place-items-center"><LoaderCircle className="size-6 animate-spin" aria-label="正在绘制活动海报" /></div>}</DialogContent></Dialog></>;
}
