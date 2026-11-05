# 埋点与可观测性（性能专项 P3）

本文记录 Daylight 的埋点模块（`server/metrics.js`）、已接入的关键路径、指标语义、开销测量方法，以及尚未覆盖的范围。所有结论按当前证据标注：**代码已实现**、**本地测试通过**、**云端部署验证通过** 分别列出，未完成的部分写「待验证」。

**2026-11-04 更新：**采集器按待写与在途总量限制内存，加入原始文件轮转、跨容器历史回收和各角色独立原子摘要。云端 23/23 定向验证与持久卷开销见 [本轮图文报告](../../competition-2026-11-04/README.md)。

## 1. 设计约束

| 约束 | 实现方式 |
| --- | --- |
| 采集不阻塞业务 | 样本先进入有界内存缓冲，后台批量追加写盘；缓冲满则丢弃该样本并只累加 `metrics_dropped_total` |
| 落盘失败不影响业务 | 写失败只计入 `dropped`，并记录 `sinkError`，不向调用方抛出 |
| 延迟可重算 | JSONL 保留每条原始延迟样本；各角色原子 summary 另存 count/sum/min/max 与有界 reservoir 的 p50/p95/p99 |
| 不泄漏用户数据 | 标签在模块边界净化：拒绝 body/subject/sender/email/token/key/url 等键名，邮箱与疑似密钥脱敏，值截断 40 字符 |
| 关闭时零开销 | `DAYLIGHT_METRICS !== '1'` 时所有 API 立即返回，不建缓冲、不启定时器 |

标签键名/值净化规则与边界由 `server/metrics.test.js` 覆盖（含“关闭时零开销”“缓冲溢出报丢样”“sink 失败不抛出且可观测”“disabled 子进程路径”）。

## 2. 指标目录（已接入代码）

### HTTP / 进程

| 指标 | 类型 | 单位 | 标签 | 位置 |
| --- | --- | --- | --- | --- |
| `http.request.ms` | histogram | ms | `method`, `status`, `class`, `route` | `server/index.js`（排除 `/health`） |
| `http.requests_total` | counter | count | `method`, `status`, `class`, `route` | 同上 |
| `http.inflight` | gauge | count | — | 同上（完成时递减） |
| `process.rss.bytes` / `process.heap_used.bytes` / `process.external.bytes` | gauge | bytes | — | `server/metrics.js` 周期采样 |
| `process.cpu.percent` | gauge | percent | — | 同上（相对上一采样区间） |
| `process.handles` / `process.uptime.seconds` | gauge | count/seconds | — | 同上 |
| `eventloop.delay.ms` | gauge | ms | `stat=mean\|max` | 同上（`perf_hooks` 直方图） |
| `gc.pause.ms` | histogram | ms | `kind` | 同上（`PerformanceObserver`） |
| `process.start_total` | counter | count | `role` | `startMetrics()` |

### 数据层

| 指标 | 类型 | 单位 | 标签 | 位置 |
| --- | --- | --- | --- | --- |
| `pg.query.ms` | histogram | ms | `op`（SQL 首关键字，如 `select`/`insert`）、`outcome` | `server/infra/postgres.js`（`pool.connect` 包装，连接级计时，避免 pool/client 双重计数） |
| `pg.pool_error_total` | counter | count | — | 同上（空闲连接错误） |
| `redis.command.ms` | histogram | ms | `command`, `outcome` | `server/infra/redis.js`（包装 `sendCommand`，覆盖全部命令） |
| `storage.snapshot.ms` | histogram | ms | `system` | `server/storage/index.js` |
| `storage.commit.ms` | histogram | ms | `docs`, `outcome`（`committed`/`conflict`/`failed`） | 同上 |
| `storage.conflict_total` | counter | count | `docs` | 同上（CAS 冲突） |

### 任务平台

| 指标 | 类型 | 单位 | 标签 | 位置 |
| --- | --- | --- | --- | --- |
| `job.execute.ms` | histogram | ms | `kind`, `outcome`（`succeeded`/`failed`/`lease_lost`） | `server/jobs/runtime.js` |
| `job.executed_total` | counter | count | `kind`, `outcome` | 同上 |
| `mq.publish.ms` | histogram | ms | `outcome` | `server/jobs/rabbit.js`（含 publisher confirm） |
| `mq.publish_total` | counter | count | `outcome` | 同上 |
| `mq.wakeup_total` | counter | count | `outcome` | 同上（含重复投递） |

### 外部依赖

| 指标 | 类型 | 单位 | 标签 | 位置 |
| --- | --- | --- | --- | --- |
| `model.request.ms` | histogram | ms | `provider`（仅主机名）、`status`、`outcome` | `server/model-fetch.js` |
| `model.requests_total` | counter | count | `provider`, `outcome` | 同上 |
| `imap.connect.ms` | histogram | ms | `provider` | `server/agent.js` |
| `imap.read.ms` / `imap.read_total` | histogram / counter | ms / count | `provider`, `outcome` | 同上 |
| `imap.messages_total` | counter | count | `provider` | 同上（`counterAdd`，增量=本批封数） |
| `oss.put.ms` / `oss.put_total` / `oss.bytes_total` | histogram / counter | ms / count / bytes | `mode`, `outcome`, `op` | `server/infra/oss.js` |
| `oss.get.ms` / `oss.get_total` / `oss.bytes_total` | 同上 | 同上 | 同上 | 同上 |
| `calendar.push.ms` / `calendar.push_total` | histogram / counter | ms / count | `provider`, `action`, `outcome`（`ok`/`retryable`/`permanent`） | `server/external-calendar.js` |

`model.request.ms` 的 `provider` 只取主机名，路径（可能含密钥）永不进入标签。`pg.query.ms` 的 `op` 只取 SQL 首个关键字，语句与参数永不进入标签。

## 3. 输出文件与环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DAYLIGHT_METRICS` | 未设置=关闭 | `1` 开启 |
| `DAYLIGHT_METRICS_DIR` | `<DAYLIGHT_DATA_DIR>/metrics` | 输出目录 |
| `DAYLIGHT_METRICS_SAMPLE` | `1` | 延迟/观测采样率 0–1 |
| `DAYLIGHT_METRICS_BUFFER` | `10000` | 缓冲上限（下限 100） |
| `DAYLIGHT_METRICS_FLUSH_MS` | `1000` | 批量落盘周期（下限 50） |
| `DAYLIGHT_METRICS_SUMMARY_MS` | `15000` | summary 重写周期（下限 1000） |
| `DAYLIGHT_METRICS_RESERVOIR` | `4000` | 分位数 reservoir 容量（200–10,000） |
| `DAYLIGHT_METRICS_SERIES` | `128` | 指标名数量上限（16–512） |
| `DAYLIGHT_METRICS_BUFFER_BYTES` | `1048576` | 待写与在途合计字节上限；同时受 BUFFER 条数限制 |
| `DAYLIGHT_METRICS_FILE_BYTES` / `DAYLIGHT_METRICS_FILES` | `8388608` / `4` | 单进程原始文件大小与份数 |
| `DAYLIGHT_METRICS_DIRECTORY_BYTES` | `134217728` | 共享目录保留目标，包含旧容器文件；并发写入可暂时增加在途批次和临时摘要 |
| `DAYLIGHT_RUN_ID` / `DAYLIGHT_GIT_SHA` | 自动 | 关联一次运行；`DAYLIGHT_GIT_SHA` 优先于 `git rev-parse` |
| `DAYLIGHT_GIT_DIRTY` | 自动 | 声明工作区是否 dirty（`1`/`0`）。部署产物通常不是 git 检出，此变量让 provenance 可确定性注入；未注入且无 git 时记录 `null`（未知），不谎报为 clean |

产物：

- `metrics-<host>-<pid>.jsonl`：一行一个原始样本（含北京时间戳与全部标签）。文件名带容器/主机标签，因为 PID 命名空间会重复——多个容器共用一个 sink 卷时，仅用 PID 会让所有容器都写 `metrics-1.jsonl`。
- `metrics-summary-<host>-<pid>.json`：按指标聚合的 count/sum/min/max 与 reservoir 分位数，临时文件写完后原子替换。原始文件单份默认 8 MiB，每进程 4 份，整个目录按最旧文件回收，保留目标 128 MiB。

生命周期由服务入口统一管理：`serviceHealth({ role })` 调用 `startMetrics({ role })`，`installShutdown()` 在基础设施关闭后等待 `stopMetrics()` 完成剩余样本与最终 summary 写入。`/health/ready` 返回 `metrics: { enabled, runId, written, dropped, sinkError }`，便于在线确认埋点是否真的在写。sink 目录不可写时只置 `sinkError`，不抛异常、不阻断服务。

查看方式（本机与容器一致）：

```sh
DAYLIGHT_METRICS=1 npm run dev                 # 埋点默认写到 <DAYLIGHT_DATA_DIR>/metrics
npm run metrics:report                          # 读取 DAYLIGHT_METRICS_DIR / data/metrics
node scripts/metrics-report.mjs <dir> --top 20 --metric pg.query.ms
```

`scripts/metrics-report.mjs` 直接从 `metrics-<host>-<pid>.jsonl` 重算 count/p50/p90/p95/p99/max/mean（不依赖 summary 的缓存），并打印 provenance（runId、gitSha、dirty）、每个进程文件的样本数，以及 drops/sinkError 健康提示；`--json` 输出机器可读结果，`--metric <name>` 按标签集下钻。容器内 sink 在 tmpfs 或命名卷上，用 `docker compose exec <service> node scripts/metrics-report.mjs` 读取；每个角色的实时 summary 以各自的 `/health/ready` 为准；CLI 读取各进程独立的 summary，并保留对旧 `metrics-summary.json` 的读取兼容。

在 Compose 拓扑上，`docker-compose.yml` 让三个应用角色共享命名卷 `metrics-data` 挂到 `/var/lib/daylight-metrics`（镜像内预建目录并 `chown node:node`），因此容器重启不丢埋点、三角色结果可一起汇总：

```sh
DC='docker compose --env-file /opt/daylight/compose.env -p daylight'
$DC exec -T api node scripts/metrics-report.mjs            # 汇总卷内全部进程文件
$DC exec -T worker node -e 'fetch("http://127.0.0.1:3001/health/ready").then(r=>r.json()).then(j=>console.log(j))'
curl -s http://127.0.0.1:3000/health/ready                 # api 的实时埋点状态
```

需要看依赖组件本身时，Compose 把 PostgreSQL/Redis/RabbitMQ/MinIO 发布在**回环端口**（默认 `15432`/`16379`/`15673`+`15674`/`19000`+`19001`），远端主机用 SSH 隧道按需打开，例如 `ssh -L 15674:127.0.0.1:15674 root@<host>` 后访问 RabbitMQ 管理台（队列深度、发布/确认速率），`ssh -L 19001:127.0.0.1:19001 root@<host>` 后访问 MinIO Console。这些端口不对外暴露。

## 4. 性能测试工具：`scripts/load-test.mjs`

用途：在真实 PostgreSQL + 真实 RabbitMQ 上驱动产品自身的 `JobRepository` / `JobWorker` / `JobTransport`，测量入队吞吐、排队延迟、端到端延迟、资源占用、并发扩展与埋点开销。handler 为合成负载，**不调用模型、IMAP、SMTP、HTTP API 或 OSS**，因此不消耗外部额度。

```sh
LOAD_TEST_DATABASE_URL=postgresql://127.0.0.1/postgres \
LOAD_TEST_AMQP_URL=amqp://daylight:daylight@127.0.0.1:5672 \
LOAD_TEST_OUT=work/load-test-01 \
node scripts/load-test.mjs --matrix          # 完整矩阵（见下）
node scripts/load-test.mjs --run --workers 4 --jobs 600 --metrics on
```

每次运行使用独立随机 schema（`search_path` 注入）与独立队列名，结束后 DROP schema；`public` 不被写入。

### 矩阵

| 配置 | 目的 |
| --- | --- |
| `1w-metrics-on` / `2w-metrics-on` / `4w-metrics-on` | 同进程 Worker 数扩展曲线 |
| `4w-pool-5` | 固定连接池 5（默认按 Worker 数放大），验证池大小是否成为瓶颈 |
| `overhead-on#1..3` / `overhead-off#1..3` | 埋点开销：成对交错重复，按中位数比较 |
| `2w-single-mailbox` | 单邮箱串行（队首顺序是正确性要求，不是退化） |
| `2w-work-25ms` | 每任务 25ms 计算负载（CPU 受限形态） |
| `2w-failures-10pct` | 10% 终态失败（不可重试）路径 |

### 产物与统计口径

- `raw.jsonl`：每任务 `queueWaitMs`（入队→首次执行）、`serviceMs`（handler 时长）、`endToEndMs`（入队→终态）与 `attempts`，全部可从原始样本重算。
- `summary.json`：每配置的吞吐、延迟分布（p50/p90/p95/p99/max）、资源占用、`analysis`（扩展、埋点开销、池调优、串行上界、失败路径）与 `caveats`。
- `series.csv`：每 200ms 的时间序列（已完成数、运行/排队数、RSS、heap、CPU%、瞬时吞吐）。
- 延迟分位数取 nearest-rank；失败样本不从端到端口径中剔除。

### 已知口径限制（写入 `summary.json.caveats`）

1. 同一配置的所有 Worker 跑在同一 Node 进程内，因此 **CPU 受限配置低估多核扩展**；生产拓扑是每 Pod 一个 Worker 水平扩展。
2. handler 为合成负载，上述数字描述的是任务平台（PG + RabbitMQ 往返与租约记账），**不是端到端业务延迟**。
3. 单邮箱配置被设计为串行（队首顺序防止改期先于原邀请生效），其吞吐较低是正确性属性。
4. 分位数可由 `raw.jsonl` 重算，不依赖工具内缓存。

## 5. 埋点开销测量方法

固定全部其他变量，只切换 `DAYLIGHT_METRICS=0/1`，在**独立子进程**中运行相同负载（避免模块缓存与进程内状态互相污染），成对交错各重复 3 次，比较吞吐与 p95 的**中位数**，同时输出同配置重复运行之间的极差，用于判断差异是否落在噪声内。

本地结果见 `results/`。本机（Apple M1 Pro 笔记本，存在其他负载）同一配置重复运行的极差可达 ±30%，因此本机的单次差异**不能**作为开销结论；`analysis.metricsOverhead.conclusion` 会显式给出「差异是否超过观测噪声」。

云端专用实例（阿里云 4 vCPU，测量期间停止三个应用服务）结果：2 路 Worker 吞吐中位数 **68.90（开）vs 72.58（关）jobs/s，-5.07%**，而同一配置 3 次重复的观测极差为 **9.30%**，因此判定为**落在噪声内**，不能声称埋点及其周边有可测的吞吐代价，也不能声称「零开销」。两处结论一致：差异方向在两个环境中都不稳定（本机为 +9.26% 即「开埋点更快」，云端为 -5.07%），这正是噪声的特征。

## 6. 尚未覆盖（明确标为待验证）

- 模型 token 用量与单任务模型成本：`usage` 已随 trace 记录，但未纳入 `metrics.js` 的指标目录，成本换算依赖当时单价，不做成默认指标。
- SSE 流内部的逐块延迟、前端渲染性能、Vite 开发服务器指标。
- IMAP 分文件夹延迟、SMTP 投递延迟（发信默认关闭）。
- 未接入的调用路径：`server/admin-assistant.js`、`server/assistant.js` 的模型调用已通过 `modelFetch` 自动计入 `model.*`，其余自定义 HTTP 客户端不在目录内。

## 7. 验证记录

| 日期 | 范围 | 结果 |
| --- | --- | --- |
| 2026-10-17 | `server/metrics.test.js`（本机） | 9/9 通过：开关关闭零开销、北京时间戳、标签净化、缓冲溢出丢样、原始延迟样本完整、计时器异常路径、summary 落盘、sink 失败可观测、disabled 子进程 |
| 2026-10-17 | 本机全量 `node --test`（含真实 PG/Redis/RabbitMQ 门控用例） | 见 `STATUS.md` 记录；埋点接入后全量通过 |
| 2026-10-17 | `scripts/load-test.mjs --matrix`（本机，真实 PG + RabbitMQ） | 功能验证通过：8+6 组配置全部排空、产物齐全；本机噪声过大，不作为容量结论 |
| 2026-10-17 | `server/metrics.test.js`（云端 `192.0.2.10`，Node 22.23.3） | 10/10 通过，含「部署产物无 git 检出时 provenance 记录 unknown 而非谎报 clean」；修复了此前 `dirty` 在该环境下退化为 `null` 导致的断言失败 |
| 2026-10-17 | `scripts/load-test.mjs --matrix`（云端专用实例，真实 PG 16.15 + RabbitMQ 3.9.27） | 通过；埋点开销 -5.07%，小于 9.30% 观测极差，判定落在噪声内 |
| 2026-10-17 | 云端全量套件（真实 PG/Redis/MQ，两个门控） | 507/507 通过、0 跳过；`/health/ready` 返回 `metrics` 摘要 |
| 2026-10-17 | **Compose 全栈**套件（容器内 PG 17.6/Redis 7.4.5/MQ 4.1.4，两个门控） | **517/517 通过、0 跳过**；三角色 `dropped=0`、`sinkError=null`，三个独立 `runId` 未互相覆盖 |
| 2026-10-17 | `server/metrics.test.js`（在 **root** uid 下执行） | 12/12 通过；「不可写 sink 目录」断言改为把目录指向普通文件之下（`ENOTDIR`），不再假设非特权 uid |
| 2026-10-17 | `scripts/metrics-report.mjs`（本机 + Compose 共享卷 `metrics-data`） | 人类可读表、`--json`、`--metric` 下钻、缺目录 exit 2 均验证 |
| 2026-10-17 | 云端真实运行核对（重启后 03:15 起） | 三角色埋点 `written` 461/4939/325、`dropped=0`、`sinkError=null`；worker `pg.query.ms` 4358 样本 p95 2.29ms；outbox 未发布 0 行 |
| 2026-10-17 | `scripts/metrics-report.mjs`（Compose 共享卷，真实邮件同步与附件解析期间） | 11 个进程 **158,789 条样本、0 条损坏行**、`dropped=0`、`sinkError=null`；32 个指标；`pg.query.ms` 122,639 样本 p50 0.456 / p95 2.957 / p99 26.456 ms；`eventloop.delay.ms` p50 10.7 / p95 43.2 / max 452.2 ms；`process.rss.bytes` max 966 MB（简历 PDF 解析峰值）；`storage.snapshot.ms` p50 60.3 / p95 104.8 ms；`storage.commit.ms` p50 26.2 ms；`imap.connect.ms` p50 526 / p95 787 ms；`oss.put.ms` p50 11.0 / p95 131.1 ms；`job.execute.ms` max 300,008 ms 即修复前的 300 s 超时证据 |
| 2026-10-17 | 模型调用计量（同一窗口的 `model.requests_total` 原始样本） | 149 次请求 = 93 次无效密钥被拒（`modelverse`）+ 53 次成功 + 3 次异常（`apimaster`）；已持久化 trace 的 7 条计价记录合计 62,513 输入 / 2,186 输出 token、已知费用 0.114 元 |
| 2026-10-17 | 最终代码 + 真实依赖全量套件（Compose 内 PG 17.6 / Redis / RabbitMQ，两个门控） | **530/530 通过、0 失败 0 跳过**；埋点相关用例（`metrics.test.js`）全绿，未因本轮改动放宽 |
| 2026-10-17 | 模型调用计量（窗口延长至 13:15，含 Modelverse 复验与知识库提问） | **153 次请求** = 93 次无效密钥被拒（`api.modelverse.cn`）+ **57 次成功**（53 `api.apimaster.ai` + 4 `api.modelverse.cn`）+ 3 次异常；已持久化 trace 的 **9 条计价记录**合计 75,577 输入 / 5,404 输出 / 18,432 缓存命中 token、已知费用 **0.158 元** |
| 2026-10-17 | 知识库与接口面修复后的最终代码全量套件（Compose 内 PG 17.6 / Redis / RabbitMQ，两个门控） | **547/547 通过、0 失败 0 跳过**；新增用例（`api-surface`/`mail-index-job`/`rag`/`mail-job`）全绿 |
| 2026-10-17 | 检索规范化（RRF + MMR）与 embedding 限流重试后的最终代码全量套件（同一 Compose 拓扑，两个门控） | **561/561 通过、0 失败 0 跳过**（81.2s）；新增用例（`rag` 的 RRF/MMR/重试、`build-boundary`）全绿；日志 `suite-compose-561-cloud.log` |
| 2026-10-17 | 冷启动独立项目重新采集埋点 | 123 样本、0 损坏行、`dropped=0`、`sinkError=null`，`runId=fresh-final` |
| 待验证 | 多副本下的指标聚合与告警 | 未执行；当前为每进程 JSONL + 周期 summary，集中聚合与告警规则未接 |
