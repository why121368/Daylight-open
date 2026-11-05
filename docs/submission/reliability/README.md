# 可靠性证据与复验方案

日期：2026-10-17。这里提供可复验入口及待完成项，不提供未执行实验的通过结论。历史本地业务测试见 [STATUS](../../../STATUS.md)；新 jobs 模块的说明见 [接口约定](../../../server/jobs/README.md)。

## 核心契约

任务和 outbox 原子入库；MQ 通知可重复，PG 状态决定能否执行。同一邮箱顺序执行；重试使用有限预算及指数退避。数据库步骤与副作用同事务，租约丢失后旧 token 不可提交。外部发送结果未知时保留待核验状态，不能把重试数据库步骤扩展成盲目重发 SMTP。

## 复验矩阵

2026-10-17 主会话以 Node 22.23.3 复跑 `scripts/verify-jobs.mjs`，真实本机 PostgreSQL/RabbitMQ 的七组检查全部通过，日志 `work/jobs-node22-verification.log`。生产 HTTP 与独立 Worker 验证也通过，证据 `work/production-verify-ljgCLK/`。以下本机结果不代表云端验收。

| 故障 / 条件 | 期望观察 | 入口 | 本材料状态 |
| --- | --- | --- | --- |
| 相同键并发提交、跨租户读取 | 单任务；他人不可见 | `scripts/verify-jobs.mjs` | 本机真实依赖通过 |
| 同邮箱两个 claim / 不同邮箱 | 同邮箱互斥、按 sequence；其他邮箱可执行 | 同上、`server/jobs.test.js` | 本机通过 |
| 租约到期与旧 Worker 返回 | 新 generation 接管，旧 token 写失败 | `scripts/verify-jobs.mjs` | 本机真实依赖通过 |
| checkpoint 后重投 | 已存步骤不重复写 DB 副作用 | 同上 | 本机真实依赖通过 |
| 事务中租约到期 | 副作用及步骤一起回滚 | 同上 | 本机真实依赖通过 |
| MQ confirm 后丢失 DB 提交 | 重复通知但不重复数据库结果 | 同上 | 真实 MQ + DB 登记故障注入通过 |
| MQ 连接关闭 | 重连并继续通知 | 同上 | 本机真实依赖通过 |
| Worker 长任务 | 心跳跨多个租约周期 | 同上 | 本机真实依赖通过 |
| 达到重试预算、手动重试 | failed 终态；新预算保留 checkpoint | 同上 | 本机真实依赖通过 |
| 真实进程 kill / 多副本接管 | 重启后状态保留、旧实例不可写 | `scripts/verify-production.mjs` | 独立 Worker 强杀、重启恢复通过；测试主动推进租约过期，云端多副本待验 |
| PG/Redis/OSS 不可用 | 生产拒绝相关操作，无静默文件回退 | `server/infra-production.test.js`、`scripts/verify-redis-restart.mjs` | 受控故障通过；真实隔离 Redis 强杀/重启后原客户端恢复通过，PG/OSS 真实停服待验收 |
| 工作台确认并发 / 跨用户请求 | 日历与场景同事务、隔离生效 | `scripts/verify-production.mjs` | 本机真实 PG/HTTP：8 路并发单一结果、跨用户拒绝、trigger 故障整体回滚通过 |
| SMTP 接受后断连 | unknown，人工查收件回执，不自动整封重发 | 小 D 历史故障测试 + 授权实连 | 历史合成验证；真实副作用故障待验收 |
| 日历意图故障、调度与远端回执丢失 | 日程/意图共同回滚；固定 ID 更新删除；unknown 不重复创建 | `scripts/verify-production.mjs` | 真实 PG/独立 Scheduler/Worker + 本地日历 HTTP mock 通过，证据 `work/production-verify-4Bd0DN/` |
| 邮箱永久失败（授权被撤销等） | 按连续失败次数指数退避，不再每分钟重投冲击用户账号；手动同步不受限 | `scripts/verify-jobs.mjs`（真实 PG 的 `mailboxSyncOutcomes` 排序与计数）、`server/job-service.test.js` | 本机真实依赖通过：3 次连续失败 → 20 分钟窗口；成功一次即清零；其他 job kind 不参与 |

## 并发专项（P2，20 项）

入口：`scripts/verify-concurrency.mjs`（导出 `verifyConcurrency()`），由 `server/concurrency-suite.test.js` 在 `DAYLIGHT_VERIFY_CONCURRENCY=1` 时调用，也可独立运行。

隔离方式：`local` runtime + 程序化 `saveInfraConfig`，产品模块按动态 `import()` 加载（加载前先改写 `DAYLIGHT_DATA_DIR` 到临时目录，避免读到真实 `data/`）。PostgreSQL 使用随机 schema（连接串 `options=-c search_path=<schema>`），Redis 使用本进程启动的 `redis-server` 子进程（回环 + 随机端口），RabbitMQ 使用真实 broker + 唯一队列名。运行结束 DROP schema、结束子进程；`public` 与用户数据不被写入。

| # | 检查 | 断言的不变量 | 本地（真实 PG/Redis/MQ） |
| --- | --- | --- | --- |
| 1 | `enqueue-idempotent-race` | 24 个并发生产者同键仅 1 行任务 | 通过 |
| 2 | `mailbox-head-of-line` | 后到任务不能越过更早的排队任务；同邮箱互斥 | 通过 |
| 3 | `parallel-mailboxes-claim-once` | 24 并发 claim 覆盖 12 邮箱，每任务恰好租约一次、token 唯一 | 通过 |
| 4 | `stale-lease-writes-fenced` | 租约过期后 checkpoint/complete/fail 全部被 fencing 拒绝，且无步骤行 | 通过 |
| 5 | `crash-after-checkpoint-exactly-once` | checkpoint 后崩溃，重跑不重复副作用（exactly-once 语义） | 通过 |
| 6 | `recover-expired-single` | 8 路并发 `recoverExpired` 仅 1 次计入，attempts 不虚增 | 通过 |
| 7 | `heartbeat-fends-off-recovery` | 存活心跳使租约不被回收，他人不可抢占 | 通过 |
| 8 | `concurrent-retry-one-winner` | 8 路并发手动重试仅 1 个赢家，预算被重置 | 通过 |
| 9 | `concurrent-cancel-one-winner` | 8 路并发取消仅 1 个赢家 | 通过 |
| 10 | `cancel-then-claim-no-resurrect` | 已取消任务不可复活，且不阻塞后续任务 | 通过 |
| 11 | `tenant-isolation-under-race` | 相同 mailbox/key 的跨租户任务互不可见、不可取消、不重复租约 | 通过 |
| 12 | `outbox-confirm-once` | 入队恰好 1 条未发布 outbox；8 路并发 confirm 仅 1 次成功 | 通过 |
| 13 | `outbox-stale-token-rejected` | 过期 outbox 租约 token 无法 confirm，接管者可以 | 通过 |
| 14 | `mq-wakeup-and-duplicate-delivery` | 真实 MQ 唤醒并 confirm；重复投递不会重复执行 | 通过 |
| 15 | `snapshot-cas-conflict` | 同版本双写仅 1 次提交，失败方返回 `STORAGE_VERSION_CONFLICT` 且版本只 +1 | 通过 |
| 16 | `concurrent-append-partial-conflicts` | 8 路并发追加全部落库、无丢失更新且无重复 | 通过 |
| 17 | `failed-commit-rolls-back` | 提交失败时行内容与版本完全不变 | 通过 |
| 18 | `concurrent-create-user-single-row` | 8 路同邮箱并发建号仅 1 行 | 通过 |
| 19 | `concurrent-register-single-user` | 同一邮箱验证码被 8 路并发注册消费，仅 1 个账号 | 通过 |
| 20 | `concurrent-session-revoke-touch` | 吊销与 touch 竞争后会话不可复活，session 版本单调 +1 | 通过 |

结果文件写在 `work/concurrency-verify-*/concurrency-evidence.json`（含每项耗时与失败细节）。

```sh
DAYLIGHT_VERIFY_CONCURRENCY=1 \
CONCURRENCY_TEST_DATABASE_URL=postgresql://127.0.0.1/daylight_test \
CONCURRENCY_TEST_AMQP_URL=amqp://daylight:daylight@127.0.0.1:5672 \
node --test server/concurrency-suite.test.js
```

### 并发专项记录

| 日期 | 环境 | 结果 |
| --- | --- | --- |
| 2026-10-17 | 本机 Node 22.23.3，真实 PostgreSQL 16.12 + 本机 RabbitMQ + 私有 redis-server | 20/20 通过，总耗时约 2.6s |
| 2026-10-17 | 云端单节点 `192.0.2.10`，Node 22.23.3，真实 PostgreSQL 16.15 + RabbitMQ 3.9.27 + Redis 6.0.16（`daylight_test` 库，随机 schema） | 20/20 通过（作为门控测试随云端全量套件执行，507/507 通过、0 跳过） |
| 2026-10-17 | 云端单节点，**Docker Compose 全栈**：真实容器内 PostgreSQL 17.6 + RabbitMQ 4.1.4 + Redis 7.4.5（`daylight_test` 库，随机 schema） | 20/20 通过（`DAYLIGHT_VERIFY_CONCURRENCY=1` 门控，随 Compose 拓扑全量套件执行，**517/517 通过、0 跳过**） |
| 2026-10-17 | 同上，**知识库与接口面修复后的最终代码** | 20/20 通过（同一门控，随最终代码全量套件执行，**547/547 通过、0 跳过**） |
| 2026-10-17 | 同上，**检索规范化（RRF + MMR）与 embedding 限流重试后的最终代码** | 20/20 通过（同一门控，随最终代码全量套件执行，**561/561 通过、0 跳过**） |

一次本机复跑中出现过 1/20 失败：`mq-wakeup-and-duplicate-delivery` 断言「真实发布 confirm 后 outbox 行已确认」。根因是**检查本身的竞态**，不是产品缺陷：消费端收到唤醒（`onWake`）可能早于发布端 `confirmOutbox` 事务对第三个连接的可见时刻。已改为在限定时限内等待该不变量成立（而不是等待两条独立路径的时钟交错），断言的含义不变且更强；随后本机连续 3 次、云端全量套件均通过。未跳过、未删除该检查。

## 隔离复验命令

使用 Node ≥22、专用测试 PostgreSQL 与 RabbitMQ，通过环境注入 `JOBS_TEST_DATABASE_URL` 和 `JOBS_TEST_AMQP_URL`，不要从真实业务设置复制凭据进日志。

```sh
node --test server/jobs.test.js
node scripts/verify-jobs.mjs
```

验证脚本创建随机 schema 和 queue，结束时清理；连接权限需允许创建/删除测试 schema 和队列。它不导入业务数据，不连接邮箱或模型。记录命令退出码、Node/PG/MQ 版本、SHA 与工作区差异、起止时间、各 PASS 行和清理结果。若进程被强杀，按 run schema/queue 名只清理对应实验资源。

## 云端恢复演练待办

在专用命名空间创建合成租户与邮箱，保存入队 ID、步骤计数和初始备份。依次停止 Worker、断开 MQ、停止 PG，再恢复依赖；每次只注入一个故障并记录检测、拒绝请求、恢复和最后完成的时间。对旧租约写入、重复请求、双用户访问和终态计数做断言。回滚应用镜像后再检查业务数据兼容，最后从备份恢复到独立环境并比对记录与附件。

RTO、RPO、故障检测耗时及数据丢失量目前均为待测。租约参数不是实测恢复时间。无真实备份恢复记录前，不声称灾难恢复通过。
