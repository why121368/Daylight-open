# Daylight · 赛道 B 提交材料清单 / Submission index

本清单依据用户提供的五项考核组织当前交付。项目总览见 [中文 README](../../README.md) / [English README](../../README_EN.md)。

## 当前提交：2026 年 11 月 6 日

用户确认本次截止日期为 **11 月 6 日（北京时间）**，新增模型调用和云资源预算合计 **¥500**。当前交付入口为 [三分钟体验](https://daylight.yunforis.com/experience) 与 [技术与实测](https://daylight.yunforis.com/evidence)。

| 当前材料 | 入口与内容 |
| --- | --- |
| 统一技术报告 | [17 页 PDF](../../public/competition/technical-report.pdf) · [手机图文版](https://daylight.yunforis.com/competition/technical-report.html) · [可编辑正文](../competition-submission-2026-11-04/technical-report.md) |
| 架构、状态与 Agent | 报告第 3-8 节：实际 Compose、选型、数据流、恢复、原文引用与真实模型对照 |
| 工程与移动体验 | 报告第 9-10、14 节：桌面及320/390px操作、完整验证、镜像与发布 |
| 成本与性能 | 报告第 11-13 节：32次真实文本调用、价格与Token、前后性能、采集开销 |
| 证据与现场 | 报告第 15-16 节：12项证据入口、三分钟脚本、二维码与原始记录 |

报告固定采用应用 `db3ee89`、证据 `006a177`、v10运行核验快照；[构建清单](../competition-submission-2026-11-04/evidence/report-manifest.json) 保存正文与PDF摘要。当前提交资料的变化另随发布记录登记。

当前网站为[v11报告与入口发布](../competition-submission-2026-11-04/deployment-v11.md)，前端及资料源码`159f434`。候选29/29、公网43项、报告引用33份资源摘要核对通过；三个应用角色的完整前端361文件一致，8服务healthy。

- [本轮五项优化、英文架构与数据流、前后对照](../competition-2026-11-03/README.md)
- [真实模型固定 15 例结果](../competition-2026-11-03/evidence/model-full/summary.json) · [公开 HTTPS 有界测量](../competition-2026-11-03/evidence/public-benchmark.json)
- [三分钟演示脚本](../competition-2026-11-03/demo-script.md) · [带字幕的实际页面截图讲解视频](../../public/competition/demo.mp4)
- [本轮发布、备份与复现](../competition-2026-11-03/deployment.md) · [预算登记](../competition-2026-11-03/generation-and-budget.md)

以下保留 10 月 18 日提交阶段的材料目录与冻结表；对应的当时状态按各文件日期读取。历史 [冲刺计划](competition-sprint.md)、[证据登记](evidence-register.md)、[基础邮件评测](evaluation-report.md) 可作为补充材料。

## 历史材料状态：2026 年 10 月 18 日

| 交付物 / Deliverable | 当前状态 / Status | 完成标准 / Acceptance |
| --- | --- | --- |
| 代码与双语 README / Code & bilingual README | 首页已整理；最终版本待冻结 | 仓库可访问，Tag/Commit、代码快照、锁文件和复现步骤齐全 |
| 技术报告 / Technical report | [七章 LaTeX 框架](../hackathon-report/README.md) | 补齐真实实现、证据与边界，编译正式 PDF |
| 架构图 / Architecture | [代码架构与 Mermaid](architecture.md)，云端 Docker Compose 拓扑已验证 | 与实际部署一致，说明组件、负载、状态、伸缩及恢复 |
| 原始验证证据 / Evidence | [验证状态](../../STATUS.md)、[可靠性矩阵](reliability/README.md)、[性能原始记录](performance/README.md) | 测试条件、关键配置、原始结果、成功与失败案例、trace |
| 埋点与可观测性 / Observability | [指标目录与开销方法](observability/README.md) | 指标语义与标签规则、采集开销测量、未覆盖范围 |
| 部署验收 / Deployment acceptance | [云端单节点部署验收报告](deployment/README.md) · [systemd 基线单元](../../deploy/systemd/README.md) · [一键 Compose 步骤](../../deploy/README.md) | 真实云主机上一键启动 9 个服务、拓扑与依赖顺序、健康检查、迁移幂等、依赖实连、真实模型与未验证边界 |
| 答辩 PPT / Slides | [八页内容与逐页讲稿](defense.md)已完成；演示文件待制作 | 约 8 页、5 分钟；架构、链路、结果、取舍、不足 |
| 现场 Demo / Live demo | [三分钟脚本与备用方案](defense.md)已完成；发布地址和账号待冻结 | 3 分钟现场真实运行，明确预置数据与实际调用 |
| 备用视频 / Backup recording | 待录制上传 / Pending | 建议 3 分钟，故障备用或长过程佐证，不替代核心实演 |
| 成本性能 / Cost & performance | [本机 PG 合成基准](performance/README.md)已采集；云端业务容量与成本待测 | Token 与单价、p50/p95、资源、并发、失败率、原始数据 |

## 报告与证据对照

| 七章报告 / Report chapter | 最少应提供的证据 |
| --- | --- |
| 1. 场景与价值 / Scenario & value | 目标用户、痛点、人工流程对照、价值验证及样本局限 |
| 2. 系统架构 / Architecture | 实际拓扑、组件职责、技术决策、状态与故障域 |
| 3. Agent 执行链路 / Execution | 一条完整调用轨迹、上下文、工具参数摘要、确认和结果 |
| 4. 可靠性与异常 / Reliability | 模型错误、工具失败、超时/重试、恢复、人工介入案例 |
| 5. 效果与验证 / Evaluation | 用例、原始结果、成功与失败、环境/模型/版本/样本量 |
| 6. 成本与性能 / Cost & performance | usage、价格版本、计时口径、资源采样、瓶颈与优化取舍 |
| 7. 部署与局限 / Deployment & limitations | 干净环境复现、依赖、配置、回滚、当前边界与后续计划 |

## 历史版本冻结表 / Historical release record

- 提交 Tag / Commit：**待填写 / Pending**
- 可访问仓库：[why121368/Daylight](https://github.com/why121368/Daylight)
- 源码快照文件与校验值：**待填写 / Pending**
- 部署地址及演示账号获取方式：**待填写 / Pending**（不在公开仓库提交密码）
- 技术报告 PDF、PPT、备用视频链接：**待填写 / Pending**
- 测试环境、模型/提示词/配置版本：**待填写 / Pending**
- 现场相对提交版本的变更：**待填写，未变更则注明无 / Declare changes or none**

提交前检查仓库与材料访问权限、图片和视频、版本一致性、密钥与隐私、复现命令。比赛截止时间以主办方最终通知为准。报告编译步骤见报告目录；业务部署见 [DEPLOY](../../DEPLOY.md)。

## README 素材替换 / Media replacement

品牌素材来自用户提供的 Daylight 图片，存放在 `docs/assets/readme/`；SVG 均为明确标识的占位图。

| 位置 / Slot | 替换时应展示什么 |
| --- | --- |
| `workbench-placeholder.svg` | 保研多校机会、事项材料、待确认行动 |
| `calendar-placeholder.svg` | 跨工作台冲突和改期关联，隐藏私人内容 |
| `trace-placeholder.svg` | 一次真实执行的工具、状态、耗时与结果 |
| `recruitment-placeholder.svg` | 智能招聘工作台及脱敏候选人/邀约 |
| `architecture-placeholder.svg` | 提交版本实际架构；标注目标与已部署边界 |

替换成 PNG/SVG 后同时更新两份 README 的图片路径。不要将设计稿、示例回放或人工绘制的轨迹标成真实运行证据。中英文的功能、限制、版本和证据口径应保持一致。
