import React, { useEffect, useState } from 'react';
import { Link2, MapPin, Route, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CampusMediaUpload } from './media-upload';
import { bindEntrancesByDistance, buildStreetViewBatch, parseStreetViewManifest, removeIntermediateNode } from '../../../shared/campus-geometry-actions.js';

/** Every operation previews or changes only the editor draft; the parent's Save publishes it. */
export function CampusGeometryTools({ draft, placeId, nodeId, edgeId, applyDraft, disabled }) {
  const [threshold, setThreshold] = useState('15'), [replace, setReplace] = useState(false), [allPlaces, setAllPlaces] = useState(false), [bindings, setBindings] = useState(null);
  const [edgeList, setEdgeList] = useState(''), [manifest, setManifest] = useState(''), [start, setStart] = useState('0'), [end, setEnd] = useState(''), [source, setSource] = useState(''), [authorized, setAuthorized] = useState(false), [scenes, setScenes] = useState(null);
  useEffect(() => { setBindings(null); setScenes(null); }, [draft]);
  useEffect(() => { setBindings(null); }, [placeId]);
  useEffect(() => { if (edgeId && !edgeList) setEdgeList(edgeId); }, [edgeId]);
  const run = action => { try { action(); } catch (error) { toast.error(error.message || '操作失败，请核对草稿。'); } };
  const bindingOptions = () => ({ maxMeters: Number(threshold), placeId: allPlaces ? '' : placeId, replace });
  const mediaOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const sceneOptions = () => ({ edgeIds: edgeList.split(/[,，\s]+/).filter(Boolean), images: parseStreetViewManifest(manifest, { mediaOrigin }), startMeters: Number(start), endMeters: end, sourceUrl: source, mediaOrigin });
  return <div className="space-y-3">
    <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">入口批量绑定与中间节点连接</summary><div className="mt-3 space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">按距离核查有步行连接的地面节点；先预览，再写入本页草稿。未匹配时保留原绑定。绑定不证明入口与道路之间可以直线通过。</p>
      <label className="grid max-w-48 gap-1 text-xs">最大绑定距离（米）<Input type="number" min="0" max="100" step="0.5" value={threshold} onChange={event => { setThreshold(event.target.value); setBindings(null); }} aria-label="入口自动绑定阈值" /></label>
      <div className="flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={allPlaces} onChange={event => { setAllPlaces(event.target.checked); setBindings(null); }} />检查全部地点</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={replace} onChange={event => { setReplace(event.target.checked); setBindings(null); }} />重新匹配已有绑定</label></div>
      <Button size="sm" variant="outline" disabled={disabled || (!allPlaces && !placeId)} onClick={() => run(() => setBindings(bindEntrancesByDistance(draft, bindingOptions())))}><MapPin className="size-3.5" />预览入口绑定</Button>
      {bindings && <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs"><p>可绑定 {bindings.bound.length} 个 · 超阈值/无节点 {bindings.unmatched.length} 个 · 保留原绑定 {bindings.retained.length} 个</p><div className="max-h-36 space-y-1 overflow-y-auto">{bindings.bound.map(row => <p key={row.entranceId}>{row.entranceId} → {row.nodeId} · {row.distanceMeters} 米</p>)}</div><Button size="sm" disabled={disabled || !bindings.bound.length} onClick={() => run(() => { const result = bindEntrancesByDistance(draft, bindingOptions()); applyDraft(result.catalog); toast.success(`已将 ${result.bound.length} 个入口绑定加入草稿`); })}><Link2 className="size-3.5" />应用这些绑定到草稿</Button></div>}
      <div className="space-y-2 border-t pt-3"><p className="text-xs text-muted-foreground">删中间点接边仅适用于同属性、近乎共线且恰有两条道路的节点。入口/地点/节点街景引用、转弯或不兼容单向路会阻止操作。</p><Button size="sm" variant="outline" disabled={disabled || !nodeId} onClick={() => run(() => { const result = removeIntermediateNode(draft, nodeId); applyDraft(result.catalog); toast.success(`已接成 ${Math.round(result.mergedEdge.distanceMeters)} 米路段，保留方向及里程`); })}><Scissors className="size-3.5" />删除当前中间节点并接边</Button></div>
    </div></details>
    <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">街景按里程插值与批量文件名绑定</summary><div className="mt-3 space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">可批量上传有权公开的本机图片，也可填写授权 HTTPS 图片清单。文件名前或结尾的序号为 1–50，按数字排序后沿选定连续路段等距布点；位置依赖录入里程，发布前需现场核对。上传和加入草稿后，还需保存目录才会公开。</p>
      <label className="grid gap-1 text-xs">连续路段 ID（按路径顺序，逗号分隔）<Input value={edgeList} onChange={event => { setEdgeList(event.target.value); setScenes(null); }} aria-label="批量街景路段顺序" /></label><Button size="sm" variant="outline" disabled={!edgeId || disabled} onClick={() => { const ids = edgeList.split(/[,，\s]+/).filter(Boolean); if (!ids.includes(edgeId)) setEdgeList([...ids, edgeId].join(',')); setScenes(null); }}><Route className="size-3.5" />加入当前选中路段</Button>
      <div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-xs">开始里程（米）<Input type="number" min="0" value={start} onChange={event => { setStart(event.target.value); setScenes(null); }} aria-label="街景开始里程" /></label><label className="grid gap-1 text-xs">结束里程（空为路径末端）<Input type="number" min="0" value={end} onChange={event => { setEnd(event.target.value); setScenes(null); }} aria-label="街景结束里程" /></label></div>
      <label className="grid gap-1 text-xs">授权来源或资料说明链接<Input type="url" value={source} onChange={event => { setSource(event.target.value); setScenes(null); }} placeholder="https://…" aria-label="批量街景来源链接" /></label>
      <CampusMediaUpload disabled={disabled} onUploaded={media => { setManifest(current => [current.trim(), `${media.filename} | ${media.url}`].filter(Boolean).join('\n')); setScenes(null); }} />
      <label className="grid gap-1 text-xs">每行 文件名 | 授权图片地址<Textarea className="min-h-32 font-mono text-xs" value={manifest} onChange={event => { setManifest(event.target.value); setScenes(null); }} aria-label="街景文件名和授权URL清单" placeholder={'scene-01.jpg | https://你的图片域名/scene-01.jpg\nscene-02.jpg | https://你的图片域名/scene-02.jpg'} /></label>
      <label className="flex items-start gap-2 text-xs leading-relaxed"><input className="mt-0.5" type="checkbox" checked={authorized} onChange={event => { setAuthorized(event.target.checked); setScenes(null); }} />我已获得这些图片公开展示的权限，链接不含私人访问凭据，并会核对推算的位置。</label>
      <Button size="sm" variant="outline" disabled={disabled || !authorized || !manifest.trim()} onClick={() => run(() => setScenes(buildStreetViewBatch(draft, sceneOptions())))}>预览布点与重复检查</Button>
      {scenes && <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs"><div className="flex flex-wrap gap-2"><Badge variant="outline">路径 {Math.round(scenes.totalMeters)} 米</Badge><span>新增 {scenes.generated.length} 点 · 重复跳过 {scenes.skipped.length} 点</span></div><ol className="max-h-48 space-y-2 overflow-y-auto">{scenes.generated.map(scene => <li key={scene.id} className="break-all"><strong>{scene.sourceFilename}</strong><p className="mt-1 text-muted-foreground">{scene.edgeId} · {scene.offsetMeters.toFixed(1)} 米 · {scene.lat.toFixed(6)}, {scene.lng.toFixed(6)}</p></li>)}</ol><Button size="sm" disabled={disabled || !authorized || !scenes.generated.length} onClick={() => run(() => { const result = buildStreetViewBatch(draft, sceneOptions()); applyDraft(result.catalog); setManifest(''); setScenes(null); toast.success(`已加入 ${result.generated.length} 个街景草稿点，请保存目录后公开`); })}>加入街景草稿</Button></div>}
    </div></details>
  </div>;
}
