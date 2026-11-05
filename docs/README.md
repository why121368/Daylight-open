# Daylight 文档导航 / Documentation

| 我想… / Goal | 入口 / Read |
| --- | --- |
| 接手竞赛收尾、运行与明确未完成事项 | [11月4日交接文档：版本、回滚、真人／微信／提交及后续计划](../HANDOFF-2026-11-04.md) |
| 从源码构建容器并核对真实依赖 | [构建快照、英文流程图、实构建与只读运行](competition-container-2026-11-04/README.md) · [最新v22、私有包、正式截图与全部回执](competition-container-2026-11-04/deployment-v22.md) |
| 实际公网数据恢复与异机加密副本 | [分阶段恢复、英文流程图、9表/187附件实测与兼容修复](competition-recovery-2026-11-04/README.md) · [v18发布与正式截图](competition-recovery-2026-11-04/deployment-v18.md) |
| 公开页首屏等待、按需加载与手机对照 | [加载边界、gpt-image-2.5英文图与20次采样](competition-entry-2026-11-04/README.md) · [v17发布与正式截图](competition-entry-2026-11-04/deployment-v17.md) |
| 观看分章视频，逐章核对讲稿与证据 | [在线播放器](https://daylight.yunforis.com/demo) · [选型、手机前后图与复现](competition-video-2026-11-04/README.md) · [完整讲稿](competition-video-2026-11-04/transcript.md) · [v14发布](competition-video-2026-11-04/deployment-v14.md) |
| 从原邮件执行记录完成回复审核 | [状态设计、PostgreSQL验证、前后对照与手机截图](competition-reply-2026-11-04/README.md) · [v13发布](competition-reply-2026-11-04/deployment-v13.md) |
| 采集用户价值：人工与Agent整理通知对照 | [方法、流程图、本地主持工具和10次真实模型预检](competition-value-2026-11-04/README.md) |
| 按五项考核阅读当前完整技术报告 | [21页PDF](../public/competition/technical-report.pdf) · [官网图文](https://daylight.yunforis.com/competition/technical-report.html) · [最新前后图、基线与复现](competition-report-refresh-2026-11-04/README.md) · [v15发布](competition-report-refresh-2026-11-04/deployment-v15.md) |
| 邮件问答上下文、引用与手机前后对照 | [RAG 设计、14 次真实调用、评分复核与截图](competition-rag-2026-11-04/README.md) · [v9 云端验证](competition-rag-2026-11-04/deployment-v9.md) · [当前 v10 发布](competition-rag-2026-11-04/deployment-v10.md) |
| 11 月 4 日费用、运行观测与采集开销 | [价格、逐例估算、采集设计与云端记录](competition-2026-11-04/README.md) · [v8 发布与最终复查](competition-2026-11-04/deployment-v8.md) |
| 11 月 6 日竞赛：免登录体验、技术图文与发布 | [本轮交付记录](competition-2026-11-03/README.md) · [演示脚本](competition-2026-11-03/demo-script.md) · [部署](competition-2026-11-03/deployment.md) |
| 直接运行可交付 Demo / Run the delivery demo | [演示交付入口](delivery/README.md) · [讲解脚本](delivery/demo-script.md) |
| 做好云端上线前准备 / Prepare a cloud release | [完整云端部署方案](delivery/cloud-deployment.md) · [本轮验证](delivery/verification.md) |
| 了解产品与功能 / Understand the product | [中文 README](../README.md) · [English](../README_EN.md) |
| 一键启动 / Start the complete stack | [Compose 部署](../README.md#deploy) · [English](../README_EN.md#deploy) |
| 手机扫码公开访问 / Publish a public QR entry | [UCloud / HTTPS 部署方案](public-access.md) |
| 使用已迁移账号和邮箱 / Use migrated accounts and mailboxes | [11 月 2 日公网数据迁移与手机体验](public-data-migration-2026-11-02.md) |
| 继续当前公网部署与功能演示 | [2026-11-02 交接文档](handoff-public-deployment-2026-11-02.md) |
| 校园地图、课表、活动与交流 / Campus guide | [使用步骤、数据与功能对照](campus-guide.md) |
| 配置认证、邮件和存储 / Configure services | [DEPLOY](../DEPLOY.md) · [环境示例](../deploy/compose.env.example) |
| 配置 Kubernetes / Deploy to Kubernetes | [部署资源](../deploy/README.md#kubernetes-with-external-managed-dependencies) |
| 理解架构和任务 / Architecture and jobs | [架构](submission/architecture.md) · [任务约定](../server/jobs/README.md) |
| 自定义工作台 / Customize workspaces | [模板说明](../README.md#templates) · [JSON 示例](examples/campus-followup.template.json) |
| 排查故障 / Troubleshoot | [README 排障](../README.md#operations) · [日历恢复 API](calendar-recovery-api.md) |
| 查看实际验证范围 / Check validation scope | [STATUS](../STATUS.md) · [云端记录](submission/deployment/README.md) · [故障测试](submission/reliability/README.md) |
| 查看性能和成本 / Performance and cost | [测量](submission/performance/README.md) · [基础邮件评测](submission/evaluation-report.md) · [指标](submission/observability/README.md) |
| 当前公网交互慢、架构优化与前后实测 | [2026-11-03 图文报告、图源与数据](performance-2026-11-03/README.md) · [离线 HTML](performance-2026-11-03/report.html) |
| 准备比赛材料 / Competition materials | [清单](submission/README.md) · [报告](hackathon-report/README.md) · [发布冻结](submission/release.md) |
| 准备截图 / Capture screenshots | [素材与镜头清单](assets/readme/README.md) |
| 参与改进 / Contribute | [CONTRIBUTING](../CONTRIBUTING.md) |

历史记录可能对应不同提交。引用测试数量、费用或运行结论时，同时保留版本、环境与原始记录；不要把所有历史结果合并为当前版本验收。

Historical results may refer to different revisions. Keep version, environment, and raw results with every claim.

本轮 README 的组织方式参考了公开项目的产品介绍、快速启动、功能、部署、支持与贡献入口，而非复制其能力或成熟度声明：[Dify](https://github.com/langgenius/dify/blob/main/README.md)、[n8n](https://github.com/n8n-io/n8n/blob/master/README.md)、[Open WebUI](https://github.com/open-webui/open-webui/blob/main/README.md)。
