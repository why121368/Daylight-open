# 云端 load-test 矩阵（真实云主机 + 真实 PostgreSQL/RabbitMQ）

- 时间：2026-10-17 03:15（北京时间），阿里云单节点 ECS `192.0.2.10`。
- 环境：Intel(R) Xeon(R) Platinum，4 vCPU，7.5 GiB，linux/x64，Node v22.23.3，PostgreSQL 16.15，RabbitMQ 3.9.27。
- 基线 commit `9bb3cea`，工作区含本轮未提交改动。
- 命令：`node scripts/load-test.mjs --matrix`（`/root/run-load-matrix.sh`）。**测量期间停止 api/worker/scheduler 三个服务**，避免与后台轮询/claim 争抢 CPU 与连接；测量结束后由脚本 trap 重新拉起（结果 `active active active`）。
- 隔离：随机 schema + 唯一队列名，运行结束 DROP；使用独立 `daylight_test` 库。
- 产物：`summary.json`、`series.csv`、`raw.jsonl.gz`（6600 条每任务原始记录）、`matrix.log`、`metrics/`（8 份埋点 summary + 一份原始样本）。

## 结果

| 配置 | 排空吞吐 | 播种吞吐 | p95 端到端 | RSS | CPU(单核%) |
| --- | --- | --- | --- | --- | --- |
| `1w-metrics-on` | 49.64 jobs/s | 399.73 jobs/s | 12080 ms | 110 MiB | 42.11 |
| `2w-metrics-on` | 70.70 jobs/s | 406.78 jobs/s | 8732 ms | 104 MiB | 58.25 |
| `4w-metrics-on` | 84.20 jobs/s | 459.07 jobs/s | 7186 ms | 112 MiB | 77.76 |
| `4w-pool-5` | 88.99 jobs/s | 384.12 jobs/s | 7353 ms | 109 MiB | 78.95 |
| `2w-single-mailbox` | 39.60 jobs/s | 223.46 jobs/s | 2826 ms | 89 MiB | 61.81 |
| `2w-work-25ms` | 23.03 jobs/s | 398.67 jobs/s | 10185 ms | 100 MiB | 83.64 |
| `2w-failures-10pct` | 51.65 jobs/s | 414.51 jobs/s | 4581 ms | 98 MiB | 54.88 |

埋点开销：中位数 68.90 vs 72.58 jobs/s（-5.07%），**小于 9.30% 的观测极差**，`summary.json` 判定为「差异落在观测噪声内」，不据此判断开销方向。

## 关键发现

1. **绝对吞吐由 PostgreSQL 提交延迟决定，不是事件循环。** 4 路同进程 Worker 只用满约 0.78 个核（CPU 77.76%），说明 CPU 未饱和；而每个任务需要约 4 个已提交事务（入队、checkpoint、终态提交，另有 outbox confirm/claim）。用 `scripts/probe-pg-commit.mjs` 在同一实例实测：**2.886 ms/次提交 = 346 次提交/s**（`synchronous_commit=on`、`fsync=on`、`wal_sync_method=fdatasync`）。346 ÷ 4 ≈ 86 jobs/s，与实测 4 路 84.2 jobs/s 吻合。本机对照为 **0.252 ms/次提交（3966 次/s）**，提交延迟相差 11.5 倍，直接对应本机 499 jobs/s 与云端 84 jobs/s 的差距。**这不是代码回归，是磁盘与持久化配置差异。**
2. **连接池不是瓶颈。** 固定池 5（88.99）与自动池 10（84.20）的差异落在噪声内，与本地结论一致。
3. **同进程 Worker 扩展在 4 路仍未饱和但已趋缓**（49.64 → 70.70 → 84.20），因为上限来自 PG 提交率而不是本进程。
4. **单邮箱串行是设计上界**（39.60 jobs/s，约为并行配置的 56%），队首顺序是正确性要求（改期通知不能先于原邀请生效）。
5. **失败路径不放大负载**：10% 终态失败配置（51.65）与无失败 2 路（70.70）差异主要来自 p95 与工作分布，失败任务只记账一次、不重试。
6. **埋点开销在本机与云端都没有测出可信方向**（云端 -5.07%，本机 -9.26%，均小于各自噪声），这是诚实结论而非「零开销」结论。

## 埋点样本（`metrics/`）

负载运行同时以 `DAYLIGHT_METRICS=1` 采集，产物在 `metrics/<配置>/`：8 份 `metrics-summary.json` 加一份原始样本 `metrics-sample.jsonl.gz`。所有配置 `dropped=0`、`sinkError=null`。

| 配置 | written | `pg.query.ms` count / p50 / p95 | `job.execute.ms` p50 / p95 | `mq.publish.ms` p50 / p95 |
| --- | --- | --- | --- | --- |
| `1w-metrics-on` | 20470 | 18139 / 0.55 / 2.151 | 11.841 / 22.994 | 7.176 / 12.908 |
| `4w-metrics-on` | 20570 | 18623 / 1.162 / 5.153 | 25.518 / 48.357 | 22.444 / 55.461 |
| `2w-failures-10pct` | 8099 | 7352 / 0.748 / 4.054 | 15.890 / 30.878 | 10.342 / 31.881 |

与此一致：`job.executed_total`、`mq.publish_total`、`mq.wakeup_total` 的 count 均等于该配置的任务数（各 600 / 240），说明每个任务恰好完成一次、恰好一次唤醒与一次发布，没有重复执行。

Worker 数增加时 `pg.query.ms`（0.55 → 1.162）与 `mq.publish.ms`（7.18 → 22.44）的 p50 同步上升，说明多 Worker 之间在共享 PG/连接池上出现排队——与「吞吐受提交延迟与共享资源限制」的结论一致。

## 口径限制（同 `summary.json.caveats`）

- 同一配置的所有 Worker 跑在**同一 Node 进程**内，CPU 受限配置低估多核扩展；生产拓扑是每 Pod 一个 Worker 水平扩展。
- handler 为合成负载，**不调用模型、IMAP、SMTP、OSS**；数字描述任务平台（PG + MQ 往返与租约记账），不是端到端业务延迟。
- 负载形态是「先顺序播种 600 个任务，再并发排空」的突发批次，因此 p95 端到端包含大量排队等待，**不能读作稳态延迟或 SLA**。
- 单邮箱配置的较低吞吐是正确性属性，不是退化。
- 分位数可由 `raw.jsonl.gz` 重算。

## 与真实业务的关系

真实邮件链路每封邮件都要调用模型（秒级），因此任务平台约 85 jobs/s 的框架开销远高于所需；生产瓶颈是模型调用与外部依赖，不是任务平台。本矩阵用于确定平台上限与调优方向（增大 PG 提交吞吐、每 Pod 单 Worker 水平扩展），不作为业务吞吐承诺。
