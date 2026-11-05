# 云原生实施记录

## 目标与基线

2026-10-17 开始。基线 `9bb3cea`，分支 `feat/cloud-native-platform`。目标为保研通知到回执的可靠云端执行；保护招聘、发票、小 D 及既有数据。开始时 `server/jobs/repository.js`、`schema.js` 为已有未跟踪工作，增量审查而非覆盖。报告产物及 `output/` 也是原有文件。

本机默认 Node 21 不满足项目要求，验证改用已安装 Node 22.23.3。Docker daemon 可用（29.6.2）；默认 PostgreSQL socket 未响应。测试依赖使用独立容器/数据库，不读取真实配置。云资源、真实模型调用及外部发信尚无本轮授权或环境验证。

## 问题与验收矩阵

| 编号 | 问题 / 验收 | 状态 | 证据与下一步 |
|---|---|---|---|
| A | 干净部署（真实云主机） | **云端部署验证通过**（Docker Compose 全栈，9 服务一键启动） | 应用与 PostgreSQL/Redis/RabbitMQ/MinIO 全部容器化，`up -d --wait --build` exit 0；迁移幂等、三角色与依赖健康通过。原生 systemd 路径作为早期基线保留，见 [部署验收报告](deployment/README.md) |
| B | API/Worker/Scheduler 分离 | **云端部署验证通过** | 同一镜像三个角色（Compose 服务与三个 systemd 单元两种承载方式均已云端运行）；全量套件与生产闭环均以分离进程运行 |
| C | 持久任务与步骤 | **真实依赖验证通过（云端）** | 真 PG jobs/checkpoint；`verify-jobs` 8/8（含退避真实 SQL 校验） |
| D | confirm/outbox/退避/故障恢复 | **真实依赖验证通过（云端）** | 真 MQ 重投/confirm 故障/租约接力通过；新增失败邮箱指数退避；云端 outbox 未发布 0 行 |
| E/F | PG 权威读写 / 并发不覆盖 | **真实依赖验证通过（云端）** | 快照完整输入校验、CAS、借用 checkpoint client；20 项并发专项含 snapshot CAS 冲突与回滚 |
| G | 场景与日历原子提交 | **真实依赖验证通过（云端）** | 同一 storage snapshot；HTTP 提交屏障；`verify-production` 12/12（外部日历为本地 HTTP mock） |
| H | 健康与停机 | **云端部署验证通过** | 三角色 `/health/ready` 200 并暴露埋点状态；SIGTERM 有界关闭 + systemd TimeoutStopSec=60 |
| I | 全模块状态及隔离 | 真实依赖验证通过（附件/存储）；UI 与真实外部日历未验 | 附件真实 OSS 8/8；辅助文档快照；外部日历业务接线与人工核验 API 已实现，UI 未接 |
| J | 显式邮箱调度与顺序 | **真实依赖验证通过（云端）** | owner/mailbox scope、严格邮箱队首、租约 fencing；本地与云端并发专项均通过 |
| K | 生产依赖失败不静默降级 | **真实依赖验证通过（云端）** | 生产强制依赖；真实 Redis 强杀/重启后原客户端恢复通过（`verify-redis-restart`） |
| L | 部署/恢复/成本/答辩证据 | 本地与云端性能证据已生成；业务成本仍未知 | 本机+云端负载矩阵与提交延迟探针（systemd 与 Compose 两种拓扑）；真实模型调用已打通但成本仍未知，见 [性能](performance/README.md) |

## 执行轮次

### 第四轮：云端部署、并发专项与性能/埋点收口（2026-10-17）

目标：把前三轮的实现从「本机定向通过」推进到「真实云主机上的部署与依赖验证」，并补齐 P2 并发专项与 P3 性能/埋点交付物。结论分级见 [部署验收报告](deployment/README.md)。

- **P0 部署（3 小时硬里程碑，达成，后续升级为容器全栈）**：真实阿里云单节点。该轮实例**尚未安装 Docker**（早期记为「Docker Hub 不可达」，该归因已更正），因此先以原生 apt 安装（PostgreSQL 16.15 / Redis 6.0.16 / RabbitMQ 3.9.27 / Node 22.23.3 来自阿里云镜像站），API / Worker / Scheduler 三个 systemd 单元共享 `/opt/daylight/.env`（600），数据服务仅监听回环。迁移重复执行幂等、空库初始化不导入本地数据。三个 `/health/ready` 均返回 200。unit 原文入库 `deploy/systemd/`。**随后在同一实例安装 `docker.io` 29.1.3 + `docker-compose-v2` 2.40.3 并配置镜像源，把应用与 4 个依赖全部迁到 Compose，一键启动 9 个服务成功**；详见下一轮。
- **P1 功能验证**:云端全量套件 **507 项 / 507 通过 / 0 失败 / 0 跳过**（98s，真实 PG + Redis + RabbitMQ，启用 `DAYLIGHT_VERIFY_PRODUCTION` 与 `DAYLIGHT_VERIFY_CONCURRENCY` 两个门控）。`verify-jobs` **8/8**，`verify-production` **12/12**，`verify-redis-restart` PASS。真实依赖：阿里云 OSS **8/8**；真实 QQ IMAP **8/9**，唯一失败项是需要模型的抽取步骤（出网被阻断）。**该失败项已在第五轮打通。**
- **P2 并发专项（20 项）**：`scripts/verify-concurrency.mjs` + `server/concurrency-suite.test.js`（`DAYLIGHT_VERIFY_CONCURRENCY=1` 门控）。覆盖同键并发入队、同邮箱队首、并发 claim 唯一租约、stale 写入 fencing、checkpoint 后崩溃 exactly-once、并发 recover/retry/cancel 单赢家、跨租户隔离、outbox 单次 confirm、真实 MQ 重复投递、snapshot CAS 冲突与回滚、并发建号/注册/会话吊销。清单见 [可靠性矩阵](reliability/README.md)。
- **P3 性能与埋点**：新增 `scripts/load-test.mjs`（真实 PG + RabbitMQ 的矩阵化负载：扩展曲线、连接池、串行上界、CPU 受限、失败路径、埋点开销成对重复）。新增 `server/metrics.js`（有界缓冲、标签净化、raw 延迟样本、周期 summary、sink 失败可观测、关闭零开销），并接入 HTTP、PG、Redis、OSS、模型、IMAP、MQ、作业执行、存储提交 9 条关键路径；`/health/ready` 暴露埋点状态。指标目录与开销方法见 [埋点与可观测性](observability/README.md)。
- **缺陷修复（D1）**：永久失败的邮箱此前会被调度器每分钟重新入队，持续冲击用户账号。新增「连续终态失败次数 → 指数退避（5 分钟起，1 小时封顶）」的调度门控，退避状态来自 jobs 表的真实历史（跨重启、多副本一致），手动同步不受限；连续失败 3 次即等待 20 分钟，成功一次立即清零。worker 失败原因此前只记 `JOB_FAILED` 无细节，现记录有界脱敏原因（邮箱地址与 URL/查询串中的凭据被替换），并把 job/kind/mailbox/attempt 带入日志。
- **修复（P1 顺序）**：补充 job 层与批处理层的乱序输入测试，断言 `runMailJob` 与 `processEmails` 均按 `receivedAt` 升序处理，改期通知不会先于原邀请生效。
- **缺陷修复（埋点 provenance）**：部署产物通常不是 git 检出，`dirty` 字段在云端会退化为 `null` 导致断言失败。新增 `DAYLIGHT_GIT_DIRTY` 显式声明并修正契约断言；无 git 且未声明时记录 `null`（未知），不谎报为 clean。
- **未验证（本轮）**：真实模型调用（出网阻断）、公网 HTTPS 入口（安全组未放行）、多节点/HA/K8s 集群、回滚演练、长稳与容量上限。前两项已在第五轮打通。

### 第五轮：Docker Compose 全栈部署与真实模型打通（2026-10-17）

目标：把「容器化交付」从产物层面推进到真实云端一键运行，并补齐上一轮遗留的两项未验证（真实模型调用、公网入口）。

- **一键 Compose 全栈**：`docker compose --env-file /opt/daylight/compose.env -p daylight up -d --wait --build` **exit 0、11 秒返回**。9 个服务 = `api` / `worker` / `scheduler` + `postgres` 17.6 / `redis` 7.4.5 / `rabbitmq` 4.1.4 / `minio` + `migrate` / `minio-init`。依赖顺序由 healthcheck 与 `service_completed_successfully` 强制；应用容器 `read_only` + `cap_drop ALL` + `no-new-privileges`。
- **环境适配**：安装 `docker.io` 29.1.3 + `docker-compose-v2` 2.40.3 并配置 4 个 `registry-mirrors`；新增 `DEBIAN_MIRROR` 构建参数与容器内 `Acquire::ForceIPv4`（默认 Debian CDN 会挂死）；MinIO tag 更新为 `RELEASE.2025-09-07T16-13-09Z`。
- **数据迁移**：systemd PG（16.15，只读 dump）→ Compose 容器 PG（17.6），`app_settings=13` / `users=8` / `jobs=2` 一致；空库重复迁移输出 `no local data imported`。
- **Compose 拓扑验证**：全量套件 **517/517、0 失败 0 跳过**（71.9s，容器内真实 PG/Redis/MQ + 两个门控）；`verify-jobs` **8/8**；`verify-production` **12/12**；`verify-oss`（容器内 MinIO）**14/14**；`verify-real-mail` **9/9**。
- **知识库与生产接口面修复后复跑**：同一 Compose 拓扑上全量套件 **547/547、0 失败 0 跳过**；`GET /api/rag/status`、`POST /api/rag/reindex`（15 封邮件 → 35 条分块）、`POST /api/rag/search`、`POST /api/rag/ask`（真实模型按证据作答）与 `GET /api/invitations` 实测 200（此前全部 `503 WORKFLOW_NOT_MIGRATED`）。**后续最终代码**（检索规范化 RRF + MMR、embedding 限流重试）在同一拓扑上为 **561/561、0 失败 0 跳过**，且三个真实邮箱的检索问答 42/42 通过。
- **真实模型调用打通（上一轮未验证项）**：OpenAI 兼容端点 `api.modelverse.cn/v1` + `deepseek-v4.1-flash`，真实 IMAP 2 封 + 1 次真实抽取（2199 ms）。配置需同时写 shared 层与 `userPrefs[userId]` 层。**后续更正**：同一密钥对该端点推理返回 401 `Validate Certification failed`，本轮完整闭环一度改用另一个 OpenAI 兼容端点。**再后续（同日）**：用户提供了新的优云智算密钥，实测该端点推理返回 200 并返回 usage，部署已改回 Modelverse 并以 2 封真实新邮件复验通过（1 个日程 + 1 个日程/1 个待办，trace 计费 0.0160/0.0278 元）。
- **公网入口打通（上一轮未验证项）**：安全组放行 TCP 3000 后，外部实测 `/health/live`、`/health/ready`、前端 `GET /` 均 HTTP 200。
- **依赖重建自愈**：recreate `postgres/redis/rabbitmq` 后，未被重建的 api/worker/scheduler 自行恢复并保持 healthy。
- **Compose 性能矩阵**：54.89 / 77.93 / 98.36 jobs/s（1/2/4 Worker），容器 PG 提交延迟 2.252 ms/次（444 次/s）；**吞吐仍由 PG 提交延迟决定，容器化没有引入可测损失**。
- **仍**未验证：公网 HTTPS/域名/证书（当前直连 HTTP:3000）、完整「通知→事项→行动→回执」真实邮件端到端闭环、K8s 集群/多节点/HA、滚动更新与回滚演练、长稳与容量上限。

### 第三轮：集成回归与证据收口（进行中）

- 最新独立生产验证扩展到 **12/12 检查通过**，Node 22.23.3：新增真实 PG 日程/意图原子回滚，独立 Scheduler→Worker 固定 ID PATCH/DELETE 单次执行，创建 POST 回执丢失后 unknown 持久化且手动重试不重复 POST。证据 `work/production-verify-4Bd0DN/`；Google Calendar 与 S3 均为本地 HTTP mock。
- 第四轮包含外部日历业务接线及真实 PG 存储用例：Node 22.23.3 **486 项，484 通过、0 失败、2 跳过**；前端重建通过。日志 `work/cloud-native-regression-round4.log`、`work/cloud-native-build-final.log`。
- 两项默认跳过的真实依赖测试均已单独运行通过：认证 `2/2`（`work/auth-real-evidence-eS2E3B/`），生产闭环 `1/1`（下述证据）。保留全量原始计数，不将分次运行拼成虚构的一次全通过。
- Node 22.23.3 第三轮全量回归 **476 项，460 通过、0 失败、16 跳过**，日志 `work/cloud-native-regression-round3.log`；前端 `npm run build` 退出 0，日志 `work/cloud-native-build.log`。日历后续接线仍需增量验证。
- Node 22.23.3 生产闭环复验 **1/1，通过内部 8 项检查**，真实本机 PG/Redis/MQ、本地 S3 mock；检查点后强杀及重启恢复、双用户隔离、日历提交故障回滚、8 路并发确认无重复均通过。证据 `work/production-verify-ljgCLK/`，命令日志 `work/production-node22-verification.log`。
- Node 22.23.3 主会话复跑 `scripts/verify-jobs.mjs`，真实 PG/MQ 七组检查全部通过：并发幂等与隔离、租约 fencing、事务中到期回滚、重试预算、outbox 旧确认拒绝、confirm 登记失败/重连、心跳及 checkpoint 恢复。日志 `work/jobs-node22-verification.log`。
- 独立真实 Redis SIGKILL/原端口重启验证通过，原生产客户端自动恢复，不回退内存、不落地断连写入；关闭后自然退出。脚本 `scripts/verify-redis-restart.mjs`，证据 `work/redis-restart-O6On65/`。单次恢复耗时不是 SLA。
- 清除继承代理后全量回归：444 项，429 通过、1 失败、14 跳过。唯一失败为招聘 API 旧夹具把模糊 SMTP 错误期待为 failed；明确 AUTH 拒绝与 unknown 防重用例修复后，相关 8 文件 67/67 通过。仍需最终代码全量回归，不能把局部复验当作全量成功。
- 主会话真实本机 PostgreSQL 存储/HTTP/导入/辅助持久化定向命令已退出 0，日志 `work/cloud-native-storage-real.log`。HTTP 成功前提交、失败丢弃，跨文档 CAS 与读集冲突校验已覆盖。导入仍只覆盖 settings/calendar/scenarios。
- 任务基准采用 Node 22.23.3、本机 PG 16.12、每组 200 个合成任务和 20 个预设失败：1/2/4 Worker 终态吞吐分别 23.55/43.81/95.24 任务每秒。三组均无未完成任务；原始记录见 performance/results/20261017T011011+0800-node22。单进程、每档一次、无预热，不能推断云端 SLA 或真实模型成本。
- 外部日历持久意图、调度与带 fencing 的发送检查点已实现，23/23 模拟测试通过；服务入口和邮件/场景/助手日程写路径继续接线。创建未知结果禁止盲目重试，人工核验恢复仍待补齐。
- 依赖健康和停机 14/14 受控测试通过，尚无真实 Redis 重启、云端多副本验收证据。
- 架构、恢复矩阵、八页讲稿、三分钟 Demo、问答、版本冻结材料已落盘；未生成演示视频，未宣称云部署或生产验收完成。

### 第二轮：额度恢复后继续实施

- 任务仓库、RabbitMQ confirm/outbox、租约 Worker 和独立邮件 handler 已落盘；任务子模块报告真实隔离 PG16/MQ3 的重复投递、租约拒写及重连验证通过，业务接线仍进行中。
- 认证原子消费、session touch/revoke 和密码重置事务已实现；子任务报告独立真实 PG/Redis 并发验证通过。
- 生产快照/CAS 存储、辅助文档迁移、HTTP 提交屏障、后台入口及前端任务页正在集成。不得将单模块通过等同端到端通过。
- 主 Agent Node 22.23.3 定向运行 jobs/mail-job/service-health/infra-production：23/23 通过。场景分析新增输入版本检查，首轮夹具缺学校字段失败，补齐合成字段后新并发用例和健康用例2/2通过。
- Docker/Compose/K8s 产物已生成；子任务记录镜像下载内容摘要大小校验失败、K8s API连接拒绝，完整部署仍未通过。
- 本轮尚未连接真实邮箱、付费模型、SMTP或云端资源。

### 第一轮：审计与实现边界

- 已读当前 AGENTS、README、STATUS、DEPLOY，当前业务增加小 D 发信审核与会议恢复，需保留这些语义。
- 并行委派共享状态只读审计，以及 jobs 运行器和真实依赖测试。核心应用集成由主 Agent 负责。
- 后续：完成共享状态方案，先保证权威提交与隔离，再增加副本；网络调用不得占据业务事务。

## 完成标准

每项记录本地通过、真实依赖通过、云端通过分别提供命令与证据。重点包括并发确认、提交后 ack 前崩溃、Worker 接管、过期写入拒绝、等待确认跨重启、PG/MQ 中断、跨用户隔离、干净部署和回滚。当前均未据此宣布通过。

## 运行器阻塞与恢复入口

后续收到生产基础设施子任务结果：新增 `server/runtime-mode.js`、`server/infra-production.test.js`，修改 `server/infra/{config,postgres,redis,oss,index}.js`。显式生产模式采用环境配置，禁用这些基础设施的本地回退及旧 hydrate；PG 启动不自动建表或导入。主 Agent 使用 Node 22.23.3 复跑 `node --test server/infra-production.test.js`：6/6 通过。该测试使用模拟依赖，仅为本地验证。生产 jobs 状态尚未接入，业务存储仍未迁移，不能启动此模式后宣称应用生产就绪。

共享状态只读审计已完成：推荐异步加载 PG 快照、保留同步读取、以短事务收口写入。现有同步 saveStore 不能在事务外维持“立即提交远程数据库”的语义；场景确认需与日历同 client 提交；网络调用须在事务外。招聘、traces、提示词、RAG、附件、认证会话等也需要迁移或明确单实例边界。该审计尚未实施。

任务子 Agent `ses_eba68f821ffeDhEcpmkT5goFUR` 被模型服务拒绝：余额不足（返回剩余 $0.090312，当前请求需要 $0.111770）。未获得该子任务完成报告，不能认定运行器或测试已完成。其他已启动子任务也尚未返回验收结果。

中断时 `git diff --stat` 无已跟踪文件差异；新增本实施记录，`server/jobs/` 仍为未跟踪目录，必须重新阅读其内容并确认来源，不能覆盖。本轮没有运行测试、构建、容器部署或真实外部业务调用。

恢复步骤：

1. 检查 `git status --short` 和本记录，以及未跟踪 `server/jobs/` 的现有内容。
2. 使用 `~/.nvm/versions/node/v22.23.3/bin` 加入 PATH，避免默认 Node 21。
3. 接收或重新进行共享状态审计及生产配置改造；核对其他子任务是否已落盘。
4. 完成 PG 权威读写与事务设计，再集成持久任务和独立服务入口。
5. 用隔离容器启动 PG/MQ/Redis，运行并发及故障实验；目前 Docker daemon 可用，但尚未启动本轮测试依赖。
