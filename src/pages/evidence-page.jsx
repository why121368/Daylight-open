import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, CheckCircle2, Download, FileText, Layers3, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExperienceShell } from '@/components/experience-shell';
import { estimateCost } from '../../shared/cost-estimate.js';
import evidenceSnapshot from '@/data/competition-evidence.json';

const { costEvidence, reportManifest, ragLatency, currentBudget, recovery } = evidenceSnapshot.data;

const REPO = 'https://github.com/why121368/Daylight/blob/feat/competition-experience-20261103/';
const PUBLIC_SOURCES = {
  'docs/distributed-ha-and-capacity.md': '/competition/capacity-design.html',
  'docs/competition-2026-11-03/README.md': '/competition/report.html',
  'docs/delivery/README.md': '/competition/reproduce.html',
  'docs/performance-2026-11-03/README.md': '/competition/performance-report.html',
  'docs/competition-2026-11-04/README.md': '/competition/operations-report.html',
  'docs/competition-rag-2026-11-04/README.md': '/competition/rag-report.html',
  'docs/competition-value-2026-11-04/README.md': '/competition/value-report.html',
  'docs/competition-reply-2026-11-04/README.md': '/competition/reply-review-report.html',
  'docs/competition-video-2026-11-04/README.md': '/competition/video-report.html',
  'docs/competition-report-refresh-2026-11-04/README.md': '/competition/report-refresh.html',
  'docs/competition-rag-latency-2026-11-04/README.md': '/competition/rag-latency-report.html',
  'docs/competition-recovery-2026-11-04/README.md': '/competition/recovery-report.html',
  'docs/competition-continuity-2026-11-04/README.md': '/competition/continuity-report.html',
  'docs/competition-delivery-2026-11-04/README.md': '/competition/delivery-report.html',
  'docs/competition-container-2026-11-04/README.md': '/competition/container-report.html',
};
const fullModelRun = costEvidence.groups.find(group => group.group === 'model-full');
const fields = [['messages', '每月新邮件数', 1000], ['inputTokens', '每封输入 Token', costEvidence.workload.inputTokensPerCall], ['outputTokens', '每封输出 Token', costEvidence.workload.outputTokensPerCall], ['cachePercent', '输入缓存占比（%）', 0], ['inputPrice', '输入单价（元 / 百万 Token）', costEvidence.source.inputCnyPerMillion], ['outputPrice', '输出单价（元 / 百万 Token）', costEvidence.source.outputCnyPerMillion], ['cachedInputPrice', '缓存输入单价（元 / 百万 Token）', costEvidence.source.inputCnyPerMillion], ['monthlyInfra', '每月基础设施（元）', 100]];
function Source({ path, children }) {
  const [file, anchor] = path.split('#');
  const href = PUBLIC_SOURCES[file] ? `${PUBLIC_SOURCES[file]}${anchor ? `#${anchor}` : ''}` : `${REPO}${path}`;
  return <a href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4">{children}<ArrowUpRight className="size-3.5" /></a>;
}
const money = value => `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}`;

export default function EvidencePage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '技术与实测 · Daylight';
    return () => { if (document.title === '技术与实测 · Daylight') document.title = previousTitle; };
  }, []);
  const [cost, setCost] = useState(() => Object.fromEntries(fields.map(([key, , value]) => [key, String(value)])));
  const estimate = Object.values(cost).some(value => value.trim() === '') ? null : estimateCost(Object.fromEntries(Object.entries(cost).map(([key, value]) => [key, Number(value)])));
  return <ExperienceShell active="evidence">
    <p className="text-xs font-semibold tracking-[.2em] text-emerald-700 dark:text-emerald-300">设计逻辑 · 执行证据 · 实测结果</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">每个下一步，都有依据。</h1>
    <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">Daylight 把邮件、日历、待办、附件与执行记录连在一起。下面按五项考核说明设计依据、工具链路、部署方式与测量结果。</p>
    <div className="mt-5 flex flex-wrap gap-3"><Button asChild className="min-h-11"><a href="/competition/technical-report.html"><FileText className="size-4" />阅读完整技术报告</a></Button><Button asChild variant="outline" className="min-h-11"><a href="/competition/technical-report.pdf" download="Daylight-Technical-Report-20261104.pdf"><Download className="size-4" />下载 PDF · {reportManifest.pages} 页</a></Button></div>
    <p className="mt-2 text-sm leading-7 text-muted-foreground">{reportManifest.pages} 页 · 用户价值预检 · 回复审核 · 分章视频 · <span className="whitespace-nowrap">PDF {(reportManifest.bytes / 1000000).toFixed(1)} MB</span></p>
    <Source path="docs/competition-report-refresh-2026-11-04/README.md">报告版本与更新记录</Source>
    <nav aria-label="技术页目录" className="mt-6 flex flex-wrap gap-2">{[['value', '场景价值'], ['architecture', '云原生架构'], ['agent', 'Agent 链路'], ['delivery', '工程与体验'], ['cost', '成本与性能']].map(([id, label]) => <Button asChild variant="outline" className="min-h-11" key={id}><a href={`#${id}`}>{label}</a></Button>)}</nav>

    <section id="value" className="scroll-mt-6 pt-12"><h2 className="text-2xl font-semibold">01 · 面向多任务并行的邮件使用者</h2><p className="mt-4 max-w-3xl leading-8 text-muted-foreground">申请者同时面对面试、材料截止和临时改期；HR 则要串联候选人、简历和邀约。打开邮件之后，仍有整理、核对和追踪的工作。Daylight 用有来源的事项承接这些动作。</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{[['以前', '反复翻邮件找时间，再分别写入日历和待办。改期后还要回头核对旧安排。'], ['使用 Daylight', '提取时间与材料要求，关联原邮件；检测冲突，保留改期与取消历史；回复先进入审核。'], ['如何衡量价值', '本地主持工具使用两套原创通知，轮换人工与 Agent 顺序；计时包含阅读、模型等待、核验与修正，保存结果及主持人复核。']].map(([title, text]) => <Card key={title} className="shadow-none"><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="text-sm leading-7 text-muted-foreground">{text}</CardContent></Card>)}</div>
      <Button asChild className="mt-5 min-h-11"><Link to="/experience">浏览三分钟功能导览<ArrowRight className="size-4" /></Link></Button>
      <div className="mt-3"><Source path="docs/competition-value-2026-11-04/README.md">用户对照方法、工具与真实模型预检</Source></div>
    </section>

    <section id="architecture" className="scroll-mt-6 pt-14"><h2 className="text-2xl font-semibold">02 · 按负载与状态拆分服务</h2><p className="mt-4 max-w-3xl leading-8 text-muted-foreground">公网采用 API、Worker、Scheduler 分离的 Docker Compose。PostgreSQL 保存权威业务与任务状态，RabbitMQ 提醒执行，Redis 保存临时协调与会话，私有 MinIO 保存附件。耗时模型和 OCR 由后台执行，任务使用租约、幂等与恢复机制。</p>
      <figure className="mt-6 overflow-hidden rounded-2xl border bg-white"><a href="/competition/architecture.webp" aria-label="点击查看完整架构图"><img src="/competition/architecture.webp" alt="实际公网架构：电脑与手机经 HTTPS 访问 API，独立 Worker 与 Scheduler 使用 PostgreSQL、Redis、RabbitMQ 和私有 MinIO；公开体验使用请求内隔离内存。" loading="lazy" width="1536" height="1024" className="h-auto w-full" /></a><figcaption className="border-t p-4 text-sm leading-7 text-slate-700">公网：单节点 Docker Compose，2 vCPU / 3499 MiB。扩展验证：独立 7 节点、3 可用区 k3s 集群。两套环境各有部署与测量记录。点击图片查看大图。</figcaption></figure>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{[['PostgreSQL 作权威', '共享业务结果与任务状态，使用版本校验处理并发修改。数据库恢复后，任务按持久状态继续处理。'], ['队列用于唤醒', '消息通知提高响应速度，数据库任务与租约保存恢复依据，幂等键控制重复执行。'], ['何时横向扩容', '按 API 负载和队列积压独立扩容，结合模型 RPM / TPM 设置背压，并为每类服务确定资源请求与限制。']].map(([title, text]) => <Card key={title} className="shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="size-4 shrink-0" />{title}</CardTitle></CardHeader><CardContent className="text-sm leading-7 text-muted-foreground">{text}</CardContent></Card>)}</div>
      <div className="mt-3 flex flex-wrap gap-x-6"><Source path="docs/distributed-ha-and-capacity.md">容量与容错实测</Source><Source path="docs/competition-2026-11-03/README.md">本轮选型与图文记录</Source></div>
      <div id="recovery" className="mt-6 scroll-mt-6 rounded-2xl border p-5"><h3 className="font-semibold">公网实际数据恢复实测</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">暂停写入后保存数据库与私有附件，在独立项目的新卷中恢复。校验期间仅启动 PostgreSQL、MinIO 和只读核验程序，逐行、逐文件核对内容；Worker 与 Scheduler 在业务启动阶段启用。</p><div className="mt-4 grid gap-4 sm:grid-cols-3">{[
        ['数据库', `${recovery.tables} 表 · ${recovery.rows.toLocaleString('zh-CN')} 行`, `${recovery.sequences} 个序列，内容差异 ${recovery.contentMismatches}`],
        ['私有附件', `${recovery.objects} 个 · ${(recovery.objectBytes / 1000000).toFixed(1)} MB`, '每个对象完整读取，SHA-256 与集合一致'],
        ['数据恢复与校验', `${(recovery.dataRestoreMs / 1000).toFixed(1)} 秒`, '全新卷启动、导入及完整内容比对'],
      ].map(([title, value, note]) => <div key={title}><p className="text-xs text-muted-foreground">{title}</p><p className="mt-2 break-words text-lg font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{note}</p></div>)}</div><p className="mt-3 text-xs leading-6 text-muted-foreground">2026-11-04，公网 v17 数据快照。恢复网络为内部网络，发布端口 0；新增表、修改附件、删除附件均被识别，临时容器与卷已清理。</p><Source path="docs/competition-recovery-2026-11-04/README.md">恢复流程、异常验证、加密副本与原始记录</Source></div>
    </section>

    <section id="agent" className="scroll-mt-6 pt-14"><h2 className="text-2xl font-semibold">03 · 看得见提取、工具与恢复过程</h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['收信与上下文', '按时间处理；只选择有效日程和相关任务。邮件内容作为待分析数据。'], ['结构化计划', '基础邮件链使用兼容 JSON 提取 create / cancel / reschedule；小 D 使用受服务端校验的工具调用。'], ['工具与状态', '整封先校验再应用；改期关联新旧日程，重复邮件跳过；无法唯一匹配时交本人选择。'], ['异常与确认', '失败可重试，后台任务可恢复；发信必须审核。超时未知的外部副作用须核对后处理。']].map(([title, text], index) => <li key={title} className="rounded-2xl border p-5"><span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{String(index + 1).padStart(2, '0')}</span><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p></li>)}</ol>
      <figure className="mt-6 overflow-hidden rounded-2xl border bg-white"><a href="/competition/dataflow.webp" aria-label="点击查看完整数据流图"><img src="/competition/dataflow.webp" alt="邮件处理数据流：收信、ID去重、读取有效上下文、提取与校验、日历待办工具、Trace和回复草稿；异常修正后重试，发信需要审核。" loading="lazy" width="1536" height="1024" className="h-auto w-full" /></a><figcaption className="border-t p-4 text-sm leading-7 text-slate-700">基础邮件链使用结构化提取与工具执行，小 D 使用工具规划。用户可从原邮件追到安排、变更与执行结果。点击图片查看大图。</figcaption></figure>
      <div className="mt-6 rounded-2xl border p-5"><h3 className="font-semibold">RAG 用在“找得到依据”的地方</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">已入库邮件与附件采用混合检索，回答保留来源引用，便于回查原文。资料问答与日历写入分别校验权限，工具按各自业务规则执行。</p><p className="mt-3 text-sm leading-7 text-muted-foreground">2026-11-03 固定 15 条合成邮件调用当前配置的真实模型 deepseek-v4.1-flash，提取并在内存应用 15/15 通过，p50 7.299 秒 / p95 15.795 秒。覆盖邀请、材料、取消、改期、模糊目标与提示注入样例，每例单次调用，逐例输入、断言和 usage 随报告保存。</p><Source path="docs/competition-2026-11-03/README.md#真实模型回归">本轮模型评测与原始证据</Source></div>
      <div className="mt-4 rounded-2xl border p-5"><h3 className="font-semibold">结论对应到实际使用的原文</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">问答读取有界完整片段，模型返回结论、来源编号和逐字摘句；服务端校验编号与原文匹配后生成引用，点击即可回看。8 例原创材料调用真实模型对照，答案内容检查从 6/8 提升到 8/8，长正文与附件末尾的要求得到完整保留。</p><p className="mt-2 text-sm leading-7 text-muted-foreground">两组各 7 次模型调用、1 次空库查询；模型调用 p50 为 2.370 → 2.938 秒，当前公开价估算每组 ¥0.009536 → ¥0.022930。逐例回答、评分复核、Token 和时延一起公开。</p><Source path="docs/competition-rag-2026-11-04/README.md">RAG 优化前后、真实模型与手机记录</Source></div>
      <div className="mt-4 rounded-2xl border p-5"><h3 className="font-semibold">从执行记录直接完成回复审核</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">原邮件的回复地址、主题和草稿进入审核卡，完整阅读、编辑后确认发送；刷新会取回已保存的版本和回执。草稿关联来源邮箱与原线程，同一记录的并发准备复用一份草稿。PostgreSQL 实连 8 项验证覆盖并发、邮箱归属、版本检查和重连恢复。</p><Source path="docs/competition-reply-2026-11-04/README.md">回复闭环、状态设计与电脑手机截图</Source></div>
    </section>

    <section id="delivery" className="scroll-mt-6 pt-14"><h2 className="text-2xl font-semibold">04 · 电脑与手机顺畅走完一条主线</h2><div className="mt-6 grid gap-4 md:grid-cols-2"><Card className="shadow-none"><CardHeader><CardTitle className="text-base">电脑与手机共用入口</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-7 text-muted-foreground"><p>从免登录功能导览开始，以上科大邮箱认识日常工作区与校园生活，以 QQ 邮箱认识发票助手、智能招聘与小 D。截图可放大，校园地图、菜单与助手可继续打开使用。</p><p>当前功能保存在地址中，刷新或分享链接后可继续浏览；「手机接着看」生成当前功能的二维码。电脑使用侧边目录，手机使用功能选择器，操作按钮触控区域至少44px。</p><Button asChild variant="outline" className="min-h-11"><a href="/competition/experience-qr.png">打开体验二维码</a></Button><div><Source path="docs/competition-continuity-2026-11-04/README.md">进度恢复、手机继续与前后对照</Source></div></CardContent></Card><Card className="shadow-none"><CardHeader><CardTitle className="text-base">可复现与可回滚</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-7 text-muted-foreground"><p>仓库提供隔离演示、一键 Compose、K8s 配置与验证脚本。每次发布保留源码摘要、数据库备份、原镜像与验证证据。</p><p>健康探针检查服务状态，任务和 Trace 展示具体执行，发布后通过实际业务请求核对结果。</p><p>交付包先逐文件核对源码、构建、启动说明和五阶段日志，再从空依赖目录安装并运行七步体验。校验命令只需 Node.js，包内附带版本和摘要。</p><Source path="docs/delivery/README.md">启动、交付与演示步骤</Source><div><Source path="docs/competition-delivery-2026-11-04/README.md">交付包、逐文件校验与干净安装</Source></div><div><Source path="docs/competition-container-2026-11-04/README.md">源码容器构建、真实依赖与只读运行</Source></div></CardContent></Card></div></section>

    <div className="mt-6 rounded-2xl border p-5"><h3 className="font-semibold">三分钟分章讲解</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">实际页面截图展示七步结果、工具记录与架构设计。十二章可直接定位，讲稿随画面更新，各章连接对应证据。</p><Button asChild variant="outline" className="mt-3 min-h-11"><Link to="/demo">观看三分钟分章讲解<ArrowRight className="size-4" /></Link></Button><div className="mt-2"><Source path="docs/competition-video-2026-11-04/README.md">视频观看优化、选型与手机对照</Source></div></div>

    <div className="mt-6 rounded-2xl border p-5"><h3 className="font-semibold">运行过程持续可查</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">API、Worker、Scheduler 分别记录请求、数据库、任务、模型延迟与进程资源。每个进程按待写与在途合计限制 1 MiB，原始样本轮转，摘要原子保存；共享目录按最旧文件回收，保留目标 128 MiB。健康检查显示采集写入、丢样与错误状态。</p><Source path="docs/competition-2026-11-04/README.md#运行观测">观测机制、故障验证与云端开销</Source></div>

    <section id="cost" className="scroll-mt-6 pt-14"><h2 className="text-2xl font-semibold">05 · 用实测数据分析性能与成本</h2><p className="mt-4 max-w-3xl leading-8 text-muted-foreground">2026-11-03 在同一公网主机与同口径脚本下，拆开身份与业务快照、列表改为摘要、原文按需加载，并调整空闲轮询与邮箱切换行为。三组测量展示这些改动在各自业务路径上的效果。</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">{[['工作区接口组合', '2.57 → 0.70 秒', '小样本 HTTPS 请求平均值'], ['手机尺寸工作区可用', '8.77 → 2.38 秒', '390×844，每组 5 个新 context'], ['已有邮件重复同步', '17.02 → 2.59 秒', '同一真实邮箱各 3 次，测量重复邮件去重路径']].map(([title, value, note]) => <Card key={title} className="shadow-none"><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-3 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p><p className="mt-3 text-xs leading-6 text-muted-foreground">{note}</p></CardContent></Card>)}</div>
      <Source path="docs/performance-2026-11-03/README.md">环境、p50/p95、资源、成功率与原始样本</Source>
      <div id="rag-latency" className="mt-6 scroll-mt-6 rounded-2xl border p-5"><h3 className="font-semibold">问答更精简，等待更短</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">将同一来源的相关事实合并，减少重复结论与摘句。8 个原创合成案例各测 3 轮，新旧版本各 21 次真实模型调用；答案要点、邮箱归属、原文引用及响应模式检查均为 24/24。</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">{[
          ['模型问答 p95', `${(ragLatency.before.modelOnlyLatency.p95Ms / 1000).toFixed(3)} → ${(ragLatency.after.modelOnlyLatency.p95Ms / 1000).toFixed(3)} 秒`, '21 次调用 / 版本，包含检索与引用校验'],
          ['输出 Token', `${ragLatency.before.outputTokens.toLocaleString('zh-CN')} → ${ragLatency.after.outputTokens.toLocaleString('zh-CN')}`, `减少 ${Math.abs(ragLatency.relativeChangePercent.outputTokens)}%`],
          ['每组模型费估算', `${money(ragLatency.before.estimatedCny)} → ${money(ragLatency.after.estimatedCny)}`, '输入 ¥2、输出 ¥8 / 百万 Token'],
        ].map(([title, value, note]) => <div key={title}><p className="text-xs text-muted-foreground">{title}</p><p className="mt-2 break-words text-lg font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{note}</p></div>)}</div>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">2026-11-04，deepseek-v4.1-flash，固定关键词索引，先后顺序逐例逐轮交替。多来源问题 p50 为 5.812 → 3.134 秒，改期问题为 2.608 → 2.622 秒；逐例数据与回答一起公开。</p><Source path="docs/competition-rag-latency-2026-11-04/README.md">精简提示词、英文对照图与三轮原始记录</Source>
      </div>
      <figure className="mt-4 overflow-hidden rounded-2xl border bg-white"><a href="/competition/performance.webp" aria-label="点击查看完整性能对比图"><img src="/competition/performance.webp" alt="同公网主机性能对比：工作区接口组合2.57到0.70秒，手机尺寸工作区可用8.77到2.38秒，已有邮件重复同步17.02到2.59秒。" loading="lazy" width="1536" height="1024" className="h-auto w-full" /></a><figcaption className="border-t p-4 text-sm leading-7 text-slate-700">三组指标分别按零起点和独立刻度绘制，样本条件与逐条记录见报告。点击图片查看大图。</figcaption></figure>
      <div className="mt-7 rounded-2xl border p-5"><h3 className="font-semibold">真实调用用量 × 当前公开价格</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">15 例固定回归：输入 {fullModelRun.totals.inputTokens.toLocaleString('zh-CN')}、输出 {fullModelRun.totals.outputTokens.toLocaleString('zh-CN')} Token。按 ModelVerse 官网 2026-11-04 展示的输入 ¥2、输出 ¥8／百万 Token 复算，模型费用估算为 <strong className="text-foreground">{money(fullModelRun.totals.estimatedCny)}</strong>，平均每例 {money(fullModelRun.meanPerCallCny)}。缓存输入按普通输入价格计算。</p><p className="mt-2 text-sm leading-7 text-muted-foreground">预检、固定回归、两轮 RAG 对照与用户价值材料预检累计 {currentBudget.modelCalls} 次，输入 {currentBudget.inputTokens.toLocaleString('zh-CN')}、输出 {currentBudget.outputTokens.toLocaleString('zh-CN')} Token，合计估算 {money(currentBudget.estimatedModelCny)}。各批 usage、价格来源和复算清单随图文记录保存。</p><div className="mt-2 flex flex-wrap gap-x-6"><Source path="docs/competition-2026-11-04/README.md#模型成本">价格来源与逐例费用</Source><a href="/competition/container-assets/evidence/budget-total.json" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4">累计用量与复算清单<ArrowUpRight className="size-3.5" /></a><a href={costEvidence.source.source} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4">ModelVerse 官方模型目录<ArrowUpRight className="size-3.5" /></a></div></div>
      <Card className="mt-7 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Scale className="size-5" />按你的负载估算成本</CardTitle><p className="text-sm leading-7 text-muted-foreground">初始 Token 来自本轮 15 例平均用量，价格来自上述官方目录。按每月 1000 次提取与示例基础设施 ¥100 演算，可按自己的负载和账单调整。缓存输入初始价格与普通输入相同。</p></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{fields.map(([key, label]) => <div key={key} className="space-y-2"><Label htmlFor={`cost-${key}`} className="text-xs leading-5">{label}</Label><Input id={`cost-${key}`} type="number" inputMode="decimal" min="0" max={key === 'cachePercent' ? 100 : undefined} step="any" value={cost[key]} onChange={event => setCost(current => ({ ...current, [key]: event.target.value }))} className="min-h-11" /></div>)}</div>
        <div aria-live="polite" className="mt-6 rounded-xl bg-muted/50 p-5">{estimate ? <div className="grid gap-4 sm:grid-cols-3">{[['单封模型估算', estimate.perMessage], ['月模型估算', estimate.monthlyModel], ['月合计估算', estimate.total]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-all text-xl font-semibold tabular-nums">{money(value)}</p></div>)}</div> : <p role="alert" className="text-sm text-destructive">请输入有效的非负数，缓存占比应为 0–100%。</p>}</div>
        <p className="mt-4 text-xs leading-7 text-muted-foreground">公式：（未缓存输入 × 输入单价 + 缓存输入 × 缓存单价 + 输出 × 输出单价）÷ 1,000,000。重试、OCR、Embedding、检索存储增长、流量、备份与运维另计。填入供应商实际单价后，可按实测 Token 复算。公开功能导览只展示页面截图和说明，浏览时不会同步邮箱或调用模型。历史七步样例使用预置提取结果，原始验证记录保留在资料中。</p>
      </CardContent></Card>
    </section>
    <div className="mt-12 flex items-start gap-3 rounded-2xl border p-5 text-sm leading-7 text-muted-foreground"><CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-600" /><p>完整工程状态、逐例结果、发布记录与复现步骤保存在仓库。体验结束后，可以连接本人邮箱继续使用工作区，或直接探索校园地图、食堂与小 D。</p></div>
  </ExperienceShell>;
}
