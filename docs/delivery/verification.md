# 当前交付验证记录

日期：2026-10-28（北京时间）。来源基线 `c36cae6a5686f60f8d7cfb2df5144bf8e67ffbb7`，当前分支 `feat/campus-guide-public-access`；本轮修改包含在工作区和交付包中，尚未推送为远程发布。最终逐文件摘要见包内 `DELIVERY-MANIFEST.json`。

## 1. 稳定源码与离线检查

最终报告：`work/release-check-XerbCA/summary.json`。交付包内另有 `delivery-evidence/summary.json` 及全部五阶段日志。

- 源码摘要：`1ef3356233a9877050b4b2895aaf6ae91a201f91d443671cb4c900c8eb4856df`
- 构建摘要：`5083ed3b09c5d5210e74829cd49915e9203ab3bc38696fef6b363281d1e7f865`
- 环境：Windows x64、Node 24.14.0；测试子进程去除继承服务凭据，阻止原 `data/` I/O 和外网。

| 阶段 | 结果 | 耗时 / 范围 |
| --- | --- | --- |
| 全量测试 | **915 项：887 通过、0 失败、28 条件跳过** | 测试约 78.2 秒；跳过的配置/依赖检查不记为实连 |
| 前端构建 | 通过 | 约 55.4 秒；主包约 1.93 MB、PDF chunk 约 590 kB，仍有大包提示 |
| 评测语料 validate | 通过 | 只检查语料与断言结构，不是本轮模型评测 |
| Demo HTTP | 通过 | 认证、状态、改期/冲突、招聘、发票、引用、工作台、重复导入、匿名及越权、SPA 入口 |
| 部署资产 | 通过 | 文件与锁文件检查；另外实际 Compose 配置解析共 16 项通过 |

Guard 记录 2 次被禁止的测试外网请求意图。没有以真实邮箱、模型、SMTP 或学校登录替代测试夹具。验证脚本会拒绝源码运行中变化的结果；此前此类报告保留 `ok=false`，没有用于最终打包。

## 2. 依赖审计与镜像构建

`npm audit --omit=dev --registry=https://registry.npmjs.org`：**0 个当前已知漏洞**。完整报告：[dependency-audit.json](evidence/dependency-audit.json)。初次 registry 的 npm 审计端点不支持，故切至 npm 官方通告端点；不是忽略错误。依赖升级后 PDF.js 6.4.299、Nodemailer 10.2.1、Undici 8.12.3、Body Parser 1.20.9、qs 6.16.2、ip-address 10.7.5、KaTeX 0.19.1 已锁定。该审计不覆盖未公开漏洞和整个运行环境。

最终应用镜像构建成功：

```sh
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22.23.3-bookworm-slim \
  -t daylight:delivery-20261028 .
```

镜像 ID：`sha256:fe48aad934f456e654679540a18a82d053f78fe9408a5f3b134eb751e2de2881`。这是本地 image ID，尚无本轮 registry push digest。最终构建原始日志：`work/delivery-image-build-final-ui.log`。此前 Docker Hub auth 超时、阿里 Debian 字体包下载失败、最后一轮 npm 下载超时均保留失败记录；最终分别使用官方 ECR Node、默认 Debian 源和一次 npm 重试成功。

容器以 UID 1000 运行，Node 22.23.3、canvas 原生模块、PDF.js 和 Tesseract 模块加载通过；未将模块加载说成真实 OCR 识别。

## 3. 真实本地容器与恢复

报告：[local-containers.json](evidence/local-containers.json)、[restore-proof.json](evidence/restore-proof.json)。原始材料位于 `work/delivery-containers-Fmzh6m/`。各项目使用随机独立名字、卷、凭据和自动分配的回环端口；未挂载仓库真实 `data/`、未连接其他项目的数据库或对象桶。

| 检查 | 结果 |
| --- | --- |
| API / Worker / Scheduler / PG / Redis / RabbitMQ / MinIO | 全部 healthy；迁移、桶初始化退出 0 |
| 真实 PostgreSQL / RabbitMQ | 任务幂等、所有权、同邮箱顺序、过期租约与旧执行者围栏、事务回滚、有限重试、outbox 确认间隙、重复唤醒、断线重连、Worker 心跳和检查点通过 |
| 真实并发检查 | **20/20 通过**；独立 schema / queue，专有 Redis 容器 |
| 真实本地 S3 对象接口 | **14/14 通过**；上传下载相同、键规范、缺失对象返回 null、缺凭据不回退、删除验证 |
| 合成生产 API | 写入日历并读取成功；匿名 401、普通用户管理 403、越权邮箱 404 |
| 停写一致性备份 | 真实 pg_dump、MinIO 停机冷卷复制、4 项校验和与完成标记，原栈恢复健康；约 **27.7 秒** |
| 全新项目恢复 | 真实 pg_restore、相同日历行与合成用户、4500 字节对象 SHA-256 一致、匿名附件 403、角色健康；约 **48.7 秒** |

最终恢复对象摘要：`c2b1537a23b0164c1e467e25700d922418feea3d66f76aeeb0cfd6ecb82c4189`。原项目在恢复后仍可读取。Redis 会话不恢复，恢复环境需重新登录。小型合成数据只证明这次流程可执行，不能外推真实邮件量下的 RTO、RPO、吞吐或账单。

**MinIO 版本限制：** 默认镜像本轮拉取失败，改用已有本机缓存的 `RELEASE.2025-04-22T22-12-26Z`，仅修改专用测试项目的健康检查。未使用另一个项目的数据或服务，缓存镜像不分发。PostgreSQL 为官方 ECR 仓库的 17.6，Redis 为 7.4.5，RabbitMQ 为 4.1.4。此次结果是本地真实依赖检查，不是默认所有镜像全新拉取通过，也不是 UCloud / US3 或 Kubernetes 实连。

实际演练修复了 Compose `create --no-deps` 无效参数。旧 OSS 脚本把缺失对象正常返回 null 当成异常，现已按实际接口约定验证；对象缺失与 HTTP 所有权鉴权分别检查。

## 4. 浏览器检查

最终 Demo 为 `work/demo-nWy4Z6/`。正常登录路径可点击演示入口；账户权限保持普通用户。已核验总览日历链接、有效日程与变更来源、冲突的执行阶段和候选/回复草稿、两封报告提醒合并待办、关键词「项目报告」的两条引用及回原信、四类工作台、三位候选人、简历 PDF、发票字段与原 PDF、公开校园示意路线。

- [最终总览截图](evidence/demo-overview.png)
- [简历 PDF 截图](evidence/resume-preview.png)
- [票据 PDF 截图](evidence/invoice-preview.png)
- [校园示意路线截图](evidence/campus-route.png)

当前构建未新增控制台渲染错误。先前本轮浏览器发现的 Map 图标遮蔽 JS Map、总览统计链接遗漏 `/app`、移动侧栏未在导航后收起均已修复并复验。474 像素窗口完成主要流程；这不代替所有设备或真实手机移动网络验收。

## 5. 打包与可搬迁检查

打包器检查当前源码和 dist 的摘要与成功报告相同，再输出源码、构建、当前文档、五阶段证据与 SHA-256。解压后通过 manifest 枚举自身源码，避免误用父目录 Git；首次安装需联网获取 node_modules。最终压缩包及校验文件在 `output/delivery/`，以 `latest.json` 指定版本为准。

最终源码候选包 `daylight-demo-20261028T004655.tar.gz` 已执行归档路径、SHA-256 和 806 文件逐项校验，从空 `node_modules` 执行 `npm ci` 安装 541 个包，随后 `node scripts/demo.mjs --check --no-build` 全部 HTTP 流程通过。证据：[package-install.json](evidence/package-install.json)、[安装输出](evidence/package-install.txt)、[Demo 输出](evidence/package-demo.txt)。最终包在补齐文档后重打包，代码与构建摘要保持与安装验证版本相同；外层校验文件给出最终压缩包摘要及逐文件复验结果。隔离容器项目和专用卷已全部清理，见 [清理记录](evidence/container-cleanup.json)；演示服务保留运行。

## 6. 目标环境验收边界

本轮没有真实 IMAP / 付费模型 / SMTP / 学校网站调用或云端部署动作。目标云仍需可用的可信依赖镜像、正式 HTTPS、手机外网、授权真实业务闭环、集群准入与多节点故障、异地恢复、代表性容量/长稳和费用验收。完整步骤和通过证据要求见 [云端方案](cloud-deployment.md)。
