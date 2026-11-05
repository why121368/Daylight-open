# 优云智算优先的模型服务与接入方案

> 方案与公开资料核查日期：2026-10-17（北京时间）。本文只设计，不修改当前配置或代码，不读取用户凭据、正文及附件，不调用模型、Embedding、OCR 或其他计费 API。文中的“文档支持”是官方公开资料证据，“候选”尚需授权后的实连和业务评测。不能把 URL、Key 字段保存成功或接口文档中的示例当作 Daylight 已接入成功。

## 1. 选型结论与服务分工

将**优云智算 ModelVerse 按量模型 API 作为 Daylight 正式应用的优先接入方案**，沿用现有后端 OpenAI 兼容 Chat Completions 调用边界。先验证一个适合结构化提取和工具调用的文本模型，再按收益开启 Embedding 与难页 OCR。当前已保存的用户模型配置仍由用户选择；本方案不是自动切换模型、换 Key 或把现有邮件发送给新供应商的授权。

| 项目需要 | 优先方案 | 为什么采用 / 进入条件 |
| --- | --- | --- |
| 邮件分类、日程与待办提取、工作台建议 | ModelVerse 按量 Chat Completions | 现有 Node `fetch` 调用契约接近，减少多家协议接入；按实际请求付费，适合尚未测出稳定推理负载的阶段 |
| 小 D 和招聘工具编排 | 同一平台上通过工具契约测试的文本模型 | 凭据与计费入口可统一，Daylight 仍负责工具、权限、审批与任务账本；模型不能替代这些规则 |
| 语义检索 | 按需开启 ModelVerse `/v1/embeddings` | 有官方专门文档；只在关键词检索的业务样本表现不足、向量收益大于成本时启用 |
| PDF 文字层与普通扫描页 | 现有 PDF.js + CPU OCR Worker | 文字层提取不需要模型调用；无需把每份附件都上传到模型平台 |
| 难识别的扫描页 | 可选 ModelVerse `deepseek-ai/DeepSeek-OCR` | 官方给出图片转 Markdown API；用有上限的页级调用补充 CPU OCR，先评估中文简历/表格效果与数据授权 |
| 业务 API、调度、任务、PG、附件存储 | 按 [部署与容量方案](04-deployment-and-capacity.md) 落地 | 模型服务解决推理需求，不替代事务数据库、US3 原件、用户会话和业务部署 |
| 自托管 GPU 推理 | 后续条件方案 | 只有隐私/专网硬约束、稳定利用率、服务质量及总成本实测支持时才评估优云智算 GPU；首期没有必要为远端 API 再租 GPU |

优云智算的 GPU、模型 API、Coding/Agent Plan 和 Agent 托管是不同服务。选择“优云智算优先”应针对实际需求，不能推导成每一项都采购。Agent 托管即使能运行通用助手，也没有证据能直接继承 Daylight 的邮箱归属、跨工作台事务、SMTP 审核、unknown 核验及现有用户数据契约，因此不拿它替换项目自身的业务后端。

按量 API 文档描述按 Token、次数或时长计费；套餐文档描述独立 Key、指定模型、并发/窗口额度和编程工具接入。公开页面未在本次核查中给出足够证据，证明套餐允许本项目的多用户后台邮件同步与持续商业应用调用。因此正式方案按量优先，套餐仅在其适用范围、后台调用许可和实际额度都核实后另作决策，不能把个人 Coding/Agent Plan 当成通用无限推理接口。

## 2. 官方公开证据及其边界

下表全部在 **2026-10-17** 只读核查。标记含义：**明确**＝专门接口/模型文档给出；**通用**＝网关级说明，不能推出每个模型均支持；**待核实**＝本次公开资料不足，须后续核对或授权实连。本轮没有任何“Daylight 真实服务验证通过”结论。多数文档页显示最近更新为 2026-09-22，实时型号与价格仍以届时账号可用信息为准。

| 主题 / 官方来源 | 可见原文或字段 | 证据程度与采用边界 |
| --- | --- | --- |
| [快速开始](https://www.compshare.cn/docs/modelverse/models/quick-start) | Base URL 为 `https://api.modelverse.cn/v1`；示例请求 `/v1/chat/completions` | **明确：**可作为优先 endpoint。页面还列海外域名；它是同一平台的另一入口，不代表独立供应商容灾 |
| [认证鉴权](https://www.compshare.cn/docs/modelverse/models/common/certificate) | “使用 API Key 进行认证”；`Authorization: Bearer {api_key}` | **明确：**后端 Bearer 鉴权，与项目现有方式匹配；不含真实 Key，不在前端或任务 payload 暴露 Key |
| [Chat Completions](https://www.compshare.cn/docs/modelverse/models/text_api/openai_compatible) | `response_format` 示例为 `{"type":"json_schema"}`；有 `tools`、`tool_choice` | **通用：**支持输出格式及工具参数的接口声明。该页未给每模型 `json_object`/JSON Schema/完整 `tool_calls` 往返的认证矩阵，不能据此直接宣称满足 Daylight 的全部契约 |
| [Chat Completions](https://www.compshare.cn/docs/modelverse/models/text_api/openai_compatible) | “支持流式响应”；chunk 的 object 为 `chat.completion.chunk`，包含 `delta`，以 `[DONE]` 结束 | **明确到协议级：**有流式格式描述；逐模型的工具增量拼接、结束事件和最终 usage 仍需测试 |
| [快速开始](https://www.compshare.cn/docs/modelverse/models/quick-start) | 示例 `usage.prompt_tokens`、`completion_tokens`、`prompt_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens` | **通用示例：**证明公开响应形态包含这些字段，不证明所有模型/流式请求必返，也不是缓存命中或缓存折扣承诺 |
| [获取模型列表](https://www.compshare.cn/docs/modelverse/models/text_api/models) | `GET /v1/models`；“此接口只会返回文本生成的模型” | **明确：**用于后续核对文本模型 ID；模型列表不能替代能力清单，也不能用它否认单独文档中的 Embedding 服务。本次未调用该接口 |
| [模型协议支持](https://www.compshare.cn/docs/modelverse/models/text_api/model-competi) | “✅：当前推荐、经过验证的主要调用方式”；空白“不保证其兼容性” | **明确到协议映射：**Qwen/Qwen-Plus、DeepSeek-V3.1-Terminus、GLM-4.6 等列在 Chat 协议下；不等于每个高级参数已验证 |
| [API 与扩展字段](https://www.compshare.cn/docs/modelverse/models/text_api/api-expand) | 列出 Chat、Responses、Messages 等；扩展 `thinking_enabled`、`web_search` | **通用：**路由和扩展参数声明。Daylight 不因其可用就开启联网搜索；思考参数按模型适配，不能一律注入 |
| [DeepSeek 思考参数](https://www.compshare.cn/docs/modelverse/models/text_api/thinking/deepseek) | `thinking.type` 可选 enabled/disabled；支持列表含 `deepseek-ai/DeepSeek-V3.1`、`deepseek-ai/DeepSeek-V3.1-Terminus` | **明确到所列型号：**不能外推到全部 DeepSeek 或 Qwen 型号；页面与通用扩展存在不同参数名称，须固定已验证组合 |
| [Embedding](https://www.compshare.cn/docs/modelverse/models/text_api/embeddings) | `POST /v1/embeddings`；列 `text-embedding-3-large` 默认 3072 维、`text-embedding-ada-002` 默认 1536 维；可选 `dimensions` | **明确：**接口、模型和维度在专门文档中存在。实际权限、价格、时延和选定 dimensions 仍待验证 |
| [DeepSeek-OCR](https://www.compshare.cn/docs/modelverse/models/text_api/deepseek-ocr) | `deepseek-ai/DeepSeek-OCR`；“输入仅支持 base64 编码的图片”；提示 `convert to markdown`；max_tokens 最大 8192 | **明确：**图片 OCR 能力；不代表直接上传整份 PDF、PDF 任务状态、版面坐标或页码映射服务已提供 |
| [按量价格](https://www.compshare.cn/docs/modelverse/price)、[模型 API 产品页](https://www.compshare.cn/model-api) | “按量后付费”；“模型与价格以控制台实时信息为准” | **明确：**计费入口和动态价格边界。官网的高并发/高速描述不是 Daylight 的压测结果或合同 SLA |
| [套餐快速开始](https://www.compshare.cn/docs/modelverse/package_plan/package)、[套餐计费](https://www.compshare.cn/docs/modelverse/package_plan/logic) | 专属 Key 独立于普通按量 Key；额度耗尽返回 429；“不支持超额自动计费” | **明确到套餐机制；后台适用性待核实：**不能把套餐额度、Key 和普通按量余额混算，不能自动从套餐切到付费按量 |
| [错误码](https://www.compshare.cn/docs/modelverse/models/common/error-code) | 参数/权限错误 400、鉴权 401、限流 429、模型服务错误 500、网关超时 504 | **明确到已列错误：**按类别处理。余额不足的具体错误字段及账号实时限额未在本次证据中确定，不能虚构为固定 HTTP 402 |
| [隐私政策](https://www.compshare.cn/docs/overview/serviceagreement/privacy) | 业务数据章节规定按指示处理；政策要求云服务用户为其自身用户另行约定隐私政策 | **政策级证据：**不等于每个代理模型的处理地域、下游供应商、推理日志保留和训练使用细则均已确认 |

文档自身有适用范围差异：快速开始在一处写 `/v1/response`，详细 [Responses 文档](https://www.compshare.cn/docs/modelverse/models/text_api/response_api) 与协议表写 `/v1/responses`；某些 Coding Plan 页面又使用不同 Base URL、Key 和型号名称。首期使用文档一致且符合现代码的 `/v1/chat/completions`，不通过拼接或猜测把其他协议混进来。

本次没有找到足以确认“所有文本模型均支持 `json_object`、所有流式响应都支持 `stream_options.include_usage`、缓存 TTL/命中规则/折扣统一、模型 API 零日志保留”的逐型号官方证据。设计中把这些保留为具体模型的兼容性与采购核查项，不能从“OpenAI 兼容”宣传语推断。

## 3. 文本模型候选与选择依据

候选的顺序来自项目任务和公开协议/价格信息，不是已测质量排名。至少准备一个中文邮件/简历/改期样本集，包括有歧义通知、取消、提示注入、跨时区与长附件；在相同样本、提示词和预算下比较结构正确率、关键业务正确率、工具误用、p50/p95 延迟与完整任务成本，之后才冻结版本。

| 候选型号（官方协议表所列 ID） | 计划角色 | 选择原因 | 不能提前宣称 |
| --- | --- | --- | --- |
| `Qwen/Qwen-Plus` | 首轮结构化提取与小 D 基线候选 | Chat 协议有官方标记；按量价表低上下文档的输入/输出价格较低，适合先测大量短邮件任务 | 未实测 `json_object`、工具往返、复杂改期和上下文长度边界；不能据价格选择后直接上线 |
| `deepseek-ai/DeepSeek-V3.1-Terminus` | 同平台第二个提取/工具候选 | Chat 协议与型号对应的思考开关有文档，便于约束响应时长与参数 | 不将原厂直连接口的行为自动等同于 ModelVerse；不承诺非思考模式一定更快或更准 |
| `zai-org/glm-4.6` | 工具编排对照候选 | 官方协议表列 Chat 支持；用于对照多步工具选择和参数稳定性 | 尚未确认此网关的全部工具字段、JSON 模式或延迟表现 |

三个候选均通过同一网关，适合减少接入成本，但仍共享平台故障域。不能把“Qwen 切 DeepSeek”直接写成独立供应商高可用。跨供应商后备也需用户提前配置、批准数据流向并完成等价契约评测；没有授权时，失败进入等待/人工处理，保留本地规则和已保存数据能力。

本次不优先选专门编码模型、强推理模型或仅支持 Responses 的型号作为邮件基础模型：项目首先需要稳定的结构输出、低成本及时处理与受控工具调用；大量推理 token、额外协议适配及更长时延的价值需要业务测量证明。未来增加高质量审核模型时，也应只用于难例或人工触发，不默认每封邮件串行调用多个模型。

模型配置拆成“默认提取”“助手工具”“Embedding”“难页 OCR”四种用途的目标配置，并可显式引用同一个凭据。已保存的单模型设置可作为提取和助手的兼容默认，但不能把聊天型号自动当成 embedding 型号。每次 run 保存 provider、endpoint 标识、模型 ID、参数/提示词版本、用途和定价版本；保存凭据引用，不保存 Key。

## 4. 与现有代码逐项对接

### 4.1 结构化提取与工具契约

[agent.js](../../server/agent.js) 和 [model-json.js](../../server/model-json.js) 使用 `POST {baseUrl}/chat/completions`，请求 `response_format: { type: 'json_object' }`，读取 `choices[0].message.content` 并解析业务对象。`https://api.modelverse.cn/v1` 与这一 URL 组合相符，但公开文档中的 `json_schema` 示例不足以证明同一候选型号满足当前 `json_object` 要求。

实施时为所选型号建立能力配置：支持的协议、`json_object`/schema 模式、输出 token 参数、工具调用、stream/usage、思考开关及多模态限制。按实际结果选其中一种：当前 `json_object` 契约通过则沿用；若只验证了 JSON Schema，则经明确适配和回归后使用对应 schema；若不能可靠输出所需结构，替换为已获授权且通过测试的候选，或让任务失败待处理。不能静默删除格式参数后，把任意自然语言或模型“修复”的缺失动作直接写入日历。

JSON 合法只代表格式，服务端仍验证枚举、日期、已有目标、取消/改期链、邮箱权限和来源。截断的响应、`finish_reason=length`、拒绝内容、空对象以及字段类型错误不算业务成功。现有格式修正最多一次的路径在 [model-json.js](../../server/model-json.js) 中可作为起点，重试计入预算；格式修正不获得新的工具执行授权。

[assistant.js](../../server/assistant.js) 的工具循环发送 `tools` 与 `tool_choice: 'auto'`，读取 `message.tool_calls`，回传 `role: 'tool'` 与相应 ID。必须验证多个调用、参数 JSON 字符串、tool_call_id 关联、工具错误后续轮次、未知工具拒绝和最终文本回复；不能只测试“你好”通了就开启助手写操作。服务端工具白名单、参数验证和外部动作审批遵循 [状态与执行可靠性方案](03-state-and-task-reliability.md)，不会因为平台提供内置工具就扩大权限。

当前关闭思考的分支按特定原厂 hostname/model 判断，换成 ModelVerse 后不会自然命中；也不应把原厂或另一型号的字段不加区别地发给网关。选中 DeepSeek-V3.1-Terminus 时才按该型号文档验证 `thinking.type`；其他候选依据其自身支持情况决定，未知字段不默认注入。无需为使用该平台强制引入 LangChain 或更换现有 fetch，但可抽出统一适配器减少重复错误处理。

### 4.2 上游流式与前端 SSE 是两层

当前小 D 的 [chatCompletion](../../server/assistant.js) 读取非流式 JSON，上层把工具阶段和结果通过应用 SSE 传给浏览器。前端能看见逐步执行不证明 ModelVerse 的 token 流式接口已接入。首期可以继续这个方式，先保证结构/工具契约及超时体验。

如果后续为了首字时延使用上游流式，适配器须按 SSE 帧而非网络 chunk 边界解析，拼接 `delta.content` 和分片 `delta.tool_calls`，等待完整参数与正常结束后才交给工具验证。必须覆盖 UTF-8 分片、空 choices、usage 独立尾帧、`[DONE]`、中途错误、结束前断开及取消。上游流与浏览器连接恢复分开处理：前端重连读取持久 run，不从头重跑模型或工具。

官方公开 Chat 文档明确有流式，却没有在本次核查范围内明确保证每模型 `stream_options.include_usage`。该参数仅在对应能力验证后发送；无 usage 的流式结果标为未知用量，不为了补账再调用模型生成一次。若纯模型读取失败可在预算内重试非流式，应在任何工具执行之前进行；已发生副作用则按检查点和 effect 状态恢复。

### 4.3 Embedding 的独立配置、维度与计量

[rag/embed.js](../../server/rag/embed.js) 已组合 `/embeddings` 并按 `data[index].embedding` 读取，适合接入官方 Embedding 接口；但现有 `embeddingModel || settings.model` 的回退可能把聊天模型发到该端点。目标必须显式配置 Embedding model，可独立指定 endpoint/credential 与定价，并保留用户开启开关。未开启或授权不足时继续明确的关键词模式。

优先评测官方专门列出的 `text-embedding-3-large`。它默认 3072 维，而 [rag/store.js](../../server/rag/store.js) 可选向量列写死 `vector(1536)`；当前代码实际主要保存 JSONB embedding、在 JavaScript 中计算相似度，因此不能表述成“今天已因 3072 写入向量列报错”，但目标数据库向量索引显然不能照搬这个列定义。

有两个可评审选项：保持 3072 维并为选定 PG/pgvector 版本核实存储与近邻索引限制；或明确请求降低后的维度，例如 1536，并验证 ModelVerse 实际响应长度及检索效果后建立对应索引。不能静默截断已存向量。若采用 `text-embedding-ada-002`，仍须对中文召回、成本和模型生命周期评测，不能仅因维度一致就优先。

每个索引代际保存 provider、model、dimension、文本归一化与分块版本。模型或维度变化时建立新代际、完整后切换查询，旧新向量不混算；查询与索引端使用同一配置。官方文档给输入 Token 上限，当前“切 8000 字符”不是严格 Token 预算，需要按模型分词或保守分批并处理超限。

Embedding 官方响应示例只有 `usage.prompt_tokens` 与 `total_tokens`，没有 `completion_tokens`。现有 [usageMetrics](../../server/traces.js) 同时要求输入/输出字段，会把它标成 usage 不完整。因此目标计量按调用类型区分：Embedding 记录输入计费单位和其自身价格，不能伪造一条缺失的聊天 completion；也不能继续用聊天模型的 tokenPriceIn 估价。无已核对价格时展示 Token 已知、费用未知。

### 4.4 OCR 只负责选定图片页

[pdf.js](../../server/pdf.js) 已提供逐页文字层提取、页面渲染及可注入 OCR 路径。目标继续先取原生文字层；对用户开启云 OCR 的范围，由CPU OCR Worker渲染低质量扫描页并保存受控私有对象引用，PG登记云OCR子任务后释放CPU槽。I/O Worker检查授权与独立模型额度，读取PNG/JPEG字节，以`data:image/...;base64,...`调用`deepseek-ai/DeepSeek-OCR`，持久保存返回结果，再唤醒OCR Worker做校验和后处理。父任务等待依赖，不占CPU执行槽；队列只传引用，不复制页面内容或凭据。CPU解析角色不需要模型出口和API Key。不开放私有US3桶或传递任意远程URL；该型号文档明确不支持远程image_url。

限制单页像素、上传字节、页数、调用数、最大响应及任务期限；保留 source attachment/version/page 与提取器版本。现有 PDF trace 中的 `tesseract.js` 引擎标签也须按实际执行器改为对应 provider/model，不能让云 OCR 记录仍显示本地引擎。Markdown 需要清理、解析并对照原件核验，不能直接当作可信 HTML，也不能假设模型返回的表格没有漏行或臆造。文档提到的最大 8192 输出 tokens 不代表任意整份简历/PDF 可完整解析；超过上限按页分段或提示核验。

官方页面核查时写“当前该模型免费开放使用”，这只是页面当时的价格说明，不能作为长期零成本承诺。启用前再次核对账户权限、价格与调用额度，仍记录页数、token/调用量、失败与重试。数据不允许送外部平台、服务失败或无可用额度时，按用户策略保留 CPU OCR 或进入待处理，不静默发送到另一个供应商。未找到证据支持把该接口描述成“托管整份 PDF 文档解析服务”。

## 5. 资源、并发与成本治理

远端模型 API 让 Daylight 不必维护首期 GPU 推理服务，但不会让推理预算和排队自然消失。I/O Worker 的扩容上限要同时受模型配额、邮箱顺序、租户预算和 PG 连接限制约束，不能只看 CPU 或队列长度；OCR Worker 的 CPU/内存与外部 OCR 调用配额分别限制。具体实例和伸缩阈值统一见 [部署与容量](04-deployment-and-capacity.md)。

模型账号/凭据引用、具体型号、租户分别设置可配置的并发、RPM、TPM 和每日费用预算。调用前预留输入与输出上限的预算，结束后按实际 usage 结算；多 Worker 通过共享状态协调全局额度，首期可用 PG 短事务预留，不能每个 Pod 单独认为还有全额配额。Token 估算有误差时保留余量，账号实际 RPM/TPM 在后续核对后填写，不编造平台统一配额。重试、格式修正、工具循环、查询 embedding 都占预算。

| 情况 | 处理与业务影响 |
| --- | --- |
| 请求错误400、模型权限或认证错误 | 输入超长、字段值错误等拒绝当前任务并说明原因；若证据表明该型号/参数配置不受支持、Key无效或无权限，再暂停对应配置的新调用。按错误体分类，不因单个坏输入停全部租户；不无限重试或自动换Key |
| 429 | 区分瞬时速率、并发、Token 或套餐窗口额度；尊重服务返回的等待提示，按有界退避及任务期限安排；不默认全是瞬时拥堵 |
| 500 / 504、网络超时 | 仅对允许重算的模型步骤有界重试；可能已产生模型计费，记录请求关联与 usage 未知，不重复已执行工具 |
| 账户余额/额度不足、暂停服务 | 依据实际响应字段分类，告警并暂停新的付费任务；保留 PG 队列、草稿和人工操作，不自动充值或换付费方式 |
| 响应可解析但业务结构不合格 | 校验拒绝；如适用进行一次受控格式修正；不能把语法修正当作目标存在或用户已同意 |
| 平台整体不可用 | 暂停依赖模型的分析，规则/手工功能及已保存结果按依赖范围可用；已授权备用模型也需独立限额和可追溯切换 |

普通文本估价可沿用输入/输出 token × 对应单价，但定价须绑定实际型号、上下文档位、币种及生效时间。缓存命中 token 只有在字段语义和缓存单价已核实后才使用折扣；官方示例中的 cached_tokens=0 不证明命中机制、TTL 或优惠已启用。未返回缓存细分时不得假装确认命中，估算若采用全价需明确标为估算假设。不要把套餐页面的缓存倍率套到按量 Key。

任务完整成本还包括失败调用、JSON 修正、多轮工具、embedding 索引/查询、OCR 页、US3 存储与流量、API/Worker/PG 和观测费用。平台账单与 trace 估算分开对账；数据缺失、价表缺失或网关超时的调用明确记未知/待对账，不记成 0 元。模型预算触顶停的是新模型任务，不应把已有业务数据标为失败或删除。

## 6. 数据流、凭据与供应链约束

选择国内平台入口并不能自动证明每个代理模型在国内处理、无日志、无跨供应商转发或不用于训练。正式启用前对选定型号明确处理主体/下游、处理地域、请求与响应留存期、训练用途、删除方式、日志访问、协议和服务等级；通用隐私政策只能提供原则，具体安排应以确认后的服务条款为准。没有确认的项目标为待核实，不在架构图上写“数据不出域”。

用户看到并选择模型提供方、用途及会发送的数据类别；基础邮件处理可能发送正文和相关日程上下文，Embedding 会发送授权的 chunk，OCR 会发送选定页面图像。保持邮箱与 RAG 作用域，尽量裁剪无关签名、重复引用、无关附件与其他候选人内容，但不以脱敏破坏业务含义后声称效果不变。原件、模型输入、日志与引用分别设置访问和留存；公开证据包只留合成数据或经过核对的脱敏内容。

凭据在后端受控配置中保存与轮换；运行配置、job、日志和数据库审计只引用凭据 ID。生产**模型服务出口**只允许已配置且经过验证的HTTPS主机，不把本机自动代理探测作为云端网络依赖；IMAP/SMTP、数据库及对象服务分别按 [部署方案](04-deployment-and-capacity.md) 的端口、TLS和访问策略管理。签名URL或模型返回URL均不作为绕过附件鉴权的凭据。

采用同一网关减少接入成本的同时，也增加其可用性、账户额度、协议变化和下游供应链的集中依赖。缓解手段是保留清晰适配器与数据出口策略、冻结已验证的模型能力配置、做故障演练及可追溯迁移；不是未经同意把同一敏感请求同时发给多个模型平台“赛跑”。

## 7. 兼容性验收矩阵与上线顺序

下面是后续授权实施时的验收设计，本次未运行。先使用合成通知/简历验证接口契约，再以有权使用的真实业务样本做效果与成本评测；真实外发仍须独立审核，与模型测试分开。

| 契约 | 测试样本 / 故障 | 通过条件 |
| --- | --- | --- |
| endpoint 与鉴权 | 合法/无效 Key、模型无权限、错误 Base URL | 正确分类失败，无敏感信息泄露；配置保存、连通、能力验收分别显示 |
| JSON 模式 | 选定型号的 json_object；复杂嵌套、中文转义、空/截断/拒绝响应 | 满足当前格式契约或明确适配后的 schema；不合格结果不写业务 |
| 邮件业务 | 创建、取消、改期、歧义目标、时区、示例/真实来源 | 保留当前业务语义，关键误写为零的门槛需结合样本与风险评审；报告样本量而非宣称无限可靠 |
| tools 往返 | 无工具、单/多工具、参数分片、未知工具、错误后续轮次 | tool_call_id 关联正确，参数验证与授权独立，重复 run 不重复副作用 |
| 上游 SSE（若启用） | 分帧、空 choices、usage 尾帧、DONE、断连 | 不执行半个工具参数；关键结果可恢复；未知 usage 清楚标记 |
| usage 与缓存 | 输入/输出、reasoning、cached 缺失或存在，流式/非流式 | 不重复累加 token，不把 reasoning 再加一遍；缓存折扣有经核对单价，账单可对照 |
| Embedding | 单/批输入、乱序 index、空文本、超限、3072/选定降维 | 向量数量/有限数值/长度正确；模型代际一致；关键词降级可见 |
| PDF/难页 OCR | 文字层、扫描页、表格、加密/损坏 PDF、输出截断 | 原页引用正确；只对授权页面调用；幻觉/漏字可核验；不伪造解析成功 |
| 并发与限额 | 多 Worker 抢配额、429、余额不足、平台中断 | 全局预算不被副本数放大；有界退避、公平排队、业务截止可见 |
| 隔离与权限 | 跨租户 RAG、撤权后排队任务、模型提示注入 | 授权外文本不出域；模型不能扩大工具或邮箱权限 |

推荐实施顺序是：先完成 ModelVerse 按量文本候选的协议和效果验证，选择固定型号；再接入共享预算、成本和故障分类；然后在检索样本证明收益时开启独立 Embedding；最后按扫描页质量问题增加云 OCR。任一步骤不通过，都保留“待验证/不可用”状态，当前项目继续按已明确的用户配置运行。是否进一步使用优云智算 GPU 自托管，依据稳定负载、完整成本、服务质量和数据约束另立决策，不作为本方案默认交付项。
