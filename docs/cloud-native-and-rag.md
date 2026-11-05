# Daylight · 完整 RAG 架构与云原生方案

本文是**完整架构方案**（可落地对照），不是声称「已经全部上线」。当前代码仍是 React + 一个 Node 进程，可选 PostgreSQL / Redis / RabbitMQ / OSS；下列拓扑、监控、压测与容灾用于后续扩到多机与招聘知识检索。

---

## 1. 完整 RAG 架构（招聘 / 附件 / 小 D）

### 1.1 要解决的问题

| 问题 | 不靠 RAG 时 | 靠 RAG 后 |
| --- | --- | --- |
| 简历 PDF 很长 | 整份塞进 prompt → 贵、易截断 | 只检索相关页/段 |
| 人才库人多 | 模型「猜」谁匹配 | 先向量/关键词召回，再精排 |
| 回答无出处 | 难核验 | 强制带来源（候选人、文件、页码） |
| 多租户 | 一不小心串库 | 检索强制 `ownerUserId` / `mailboxId` 过滤 |

### 1.2 端到端数据流

```
邮件附件 / 手动上传 PDF
        │
        ▼
┌───────────────────┐
│ Ingest Worker     │  PDF 文字层 / OCR（已有 server/pdf.js）
│ 分块 Chunker      │  页或段，约 500–800 字，重叠 ~80 字
│ Embedding         │  OpenAI 兼容 embedding API
└─────────┬─────────┘
          │ 写入
          ▼
┌───────────────────┐     ┌──────────────────────────┐
│ PostgreSQL        │◄───►│ Vector：pgvector 同库     │
│ candidates /      │     │ 或专用向量库（可选）       │
│ attachments 元数据 │     │ metadata: candidateId,    │
└───────────────────┘     │ attachmentId, mailboxId,  │
                          │ page, ownerUserId         │
                          └────────────┬─────────────┘
                                       │
用户提问（招聘助手 / 小 D）              │
        │                              │
        ▼                              ▼
┌───────────────────┐     ┌──────────────────────────┐
│ Agent + Tools     │────►│ Retriever                │
│ search_candidates │     │ 1) 关键词 / 元数据过滤    │
│ rag_search        │     │ 2) 向量 Top-K             │
│ search_knowledge  │     │ 3) 可选 Rerank            │
└─────────┬─────────┘     └────────────┬─────────────┘
          │                              │
          │◄──── 片段 + 引用 ────────────┘
          ▼
┌───────────────────┐
│ Chat Completions  │  只带检索片段，禁止编造无引用事实
│ 回答 + 引用卡片   │  点击 → 现有全局附件预览
└───────────────────┘
```

### 1.3 分块与索引约定

1. **分块**：优先按页；页过长再按段落。重叠约 80 字，避免跨页句子被切断。
2. **向量字段**：`embedding vector(维度)` + `content text` + JSON/列式元数据。
3. **混合检索**：`mailboxId` / `candidateId` 硬过滤 → 向量召回 →（可选）交叉编码器重排。
4. **更新策略**：附件重新 OCR 成功后按 `attachmentId` 删旧块再写新块；候选人合并时块的 `candidateId` 跟着迁。
5. **安全**：查询构造必须带当前用户隔离条件；工具层再校验一次，不信任模型传入的跨邮箱 id。

### 1.4 与现有代码的衔接点

| 现有能力 | RAG 接入点 |
| --- | --- |
| `server/pdf.js` 文字/OCR | Ingest 输入 |
| `server/recruitment.js` 结构化档案 | 元数据与「先筛人再 rag」 |
| 招聘助手 tools | 新增 `rag_search` |
| 小 D tools | 新增 `search_knowledge`（范围：当前邮箱人才/附件） |
| 全局附件预览 | 引用点击打开同一 viewer |
| Token 计价 | embedding + chat 分别记 usage |

### 1.5 分期落地

| 期次 | 范围 | 不做 |
| --- | --- | --- |
| P0 | 分块 + 关键词检索 + 引用展示 | 向量、重排 |
| P1 | pgvector + embedding + 工具接入 | 多模态、联邦检索 |
| P2 | Rerank、评测集、缓存热问 | 自动微调 |

**第一期可砍掉的**：多模态向量、跨邮箱联邦、自动微调。先做「分块 + 关键词/向量混合 + 引用」。

---

## 2. 完整云原生架构

### 2.1 目标形态

| 能力 | 建议 |
| --- | --- |
| 多节点应用 | 无状态 Node（Express）水平扩展；JWT 无粘滞 |
| 数据库 | PostgreSQL 主从或托管 HA；JSON 仅本地回退 |
| 缓存 / 限流 | Redis（会话旁路、限流、短期缓存） |
| 消息队列 | RabbitMQ（或兼容）：邮件同步、OCR、抽取、embedding |
| 对象存储 | 已有 OSS 抽象；附件只存 key |
| 入口 | Ingress / Nginx；TLS；可选静态前端 CDN |
| 编排 | 先 Docker Compose；需要时再 K8s（Deployment + HPA + PDB） |

### 2.2 推荐拓扑

```
                    Internet
                        │
                        ▼
              ┌─────────────────┐
              │ Ingress / Nginx │  TLS、限流、静态资源
              └────────┬────────┘
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
     app-a         app-b         app-c     Daylight API（无状态）
         │             │             │
         └──────┬──────┴──────┬──────┘
                │             │
                ▼             ▼
         ┌──────────┐   ┌──────────┐
         │ Worker-x │   │ Worker-y │  同步 / OCR / 抽取 / embedding
         └────┬─────┘   └────┬─────┘
              │              │
    ┌─────────┴──────────────┴─────────┐
    ▼            ▼           ▼         ▼
 PostgreSQL    Redis     RabbitMQ     OSS
 (主+只读从)   (限流)    (任务队列)   (附件)
    │
    └── pgvector（RAG）

观测面：Prometheus ← app/worker 指标
       Grafana 看板 + Alertmanager
       Loki（可选日志） / Tempo（可选链路，对齐 trace_id）
```

### 2.3 组件职责

| 组件 | 职责 |
| --- | --- |
| app-* | HTTP API、鉴权、读状态、投递异步任务；不跑长时间 OCR |
| worker-* | 消费队列：IMAP 批次、模型抽取、PDF/OCR、embedding 入库 |
| PostgreSQL | 权威业务数据 + pgvector |
| Redis | 限流、短期缓存、可选分布式锁 |
| RabbitMQ | 缓冲峰值；失败重试与死信 |
| OSS | 简历/材料二进制 |
| Prometheus/Grafana | 红黄绿面板与告警 |

---

## 3. 监控（Observability）

### 3.1 指标（Prometheus）

| 类别 | 示例指标 |
| --- | --- |
| HTTP | `http_requests_total{route,status}`、`http_request_duration_seconds` |
| 业务 | `mail_sync_total{result}`、`extract_duration_seconds`、`assistant_chat_total` |
| 队列 | `queue_ready_messages`、`queue_job_age_seconds`、`queue_dlq_total` |
| 模型 | `model_request_duration_seconds`、`model_tokens_total`、`model_cost_cny` |
| RAG | `rag_ingest_chunks_total`、`rag_search_latency_seconds`、`rag_hit_count` |
| 依赖 | PG 连接数、Redis 延迟、OSS 错误率、IMAP 失败 |

### 3.2 Grafana 看板建议

- **红**：5xx、登录失败率、队列积压年龄、DLQ 增长
- **黄**：模型 P95、IMAP 失败、OCR 队列深度、embedding 滞后
- **绿**：同步成功数、助手/招聘对话次数、估算成本（元）
- **下钻**：`mailboxId` / `trace_id`（与现有 traces 对齐）

### 3.3 告警（示例）

| 条件 | 级别 | 动作 |
| --- | --- | --- |
| 5xx > 2% 持续 5m | P1 | 页 / 短信 |
| 队列年龄 > 10m | P2 | 扩 worker / 查模型限流 |
| PG 主库不可用 | P1 | 切只读或故障转移 |
| 模型错误率 > 20% | P2 | 降级：跳过非关键提取 |

---

## 4. 压力测试

### 4.1 场景分层

| 场景 | 工具 | 关注点 |
| --- | --- | --- |
| 读路径 | k6 / vegeta | `/api/state`、日历列表（无模型） |
| 写路径 | k6 | 创建日程、待办（无模型） |
| 助手 | k6（低并发） | `/api/assistant/chat`，防打爆中转 |
| 招聘 | k6 | 聊天 + 带鉴权附件下载 |
| 队列洪峰 | 脚本灌 MQ | worker 吞吐、积压年龄、无丢消息 |
| RAG | 脚本 | 检索 QPS、P95、召回质量抽检 |

### 4.2 通过标准（建议基线，上线前用实测改写）

- 读路径 P95 < 200ms（同城、暖库）
- 写路径无 5xx；冲突写入语义不变
- 助手在设定并发下错误率 < 1%（不含上游模型自身 429，需单独统计）
- 队列：峰值后 15 分钟内消化完毕，或 HPA 自动扩 worker

### 4.3 材料位置

压测脚本建议入库 `work/load/`（k6 脚本 + 结果 JSON）；**不得**把真实授权码、邮件正文写入报告。

---

## 5. 容灾与高可用

### 5.1 故障域与策略

| 故障 | 策略 |
| --- | --- |
| 单 app 挂 | 多副本 + 就绪探针；Ingress 摘除 |
| 单 worker 挂 | 队列消息未 ack 重投；幂等消费者（邮件 UID / job id 去重） |
| PG 主挂 | 托管自动 failover 或手动升从；应用短暂只读 |
| Redis 挂 | 限流降级为进程内令牌；会话仍以 JWT 为准 |
| MQ 挂 | 回退进程内队列（现有能力）；告警，避免 silently 丢任务 |
| OSS 挂 | 读：本地/缓存回退（若有）；写：失败可见，不假装成功 |
| 机房级 | 异地备份（PG dump + OSS 跨区复制）；RTO/RPO 书面约定 |

### 5.2 备份

- **日**：PostgreSQL 逻辑备份 + WAL/ PITR（托管优先）
- **附件**：OSS 版本或跨区复制
- **配置**：不含密钥的 infra 模板进仓库；密钥进密钥管理 / 环境变量
- **演练**：每季度一次「从备份恢复到空环境」并记时

### 5.3 降级清单

1. 关闭自动同步，仅手动同步  
2. 关闭招聘 OCR / RAG，仅结构化库检索  
3. 助手只读工具（查日程/待办），禁止写操作  
4. 外部日历推送改为「待确认队列」延后  

---

## 6. 落地顺序（与现状对齐）

1. 强制 PostgreSQL + OSS 为权威存储（已有双写基础）  
2. 同步 / 抽取 / OCR 进 MQ，多 worker 消费  
3. Prometheus 指标暴露（HTTP、队列、模型、成本）  
4. Grafana + Alertmanager  
5. 压测脚本入库 `work/load/`  
6. 招聘附件分块 + pgvector RAG 工具（独立开关）  
7. 按需上 K8s（HPA、PDB、资源配额）——**用户明确要求再上**

---

## 7. 与现状的边界声明

- **已实现（业务）**：单机/可选 infra 组件、traces、费用估算、附件预览、招聘结构化库。  
- **已实现（RAG P0/P1 核心，2026-10-15）**：`server/rag/*` 分块入库（文件 JSON + 可选 PG）、关键词/可选 embedding 混合检索、`rag_search` / `search_knowledge`、消息 `citations` 与附件预览跳页、设置开关与 `/api/rag/*`、本地 `rag.test.js`。  
- **仍为规划**：多机拓扑、Prometheus/Grafana、压测入库、Rerank、pgvector 生产标配与云上 HA。  
- **不得宣称**：填好配置、看到「已配置」、或本地单元测试通过 = 云上 HA / 真实 embedding 联调 / RAG 生产就绪。
