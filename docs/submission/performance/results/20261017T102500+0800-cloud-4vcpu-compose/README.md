# 云端 load-test 矩阵（Docker Compose 全栈 + 容器内 PostgreSQL/RabbitMQ）

- 时间：2026-10-17 10:25（北京时间），阿里云单节点 ECS `192.0.2.10`。
- 环境：Intel(R) Xeon(R) Platinum，4 vCPU，7.5 GiB，linux/x64，Node v22.23.3。
- **依赖拓扑**：PostgreSQL 17.6 / Redis 7.4.5 / RabbitMQ 4.1.4 均为 Compose 容器，数据卷持久化；Postgres 只绑定 `127.0.0.1:15432`（不对外）。应用三角色（api/worker/scheduler）也是容器。
- 基线 commit `9bb3cea`，工作区含本轮未提交改动。
- 命令：`node scripts/load-test.mjs --matrix`（`/root/compose-load-matrix.sh`）。**测量期间 `docker compose stop scheduler worker api`**，避免与后台轮询/claim 争抢 CPU 与连接；测量结束后由脚本 trap `docker compose start` 重新拉起。
- 隔离：随机 schema + 唯一队列名，运行结束 DROP；使用 Compose 容器内独立 `daylight_test` 库。
- 产物：`summary.json`、`series.csv`、`raw.jsonl.gz`（6600 条每任务原始记录）、`matrix.log`、`metrics/`（各配置 `metrics-summary.json` + 一份压缩原始样本）。

## 结果

| 配置 | 排空吞吐 | 播种吞吐 | p95 端到端 | RSS | CPU(单核%) |
| --- | --- | --- | --- | --- | --- |
| `1w-metrics-on` | 54.89 jobs/s | 370.37 jobs/s | 11233 ms | 109 MiB | 35.37 |
| `2w-metrics-on` | 77.93 jobs/s | 341.30 jobs/s | 8173 ms | 109 MiB | 53.44 |
| `4w-metrics-on` | 98.36 jobs/s | 379.99 jobs/s | 6305 ms | 112 MiB | 75.59 |
| `4w-pool-5` | 95.21 jobs/s | 447.76 jobs/s | 6645 ms | 109 MiB | 69.41 |
| `2w-single-mailbox` | 42.46 jobs/s | 254.78 jobs/s | 2710 ms | 88 MiB | 51.32 |
| `2w-work-25ms` | 23.81 jobs/s | 356.08 jobs/s | 9889 ms | 100 MiB | 81.09 |
| `2w-failures-10pct` | 62.57 jobs/s | 356.61 jobs/s | 3862 ms | 99 MiB | 50.08 |

埋点开销：中位数 78.02（开）vs 79.53（关）jobs/s，即 **-1.9%**，**小于 9.42% 的观测极差**，`summary.json` 判定为「差异落在观测噪声内」，不据此判断开销方向。

## 与 systemd 基线的一致性

同一实例此前以「apt 安装 PG/Redis/RabbitMQ + systemd 运行 Node」的方式测过（`results/20261017T031548+0800-cloud-4vcpu-node22/`）。换成 Compose 全容器后：

| 配置 | systemd 基线 | Compose 全栈 | 变化 |
| --- | --- | --- | --- |
| `1w-metrics-on` | 49.64 | 54.89 | +10.6% |
| `2w-metrics-on` | 70.70 | 77.93 | +10.2% |
| `4w-metrics-on` | 84.20 | 98.36 | +16.8% |

差异方向与依赖版本一致：**Compose 用的是 PostgreSQL 17.6，systemd 基线是 16.15**。用 `scripts/probe-pg-commit.mjs` 在同一实例实测提交延迟：Compose 容器 PG **2.252 ms/次提交 = 444 次/s**，systemd 主机 PG 为 **2.886 ms/次提交 = 346 次/s**。按每任务约 4 个已提交事务估算，444 ÷ 4 ≈ 111 jobs/s，与实测 4 路 98.36 jobs/s 同量级——**吞吐仍然由 PG 提交延迟决定，不是事件循环，也不是容器化本身**。容器化没有引入可测的吞吐损失。

## 关键发现

1. **同进程 Worker 扩展仍未饱和但已趋缓**（54.89 → 77.93 → 98.36）：4 路只用满约 0.76 个核（CPU 75.59%），上限来自 PG 提交率。
2. **连接池不是瓶颈**：固定池 5（95.21）与自动池 10（98.36）差异落在噪声内。
3. **单邮箱串行是设计上界**（42.46 jobs/s），队首顺序是正确性要求。
4. **25 ms 合成工作**把吞吐压到 23.81 jobs/s 且 CPU 81%，说明真实业务（模型调用是秒级）的瓶颈在外部依赖，不在任务平台。
5. **失败路径不放大负载**：10% 终态失败 62.57 jobs/s，24 失败 / 216 成功，失败任务只记账一次、不重试。
6. **埋点开销在容器内同样没有测出可信方向**（-1.9%，小于 9.42% 噪声）。

## 埋点样本（`metrics/`）

每个配置以 `DAYLIGHT_METRICS=1` 采集。所有配置 `dropped=0`、`sinkError=null`。

| 配置 | written | `pg.query.ms` count / p50 / p95 | `job.execute.ms` count / p50 / p95 | `mq.publish.ms` count / p50 / p95 |
| --- | --- | --- | --- | --- |
| `1w-metrics-on` | 20400 | 18113 / 0.541 / 1.998 | 600 / 10.220 / 21.017 | 600 / 5.890 / 42.509 |
| `4w-metrics-on` | 19548 | 18508 / 0.804 / 3.251 | 600 / 19.255 / 41.541 | 600 / 32.035 / 54.733 |
| `2w-failures-10pct` | 7491 | 7289 / 0.548 / 3.088 | 240 / 12.514 / 24.981 | 240 / 10.199 / 48.028 |

`job.executed_total`、`mq.publish_total`、`mq.wakeup_total` 的 count 均等于该配置的任务数（600 / 600 / 240），说明每个任务恰好完成一次、恰好一次唤醒与一次发布，没有重复执行。Worker 数增加时 `pg.query.ms`（0.541 → 0.804）与 `mq.publish.ms`（5.89 → 32.04）的 p50 同步上升，说明多 Worker 在共享 PG/连接池上出现排队。

## 口径限制（同 `summary.json.caveats`）

- 同一配置的所有 Worker 跑在**同一 Node 进程**内，CPU 受限配置低估多核扩展；生产拓扑是每 Pod 一个 Worker 水平扩展。
- handler 为合成负载，**不调用模型、IMAP、SMTP、OSS**；数字描述任务平台（PG + MQ 往返与租约记账），不是端到端业务延迟。
- 负载形态是「先顺序播种 600 个任务，再并发排空」的突发批次，p95 端到端包含大量排队等待，**不能读作稳态延迟或 SLA**。
- 单邮箱配置的较低吞吐是正确性属性，不是退化。
- 本矩阵与 systemd 基线为**不同依赖大版本**（PG 17.6 vs 16.15），差异不能完全归因于容器化；已用提交延迟探针给出同量级解释。
- 分位数可由 `raw.jsonl.gz` 重算。
