import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Check, Download, FileUp, ImageDown, Pencil, Plus, QrCode, RefreshCw, Search, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { guideRequest, downloadFile, matches } from '@/lib/campus-guide-client';
import { GUIDE_COLLECTIONS, PLACE_CATEGORIES, EVENT_CATEGORIES, validateCatalog, withoutDemo } from '../../../shared/campus-guide.js';
import { useGuide } from './guide-context';
import { SourcesPanel } from './maintenance-sources-panel';
import { MaintenanceOverview, RoadNetworkDiagnostics } from './maintenance-overview';
import { CampusGeometryEditor } from './campus-geometry-editor';
import { EventPosterButton } from './event-poster';

const NAMES = { places: '地点', nodes: '路网节点', edges: '道路', events: '活动', venues: '食堂与窗口', menus: '菜品', indoorPlans: '室内平面图', parcelStations: '快递站', streetViews: '道路实景' };
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
const field = (key, label, type = 'text', options = {}) => ({ key, label, type, ...options });
const common = [field('isDemo', '标记为示例资料', 'boolean')];
const tags = field('tags', '标签（逗号分隔）', 'tags');
const source = field('sourceUrl', '可核对的来源链接', 'url');
const name = field('name', '名称', 'text', { required: true });
const place = field('placeId', '关联地点', 'reference', { collection: 'places', required: true });
const node = field('nodeId', '关联道路节点', 'reference', { collection: 'nodes' });
const dimensions = [field('width', '图宽度', 'number', { min: 10 }), field('height', '图高度', 'number', { min: 10 })];
const rectangle = [field('x', '横坐标 x', 'number'), field('y', '纵坐标 y', 'number'), field('width', '宽', 'number'), field('height', '高', 'number')];
const opening = field('openHours', '开放时段', 'hours');
const levels = [{ id: 'ground', label: '地面' }, { id: 'underground', label: '地下' }];
const nodeKinds = [{ id: 'junction', label: '路口' }, { id: 'entrance', label: '入口' }, { id: 'stairs', label: '楼梯' }, { id: 'elevator', label: '电梯' }, { id: 'ramp', label: '坡道' }, { id: 'crossing', label: '人行横道' }];
const edgeKinds = [{ id: 'walkway', label: '步行道路' }, { id: 'vehicle', label: '车行道路' }, { id: 'stairs', label: '楼梯' }, { id: 'elevator', label: '电梯' }, { id: 'ramp', label: '坡道' }, { id: 'crossing', label: '人行横道' }, { id: 'connector', label: '接驳段' }];
const array = (key, label, fields, defaults) => field(key, label, 'array', { fields, defaults });
const dining = [field('unit', '售卖单位 / 份量'), field('operator', '运营商 / 商家'), field('menuImageUrl', '菜单图片链接', 'url'), field('orderStopped', '暂停点单', 'boolean'), field('temporarilyClosed', '临时停业', 'boolean'), field('closureUntil', '停业截止（北京时间，可空）', 'datetime'), field('closureReason', '停业 / 停单说明', 'textarea'), field('adminNote', '内部维护备注', 'textarea', { help: '仅管理员目录可见，不公开给游客。' })];
const FIELDS = {
  places: [name, field('englishName', '英文名称'), field('category', '地点分类', 'select', { options: PLACE_CATEGORIES }), field('lat', '纬度', 'number', { min: -90, max: 90 }), field('lng', '经度', 'number', { min: -180, max: 180 }), node, field('aliases', '别名（逗号分隔）', 'tags'), field('occupants', '入驻单位（逗号分隔）', 'tags'), field('groupId', '建筑组编号'), field('groupName', '建筑组名称'), tags, field('address', '地址'), field('building', '楼宇'), field('floor', '楼层'), field('room', '教室 / 房间'), field('description', '说明', 'textarea'), opening, field('accessible', '无障碍可达', 'boolean'), source, ...common],
  nodes: [field('lat', '纬度', 'number', { min: -90, max: 90 }), field('lng', '经度', 'number', { min: -180, max: 180 }), field('level', '道路层级', 'select', { options: levels }), field('kind', '节点类型', 'select', { options: nodeKinds }), ...common],
  edges: [field('from', '起点节点', 'reference', { collection: 'nodes', required: true }), field('to', '终点节点', 'reference', { collection: 'nodes', required: true }), field('distanceMeters', '路段长度（米）', 'number', { min: 0.1 }), field('level', '道路层级', 'select', { options: levels }), field('kind', '道路类型', 'select', { options: edgeKinds }), field('covered', '有遮雨设施', 'boolean'), field('accessible', '无障碍可达', 'boolean'), field('bidirectional', '双向通行', 'boolean'), field('walkable', '允许步行', 'boolean'), field('closed', '暂时封闭', 'boolean'), field('description', '道路说明', 'textarea'), field('sceneImageUrl', '道路实景图片链接', 'url'), ...common],
  events: [field('title', '活动标题', 'text', { required: true }), field('englishTitle', '英文标题'), field('speaker', '主讲人'), field('category', '活动分类', 'select', { options: EVENT_CATEGORIES }), place, field('room', '活动房间 / 门牌'), field('locationText', '补充位置说明'), field('start', '开始（北京时间）', 'datetime'), field('end', '结束（北京时间）', 'datetime'), field('allDay', '全天活动', 'boolean', { help: '全天起止均填北京时间 00:00，结束为最后一天的次日。' }), field('sortOrder', '同一开始时间内的排序', 'number', { min: -100000, max: 100000 }), field('registrationDeadline', '报名截止（北京时间）', 'datetime'), field('organizer', '主办方'), field('registrationUrl', '正式报名链接', 'url'), field('imageUrl', '活动图片链接', 'url'), source, field('summary', '活动摘要', 'textarea'), field('description', '详细说明', 'textarea'), field('englishSummary', '英文简介（可选）', 'textarea', { maxLength: 1000, help: '最多 1000 字符，与中文摘要独立保存，不会自动翻译。' }), field('englishDescription', '英文详情（可选）', 'textarea', { maxLength: 15000, help: '最多 15000 字符，仅填写经核验可公开的英文内容。' }), tags, field('status', '活动状态', 'select', { options: [{ id: 'published', label: '正常发布' }, { id: 'cancelled', label: '已取消' }] }), field('capacity', '容量（留空为未知）', 'nullable-number'), field('fee', '费用（元，留空为未知）', 'nullable-number'), field('pinned', '置顶', 'boolean'), field('hidden', '从游客目录隐藏', 'boolean'), field('manualOverride', '保护人工修订，阻止来源覆盖', 'boolean'), ...common],
  venues: [name, place, field('floor', '楼层'), field('cuisine', '餐饮类型'), ...dining, tags, opening, array('windows', '餐饮窗口', [field('id', '窗口编号', 'text', { required: true }), name, field('cuisine', '餐饮类型'), ...dining, tags, opening], { name: '', cuisine: '', tags: [], openHours: [] }), ...common],
  menus: [name, field('venueId', '所属食堂', 'reference', { collection: 'venues', required: true }), field('windowId', '餐饮窗口', 'window'), field('price', '价格（元，留空为未知）', 'nullable-number', { min: 0 }), field('pricePending', '价格待核定', 'boolean'), field('meal', '供应餐次', 'select', { options: [{ id: 'all', label: '全部餐次' }, { id: 'breakfast', label: '早餐' }, { id: 'lunch', label: '午餐' }, { id: 'dinner', label: '晚餐' }] }), field('availableDays', '供应星期', 'days'), field('flavor', '口味'), tags, field('description', '说明', 'textarea'), field('portion', '份量'), ...dining, field('imageUrl', '菜品图片链接', 'url'), field('validFrom', '供应开始日期', 'date'), field('validUntil', '供应结束日期', 'date'), field('soldOut', '目前售罄', 'boolean'), array('specs', '规格与价格', [name, field('price', '价格（元，留空为未知）', 'nullable-number', { min: 0 }), field('unit', '售卖单位'), field('pricePending', '价格待核定', 'boolean')], { name: '', price: null, unit: '', pricePending: true }), ...common],
  indoorPlans: [name, place, field('floor', '楼层', 'text', { required: true }), ...dimensions, field('imageUrl', '底图图片链接', 'url'), source, array('rooms', '房间', [field('id', '房间编号', 'text', { required: true }), name, field('number', '门牌号'), ...rectangle, field('type', '类型')], { name: '', number: '', x: 0, y: 0, width: 100, height: 80, type: 'room' }), array('paths', '室内走廊', [field('points', '路径点（x,y; x,y）', 'points')], { points: [] }), ...common],
  parcelStations: [name, place, ...dimensions, field('notice', '取件公告', 'textarea'), source, array('shelves', '货架', [field('id', '货架编号', 'text', { required: true }), field('label', '货架名称', 'text', { required: true }), field('aliases', '别名（逗号分隔）', 'tags'), field('prefixes', '取件码前缀（逗号分隔）', 'tags'), ...rectangle, field('levels', '货架层数', 'number', { min: 1, max: 20 })], { label: '', aliases: [], prefixes: [], x: 0, y: 0, width: 100, height: 80, levels: 5 }), array('facilities', '站内设施', [field('id', '设施编号', 'text', { required: true }), name, field('type', '类型'), field('x', '横坐标 x', 'number'), field('y', '纵坐标 y', 'number')], { name: '', type: '', x: 0, y: 0 }), ...common],
  streetViews: [field('placeId', '关联地点（或选择道路节点）', 'reference', { collection: 'places' }), node, field('edgeId', '关联道路', 'reference', { collection: 'edges' }), field('offsetMeters', '沿道路距离（米，可空）', 'nullable-number', { min: 0 }), field('lat', '实景纬度（与经度同时填，可空）', 'optional-number', { min: -90, max: 90 }), field('lng', '实景经度（与纬度同时填，可空）', 'optional-number', { min: -180, max: 180 }), field('sourceFilename', '原始资料文件名'), field('imageUrl', '实景图片链接', 'url', { required: true }), field('description', '说明', 'textarea'), source, ...common],
};

function newRow(collection, catalog) {
  const center = catalog.meta.center;
  const first = key => catalog[key]?.[0]?.id || '';
  const start = new Date(Date.now() + 86400000).toISOString(), end = new Date(Date.now() + 90000000).toISOString();
  const base = { id: id(collection.slice(0, -1)), isDemo: false };
  return { ...base, ...({
    places: { name: '', category: 'teaching', ...center, nodeId: '', aliases: [], tags: [], openHours: [], accessible: true },
    nodes: { ...center, level: 'ground', kind: 'junction' },
    edges: { from: first('nodes'), to: catalog.nodes[1]?.id || '', distanceMeters: 100, level: 'ground', kind: 'walkway', covered: false, accessible: true, bidirectional: true, walkable: true, closed: false },
    events: { title: '', category: 'academic', placeId: first('places'), start, end, allDay: false, sortOrder: 0, registrationDeadline: '', tags: [], status: 'published', capacity: null, fee: null, hidden: false, pinned: false, manualOverride: false },
    venues: { name: '', placeId: first('places'), tags: [], openHours: [], windows: [] },
    menus: { name: '', venueId: first('venues'), windowId: '', price: null, pricePending: true, tags: [], availableDays: [1, 2, 3, 4, 5, 6, 7], meal: 'all', specs: [], soldOut: false },
    indoorPlans: { name: '', placeId: first('places'), floor: '1', width: 1000, height: 600, rooms: [], paths: [] },
    parcelStations: { name: '', placeId: first('places'), width: 1000, height: 600, shelves: [], facilities: [] },
    streetViews: { placeId: first('places'), nodeId: '', imageUrl: '', description: '' },
  }[collection]) };
}

function localTime(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16) : ''; }
function SelectField({ value, onChange, options, label, required }) {
  return <select aria-label={label} required={required} value={value ?? ''} onChange={event => onChange(event.target.value)} className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"><option value="">请选择{label}</option>{options.map(option => <option key={option.id} value={option.id}>{option.label || option.name || option.title || option.id}</option>)}</select>;
}
function DaysField({ value = [], onChange }) {
  return <div className="flex flex-wrap gap-1">{['一', '二', '三', '四', '五', '六', '日'].map((label, index) => <Button key={label} type="button" size="sm" variant={value.includes(index + 1) ? 'secondary' : 'outline'} onClick={() => onChange(value.includes(index + 1) ? value.filter(day => day !== index + 1) : [...value, index + 1].sort())} aria-pressed={value.includes(index + 1)}>周{label}</Button>)}</div>;
}
function TagsField({ value = [], onChange }) {
  const parse = input => input.split(/[,，]/).map(entry => entry.trim()).filter(Boolean);
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(value.join(', '));
  }, [value]);
  return <Input value={text} onChange={event => { setText(event.target.value); onChange(parse(event.target.value)); }} placeholder="多个标签用逗号分隔" />;
}
function PointsField({ value = [], onChange }) {
  const [text, setText] = useState(value.map(point => `${point.x},${point.y}`).join('; '));
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const parse = input => input.trim() ? input.split(/[;；]/).filter(point => point.trim()).map(point => {
    const coordinates = point.trim().split(/[,，]/).map(coordinate => coordinate.trim());
    const values = coordinates.map(Number);
    if (values.length !== 2 || coordinates.some(coordinate => !coordinate) || values.some(v => !Number.isFinite(v))) throw new Error('每个点使用 x,y，多个点用分号隔开。');
    return { x: values[0], y: values[1] };
  }) : [];
  useEffect(() => {
    let matches = false;
    try { matches = JSON.stringify(parse(text)) === JSON.stringify(value); } catch {}
    if (!matches) {
      setText(value.map(point => `${point.x},${point.y}`).join('; '));
      setError(''); inputRef.current?.setCustomValidity('');
    }
  }, [value]);
  return <div className="space-y-1"><Input ref={inputRef} value={text} placeholder="0,50; 200,50; 200,300" onChange={event => {
    const input = event.target.value; setText(input);
    try {
      onChange(parse(input)); setError(''); event.target.setCustomValidity('');
    } catch (failure) { setError(failure.message); event.target.setCustomValidity(failure.message); }
  }} />{error && <p className="text-xs text-destructive" role="alert">{error}</p>}</div>;
}

export function GuideRecordFields({ fields, value, onChange, catalog }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{fields.map(spec => {
    const current = value[spec.key];
    let input;
    if (spec.type === 'boolean') input = <div className="flex h-10 items-center justify-between gap-2 rounded-md border px-3"><span className="text-sm">{spec.label}</span><Switch aria-label={spec.label} checked={Boolean(current)} onCheckedChange={next => set(spec.key, next)} /></div>;
    else if (spec.type === 'select' || spec.type === 'reference' || spec.type === 'window') {
      const options = spec.type === 'reference' ? catalog[spec.collection].map(row => ({ ...row, label: row.name || row.title || `${row.id}${row.lat !== undefined ? ` · ${row.lat},${row.lng}` : ''}` })) : spec.type === 'window' ? (catalog.venues.find(row => row.id === value.venueId)?.windows || []) : spec.options;
      input = <SelectField label={spec.label} required={spec.required} value={current} options={options} onChange={next => onChange({ ...value, [spec.key]: next, ...(spec.key === 'venueId' ? { windowId: '' } : {}) })} />;
    } else if (spec.type === 'textarea') input = <Textarea aria-label={spec.label} value={current ?? ''} onChange={event => set(spec.key, event.target.value)} rows={3} maxLength={spec.maxLength ?? 15000} />;
    else if (spec.type === 'days') input = <DaysField value={current || []} onChange={next => set(spec.key, next)} />;
    else if (spec.type === 'points') input = <PointsField value={current || []} onChange={next => set(spec.key, next)} />;
    else if (spec.type === 'hours') input = <div className="space-y-3">{(current || []).map((row, index) => <div key={index} className="space-y-2 rounded-lg border p-3"><DaysField value={row.days} onChange={next => set(spec.key, current.map((entry, i) => i === index ? { ...entry, days: next } : entry))} /><div className="flex items-center gap-2"><Input aria-label="开始时间" type="time" value={row.start} onChange={event => set(spec.key, current.map((entry, i) => i === index ? { ...entry, start: event.target.value } : entry))} /><span>至</span><Input aria-label="结束时间" type="time" value={row.end} onChange={event => set(spec.key, current.map((entry, i) => i === index ? { ...entry, end: event.target.value } : entry))} /><Button type="button" size="icon" variant="ghost" aria-label="移除时段" onClick={() => set(spec.key, current.filter((_, i) => i !== index))}><Trash2 /></Button></div></div>)}<Button type="button" size="sm" variant="outline" onClick={() => set(spec.key, [...(current || []), { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }])}><Plus />添加时段</Button>{!current?.length && <p className="text-xs text-muted-foreground">未录入时显示“时间未知”。</p>}</div>;
    else if (spec.type === 'array') input = <div className="space-y-3">{(current || []).map((row, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="flex items-center justify-between"><strong className="text-xs">{spec.label} {index + 1}</strong><Button type="button" variant="ghost" size="sm" onClick={() => set(spec.key, current.filter((_, i) => i !== index))}><Trash2 />移除</Button></div><GuideRecordFields fields={spec.fields} value={row} catalog={catalog} onChange={next => set(spec.key, current.map((entry, i) => i === index ? next : entry))} /></div>)}<Button type="button" variant="outline" size="sm" onClick={() => set(spec.key, [...(current || []), { ...(spec.fields.some(item => item.key === 'id') ? { id: id(spec.key) } : {}), ...structuredClone(spec.defaults) }])}><Plus />添加{spec.label}</Button></div>;
    else if (spec.type === 'datetime') input = <Input type="datetime-local" value={localTime(current)} onChange={event => set(spec.key, event.target.value ? `${event.target.value}:00+08:00` : '')} />;
    else if (spec.type === 'tags') input = <TagsField value={current || []} onChange={next => set(spec.key, next)} />;
    else if (spec.type === 'number' || spec.type === 'nullable-number' || spec.type === 'optional-number') input = <Input type="number" step="any" min={spec.min} max={spec.max} value={current ?? ''} onChange={event => set(spec.key, event.target.value === '' ? spec.type === 'nullable-number' ? null : spec.type === 'optional-number' ? undefined : '' : Number(event.target.value))} />;
    else input = <Input type={spec.type} value={current ?? ''} required={spec.required} onChange={event => set(spec.key, event.target.value)} />;
    return <div key={spec.key} className={['array', 'hours', 'textarea', 'days', 'points'].includes(spec.type) ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>{spec.type !== 'boolean' && <Label className="text-xs">{spec.label}{spec.required && <span className="text-destructive"> *</span>}</Label>}{input}{spec.help && <p className="text-xs leading-relaxed text-muted-foreground">{spec.help}</p>}</div>;
  })}</div>;
}

function EventRecordFields(props) { return <GuideRecordFields {...props} fields={FIELDS.events} />; }

export function ConfirmMaintenance({ open, onOpenChange, title, children, onConfirm, busy, confirmLabel = '确认操作' }) {
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}><AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-[1400] bg-black/50" /><AlertDialog.Content className="fixed top-1/2 left-1/2 z-[1401] grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-xl"><AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title><AlertDialog.Description asChild><div className="text-sm leading-relaxed text-muted-foreground">{children}</div></AlertDialog.Description><div className="flex justify-end gap-2"><AlertDialog.Cancel asChild><Button variant="outline" disabled={busy}>取消</Button></AlertDialog.Cancel><Button variant="destructive" disabled={busy} onClick={onConfirm}>{confirmLabel}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}

export function CatalogRecordDialog({ editor, onClose, catalog, onSave, busy }) {
  const [value, setValue] = useState(() => structuredClone(editor.item));
  const [advanced, setAdvanced] = useState(JSON.stringify(editor.item, null, 2));
  const [error, setError] = useState('');
  const applyAdvanced = () => {
    try {
      const parsed = JSON.parse(advanced);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('记录应为 JSON 对象。');
      const item = { ...parsed, ...(editor.existing ? { id: editor.item.id } : {}) };
      const next = { ...catalog, [editor.collection]: editor.existing ? catalog[editor.collection].map(row => row.id === editor.item.id ? item : row) : [...catalog[editor.collection], item] };
      const checked = validateCatalog(next);
      const index = editor.existing ? catalog[editor.collection].findIndex(row => row.id === editor.item.id) : checked[editor.collection].length - 1;
      setValue(checked[editor.collection][index]);
      setError(''); toast.message('JSON 已应用到表单，尚未保存');
    } catch (failure) { setError(failure.message); }
  };
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editor.existing ? '编辑' : '添加'}{NAMES[editor.collection]}</DialogTitle><DialogDescription>先录入关联地点与节点，再添加依赖它们的资料。修改保存时会检查完整路网和引用。</DialogDescription></DialogHeader><form className="space-y-5" onSubmit={event => {
    event.preventDefault(); setError('');
    try {
      const next = structuredClone(catalog);
      if (editor.existing) next[editor.collection] = next[editor.collection].map(row => row.id === editor.item.id ? { ...value, id: editor.item.id } : row);
      else next[editor.collection].push(value);
      validateCatalog(next);
      onSave(value);
    } catch (failure) { setError(failure.message); }
  }}><div className="space-y-2"><Label>稳定编号</Label><Input value={value.id} disabled={editor.existing} required pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,99}" onChange={event => setValue({ ...value, id: event.target.value })} /><p className="text-xs text-muted-foreground">使用字母、数字、点、下划线、冒号或短横线，创建后保持不变。</p></div><GuideRecordFields fields={FIELDS[editor.collection]} value={value} onChange={setValue} catalog={catalog} /><details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">高级：完整记录 JSON</summary><p className="my-3 text-xs text-muted-foreground">用于批量坐标或少用字段。需填写完整有效的记录，应用后再检查表单并保存。</p><Textarea className="max-h-72 font-mono text-xs" rows={10} value={advanced} onChange={event => setAdvanced(event.target.value)} /><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setAdvanced(JSON.stringify(value, null, 2))}>从当前表单载入</Button><Button type="button" size="sm" variant="outline" onClick={applyAdvanced}>应用到表单</Button></div></details>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}><Check />保存{NAMES[editor.collection]}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function MetaForm({ catalog, busy, onSave }) {
  const [meta, setMeta] = useState(() => structuredClone(catalog.meta));
  const fields = [field('title', '公开目录标题', 'text', { required: true }), field('description', '介绍', 'textarea'), field('notice', '置顶公告', 'textarea'), field('dataSource', '资料来源与核验说明', 'textarea'), field('zoom', '默认地图缩放级别', 'number', { min: 1, max: 22 }), field('mapTileUrl', '地图瓦片 URL（含 {z}/{x}/{y}）'), field('mapAttribution', '地图署名'), field('satelliteTileUrl', '卫星瓦片 URL（选填）'), field('satelliteAttribution', '卫星图署名')];
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave(meta); }}><GuideRecordFields fields={fields} value={meta} onChange={setMeta} catalog={catalog} /><div className="grid grid-cols-2 gap-3"><label className="space-y-2 text-xs">中心纬度<Input type="number" step="any" min={-90} max={90} required value={meta.center.lat} onChange={event => setMeta({ ...meta, center: { ...meta.center, lat: Number(event.target.value) } })} /></label><label className="space-y-2 text-xs">中心经度<Input type="number" step="any" min={-180} max={180} required value={meta.center.lng} onChange={event => setMeta({ ...meta, center: { ...meta.center, lng: Number(event.target.value) } })} /></label></div><p className="text-xs leading-relaxed text-muted-foreground">仅填写已获使用授权的瓦片与署名。浏览器会请求这些地址，链接中不要包含私人凭据；无卫星瓦片时不显示卫星图层。</p><Button disabled={busy}>保存公开信息</Button></form>;
}

function FeedbackReview({ feedback, onUpdate, busy }) {
  const [status, setStatus] = useState(feedback.status), [resolution, setResolution] = useState(feedback.resolution || '');
  return <article className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between gap-2"><Badge variant="outline">{({ open: '待核对', resolved: '已解决', dismissed: '不采纳' })[feedback.status]}</Badge><span className="text-xs text-muted-foreground">{new Date(feedback.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span></div><p className="whitespace-pre-wrap break-words text-sm">{feedback.message}</p><p className="text-xs text-muted-foreground">类型 {feedback.kind} {feedback.placeId && `· 地点 ${feedback.placeId}`}</p><SelectField label="处理状态" value={status} onChange={setStatus} options={[{ id: 'open', label: '待核对' }, { id: 'resolved', label: '已解决' }, { id: 'dismissed', label: '不采纳' }]} /><Textarea aria-label="处理说明" value={resolution} onChange={event => setResolution(event.target.value)} maxLength={3000} placeholder="核对来源、处理内容或不采纳原因" /><Button size="sm" disabled={busy} onClick={() => onUpdate(feedback, status, resolution)}>保存处理结果</Button></article>;
}

function CheckinManager({ catalog, run, busy }) {
  const [eventId, setEventId] = useState(''), [grant, setGrant] = useState(null), [qr, setQr] = useState(''), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = grant ? Math.max(0, Math.ceil((Date.parse(grant.expiresAt) - now) / 1000)) : 0;
  async function generate() {
    return run('生成现场签到码', async () => {
      const data = await guideRequest(`/admin/events/${encodeURIComponent(eventId)}/checkin-code`, 'POST', {});
      const url = new URL('/campus', location.origin); url.searchParams.set('tab', 'events'); url.searchParams.set('event', eventId); url.searchParams.set('checkin', data.code);
      setQr(await QRCode.toDataURL(url.href, { width: 640, margin: 4, errorCorrectionLevel: 'M' }));
      setGrant({ ...data, eventId }); setNow(Date.now());
    });
  }
  return <section className="space-y-4"><p className="text-sm text-muted-foreground">每次生成会替换该活动旧码，5 分钟有效。只向现场参加者展示；签到仍需登录、参加意向和有效时间窗，不验证 GPS。</p><SelectField label="活动" value={eventId} onChange={next => { setEventId(next); setGrant(null); setQr(''); }} options={catalog.events.filter(event => event.status === 'published' && !event.hidden).map(event => ({ id: event.id, label: event.title }))} /><Button disabled={!eventId || busy} onClick={generate}><QrCode />{grant ? '更换动态码' : '生成动态码'}</Button>{grant && <div className="space-y-3 rounded-xl border p-4 text-center"><h3 className="text-sm font-semibold">{catalog.events.find(event => event.id === grant.eventId)?.title}</h3>{seconds ? <><img src={qr} alt="活动现场签到二维码" width={640} height={640} className="mx-auto w-56 max-w-full rounded-lg" /><p className="font-mono text-3xl tracking-[0.3em]">{grant.code}</p><p className="text-sm">剩余 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</p></> : <p className="p-8 text-sm text-destructive">动态码已过期，请重新生成。</p>}<p className="text-xs leading-relaxed text-muted-foreground">签到时间：{new Date(grant.checkinStartsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 至 {new Date(grant.checkinEndsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></div>}</section>;
}

export function MaintenancePanel() {
  const { catalog: publicCatalog, setCatalog, isAdmin, busy, run } = useGuide();
  const [catalog, setAdminCatalog] = useState(publicCatalog), [section, setSection] = useState('catalog'), [collection, setCollection] = useState('places'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [editor, setEditor] = useState(null), [confirm, setConfirm] = useState(null), [importPreview, setImportPreview] = useState(null), [importError, setImportError] = useState(''), [feedback, setFeedback] = useState([]), [posts, setPosts] = useState([]), [loadError, setLoadError] = useState('');
  const accept = next => { setAdminCatalog(next); setCatalog({ ...next, events: next.events.filter(event => !event.hidden) }); };
  const refreshCatalog = async () => { const next = await guideRequest('/admin/catalog'); accept(next); setLoadError(''); return next; };
  useEffect(() => {
    if (!isAdmin) return;
    let current = true;
    guideRequest('/admin/catalog').then(data => { if (current) { setAdminCatalog(data); setLoadError(''); } }).catch(error => current && setLoadError(error.message));
    return () => { current = false; };
  }, [isAdmin]);
  useEffect(() => {
    let active = true;
    if (section === 'feedback') guideRequest('/admin/feedback').then(data => active && setFeedback(data.feedback)).catch(error => active && toast.error(error.message));
    if (section === 'community') guideRequest('/admin/community/posts').then(data => active && setPosts(data.posts)).catch(error => active && toast.error(error.message));
    return () => { active = false; };
  }, [section]);
  const rows = useMemo(() => (catalog?.[collection] || []).filter(row => matches(row, query)), [catalog, collection, query]);
  const demoRemaining = useMemo(() => {
    if (confirm?.kind !== 'demo' || !catalog) return 0;
    const cleaned = withoutDemo(catalog);
    return GUIDE_COLLECTIONS.reduce((sum, key) => sum + cleaned[key].length, 0);
  }, [confirm?.kind, catalog]);
  useEffect(() => setPage(previous => Math.min(previous, Math.max(0, Math.ceil(rows.length / 20) - 1))), [rows.length]);
  if (!isAdmin) return null;
  if (!catalog) return <p className="text-sm">正在读取维护目录…</p>;
  const saveRow = value => run('保存目录资料', async () => {
    const path = `/admin/catalog/${editor.collection}${editor.existing ? `/${encodeURIComponent(editor.item.id)}` : ''}`;
    const next = await guideRequest(path, editor.existing ? 'PUT' : 'POST', { revision: catalog.meta.revision, item: value });
    await accept(next); setEditor(null); toast.success('目录已更新');
  });
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setImportError('');
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('目录文件不能超过 12 MiB。');
      const parsed = JSON.parse(await file.text()), checked = validateCatalog(parsed.catalog || parsed);
      setImportPreview({ name: file.name, catalog: checked, expectedRevision: catalog.meta.revision });
    } catch (error) { setImportError(`导入预览失败：${error.message}`); }
  };
  return <>
    <div className="space-y-2"><p className="text-[10px] font-semibold tracking-widest text-amber-700 dark:text-amber-400">CAMPUS MAINTENANCE</p><div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-semibold">校园资料维护</h1><Button variant="outline" size="icon" aria-label="刷新维护目录" disabled={!!busy} onClick={() => run('刷新目录', refreshCatalog)}><RefreshCw /></Button></div><p className="text-sm text-muted-foreground">修订 {catalog.meta.revision} · 维护后对游客公开。来源同步先进入待审核区。</p></div>
    {loadError && <p className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive" role="alert">{loadError}。请刷新后再修改。</p>}
    <div className="flex flex-wrap gap-1.5" role="navigation" aria-label="维护分类">{Object.entries({ overview: '概览', catalog: '目录', geometry: '地图编辑', diagnostics: '路网诊断', meta: '公开信息', sources: '数据来源', feedback: '用户反馈', community: '社区审核', checkin: '活动签到' }).map(([key, title]) => <Button key={key} size="sm" variant={section === key ? 'secondary' : 'outline'} onClick={() => setSection(key)}>{title}</Button>)}</div>
    {section === 'overview' && <MaintenanceOverview />}
    {section === 'geometry' && <CampusGeometryEditor catalog={catalog} onCatalogChange={accept} busy={!!busy || !!loadError} />}
    {section === 'diagnostics' && <RoadNetworkDiagnostics catalog={catalog} />}
    {section === 'catalog' && <>
      <div className="space-y-2 rounded-xl border bg-muted/30 p-3"><p className="text-sm font-medium">上海科技大学校园地图</p><p className="text-xs leading-relaxed text-muted-foreground">补入学校地图的建筑、服务点和底图。已有同编号地点与其他资料保留；来源为本版本随附快照，更新抓取由部署者执行导入命令。</p><Button size="sm" variant="outline" disabled={!!busy || !!loadError} onClick={() => run('导入上科大地图', async () => { const result = await guideRequest('/admin/import-shanghaitech', 'POST', { revision: catalog.meta.revision }); accept(result.catalog); toast.success(`已补入 ${result.added} 个地点，保留 ${result.retained} 个已有地点`); })}><FileUp />导入上科大地图</Button></div>
      <div className="grid grid-cols-3 gap-2">{GUIDE_COLLECTIONS.map(key => <button key={key} onClick={() => { setCollection(key); setQuery(''); setPage(0); }} className={`rounded-lg border p-2.5 text-left ${key === collection ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : ''}`}><strong className="block text-lg">{catalog[key]?.length || 0}</strong><span className="text-[11px] text-muted-foreground">{NAMES[key]}</span></button>)}</div>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('导出目录', async () => downloadFile(JSON.stringify(await guideRequest('/admin/export'), null, 2), `daylight-campus-r${catalog.meta.revision}.json`))}><Download />导出目录</Button><Button size="sm" variant="outline" asChild><label className="cursor-pointer"><FileUp />导入预览<input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} /></label></Button><Button size="sm" variant="ghost" disabled={!!busy || !catalog.meta.isDemo} onClick={() => setConfirm({ kind: 'demo' })}><Trash2 />清除示例</Button></div>
      {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
      <div className="flex items-center gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="pl-9" aria-label={`搜索${NAMES[collection]}`} placeholder={`搜索${NAMES[collection]}名称或编号`} /></div><Button size="sm" disabled={!!busy || !!loadError} onClick={() => setEditor({ collection, item: newRow(collection, catalog), existing: false })}><Plus />新增</Button></div>
      <p className="text-xs text-muted-foreground">{rows.length} 项{collection === 'nodes' || collection === 'edges' ? ' · 路网使用已核对的坐标和连接关系，保存时拒绝悬挂引用。' : ''}</p>
      <div className="space-y-2">{rows.slice(page * 20, page * 20 + 20).map(row => <article key={row.id} className="flex items-start gap-2 rounded-lg border p-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium">{row.name || row.title || (row.from ? `${row.from} → ${row.to}` : row.id)}</h3><p className="mt-1 break-all text-[11px] text-muted-foreground">{row.id}{row.isDemo ? ' · 示例' : ''}{row.hidden ? ' · 已隐藏' : ''}</p>{row.placeId && <p className="mt-1 text-xs text-muted-foreground">{catalog.places.find(place => place.id === row.placeId)?.name || row.placeId}</p>}</div>{collection === 'events' && <EventPosterButton event={row} place={catalog.places.find(place => place.id === row.placeId)} variant="ghost" size="icon-sm" aria-label={`下载${row.title}的活动海报`}><ImageDown /></EventPosterButton>}<Button variant="ghost" size="icon-sm" aria-label={`编辑${row.name || row.title || row.id}`} disabled={!!busy || !!loadError} onClick={() => setEditor({ collection, item: row, existing: true })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`删除${row.name || row.title || row.id}`} disabled={!!busy || !!loadError} onClick={() => setConfirm({ kind: 'delete', collection, item: row })}><Trash2 /></Button></article>)}{!rows.length && <p className="p-6 text-center text-sm text-muted-foreground">暂无匹配资料，可新增或导入已核对的数据。</p>}</div>
      {rows.length > 20 && <div className="flex items-center justify-between"><Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>上一页</Button><span className="text-xs">第 {page + 1} / {Math.ceil(rows.length / 20)} 页</span><Button size="sm" variant="outline" disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage(page + 1)}>下一页</Button></div>}
    </>}
    {section === 'meta' && <MetaForm key={catalog.meta.revision} catalog={catalog} busy={!!busy || !!loadError} onSave={meta => run('保存公开信息', async () => { const next = { ...catalog, meta: { ...meta, revision: catalog.meta.revision } }; validateCatalog(next); accept(await guideRequest('/admin/catalog', 'PUT', next)); toast.success('公开信息已更新'); })} />}
    {section === 'sources' && <SourcesPanel catalog={catalog} onCatalogRefresh={refreshCatalog} EventFields={EventRecordFields} Confirmation={ConfirmMaintenance} />}
    {section === 'feedback' && <section className="space-y-3"><p className="text-sm text-muted-foreground">处理结果只记录维护结论，不会自动修改目录。</p>{!feedback.length && <p className="p-6 text-center text-sm text-muted-foreground">暂无用户反馈。</p>}{feedback.map(row => <FeedbackReview key={`${row.id}:${row.revision}`} feedback={row} busy={!!busy} onUpdate={(item, status, resolution) => run('保存反馈结果', async () => { const saved = await guideRequest(`/admin/feedback/${encodeURIComponent(item.id)}`, 'PATCH', { revision: item.revision, status, resolution }); setFeedback(feedback.map(entry => entry.id === saved.id ? saved : entry)); toast.success('处理结果已保存'); })} />)}</section>}
    {section === 'community' && <section className="space-y-3"><p className="text-sm text-muted-foreground">隐藏后游客无法查看；恢复发布会重新公开帖子。</p>{!posts.length && <p className="p-6 text-center text-sm text-muted-foreground">暂无帖子需要维护。</p>}{posts.map(post => <article key={post.id} className="space-y-3 rounded-xl border p-4"><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{post.title}</h3><Badge variant="outline">{post.status === 'hidden' ? '已隐藏' : '已发布'}</Badge></div><p className="text-xs text-muted-foreground">{post.authorName} · {new Date(post.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{post.body}</p><Button variant="outline" size="sm" disabled={!!busy} onClick={() => run('更新帖子状态', async () => { const result = await guideRequest(`/admin/community/posts/${encodeURIComponent(post.id)}`, 'PATCH', { status: post.status === 'hidden' ? 'published' : 'hidden' }); setPosts(posts.map(row => row.id === post.id ? result.post : row)); toast.success('帖子状态已更新'); })}>{post.status === 'hidden' ? '恢复发布' : '隐藏帖子'}</Button></article>)}</section>}
    {section === 'checkin' && <CheckinManager catalog={catalog} busy={!!busy} run={run} />}
    {editor && <CatalogRecordDialog key={`${editor.collection}:${editor.item.id}`} editor={editor} onClose={() => setEditor(null)} catalog={catalog} onSave={saveRow} busy={!!busy} />}
    <ConfirmMaintenance open={!!confirm} onOpenChange={open => !open && setConfirm(null)} busy={!!busy} title={confirm?.kind === 'demo' ? '清除示例资料？' : '删除这条资料？'} onConfirm={() => run('更新目录', async () => {
      const next = confirm.kind === 'demo' ? await guideRequest('/admin/clear-demo', 'POST', { revision: catalog.meta.revision }) : await guideRequest(`/admin/catalog/${confirm.collection}/${encodeURIComponent(confirm.item.id)}`, 'DELETE', { revision: catalog.meta.revision });
      accept(next); setConfirm(null); toast.success('目录已更新');
    })}>{confirm?.kind === 'demo' ? <><p>将清除标记为示例的资料，以及依赖这些示例的记录。自定义地点与其他有效自定义资料保留。</p><p className="mt-2">清理后剩余 {demoRemaining} 条目录记录。建议先导出备份。</p></> : <><p>即将删除「{confirm?.item?.name || confirm?.item?.title || confirm?.item?.id}」。</p><p className="mt-2">如仍被道路、活动、餐厅或平面图引用，后端会拒绝删除。请先调整关联资料。</p></>}</ConfirmMaintenance>
    <Dialog open={!!importPreview} onOpenChange={open => !open && setImportPreview(null)}><DialogContent className="max-h-[90svh] overflow-y-auto"><DialogHeader><DialogTitle>导入预览</DialogTitle><DialogDescription>导入将替换整个公共目录，不会自动与当前资料合并。先核对来源、记录数与示例标记。</DialogDescription></DialogHeader>{importPreview && <div className="space-y-4"><p className="break-words text-sm">{importPreview.name}</p><div className="rounded-lg border p-3 text-sm"><strong>{importPreview.catalog.meta.title}</strong><p className="mt-2 text-xs text-muted-foreground">{importPreview.catalog.meta.dataSource || '未填写资料来源'}</p>{importPreview.catalog.meta.isDemo && <Badge className="mt-2" variant="outline">包含示例资料</Badge>}</div><div className="grid grid-cols-3 gap-2">{GUIDE_COLLECTIONS.map(key => <div key={key} className="rounded-lg bg-muted p-2 text-xs">{NAMES[key]}<strong className="mt-1 block text-base">{importPreview.catalog[key].length}</strong></div>)}</div><Button variant="destructive" disabled={!!busy || !!loadError} onClick={() => run('导入公共目录', async () => { accept(await guideRequest('/admin/import', 'POST', { catalog: importPreview.catalog, expectedRevision: importPreview.expectedRevision })); setImportPreview(null); toast.success('目录已导入'); })}>确认替换公共目录</Button></div>}</DialogContent></Dialog>
  </>;
}
