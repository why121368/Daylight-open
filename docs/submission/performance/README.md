# 性能与成本测量

已完成下述本机真实 PostgreSQL 合成任务基准，尚无云端或真实业务容量结论。[benchmark-jobs.mjs](../../../scripts/benchmark-jobs.mjs) 直接使用真实 PostgreSQL 的 JobRepository 和 JobWorker，handler 为可参数化 stub，不调用模型、IMAP、SMTP、HTTP API 或 RabbitMQ。结果只能说明给定环境下任务入队、claim、checkpoint 与终态提交的表现。

## 运行

使用 Node ≥22，在专用测试 PG 上设置 `JOBS_TEST_DATABASE_URL`。脚本自动创建随机 schema、执行 jobs migration，结束后删除该 schema，不读取应用设置或 `data/`。输出仅含合成任务和资源指标。

```sh
BENCH_JOBS=100 BENCH_CONCURRENCY=4 BENCH_MAILBOXES=16 \
BENCH_STUB_MS=20 BENCH_FAIL_EVERY=10 BENCH_TIMEOUT_MS=120000 \
BENCH_OUTPUT_DIR=work/benchmark-jobs/run-01 node scripts/benchmark-jobs.mjs
```

这些是实验输入示例，不是已经测得的性能。每次使用新的输出目录保存原始结果。`BENCH_FAIL_EVERY=10` 每第十个任务产生一次明确的 stub 失败；设为 0 不注入失败。maxAttempts 固定为 1，本脚本不测重试放大或故障恢复。

## 输出与统计口径

| 字段 / 文件 | 含义 |
| --- | --- |
| `raw.jsonl` | 每任务 ID、状态、attempts、入队耗时、排队耗时、服务耗时、端到端耗时；每 100ms 的进程 RSS/CPU 采样 |
| `summary.json` | SHA、dirty、环境、输入参数、请求/入队/成功/失败/删失数量、吞吐、资源与成本边界 |
| `latencyTerminalIncludingFailures` | 成功与失败等已观测终态的端到端 p50/p95，nearest-rank；失败不从主指标中删除 |
| `latencySuccessOnly` | 单列成功样本，不能替代包含失败的主口径 |
| `censored` | 超时或错误导致未观测终态；raw 保留观测截止时的延迟下界，不当成成功或有限终态延迟 |
| `nonSuccessRate` | `(请求数 - 成功数) / 请求数`，包含未入队和未完成，不因故障缩小分母 |
| `terminalPerSecond` | 终态数 / 包含顺序入队及排空的测量时长；不是稳定到达率容量 |
| CPU / RSS | 当前单个 Node 进程 CPU user/system 微秒与最大采样 RSS；不含 PG、宿主机或其他容器 |
| costs | 模型调用数为 0；模型业务成本不适用/未知，基础设施与总成本未知，不填成免费 |

负载为先顺序入队再并发排空的突发批次；入队等待包含在每任务端到端延迟内。并发是同一 Node 内 Worker 数，不是多进程或云副本数。同邮箱强顺序使邮箱数影响吞吐。脚本执行出错会保留可获得的部分样本并非零退出；依赖初始化失败时不生成有意义的延迟数值。

## 尚未完成的测量

下面的项目**本轮未做**，不得用已有数字替代：

- **稳态到达率**：现有矩阵是「先播种 600 个任务再并发排空」的突发批次，测量的是排空能力，不是稳定到达下的容量与尾延迟。需要固定到达率的持续压测。
- **端到端业务延迟分解**：需登录 HTTP 入队 + MQ + 独立 Worker + 真实合成邮件 + 已授权模型，分别报告排队、IMAP、模型、持久化、确认等待；人工等待不能混成系统处理延迟。
- **多进程 / 多副本扩展**：现有矩阵的 Worker 都在**同一 Node 进程**内，CPU 受限档会低估多核扩展。需要每 Pod 一个 Worker 的水平扩展测量。
- **模型与业务成本**：需真实调用 `usage` 与当时单价；云成本需实例规格、计费时长与账单。缺少任一项即标 `unknown`（本轮真实模型调用未成功，故成本仍未知）。
- **业务质量**：需人工真值、漏报误报、改期正确率与样本边界，不能用 stub 成功率代替。
- **调优验证**：若要提高平台上限，需在不牺牲持久性的前提下验证 PG 提交吞吐（如 `synchronous_commit` 之外的批量提交、`group commit`）与每 Pod 单 Worker 的水平扩展，并重新测量。

## 本次验证记录

2026-10-17，Node 22.23.3：`node --check scripts/benchmark-jobs.mjs` 通过；使用 `env -u JOBS_TEST_DATABASE_URL` 执行脚本，按预期以退出码 1 拒绝运行并提示专用数据库变量。这些检查不产生性能结论。

### 本机真实 PG 合成基准（2026-10-17 北京时间）

原始结果目录：[20261017T011011+0800-node22](results/20261017T011011+0800-node22/README.md)。三组依次执行，均退出 0；每组 200 个任务、16 个合成邮箱分区、20ms stub 等待、每第十个任务注入失败、maxAttempts=1，无预热，每个并发档仅运行一次。

环境：Node v22.23.3，macOS/darwin arm64，8 个逻辑 CPU，PostgreSQL 16.12（Postgres.app），本机回环 TCP。基线为 `9bb3cea8779b72af425085c156c4992de23bb83f`，**三组 dirty=true**，包含未提交代码，不能当作该 SHA 的干净版本性能。运行后附相关源码 SHA-256；共享工作区存在并行开发，尚未冻结实验版本。

| 同进程 Worker 数 | 成功 / 失败 / 未完成 | 含失败 p50 (ms) | 含失败 p95 (ms) | 批次终态吞吐 (任务/s) | 批次时长 (ms) | CPU user/system (µs) | 最大采样 RSS (bytes) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 180 / 20 / 0 | 4243.14 | 8052.66 | 23.55 | 8491.38 | 768004 / 174536 | 78675968 |
| 2 | 180 / 20 / 0 | 2264.65 | 4205.43 | 43.81 | 4565.42 | 671449 / 143809 | 77807616 |
| 4 | 180 / 20 / 0 | 1317.06 | 1718.65 | 95.24 | 2099.94 | 440033 / 93252 | 75661312 |

每组非成功率为 10%，全部失败对应 `BENCH_INJECTED`，这只是预设故障比例，不代表业务失败率。读取 raw 后独立核对共 600 个任务、各组 180 成功/20 注入失败，并从全体终态延迟重算 nearest-rank p50/p95，与 summary 精确一致。三组随机 schema 均已查询确认删除；脚本 migration 与写入仅作用于各自随机 schema，未对 public 执行迁移或业务写入。

此结果是先入队后排空的单次突发实验，不能用于承诺稳定到达率、最大并发、云扩容收益或业务 SLA；未控制系统其他负载，未报告重复实验方差。CPU/RSS 不含 PG，100ms 采样可能漏掉瞬时内存峰值。模型调用为 0，基础设施和总成本仍为 **unknown**，不能据此推导真实模型每任务成本。云端压测、真实模型成本和业务效果仍待测。

## 任务平台负载矩阵：`scripts/load-test.mjs`

`benchmark-jobs.mjs` 是单配置单次实验；`load-test.mjs` 是矩阵化、可对照、可重算的扩展版本，用于测量扩展曲线、埋点开销、连接池影响、串行上界与失败路径。两者都直接驱动产品自身的 `JobRepository` / `JobWorker` / `JobTransport`，handler 均为合成负载，**不调用模型、IMAP、SMTP、HTTP API 或 OSS**，不消耗外部额度。

```sh
LOAD_TEST_DATABASE_URL=postgresql://127.0.0.1/postgres \
LOAD_TEST_AMQP_URL=amqp://daylight:daylight@127.0.0.1:5672 \
LOAD_TEST_OUT=work/load-test-01 \
node scripts/load-test.mjs --matrix
```

每次运行使用独立随机 schema（连接串注入 `search_path`）与唯一队列名，结束 DROP schema；`public` 与用户数据不被写入。`--run` 单配置模式可覆盖 `--workers/--jobs/--mailboxes/--work-ms/--failure-rate/--pool/--metrics/--repeat`。

### 矩阵与统计口径

| 配置 | 目的 |
| --- | --- |
| `1w` / `2w` / `4w`（metrics-on） | 同进程 Worker 数扩展曲线 |
| `4w-pool-5` | 连接池固定 5（默认按 Worker 数放大），判断池大小是否为瓶颈 |
| `overhead-on#1..3` / `overhead-off#1..3` | 埋点开销：子进程内成对交错重复，按中位数比较，并输出同配置极差 |
| `2w-single-mailbox` | 单邮箱串行上界（队首顺序是正确性要求） |
| `2w-work-25ms` | 每任务 25ms 计算负载（CPU 受限形态） |
| `2w-failures-10pct` | 10% 终态（不可重试）失败路径 |

产物：`raw.jsonl`（每任务 `queueWaitMs` / `serviceMs` / `endToEndMs` / `attempts`）、`summary.json`（吞吐、延迟分位数、资源占用、`analysis`、`caveats`）、`series.csv`（每 200ms 已完成/运行/排队/RSS/heap/CPU/瞬时吞吐）、`metrics/<配置>/`（该配置子进程的埋点 summary 与原始样本）。分位数 nearest-rank，失败样本不剔除，可由 `raw.jsonl` 重算。

### 解释绝对吞吐：`scripts/probe-pg-commit.mjs`

任务平台每个任务需要多个已提交事务，因此宿主的**单次提交延迟**直接决定吞吐上限。该脚本只读 `pg_settings` 并测量「一次 INSERT + COMMIT」的中位往返（含预热），在本业务数据之外自建临时表并删除。

```sh
DAYLIGHT_DATABASE_URL=postgresql://127.0.0.1/postgres node scripts/probe-pg-commit.mjs
```

2026-10-17 实测：云端 **2.886 ms/次（346 次/s，`fsync=on`、`wal_sync_method=fdatasync`）**，本机 **0.252 ms/次（3966 次/s）**，相差 11.5 倍，与两处 4 路 Worker 吞吐 84.20 vs 499.17 jobs/s 的差距对应。这解释了绝对吞吐差异来自磁盘与持久化配置，而不是 Node 侧代码。

### 本机矩阵（2026-10-17，工具验证）

原始结果：[20261017T030403+0800-node22-loadtest](results/20261017T030403+0800-node22-loadtest/README.md)。8 + 6 组配置全部排空。**本机同配置重复运行极差达 16.43%，故本机结果仅验证工具正确，不构成容量结论**；容量与开销结论以云端专用实例为准（见下方云端记录）。

三点已在本机得到、且不依赖绝对值即可成立的结论：

1. `4w-pool-5`（池 5）与 `4w-metrics-on`（池 10）吞吐完全相同（499.17 jobs/s），说明瓶颈是单进程事件循环而非 PG 连接数，默认池大小保持 5 是合理的。
2. 同进程 Worker 数增加时吞吐 249.58 → 332.59 → 499.17 jobs/s，4 路接近饱和；生产为每 Pod 一个 Worker 水平扩展，此曲线不能外推多核能力。
3. 10% 终态失败配置吞吐与无失败配置相当（199.67 jobs/s），说明永久失败只记账一次、不重试、不放大负载。

埋点开销：中位数 271 vs 298.66 jobs/s（-9.26%），**小于 16.43% 的观测噪声**，`analysis.metricsOverhead.conclusion` 明确标注「差异落在观测噪声内」，本机不能据此判断开销方向。埋点目录与开销方法见 [observability](../observability/README.md)。

### 云端矩阵（2026-10-17，阿里云单节点）

原始结果：[20261017T031548+0800-cloud-4vcpu-node22](results/20261017T031548+0800-cloud-4vcpu-node22/README.md)。Intel Xeon Platinum / 4 vCPU / 7.5 GiB，Node v22.23.3，PostgreSQL 16.15，RabbitMQ 3.9.27；测量期间停止 api/worker/scheduler，结束后自动拉起。

| 配置 | 排空吞吐 | 播种吞吐 | p95 端到端 | CPU(单核%) |
| --- | --- | --- | --- | --- |
| `1w-metrics-on` | 49.64 jobs/s | 399.73 jobs/s | 12080 ms | 42.11 |
| `2w-metrics-on` | 70.70 jobs/s | 406.78 jobs/s | 8732 ms | 58.25 |
| `4w-metrics-on` | 84.20 jobs/s | 459.07 jobs/s | 7186 ms | 77.76 |
| `4w-pool-5` | 88.99 jobs/s | 384.12 jobs/s | 7353 ms | 78.95 |
| `2w-single-mailbox` | 39.60 jobs/s | 223.46 jobs/s | 2826 ms | 61.81 |
| `2w-work-25ms` | 23.03 jobs/s | 398.67 jobs/s | 10185 ms | 83.64 |
| `2w-failures-10pct` | 51.65 jobs/s | 414.51 jobs/s | 4581 ms | 54.88 |

**结论：云端绝对吞吐由 PostgreSQL 提交延迟决定，不是 Node 事件循环。** 4 路同进程 Worker 只用满约 0.78 个核；每个任务约需 4 个已提交事务。同一实例上用 `scripts/probe-pg-commit.mjs` 实测 **2.886 ms/次提交（346 次/s）**，346 ÷ 4 ≈ 86 jobs/s 与实测 84.20 吻合。本机对照 **0.252 ms/次提交（3966 次/s）**，提交延迟相差 11.5 倍，对应本机 499 与云端 84 jobs/s 的差距。这不是代码回归，而是磁盘与持久化配置差异（云端 `synchronous_commit=on`、`fsync=on`、`wal_sync_method=fdatasync`）。连接池在云端同样不是瓶颈（池 5 的 88.99 与池 10 的 84.20 差异落在噪声内）。埋点开销中位数 -5.07%，小于 9.30% 观测极差，仍判定为「落在噪声内」。

真实邮件链路每封邮件都调用模型（秒级），平台约 85 jobs/s 的框架开销远高于所需；生产瓶颈是模型与外部依赖，不是任务平台。本矩阵用于确定平台上限与调优方向（PG 提交吞吐、每 Pod 单 Worker 水平扩展），不作为业务吞吐承诺。

### Compose 全栈矩阵（2026-10-17，阿里云单节点，容器内 PG/MQ）

原始结果：[20261017T102500+0800-cloud-4vcpu-compose](results/20261017T102500+0800-cloud-4vcpu-compose/README.md)。同一实例，应用与依赖全部在 Docker Compose 中运行；PostgreSQL 17.6 / Redis 7.4.5 / RabbitMQ 4.1.4 为容器；测量期间 `docker compose stop scheduler worker api`，结束后 `start`。

| 配置 | 排空吞吐 | 播种吞吐 | p95 端到端 | CPU(单核%) |
| --- | --- | --- | --- | --- |
| `1w-metrics-on` | 54.89 jobs/s | 370.37 jobs/s | 11233 ms | 35.37 |
| `2w-metrics-on` | 77.93 jobs/s | 341.30 jobs/s | 8173 ms | 53.44 |
| `4w-metrics-on` | 98.36 jobs/s | 379.99 jobs/s | 6305 ms | 75.59 |
| `4w-pool-5` | 95.21 jobs/s | 447.76 jobs/s | 6645 ms | 69.41 |
| `2w-single-mailbox` | 42.46 jobs/s | 254.78 jobs/s | 2710 ms | 51.32 |
| `2w-work-25ms` | 23.81 jobs/s | 356.08 jobs/s | 9889 ms | 81.09 |
| `2w-failures-10pct` | 62.57 jobs/s | 356.61 jobs/s | 3862 ms | 50.08 |

**结论不变：绝对吞吐由 PostgreSQL 提交延迟决定，容器化没有引入可测损失。** 容器内 PostgreSQL 17.6 实测 **2.252 ms/次提交（444 次/s）**，444 ÷ 4 ≈ 111 jobs/s，与 4 路 98.36 同量级。相对 systemd 基线（49.64 / 70.70 / 84.20）的提升方向与 PG 从 16.15 升到 17.6 一致，**不能归因于容器化**。连接池非瓶颈（95.21 vs 98.36 落在噪声内）；埋点开销 -1.9%，小于 9.42% 观测极差。
