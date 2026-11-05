# 本地 load-test 矩阵（工具验证，非容量结论）

- 时间：2026-10-17 03:04（北京时间），本机 Apple M1 Pro / 8 核 / 16 GiB，Node v22.23.3。
- 基线 commit `9bb3cea`，工作区 110 项未提交改动（本轮 feat 分支）。
- 命令：`node scripts/load-test.mjs --matrix`，真实本机 PostgreSQL + RabbitMQ（隔离 schema + 唯一队列），合成 handler。
- 产物：`summary.json`（矩阵 + analysis + caveats）、`series.csv`（每 200ms 采样）、`raw.jsonl.gz`（6600 条每任务原始记录，可重算分位数）。

## 为什么这些数字不是容量结论

本机是笔记本且存在其他负载，**同一配置重复运行的极差达 16.43%**（`overhead-off` 298.36–332.04 jobs/s，`overhead-on` 227.70–272.23 jobs/s）。因此本机单次结果只用于验证工具本身正确（所有配置都能排空、产物齐全、埋点开关可对照）。容量与开销结论以云端专用实例的重复测量为准。

## 观测到的（工具验证层面）

| 配置 | 排空吞吐 | p95 端到端 | RSS | CPU(单核%) |
| --- | --- | --- | --- | --- |
| `1w-metrics-on` | 249.58 jobs/s | 2355 ms | 106 MiB | 52.87 |
| `2w-metrics-on` | 332.59 jobs/s | 1651 ms | 112 MiB | 67.78 |
| `4w-metrics-on` | 499.17 jobs/s | 1154 ms | 110 MiB | 91.77 |
| `4w-pool-5` | 499.17 jobs/s | 1241 ms | 109 MiB | 93.35 |
| `2w-single-mailbox` | 199.67 jobs/s | 524 ms | 81 MiB | 74.73 |
| `2w-work-25ms` | 22.67 jobs/s | 10014 ms | 96 MiB | 60.06 |
| `2w-failures-10pct` | 199.67 jobs/s | 1027 ms | 101 MiB | 54.98 |

三条值得记录的发现：

1. **连接池不是瓶颈。** `4w-pool-5`（池固定 5）与 `4w-metrics-on`（自动池 10）吞吐完全相同（499.17 jobs/s），说明限制来自单进程事件循环，而不是 PG 连接数。因此默认池大小保持 5，仅在单进程跑多个 Worker 时按 Worker 数放大。
2. **同进程 Worker 扩展在 4 路时饱和**（249.58 → 332.59 → 499.17），因为所有 Worker 共享一个事件循环。生产拓扑是每 Pod 一个 Worker 水平扩展，本表不能外推为多核扩展能力。
3. **失败路径不放大负载**：10% 终态失败配置吞吐与无失败配置相当（199.67 jobs/s），失败任务只记账一次、不重试。

埋点开销：中位数 271 vs 298.66 jobs/s（-9.26%），但**小于 16.43% 的观测噪声**，`summary.json` 中 `analysis.metricsOverhead.conclusion` 标记为「差异落在观测噪声内」，不能据此判断开销。云端专用实例的重复测量见同级云端条目。
