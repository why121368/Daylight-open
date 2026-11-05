# 云端部署验收报告（P0）

日期：2026-10-17（北京时间）。基线 commit `9bb3cea`，分支 `feat/cloud-native-platform`，工作区含本轮未提交改动。

**本报告只记录在真实云端实例上实际执行并留有证据的项目。**未执行的部分明确标注「未验证」，不把本机结果或代码实现算作云端通过。

本轮新增：**全部微服务以 Docker Compose 一键启动部署**，并在此拓扑上重跑全量套件与全部真实依赖验证。上一轮的 systemd 原生部署保留为历史基线（§5）。

## 1. 结论摘要

| 项 | 状态 |
| --- | --- |
| Docker Compose 一键启动全部 9 个服务 | **云端部署验证通过**（`up -d --wait --build` exit 0，全部 healthy） |
| 微服务拆分（api / worker / scheduler + 4 依赖 + 2 一次性任务） | **云端部署验证通过**（依赖顺序由 healthcheck 与 `service_completed_successfully` 强制） |
| 迁移幂等、空库初始化不导入本地数据 | **云端部署验证通过** |
| 历史数据从 systemd PG 迁移到 Compose PG | **云端部署验证通过**（`app_settings=13`、`users=8`、`jobs=2`，只读源库） |
| 健康检查（三角色 readiness + 埋点状态） | **云端部署验证通过** |
| 全量测试套件（容器内真实 PG/Redis/MQ + 两个门控） | **云端部署验证通过**（561/561，0 失败 0 跳过；本轮最终代码在 Compose 拓扑上复跑，此前为 530/530、547/547） |
| 任务/存储真实依赖验证（`verify-jobs`） | **云端部署验证通过**（8/8） |
| 生产闭环真实依赖验证（`verify-production`） | **云端部署验证通过**（12/12，S3 与外部日历为本地 HTTP mock） |
| 真实对象存储读写（`verify-oss`，Compose 内 MinIO） | **云端部署验证通过**（14/14） |
| 真实 IMAP 读取 | **真实依赖验证通过**（9/9；另在三个真实邮箱完成完整同步，见 §12） |
| 真实模型调用 | **真实依赖验证通过**（9/9，见 §4.6；优云智算 Modelverse 已用新密钥重跑通过，见 §12.5） |
| 真实邮件端到端业务闭环（三个真实邮箱 + 真实模型 + 真实 SMTP 回复） | **云端部署验证通过**（见 §12） |
| 冷启动一键安装在最终镜像上复验（独立项目，不触碰业务数据） | **云端部署验证通过**（exit 0 / 24 s / 9 服务 healthy / 公网 200） |
| 公网入口 `http://192.0.2.10:3000/` | **云端部署验证通过**（HTTP 200，安全组已放行 TCP 3000） |
| 依赖容器重建后应用自愈 | **云端部署验证通过**（见 §4.6） |
| 性能矩阵（Compose 内真实 PG + MQ） | 见 §7 |
| 公网 HTTPS / 域名 / 证书 | **未验证**（当前为直连 HTTP:3000，见 §9） |
| 多节点、HA、跨机接管、K8s 集群、容量与长稳 | **未验证**（本轮范围外） |

## 2. 实例与拓扑

| 项 | 值 |
| --- | --- |
| 主机 | 阿里云 ECS 单节点 `192.0.2.10`（仅用于本次验证；到期自动释放并删除数据） |
| 操作系统 | Ubuntu 22.04.5 LTS（jammy），内核 5.15.0-191-generic |
| 规格 | 4 vCPU / 7.5 GiB 内存 / 79 GB 系统盘（验证时可用 71 GB） |
| 容器运行时 | Docker 29.1.3（`docker.io`），Docker Compose v2.40.3（`docker-compose-v2`） |
| 进程拓扑 | 同一镜像 `daylight:local`（多阶段构建）以 4 种角色运行，Compose 项目名 `daylight` |
| 应用入口 | api 业务端口 `0.0.0.0:3000`；三角色健康端口容器内 `3001` |
| 依赖 | PostgreSQL 17.6 / Redis 7.4.5 / RabbitMQ 4.1.4 / MinIO（S3 兼容），全部容器化 + 命名卷持久化 |

## 3. 一键 Docker Compose 部署

### 3.1 微服务拆分（9 个服务）

| # | 服务 | 镜像 | 角色 | 端口 | 关键职责 |
| --- | --- | --- | --- | --- | --- |
| 1 | `postgres` | `postgres:17.6-bookworm` | 权威状态 | `127.0.0.1:15432→5432` | 业务数据、`daylight_jobs` 任务表、outbox、checkpoint、settings |
| 2 | `redis` | `redis:7.4.5-bookworm` | 缓存 / 会话 / 锁 | `127.0.0.1:16379→6379` | 会话与验证码、幂等辅助锁、限流 |
| 3 | `rabbitmq` | `rabbitmq:4.1.4-management-alpine` | 唤醒传输 | `127.0.0.1:15673→5672`，UI `15674→15672` | 只负责唤醒 Worker；**不承载权威状态**，丢失可由 PG 轮询恢复 |
| 4 | `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | 对象存储 | `127.0.0.1:19000→9000`，Console `19001→9001` | 招聘附件等二进制附件（S3 协议） |
| 5 | `minio-init` | `minio/mc:RELEASE.2025-04-16T18-13-26Z` | 一次性初始化 | — | 建桶后退出 0 |
| 6 | `migrate` | `daylight:local` | 一次性迁移 | — | 建表 / 幂等迁移；**不导入本地 JSON**；退出 0 后应用才启动 |
| 7 | `api` | `daylight:local` | HTTP API + 前端 | `0.0.0.0:3000`，健康 `3001` | 认证、业务读写、只入队不执行任务 |
| 8 | `worker` | `daylight:local` | 任务执行 | 健康 `3001`（容器内） | 领取 PG 任务、执行邮箱同步/日历/模型、CAS 提交、发确认 |
| 9 | `scheduler` | `daylight:local` | 周期调度 | 健康 `3001`（容器内） | 计划邮箱同步、失败退避重投、超时与心跳巡检 |

**依赖顺序（由 Compose 强制，不靠 sleep）：**

```
postgres(healthy) ┐
redis(healthy)    ├─► minio(healthy) ─► minio-init(exit 0) ─┐
rabbitmq(healthy) ┘                                          ├─► api / worker / scheduler (healthy)
                          postgres ─► migrate(exit 0) ────────┘
```

- 依赖服务用 `healthcheck`（`pg_isready` / `redis-cli ping` / `rabbitmq-diagnostics` / MinIO 健康端点）。
- 一次性服务用 `depends_on: { condition: service_completed_successfully }`：`migrate` 或 `minio-init` 失败，应用不会启动。
- 应用三角色隔离：`read_only: true` 根文件系统 + `cap_drop: [ALL]` + `no-new-privileges` + 仅 `/tmp` 与埋点卷可写。

**为什么是这三个角色而不是更多：** 拆分依据是「故障域与伸缩单位」，不是容器数量。API 需要随请求水平扩展且必须无状态；Worker 是 CPU/外部依赖密集、需要按队列深度伸缩，且必须能多副本并发领取而不重复执行；Scheduler 必须是**单实例**语义（同一时刻只有一个调度者在投递），依赖 PG 租约而不是选举保证。三者共用同一镜像与同一环境变量契约，避免「同一份业务逻辑三处实现」。

### 3.2 一键启动（实测命令与输出）

```sh
cd /opt/daylight/app
docker compose --env-file /opt/daylight/compose.env -p daylight up -d --wait --build
# exit=0  wall=11s（镜像层已缓存时）
# 所有容器最终状态：
#   api healthy / worker healthy / scheduler healthy
#   postgres healthy / redis healthy / rabbitmq healthy / minio healthy
#   migrate Exited(0) / minio-init Exited(0)
```

`--build` 让「构建镜像 + 启动全栈」是一条命令；`--wait` 会等到所有服务的 healthcheck 通过或一次性服务退出 0，因此命令返回即可用。日常重启不需要 `--build`：

```sh
docker compose --env-file /opt/daylight/compose.env -p daylight up -d --wait
docker compose --env-file /opt/daylight/compose.env -p daylight ps
docker compose --env-file /opt/daylight/compose.env -p daylight down        # 保留命名卷
```

### 3.3 环境变量

模板见 [`deploy/compose.env.example`](../../../deploy/compose.env.example)。真实口令放在仓库外（云端为 `/opt/daylight/compose.env`，权限 `600`）。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `RABBITMQ_PASSWORD` / `MINIO_ROOT_PASSWORD` | 是 | 四个依赖的独立口令，`openssl rand -hex 32` 生成（hex 免转义） |
| `MINIO_ROOT_USER` | 是 | MinIO 访问键，同时作为应用 OSS access key |
| `DAYLIGHT_JWT_SECRET` | 是 | ≥32 字符；生产模式强制校验 |
| `DAYLIGHT_IMAGE` | 否 | 默认 `daylight:local` |
| `DAYLIGHT_BIND_ADDRESS` / `DAYLIGHT_PORT` | 否 | 默认 `127.0.0.1` / `3000`；对外服务时设 `0.0.0.0` |
| `DAYLIGHT_PUBLIC_BASE_URL` | 否 | 回执/链接里的公网地址 |
| `DAYLIGHT_ADMIN_EMAILS` | 否 | 管理员邮箱白名单 |
| `DAYLIGHT_SYSTEM_MAIL_*` | 否 | 系统发信；默认 `DAYLIGHT_SYSTEM_MAIL_ENABLED=0` |
| `DEBIAN_MIRROR` | 否 | 构建镜像时的 Debian 源，国内用 `mirrors.aliyun.com`；默认 `deb.debian.org` |
| `DAYLIGHT_PG_HOST_PORT` / `DAYLIGHT_REDIS_HOST_PORT` / `DAYLIGHT_MQ_HOST_PORT` / `DAYLIGHT_MQ_UI_HOST_PORT` / `DAYLIGHT_MINIO_HOST_PORT` / `DAYLIGHT_MINIO_CONSOLE_HOST_PORT` | 否 | 依赖的**回环端口**，默认 `15432` / `16379` / `15673` / `15674` / `19000` / `19001`；仅 `127.0.0.1` 绑定 |

应用侧环境变量（`DAYLIGHT_RUNTIME=production`、`DAYLIGHT_DATABASE_URL`、`DAYLIGHT_REDIS_URL`、`DAYLIGHT_AMQP_URL`、`DAYLIGHT_OSS_*`、`DAYLIGHT_METRICS*`）由 `docker-compose.yml` 的 `x-app-environment` 从上面的口令拼装并注入，不需要手工写 URL。完整清单见 [DEPLOY.md](../../../DEPLOY.md#生产模式环境变量daylight_runtimeproduction)。

### 3.4 构建与国内网络

`Dockerfile` 多阶段构建（`dependencies` → `build` → `runtime`），runtime 基于 `node:22.23.3-bookworm-slim`。构建期做了两处环境适配：

1. **Debian 源与 IPv4 强制。** 默认 `deb.debian.org`（Fastly CDN）在双栈主机上会解析到被黑洞的 IPv6，`apt-get update` 挂死。构建参数 `DEBIAN_MIRROR` 替换源，并在容器内写入 `Acquire::ForceIPv4 "true"`。
2. **镜像源。** `/etc/docker/daemon.json` 配置四个 `registry-mirrors`（`docker.m.daocloud.io`、`docker.1ms.run`、`docker.1panel.live`、`dockerproxy.net`）与 `json-file` 日志轮转（`max-size=10m`、`max-file=3`）。`alpine:3.20` 实测 5 秒内拉取成功。

**Bugfix 记录：** `minio/minio` 固定 tag 从 `RELEASE.2025-04-22T22-12-26Z` 改为 `RELEASE.2025-09-07T16-13-09Z`。旧 tag 的某个 layer blob 在所有可达镜像源上均返回 502/403/denied（`latest` 亦受影响），新 tag 可正常拉取且与 `latest` 同一 digest。

### 3.5 运行时数据迁移（systemd PG → Compose PG）

- 源库 `/var/lib/postgresql`（PostgreSQL 16.15）**只读** `pg_dump`，恢复到 Compose 容器内 PostgreSQL 17.6。
- 迁移后核对：`app_settings=13`、`users=8`、`jobs=2`，与源库一致。
- dump 与核对记录保存在 `/root/daylight-evidence/compose-migration/`（服务器本地）。
- `migrate` 服务在空库上再次执行输出 `Daylight database migrations completed (no local data imported)`，确认**迁移幂等**且不导入本地 JSON。

### 3.6 在 Compose 拓扑上重跑的全部验证

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 全量测试套件（容器 PG/Redis/MQ + `DAYLIGHT_VERIFY_PRODUCTION=1` + `DAYLIGHT_VERIFY_CONCURRENCY=1`） | **517/517 通过，0 失败 0 跳过**，71.9 s | [evidence/compose-suite-cloud-517.log](evidence/compose-suite-cloud-517.log) |
| `verify-jobs`（真实 PG + RabbitMQ，含邮箱失败退避真实 SQL 校验） | **8/8** | [evidence/compose-verify-jobs-cloud.log](evidence/compose-verify-jobs-cloud.log) |
| `verify-production`（真实 PG + MQ，S3/日历为本地 mock） | **12/12** | [evidence/compose-verify-production-cloud.log](evidence/compose-verify-production-cloud.log) |
| `verify-oss`（Compose 内 MinIO，S3 协议） | **14/14** | [evidence/compose-verify-oss-minio.log](evidence/compose-verify-oss-minio.log) |
| `verify-real-mail`（真实 QQ IMAP + 真实模型，经 Compose api 容器） | **9/9** | [evidence/compose-verify-real-mail-cloud.log](evidence/compose-verify-real-mail-cloud.log) |
| 三角色 readiness + 埋点状态 | 全部 `ok:true`、`dropped=0`、`sinkError=null` | [evidence/compose-stack-health-cloud.txt](evidence/compose-stack-health-cloud.txt) |
| 服务状态与端口映射 | 9 服务符合预期 | [evidence/compose-ps-cloud.txt](evidence/compose-ps-cloud.txt) |
| 工具链与镜像源 | Docker 29.1.3 / Compose 2.40.3 | [evidence/compose-toolchain-cloud.txt](evidence/compose-toolchain-cloud.txt) |

**真实模型调用（本轮打通）：** 模型端点为可配置的 OpenAI 兼容 Chat Completions 服务 `api.modelverse.cn/v1`，模型 `deepseek-v4.1-flash`（实测支持 `response_format: { type: 'json_object' }`）。`verify-real-mail --fetch=2 --model=1` 通过 Compose api 容器执行，真实 IMAP 读取 2 封并做 1 次真实模型抽取：

```
PASS  real model extraction (1/1) — latency=2199ms actions=[none] tasks=0 invoices=0
=== summary: 9/9 passed ===
usage: imapConnects=3 messagesRead=6 attachmentObjects=2 modelCalls=1 modelFailures=0
```

模型配置需同时写 **shared 层与 `userPrefs[userId]` 层**：`readSettings()` 的合并顺序是 `...stored, ...current, ...userPref`，即用户级覆盖共享级。本轮首次验证失败正是因为只改了共享层，`userPrefs` 仍指向旧的不可达端点。

> **更正（2026-10-17 稍后）**：上段的 `api.modelverse.cn` 密钥随后被该端点**拒绝推理**：`GET /v1/models` 返回 200，但 `POST /v1/chat/completions` 返回 HTTP 401 `Validate Certification failed`（无 token 时提示 `missing token`），换浏览器 UA 与其他模型 id 同样失败。因此「已验证的模型端点」应读作「设置中配置的 OpenAI 兼容端点已验证」，并在本轮真实闭环中一度改用另一个 OpenAI 兼容端点（`api.apimaster.ai`）。**该偏离随后被消除**：用户提供了新的优云智算密钥，实测同一端点上 `POST /v1/chat/completions` 返回 200 并返回 usage，部署已改回 Modelverse 并以真实邮件复验通过。详见 §12.5。

**公网入口：** 安全组放行 TCP 3000 后，从本机（非服务器）实测：

```
/health/live   HTTP 200 in 0.065s
/health/ready  HTTP 200 in 0.077s
/              HTTP 200 in 0.065s   （前端 HTML）
```

**依赖容器重建后应用自愈：** 为给依赖加回环端口而 `docker compose up -d --wait postgres redis rabbitmq`，三个依赖容器被 Recreate（新 IP）。api/worker/scheduler **未被重建**，连接断开后自行恢复，重建完成后三角色仍 `healthy`、埋点持续写入、`/health/ready` 200。这说明应用对依赖重启是自愈的，而不是必须整体重启。

## 4. 监控与查看方式

### 4.1 内建健康与埋点端点

| 端点 | 位置 | 返回 |
| --- | --- | --- |
| `/health/live` | api `:3000` | 进程存活，不检查依赖 |
| `/health/ready` | 三角色各自 `:3001`（api 也可从宿主 `:3000` 访问） | `ok`、`role`、`draining`、`metrics.{enabled,runId,written,dropped,sinkError}` |

```sh
# api
curl -s http://127.0.0.1:3000/health/ready
# worker / scheduler（容器内）
docker compose --env-file /opt/daylight/compose.env -p daylight exec -T worker \
  node -e 'fetch("http://127.0.0.1:3001/health/ready").then(r=>r.json()).then(j=>console.log(j))'
```

`metrics.sinkError` 为 `null` 表示埋点在正常落盘；一旦磁盘不可写会变成错误码而**不会**让服务崩溃。

### 4.2 埋点文件与汇总

- 开关：`DAYLIGHT_METRICS=1`（Compose 已设）；目录 `DAYLIGHT_METRICS_DIR=/var/lib/daylight-metrics`。
- 落盘文件：`metrics-<host>-<pid>.jsonl`（含 host 与 pid，容器 PID 命名空间重复时不会互相覆盖）+ 周期 `metrics-summary.json`。
- Compose 中该目录是共享命名卷 `metrics-data`，三角色都写入同一卷，容器重启不丢。

```sh
# 人类可读汇总（表 + 关键分位）
docker compose --env-file /opt/daylight/compose.env -p daylight exec -T api \
  node scripts/metrics-report.mjs
# 机器可读 / 下钻单指标
node scripts/metrics-report.mjs --json
node scripts/metrics-report.mjs --metric pg.query.ms
# 指定目录（默认读 DAYLIGHT_METRICS_DIR）
node scripts/metrics-report.mjs --dir /var/lib/daylight-metrics
```

本机（非容器）运行同样支持：`DAYLIGHT_METRICS=1 npm run dev`，随后 `npm run metrics:report`。

### 4.3 依赖组件的可观测界面（仅回环，需 SSH 隧道）

```sh
# RabbitMQ 管理台：队列深度、连接、发布/确认速率
ssh -L 15674:127.0.0.1:15674 root@192.0.2.10   # 然后打开 http://127.0.0.1:15674
# MinIO Console：对象桶与附件
ssh -L 19001:127.0.0.1:19001 root@192.0.2.10   # 然后打开 http://127.0.0.1:19001
# 直接查 Postgres（只读）
ssh -L 15432:127.0.0.1:15432 root@192.0.2.10
```

依赖端口一律只绑 `127.0.0.1`，不对外暴露；需要时用 SSH 隧道按需打开。

### 4.4 日志与状态

```sh
DC='docker compose --env-file /opt/daylight/compose.env -p daylight'
$DC ps                        # 服务、状态、端口
$DC logs -f worker            # 跟踪某角色
$DC logs --tail 200 scheduler
$DC top                       # 容器内进程与资源
```

## 5. 历史基线：systemd 原生部署（上一轮，已停用）

上一轮在同一实例上以「apt 安装 PostgreSQL/Redis/RabbitMQ + systemd 运行三个 Node 单元」的方式验证通过，作为对比基线保留：

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| PostgreSQL | 16.15 | PGDG apt（`apt.postgresql.org`，jammy） |
| Redis | 6.0.16 | Ubuntu jammy apt |
| RabbitMQ | 3.9.27 | Ubuntu jammy apt |
| Node.js | v22.23.3 | `mirrors.aliyun.com/nodejs-release/` |

三个 unit 文件原文见 [deploy/systemd](../../../deploy/systemd/README.md)。该方式下的验证结论：全量套件 507/507、`verify-jobs` 8/8、`verify-production` 12/12、`verify-redis-restart` 通过、真实阿里云 OSS 8/8（PV 轮，证据见 [evidence/verify-oss-cloud.log](evidence/verify-oss-cloud.log)）。

**结论更正（重要）：** 上一版报告把这条路线的偏离原因写成「云端拉取镜像时反复出现内容摘要校验失败（Docker Hub 不可达）」。**该归因不成立**——真实情况是该实例**从未安装过 Docker**，不存在任何失败的镜像拉取。本轮安装 `docker.io` 29.1.3 + `docker-compose-v2` 2.40.3 并配置镜像源后，镜像拉取与本地构建均正常，Compose 全栈已成功运行。当前 api/worker/scheduler 由 Compose 承载，systemd 三 unit 已停止（宿主机的 PG/Redis/RabbitMQ 仍在 127.0.0.1 运行，与 Compose 端口不冲突）。

## 6. 配置与密钥

- 代码位置 `/opt/daylight/app`；Compose 配置 `/opt/daylight/compose.env`（权限 `600`）。
- 历史 systemd 配置保留在 `/opt/daylight/.env` 与 `/opt/daylight/service-secrets.env`（均为 `600`），不再被应用读取。
- 仓库与文档中不含任何真实口令、API Key 或邮件正文。本报告与证据日志中的真实邮箱与存储桶名已脱敏。
- 生产模式由 `DAYLIGHT_RUNTIME=production` 显式启用：基础设施全部来自环境变量，启动时不读 `data/infra.json`、不建表、不导入本地数据；依赖不可用时明确失败，不静默回退到 JSON 或内存。
- 云端受控夹具仅 3 项已声明改动（用于让示例用户可用）：`data` 库中所有 mailbox `autoSync=false`、`default`（QQ）邮箱的 `ownerUserId`、该用户的 `activeMailboxId='default'`。`DAYLIGHT_SYSTEM_MAIL_ENABLED=0`，可逆。
- 验证使用 Compose 容器内独立数据库 `daylight_test`，与业务库 `daylight` 分离；有写入的用例只作用于该库或各自的随机 schema。

## 7. 性能矩阵（Compose 内真实 PostgreSQL + RabbitMQ）

执行 `scripts/load-test.mjs --matrix`（`/root/compose-load-matrix.sh`）。测量期间 `docker compose stop scheduler worker api`，避免与后台轮询/claim 竞争 CPU；结束后由 trap `docker compose start` 拉起。数据库使用 `daylight_test` 中的随机 schema，队列使用唯一队列名。

| 配置 | 排空吞吐 | p95 端到端 | CPU(单核%) |
| --- | --- | --- | --- |
| `1w-metrics-on` | 54.89 jobs/s | 11233 ms | 35.37 |
| `2w-metrics-on` | 77.93 jobs/s | 8173 ms | 53.44 |
| `4w-metrics-on` | 98.36 jobs/s | 6305 ms | 75.59 |
| `4w-pool-5` | 95.21 jobs/s | 6645 ms | 69.41 |
| `2w-single-mailbox` | 42.46 jobs/s | 2710 ms | 51.32 |
| `2w-work-25ms` | 23.81 jobs/s | 9889 ms | 81.09 |
| `2w-failures-10pct` | 62.57 jobs/s | 3862 ms | 50.08 |

**根因仍然是 PostgreSQL 提交延迟，容器化没有引入可测损失。** 4 路同进程 Worker 只占约 0.76 个核，而每任务约需 4 个已提交事务。同实例 `scripts/probe-pg-commit.mjs` 实测：Compose 容器 PostgreSQL 17.6 **2.252 ms/次提交（444 次/s）**，systemd 基线 PostgreSQL 16.15 为 **2.886 ms/次提交（346 次/s）**；444 ÷ 4 ≈ 111 jobs/s，与实测 98.36 同量级。相对 systemd 基线的提升（1w 49.64→54.89、2w 70.70→77.93、4w 84.20→98.36）方向与 PG 从 16.15 升到 17.6 一致，**不能归因于容器化**。连接池非瓶颈（池 5 的 95.21 与池 10 的 98.36 落在噪声内）；埋点开销 -1.9%，小于 9.42% 观测极差，判定为落在噪声内。原始数据：[Compose 矩阵结果](../performance/results/20261017T102500+0800-cloud-4vcpu-compose/README.md)（systemd 基线见 [results/20261017T031548+0800-cloud-4vcpu-node22](../performance/results/20261017T031548+0800-cloud-4vcpu-node22/README.md)）。

真实邮件链路每封邮件都调用模型（秒级），平台约 100 jobs/s 的框架开销远高于所需；瓶颈在模型与外部依赖，不在任务平台。本矩阵用于确定平台上限与调优方向，不作为业务吞吐承诺。统计口径与已知限制见 [性能专项](../performance/README.md)：handler 为合成负载，**不调用模型、IMAP、SMTP、OSS**，数字描述任务平台（PG + MQ 往返与租约记账），不是端到端业务延迟。

## 8. 运行时观测与生产数据核对

**在线埋点状态**（各角色 `/health/ready` 的 `metrics` 字段，Compose 运行中）：

| 角色 | enabled | written | dropped | sinkError |
| --- | --- | --- | --- | --- |
| api | true | 1709 | 0 | null |
| worker | true | 16018 | 0 | null |
| scheduler | true | 2113 | 0 | null |

三个角色各自独立的 `runId`，说明埋点按进程实例归属，未互相覆盖。指标写入共享卷 `/var/lib/daylight-metrics/`。上一轮（systemd）worker 实时 summary 中 `pg.query.ms` 采样 4358 次（p50 0.479 ms、p95 2.29 ms、max 18.472 ms），证明埋点在真实负载下既在写也没有丢样（`dropped=0`）；原始 summary 见 [evidence/metrics-summary-cloud-worker.json](evidence/metrics-summary-cloud-worker.json)。

**任务与 outbox 核对**（业务库 `daylight`，只读查询）：`daylight_jobs` 2 行（均为 `mailbox.sync`、`failed`、`attempts=5`）、`daylight_job_outbox` 10 行且**未发布 0 行**。这两行是 **D1 缺陷**（永久失败邮箱无退避，调度器持续重投）在真实数据里的表现，采集于修复上线之前；修复后改为数据驱动退避（读 `daylight_jobs` 最近终态历史，默认 base 300 s / max 3600 s），并由 `verify-jobs` 的「mailbox sync history drives consecutive-failure backoff (real SQL ordering)」在真实 SQL 上复验。原始记录见 [evidence/production-jobs-state.txt](evidence/production-jobs-state.txt)。

## 9. 未验证与阻塞（必须如实说明）

1. **公网 HTTPS / 域名 / 证书未验证。** 当前是直连 `http://192.0.2.10:3000`（HTTP 200 已实测）。上线前仍需反向代理 + 证书 + TLS 终止；本次不放行 443/不开证书。
2. **真实飞书、真实 Google/Outlook/iCloud 日历**按用户要求不在本轮范围；协议逻辑以本地 HTTP mock 覆盖。
3. **真实阿里云 OSS** 已在上一轮验证 8/8；本轮 Compose 拓扑用 MinIO（S3 兼容）验证 14/14。两者是同一适配器的不同端点，但**不是同一次验证**：切换回阿里云 OSS 只需把 `DAYLIGHT_OSS_*` 指向阿里云端点。
4. 未做：K8s 集群部署、多副本与节点故障转移、滚动更新与回滚演练、备份恢复演练、长时间稳定性与容量上限、公网压测、TLS 压测。
5. 真实模型调用此前**只覆盖了 1 封邮件的抽取路径**（`actions=[none]`）。本轮已补上完整闭环：三个真实邮箱、三个邮箱共 43 封邮件走真实 IMAP + 真实模型抽取，产出真实日程/待办/候选人，并由真实 SMTP 发出经审核的回复且收信方确认收到——见 §12。仍未验证的是模型返回非空取消/改期动作在**云端最终镜像上**的完整重放（本闭环中的取消/改期对来自个人邮箱真实邮件，已核对 `replacementEventId`/`previousEventId` 与取消原因）。

## 10. 与 AGENTS 约定的对应

- 所有结论区分「代码已实现 / 本地测试通过 / 真实依赖验证通过 / 云端部署验证通过」，未使用「生产验收通过」。
- 有写入的验证只用独立 `daylight_test` 库与随机 schema；本机验证只用专用库 `daylight_test`，未改动用户 `data/` 与本地 `daylight` 库。
- 未弱化任何断言或把失败改成跳过：Compose 套件 517 通过、0 跳过；失败过的两个用例分别是**测试自身在 root 下的可移植性缺陷**（已改为用「文件下的路径」触发 `ENOTDIR`，任何 uid 都失败）与**脚本对 provider 名的硬编码**（已改为接受任意 S3 兼容云端模式，仍然拒绝 local 回退）。
- 未自动 commit / push。

## 11. 证据索引

| 证据 | 位置 |
| --- | --- |
| Compose 全量套件日志（真实依赖、两个门控，517/517、0 跳过） | [evidence/compose-suite-cloud-517.log](evidence/compose-suite-cloud-517.log) |
| Compose 任务/存储真实依赖（8/8） | [evidence/compose-verify-jobs-cloud.log](evidence/compose-verify-jobs-cloud.log) |
| Compose 生产闭环（12/12，S3 与外部日历为本地 HTTP mock） | [evidence/compose-verify-production-cloud.log](evidence/compose-verify-production-cloud.log) |
| Compose 真实对象存储 MinIO（14/14） | [evidence/compose-verify-oss-minio.log](evidence/compose-verify-oss-minio.log) |
| 真实 QQ IMAP + 真实模型（9/9，经 Compose api 容器） | [evidence/compose-verify-real-mail-cloud.log](evidence/compose-verify-real-mail-cloud.log) |
| Compose 三角色健康与埋点状态 | [evidence/compose-stack-health-cloud.txt](evidence/compose-stack-health-cloud.txt) |
| Compose 服务/端口状态 | [evidence/compose-ps-cloud.txt](evidence/compose-ps-cloud.txt) |
| Docker/Compose 版本、镜像源、镜像清单 | [evidence/compose-toolchain-cloud.txt](evidence/compose-toolchain-cloud.txt) |
| systemd 基线套件日志（507/507） | [evidence/suite-cloud-final.log](evidence/suite-cloud-final.log) |
| systemd 基线真实阿里云 OSS（8/8） | [evidence/verify-oss-cloud.log](evidence/verify-oss-cloud.log) |
| systemd 基线真实 QQ IMAP（8/9） | [evidence/verify-real-mail-cloud.log](evidence/verify-real-mail-cloud.log) |
| systemd 基线 Redis 重启恢复 | [evidence/verify-redis-restart-cloud.log](evidence/verify-redis-restart-cloud.log) |
| 在线埋点 summary（worker，真实运行） | [evidence/metrics-summary-cloud-worker.json](evidence/metrics-summary-cloud-worker.json) |
| 生产任务与 outbox 状态（含 D1 缺陷真实证据） | [evidence/production-jobs-state.txt](evidence/production-jobs-state.txt) |
| Compose 性能矩阵原始数据 | [results/20261017T102500+0800-cloud-4vcpu-compose](../performance/results/20261017T102500+0800-cloud-4vcpu-compose/README.md) |
| systemd 性能矩阵原始数据 | [results/20261017T031548+0800-cloud-4vcpu-node22](../performance/results/20261017T031548+0800-cloud-4vcpu-node22/README.md) |
| 冷启动一键安装（最终镜像，独立项目，0 业务数据影响） | [evidence/fresh-final/](evidence/fresh-final/)（`10-env-keys.txt` 已脱敏、`11-config.txt`、`12-up-timing.txt`、`13-ps.txt`、`14-health.txt`、`15-metrics.txt`） |
| 检索规范化（RRF + MMR）与 embedding 限流重试后的最终代码 + 真实依赖全量套件（561/561、0 跳过） | [evidence/suite-compose-561-cloud.log](evidence/suite-compose-561-cloud.log) |
| 上一版最终代码 + 真实依赖全量套件（547/547、0 跳过） | [evidence/suite-compose-547-cloud.log](evidence/suite-compose-547-cloud.log) |
| 上一轮最终代码 + 真实依赖全量套件（530/530、0 跳过） | [evidence/suite-compose-530-cloud.log](evidence/suite-compose-530-cloud.log) |
| 交互式业务接口端到端校验（15/15） | [evidence/crud-e2e-cloud.txt](evidence/crud-e2e-cloud.txt) |
| 真实回复送达（IMAP 只读确认，地址前缀已脱敏） | [evidence/reply-delivery-imap.txt](evidence/reply-delivery-imap.txt) |
| 真实运行监控报告与三角色健康 | [evidence/metrics-report-cloud.txt](evidence/metrics-report-cloud.txt)、[evidence/health-cloud.txt](evidence/health-cloud.txt) |
| 模型调用计量（原始样本聚合，153 次请求） | [evidence/model-calls-cloud.txt](evidence/model-calls-cloud.txt) |
| 优云智算 Modelverse 端点连通与推理复验（列模型 + 真实 chat 调用） | [evidence/modelverse-probe-cloud.txt](evidence/modelverse-probe-cloud.txt) |
| Modelverse 复验：2 封真实新邮件 → 当日程/待办 + 计价 trace | [evidence/modelverse-sync-cloud.txt](evidence/modelverse-sync-cloud.txt) |
| 邮箱知识库在生产可用（status/reindex/search/ask + 邀请接口） | [evidence/rag-live-cloud.txt](evidence/rag-live-cloud.txt) |
| 知识库分块落库统计（PostgreSQL，只读 SQL） | [evidence/rag-chunks-cloud.txt](evidence/rag-chunks-cloud.txt) |
| 业务状态与 trace 汇总（只读 SQL） | [evidence/business-state-cloud.txt](evidence/business-state-cloud.txt) |

## 12. 真实邮箱 + 真实模型的端到端业务闭环（2026-10-17，本轮补充）

范围：在 Compose 全栈上接入**三个真实邮箱**，用真实 IMAP 同步、真实模型抽取、真实对象存储保存附件，并用真实 SMTP 发出经人工审核的回复。凭据只存在于运行时 `PUT /api/settings` 与数据库列内，未进入仓库、文档、日志或提报材料。

### 12.1 语料投递

- 从真实 SMTP 账号向三个邮箱投递 **38 封**测试语料（含 **8 份**真实生成的简历 PDF；其中 2 封为模型端点复验投递的新邮件），每封带来源脚注、`Reply-To` 指向发信账号；发信总量 38 封，低于本轮 60 封上限。
- **25/28 封经 IMAP 确认进入收件箱**。未计入闭环的 3 封：2 封被发信账号频控拒绝（`550 Too many attempts`，随后重发成功）、1 封高校通知未出现在收件箱（收信方反垃圾过滤）。属于外部投递限制，不是产品缺陷。

### 12.2 真实模型抽取结果（非预置）

| 邮箱 | 取回邮件 | 日程 | 待办 | 备注 |
| --- | --- | --- | --- | --- |
| 个人 QQ | 15 | **6** | **8** | 含 1 组取消/改期闭环 |
| 高校邮箱 | 15 | **17** | **9** | 宣讲会、讲座、答辩、报名截止等 |
| 招聘 163 | 13 | **1** | **3** | 另有独立招聘链路 |
| 招聘候选人 | 8 个候选人 / 8 个附件 | — | — | 全部由真实简历 PDF 解析，`profile` 含教育/经历/技能/获奖分节与页级证据引用 |

取消/改期闭环：原日程 `status=cancelled` 且带取消原因与 `replacementEventId`，新日程带 `previousEventId` 指回原日程。

### 12.3 真实回复链路

- **小 D 起草 + 人工审核 + 真实发信，收信方确认到达**：`POST /api/assistant/chat` → 小 D 检索邮件上下文并调用 `draft_email` → 草稿可审核 → `PATCH` 人工修改 → `POST /api/assistant/drafts/:id/send`（带 `confirmed` 与 `revision`）→ 返回 `status=sent` 与 `accepted` 名单；在收件邮箱 IMAP 中确认该回信已进入收件箱（发件人为招聘邮箱、主题与草稿一致）。
- 处理日志页的直达发信入口 `POST /api/traces/:id/send` 在生产**显式**返回 `503 WORKFLOW_NOT_MIGRATED`（不静默降级），指向助手的审核发送流程；页面按钮在这条路径上仍是死路，列为待补缺陷。

### 12.4 本轮发现并修复的缺陷

| 编号 | 现象（真实运行证据） | 修复 | 回归验证 |
| --- | --- | --- | --- |
| D1 | 生产邮件任务不落 trace：处理日志为空、token/费用恒 0、回复草稿无法进入审核发送 | `createMailHandler` 在快照内构造绑定 `traces:<mailboxId>` 的 recorder 并传给 `runMailJob`；IMAP 读取阶段无快照时 persist 安全跳过，首个快照内写入时整批落库 | 新增用例「mail runs carry a trace recorder…」；真实同步产出 7 条 trace（4 `imported`、6 带草稿） |
| D2 | 生产下 `GET /api/traces` 默认范围 503 `Document was not loaded: settings:traces:undefined` | `readTraces`/`saveTraces` 默认到当前活跃邮箱（与 `readStore` 一致） | 新增用例「trace reads and writes default to the active mailbox…」；真实 `GET /api/traces` 返回 200 与完整 summary |
| D3 | 调度器每分钟对同一邮箱重复入队，慢同步期间队列无界增长 | 新增 `hasPendingSync`（该邮箱有 `queued`/`running` 同步则本轮 `deferred`），手动同步不受影响 | 新增用例「a mailbox already syncing is deferred…」；真实日志由 `scheduled:3` 转为 `deferred:3`，队列 0 积压 |
| D4 | 邮件任务把逐封失败折叠为单个 `MAIL_PROCESSING_FAILED`，丢失原因 | 逐封记录脱敏后的 `reason` 并写入任务异常信息 | 强化既有用例，断言 `errors[0].reason` 与异常消息 |
| D5 | 邮件任务默认 300 s 超时对真实邮箱过短，超时重试浪费模型调用 | 新增 `DAYLIGHT_JOB_TIMEOUT_MS`（代码默认仍 300 s，Compose 模板 900 s），租约由心跳续期 | 真实日志修复前 `JOB_TIMEOUT`，修复后三邮箱 `attempts=1` 全部成功 |
| D6 | 未提交改动把 `declined` 事件从**身份匹配**一并过滤，既有用例失败 | 回退该过滤，冲突占用仍由 `conflicts.js` 独立负责 | 原有用例恢复通过，未跳过或削弱任何断言 |
| D7 | 邮箱知识库、邀请回信、私密日历订阅与两个 `emails/:id` 重跑入口**写完了却在生产不可达**：生产白名单缺 `rag`/`invitations`/`invitation-preferences`/`calendar.ics`/`emails`，实测 `GET /api/rag/status`、`POST /api/rag/search`、`POST /api/rag/ask`、`GET /api/invitations` 全部返回 `503 WORKFLOW_NOT_MIGRATED` | 生产接口面抽到 `server/api-surface.js`：每个区域登记「为什么可以上生产」，`index.js` 改用它；未登记路径额外打 `unclassified_api_path` 告警，避免新功能悄悄 503 | 新增 `server/api-surface.test.js` 5 项，含**解析 `index.js` 全部 `/api` 路由并断言每条都有明确表态**；重部署后 `/api/rag/status`、`/api/rag/reindex`、`/api/rag/search`、`/api/rag/ask` 与 `GET /api/invitations` 实测 200 |
| D8 | 同一个分块在文件后端缺少 `emailId`/`source`（PostgreSQL 侧由 `rowToChunk` 还原），本地与生产分块形状不同，依赖分块定位原信的展示在本地失效 | `rag/store.js` 文件分支读写都经 `fileToChunk` 归一化，两个后端形状一致 | `server/mail-index-job.test.js` 断言分块带得回 `emailId`/`source` |
| D9 | 文档写明「已处理邮件在同步时写入当前邮箱索引」，但生产同步跑在 worker 里，索引器只挂在请求处理器上 → 生产必须手动点「纳入已处理邮件」 | `runMailJob` 在**业务提交成功后**旁路调用索引器（`rag_chunks` 有自己的短事务与 advisory lock，不进业务 CAS）；索引失败只记脱敏告警、不影响邮件结果，可用 `/api/rag/reindex` 重建 | 新增 2 项用例：默认索引器把主题正文写入知识库且重放不重复；索引失败不影响提交并输出 `knowledge_index_failed` 脱敏告警 |

### 12.5 供应商偏离已消除与计量

- **偏离消除（真实依赖验证通过）**：数据库内最初保存的 `api.modelverse.cn` 密钥可列模型（`GET /v1/models` 200）但推理被拒（`POST /v1/chat/completions` 401 `Validate Certification failed`），本轮闭环一度使用用户另一个 OpenAI 兼容供应商（`api.apimaster.ai`）。用户随后提供了**新的优云智算密钥**，实测同一端点 `GET /v1/models` 200（274 个模型）、`POST /v1/chat/completions`（`deepseek-v4.1-flash`，带 `response_format: json_object`）返回 200 且返回 `usage`；部署已改回 `https://api.modelverse.cn/v1` + `deepseek-v4.1-flash`，并投递 **2 封真实新邮件**做同步复验：真实 worker 在 30 秒内处理完（job `attempts=1`、`succeeded`），产出 1 个日程 + 1 个日程/1 个待办（其中一封触发真实日程冲突标记与回复草稿），trace 计费 **0.0160 元 / 0.0278 元**。证据 [modelverse-probe-cloud.txt](evidence/modelverse-probe-cloud.txt)、[modelverse-sync-cloud.txt](evidence/modelverse-sync-cloud.txt)。
- **密钥不外泄**：新密钥只经 `PUT /api/settings` 写入运行时设置与数据库列；响应与页面只回掩码值。本轮新增的证据文件已用 `sk-` 前缀、各邮箱授权码、管理员口令、`Authorization: Bearer` 全文扫描，无命中；密钥亦未进入仓库、文档、提交信息或日志。
- 模型用量（埋点原始样本，窗口 11:17 → 13:15）：**153 次请求** = 93 次无效密钥被拒 + **57 次成功**（53 次 `api.apimaster.ai` + 4 次 Modelverse）+ 3 次异常；已持久化 trace 中 **9 条完整计价记录**合计 **75,577 输入 / 5,404 输出 / 18,432 缓存命中 token，已知费用 0.158 元**。可计费的成功调用 57 次，仍低于本轮 150 次上限；被拒与异常请求未产生计费输出。

### 12.6 交互式业务接口端到端校验（15/15 通过）

在真实部署上直接调用业务 API，校验用例自带清理，结束后业务数据与校验前一致：

- 日程：`POST /api/events` 新建 → `PUT` 改期（`time=14:30`）→ `PUT` 取消（`status=cancelled` 且保留取消原因）→ `DELETE` 删除；
- 待办：`POST /api/tasks` 新建 → `PUT` 改截止/优先级/责任人（`2026-11-04 09:30`、`high`、招聘团队）→ `PUT` 完成（`status=done`、写入 `completedAt`）；
- 待办删除：走产品唯一路径 **小 D 的 `delete_task`**（对话中成功删除并回报原状态）；**REST 面没有待办删除接口**（返回 404），这是已记录的不对称：日程有 `DELETE`，待办删除只由小 D 负责；
- 只读面：`GET /api/jobs`（50 条，全部 `succeeded`）、`GET /api/recruitment`（8 候选人 / 8 附件）正常。

证据：[crud-e2e-cloud.txt](evidence/crud-e2e-cloud.txt)。

### 12.7 监控证据（真实运行）

`node scripts/metrics-report.mjs`：11 个进程 **158,789 条样本、0 条损坏行、0 丢弃、0 sink 错误**，32 个指标。`pg.query.ms` 122,639 样本 p50 0.456 / p95 2.957 / p99 26.456 ms；`eventloop.delay.ms` p95 43.2 ms（max 452.2 ms，出现在简历 PDF 解析峰值）；`storage.snapshot.ms` p50 60.3 / p95 104.8 ms；`storage.commit.ms` p50 26.2 ms；`imap.connect.ms` p50 526 ms；`oss.put.ms` p50 11.0 ms；`http.request.ms` p50 136 / p95 355 ms（最大 16.5 s，为长轮询/长响应接口）；`process.rss.bytes` max 966 MB；`job.execute.ms` max 300,008 ms 即修复前超时证据。三角色 `/health/ready` 均 `ok:true` 且带 `written`/`dropped`/`sinkError`。证据：[metrics-report-cloud.txt](evidence/metrics-report-cloud.txt)、[health-cloud.txt](evidence/health-cloud.txt)。

### 12.8 邮箱知识库在生产可用（本轮实测）

- **修复前**：`GET /api/rag/status`、`POST /api/rag/search`、`POST /api/rag/ask`、`GET /api/invitations` 在部署上全部返回 `503 WORKFLOW_NOT_MIGRATED`（生产接口面未登记这几条业务路径），已实现的功能不可达。见 D7。
- **修复后实测（同一部署）**：`GET /api/rag/status` 200；`POST /api/rag/reindex` 处理 **15 封邮件 / 20 条正文分块**，加 **8 个简历附件分块**共 **35 条**；`POST /api/rag/search`「面试安排」→ 3 条命中，引用带 `emailId` 与 `source=email|resume`；`POST /api/rag/ask`「我忘了之前安排给王梓睿的二面是在什么时候，帮我找一下」→ 模型回答「王梓睿的二面安排在 10 月 22 日（周四）16:30—17:15，形式为线上会议（腾讯会议），岗位是数据分析师（校招），面试官为陈老师、刘老师」，返回 **6 条证据片段**，片段来自真实邮件《【面试安排】10 月 22 日 16:30 王梓睿 数据分析师 二面》；`GET /api/invitations` 200。
- 证据：[rag-live-cloud.txt](evidence/rag-live-cloud.txt)、[rag-chunks-cloud.txt](evidence/rag-chunks-cloud.txt)。
- 覆盖用例：`server/rag.test.js`（12 项）、`server/api-surface.test.js`（5 项，含解析 `index.js` 全部 `/api` 路由并断言每条都有明确表态）、`server/mail-index-job.test.js`（2 项）、`server/mail-job.test.js`（2 项）。
