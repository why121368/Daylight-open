# 三分钟视频完整讲稿

[打开分章播放器](/demo) · [下载文字稿](/competition/demo-transcript.txt)

实际页面截图与工程图，中文字幕，无音轨。七步体验使用原创邮件、预置提取结果与实时工具执行。

## 00:00 从邮件到下一步

多个申请同时推进，通知、材料与临时改期分散在收件箱。

打开同一个 HTTPS 入口，电脑和手机都能开始七步体验。

原创邮件样例 · 预置提取结果 · 工具实时执行

[定位视频这一章](/demo?chapter=overview) · [用户价值与对照方法](/competition/value-report.html)

## 00:15 01 通知变成安排与待办

面试：11 月 5 日 10:00–10:30。

材料：11 月 4 日 18:00 前准备一页研究经历。

时间与材料要求分开记录，原文随时展开核对。

[定位视频这一章](/demo?chapter=invitation) · [打开七步交互体验](/experience)

## 00:30 02 冲突留给本人决定

14:00 的实验室交流与课题组例会重叠。

日历标记时间冲突，原通知与回复草稿保留。

用户查看已有安排后，决定如何协调。

[定位视频这一章](/demo?chapter=conflict) · [查看冲突处理](/experience)

## 00:45 03 改期关联新旧安排

上午面试调整到 15:00。

旧安排标为取消，新安排记录变更邮件。

previousEventId 与 replacementEventId 双向关联历史。

[定位视频这一章](/demo?chapter=reschedule) · [改期与来源记录](/competition/report.html)

## 01:00 04 重复邮件直接跳过

再次收到同一个邮件 ID。

日程 4 → 4，待办 1 → 1。

去重发生在提取前，减少重复计算与重复模型调用。

[定位视频这一章](/demo?chapter=duplicate) · [去重与工具记录](/competition/report.html)

## 01:15 05 校验失败保持原状态

本步骤的预置提取故意包含无效时间。

服务端先校验整封，再应用日程与任务。

日程 4 → 4，待办 1 → 1；失败步骤记录在 Trace 中。

[定位视频这一章](/demo?chapter=validation) · [整封校验与异常恢复](/competition/report.html)

## 01:30 06 修正后重试成功

为同一封邮件提供有效时间，再次处理。

新增 16:00 补充交流，失败尝试仍可回查。

日历状态与每次执行结果都有来源。

[定位视频这一章](/demo?chapter=retry) · [重试与状态恢复](/competition/report.html)

## 01:45 07 取消留痕，材料保留

15:00 面试取消，释放对应时间。

取消通知与旧安排保留，材料待办继续由本人处理。

安排、来源、冲突、变更与恢复构成一条可追踪主线。

[定位视频这一章](/demo?chapter=cancel) · [取消记录与待办保留](/competition/report.html)

## 02:00 打开工具，核对执行

查看实际工具名、参数、状态与耗时。

日历上下文 → 提取结果 → 冲突检查 → 应用操作 → 回复草稿。

技术页同时提供真实模型固定回归：15 / 15 通过。

[定位视频这一章](/demo?chapter=tools) · [执行记录与回复审核](/competition/reply-review-report.html)

## 02:15 按负载与状态拆分服务

API / Worker / Scheduler 分离；PostgreSQL 保存权威状态。

公网单节点 Compose；独立 k3s 容量与故障记录随报告提供。

[定位视频这一章](/demo?chapter=architecture) · [架构、容量与容错实测](/competition/capacity-design.html)

## 02:30 Agent 数据流与恢复路径

邮件 ID 去重、有效上下文、结构化提取、整封校验、工具执行、Trace。

模型固定回归：p50 7.299s / p95 15.795s；逐例结果与 Token 已保存。

[定位视频这一章](/demo?chapter=dataflow) · [真实模型逐例回归](/competition/report.html#真实模型回归)

## 02:45 用实测与公式讨论成本

同公网主机：工作区接口 2.57→0.70s；手机尺寸可用 8.77→2.38s。

技术页可修改邮件数、Token、缓存比例与单价，按实际负载复算。

[定位视频这一章](/demo?chapter=performance) · [优化前后原始测量](/competition/performance-report.html)
