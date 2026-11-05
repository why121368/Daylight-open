# 公网发布与验收

日期：2026-11-03 至 2026-11-04，北京时间。工作分支：`feat/competition-experience-20261103`。

**后续发布：**本页归档 v1–v6 体验与公开证据发布。11 月 4 日的 v7 已更新费用计算器、启用三个角色的指标采集，并加入有界缓冲、轮转和独立摘要；v8 进一步发布实测图文、截图和原始证据。最新版本、备份与验证见 [v8 发布记录](../competition-2026-11-04/deployment-v8.md)，技术设计与实测见 [成本与运行观测报告](../competition-2026-11-04/README.md#发布与公网检查)。

## 入口与版本

| 项目 | 当前值 |
| --- | --- |
| 交互体验 | <https://daylight.yunforis.com/experience> |
| 五项技术与实测 | <https://daylight.yunforis.com/evidence> |
| 三分钟字幕讲解 | <https://daylight.yunforis.com/competition/demo.mp4> |
| 手机扫码 | [二维码 PNG](../../public/competition/experience-qr.png)，只编码公开体验 URL |
| 最终镜像 | `daylight:public-competition-20261103-v6` |
| 镜像 ID | `sha256:a944408a0a92df5bf4cb9d66073ab2d1c81cfb6ede7aaf678f26fc2310265f8c` |
| 原有业务底座 | `daylight:public-campus-assistant-20261103`，随后按 v1 → v2 → v3 → v4 → v5 → v6 发布 |
| 最终候选包 SHA-256 | `b442b9a974ebfc6e60d221731f6a56df45c3b55be1f9439fbe1ce28fac6d3025` |
| 文件清单 | [290 个候选文件及 SHA-256](evidence/release-v6-manifest.json)，包括前端、更新的后端/共享模块和候选测试 |

v1 发布七步体验、技术页与核心图；v2 更新文字、路由滚动复位与字幕视频；v3 增加三张技术图的大图入口并简化成本说明。v4 修正从公开页返回首页时的浏览器标题。v5 发布站内图文与原始证据，v6 将手机报告改为标题在前、目录折叠。六次使用独立镜像标签。

## 发布过程与选型

1. 核对服务器正在运行的基础镜像，避免覆盖其他版本；以部署锁串行执行。
2. 备份 PostgreSQL custom dump，列出归档目录；保存环境配置、Compose、原后端、dist 与原镜像 ID。
3. 在独立构建目录解包候选，逐文件校验 SHA-256，基于现有镜像构建。复用原有 LibreOffice、OCR 和运行依赖。
4. 候选镜像在 `DAYLIGHT_RUNTIME=production`、`--network=none` 下运行新链路 **6/6** 测试。公开样例通过请求内只读合成快照执行，真实工具结果可重复生成。
5. 更新 API、Worker、Scheduler 三个应用角色。数据服务继续使用原卷与账号数据，业务 schema 沿用当前版本。
6. 等待容器健康后，从服务内检查七步结果、匿名权限与资源；再从 Windows 客户端通过正式 HTTPS 核验。
7. 发布脚本在更新后的验证失败时恢复上一环境文件与应用镜像。该保护保留在执行脚本中；本次最终发布走成功路径。

采用现有单节点 Compose 是基于当前预算和实际负载的选择：2 vCPU / 3499 MiB 主机复用，新增公开体验只执行固定七步工具，且不产生实时模型调用。API / Worker / Scheduler 的服务边界保留；Kubernetes、资源请求/限制与跨区扩展依据见 [独立 k3s 容量及容错记录](../distributed-ha-and-capacity.md)。

## 备份与回滚

| 发布 | 发布前备份 |
| --- | --- |
| v1 | `/opt/daylight-backups/before-competition-20261103231503` |
| v2 | `/opt/daylight-backups/before-competition-20261103233843` |
| v3 | `/opt/daylight-backups/before-competition-20261103234417` |
| v4 | `/opt/daylight-backups/before-competition-20261103235216` |
| v5 | `/opt/daylight-backups/before-competition-20261104000622` |
| v6 | `/opt/daylight-backups/before-competition-20261104001040` |

备份位于服务器私有目录。数据库归档已成功列出 TOC；完整数据库恢复演练沿用既有运维验收流程。

回退 v6 应用到 v5：

```sh
cd /opt/daylight
cp /opt/daylight-backups/before-competition-20261104001040/compose.env deploy/compose.env
./manage.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker scheduler
curl -fsS https://daylight.yunforis.com/health/ready
```

该操作恢复上一应用版本，保留当前业务数据。若需恢复数据库，先按业务时间点评估发布之后的新增数据，再使用备份恢复流程。

## 实际验收

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 服务健康 | Caddy、API、Worker、Scheduler、PostgreSQL、Redis、RabbitMQ、MinIO 共 8 服务 healthy | [v6 发布日志](evidence/deploy-v6.txt) |
| 应用容器 | API / Worker / Scheduler restart=0，OOM=false | 同上 |
| HTTPS readiness | 200，`ok:true` | [公网逐项结果](evidence/public-verification-v6.json) |
| 七步状态 | completed → conflict → completed → duplicate → failed → completed → completed | 同上；去重与失败前后计数相同，最终取消历史 2 项、材料待办 1 项 |
| 访问面 | 匿名 `/api/state` 401；非法 `step=8` 400；样例响应 `no-store` | 同上 |
| 页面和图像 | 两个公开路由、三张 WebP 与二维码 200；图像与本地 SHA-256 一致 | 同上 |
| 视频 | `video/mp4`，32 字节分段读取 206；本地完整解码通过 | 同上；1920×1080，约 3 分钟，1,431,534 字节 |
| 桌面与窄屏 | 320 / 360 / 390 / 768 / 1440px 两页均无横向溢出；320px 开始按钮 top≈381、bottom≈429，48px 高 | [浏览器记录](evidence/browser-verification.json) |
| 交互 | 桌面与手机七步、原文/工具展开、步骤回看；结果到技术页滚动复位；费用计算与非法数值 | 同上、[逐步截图](README.md#逐步页面证据) |
| 前端错误恢复 | 本地首次503显示重试，重试后基线日程加载、开始按钮恢复 | [图文](README.md#前端加载错误与恢复) |

健康检查与业务 Trace 用于本轮验收；服务器当前 `metrics.enabled=false`，Prometheus 采集关闭。此前工作区与真实邮箱同步的 CPU、峰值内存、耗时和优化前后数据见 [性能报告](../performance-2026-11-03/README.md)。本轮公开接口为预置提取与实时工具，顺序和4并发共40次HTTPS采样全部成功，原始记录见 [JSON](evidence/public-benchmark.json)。

## 从 GitHub 复现

准备 Node.js ≥22.19 与 npm，检出本分支后执行：

```sh
npm ci
npm test
npm run build
npm run demo -- --no-build --port 3180
```

打开 `http://127.0.0.1:3180/experience` 或 `/evidence`。完整生产拓扑使用 `sh deploy/up.sh`，配置步骤见 [部署说明](../../deploy/README.md)。

复查公网与有界测量：

```sh
node scripts/verify-competition.mjs https://daylight.yunforis.com work/competition-public-check.json
node scripts/benchmark-experience.mjs https://daylight.yunforis.com work/competition-public-benchmark.json
```

视频可用 `python scripts/competition-walkthrough.py --ffmpeg /path/to/ffmpeg` 复现，依赖 Pillow 与 Microsoft YaHei 或 Noto Sans CJK 字体。图像来源、提示词、六次调用登记及 ¥500 预算见 [生成记录](generation-and-budget.md)。

## 现场采集

按 [三分钟讲稿](demo-script.md) 在手机微信扫码检查七步、折叠原文、工具记录、大图与返回；按 [对照方案](value-study.md) 记录真人耗时、遗漏和修正；把供应商实际单价及账单填入费用登记。浏览器尺寸验证、模型API回归和现场真机记录分别保存。

## 官网材料与版本记录

技术页主要证据均指向站内HTML，官网资料为生成时的快照，其中发布归档保存v4记录；本文件及v5/v6日志记录随后两次补充发布。最终公网18项路径检查包括报告、容量设计、k3s实测、模型原始结果、图片及视频，公开文件与本地SHA-256一致。HTML使用白名单生成器，运行 `python scripts/competition-public-report.py` 后构建；v6仅更新静态HTML，沿用v5已通过的前端构建。
