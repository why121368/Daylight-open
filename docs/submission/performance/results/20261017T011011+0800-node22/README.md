# 本机真实 PG / 合成任务原始证据

三组运行结束于北京时间 2026-10-17 01:10:11.996、01:10:23.639、01:10:36.707；summary 的 `at` 使用 UTC，因此日期为 2026-10-16。目录时间取第一组结束时间，不是精确开始时间。

| 并发 | 原始逐任务及资源采样 | 完整汇总 |
| --- | --- | --- |
| 1 | [raw.jsonl](workers-1/raw.jsonl) | [summary.json](workers-1/summary.json) |
| 2 | [raw.jsonl](workers-2/raw.jsonl) | [summary.json](workers-2/summary.json) |
| 4 | [raw.jsonl](workers-4/raw.jsonl) | [summary.json](workers-4/summary.json) |

每组输入：200 个任务、16 个合成分区、20ms stub、failEvery=10、超时 120000ms；顺序启动三次独立 Node 22.23.3 进程，每次仅对应一个并发档。没有邮箱地址、邮件正文或外部服务凭据。数据库 URL 只通过环境传入，不保存在结果中。

复现命令如下，将 W 分别设为 1、2、4，使用新的输出目录；`JOBS_TEST_DATABASE_URL` 指向专用测试 PG。

```sh
BENCH_JOBS=200 BENCH_CONCURRENCY="$W" BENCH_MAILBOXES=16 \
BENCH_STUB_MS=20 BENCH_FAIL_EVERY=10 BENCH_TIMEOUT_MS=120000 \
BENCH_OUTPUT_DIR="work/benchmark-repeat/workers-$W" node scripts/benchmark-jobs.mjs
```

版本基线 `9bb3cea8779b72af425085c156c4992de23bb83f`，dirty=true。相关代码运行后的 [source-hashes.json](source-hashes.json) 用于追踪工作区内容，不等于已冻结提交，也不能证明运行期间无并行修改。

实际核验：三次命令退出 0；独立读取 raw 核对 600 个任务、60 个注入失败和每组精确 p50/p95；查询 `pg_namespace` 确认三组 runId 对应 schema 全部不存在。没有执行 public 的 DDL 或业务写入。输出保留失败样本，没有挑选或删除较慢样本。

这是本机真实 PG、合成 handler 的单次基准；无 MQ/HTTP、模型/IMAP/SMTP，也不是云端业务验收。费用未知，详细指标和限制见 [性能说明](../../README.md)。
