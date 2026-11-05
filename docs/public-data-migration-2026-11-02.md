# 2026-11-02 公网业务数据迁移与手机体验

## 访问

- 登录：<https://daylight.yunforis.com/login>；工作区：<https://daylight.yunforis.com/app>。
- 本轮将本机已有账号（含 `why`）迁至公网，密码哈希原样保留。密码和其他凭据不记录在本文。
- 扫登录页二维码后填写账号、密码和当次图形验证码。手机侧栏底部可切换校园邮箱、QQ 邮箱或混合视图；招聘、发票和邮件按邮箱显示。
- 新二维码及 HTTPS 检查报告：`work/daylight-why-login-20261102.png`、同名 `.png.json`。二维码仅含登录 URL，不含账号或令牌。

## 硬件及服务恢复

17:22 左右实读 2 vCPU、3499 MiB 内存，4 GiB swap，根盘 30 GiB。升级后的主机已重新启动，8 个常驻服务均 healthy；MinIO 已有实际进程和正常探针。此前故障没有足够日志证据可归因为 OOM，不对历史根因补作推断。

继续沿用 `/opt/daylight/manage.sh`、三份 Compose、原环境文件、`daylight_postgres-recovery-data` 和 `daylight_minio-data`。没有清空或删除卷。调整 `compose.lowmem.yml`：API 堆上限最终为 1024 MiB、Worker 768 MiB、Scheduler 192 MiB，迁移/建桶 256 MiB；PostgreSQL shared buffers 128 MB、work mem 4 MB、maintenance work mem 64 MB、max connections 60；MinIO Go 软目标 256 MiB。单个 Worker 串行取任务，不据此承诺并行容量。

17:46 左右 API 在多次浏览完整历史后触及初始设置的 512 MiB Node 堆限制，日志为 `Reached heap limit`，容器自动重启 1 次，`OOMKilled:false`。系统仍有约 1.3 GiB available、swap 使用为 0；因此将 API 堆调为 1 GiB，并在最终镜像复核。不能把升级后的全部运行过程描述为从未重启；大量 trace/整份快照的内存成本仍需后续优化及容量测量。

## 迁移方法与完整性

本机 `data/runtime/environment.json` 指定的 PostgreSQL 是权威来源；没有从旧 JSON 缓存重建数据。迁移时本地应用角色未运行，没有 running 任务，数据库使用 `pg_dump` custom 快照。

| 快照集合 | 数量 |
| --- | ---: |
| users | 2 |
| app_settings | 33 |
| mailbox_calendars | 5 |
| rag_chunks | 619 |
| daylight_jobs | 1553 |
| daylight_job_steps | 45 |
| daylight_job_outbox | 1605 |
| daylight_job_mailboxes | 2 |
| password_resets | 0 |

- 两个账号为原管理员和 `why`，原账号 ID、邮箱归属、工作台、模型/Embedding 配置、日历待办、邮件、招聘、发票、追踪记录与索引一并保留。
- `why` 两个邮箱在快照时共有 100 封已入库邮件、56 个日程、10 个待办。另有旧邮箱/默认邮箱的历史数据随整库保存，未擅自将它们转让给 `why`。启动自动同步后这些数量会增长。
- 171 个引用对象从原阿里云 OSS 读取，193,841,391 字节；上传至服务器私有 MinIO，逐个回读并比对大小、SHA-256，全数通过。对象 key 保留，298 处附件描述改为当前 `s3` 存储与受鉴权的站内代理 URL；没有改邮件正文。
- 数据库恢复使用 `pg_restore --single-transaction --clean --if-exists`，应用写入者先停止。恢复后、任何适配之前，9 张表的行数及排序后的逐行 JSON SHA-256 全部与本机相同。
- 本机 2 个 queued 历史任务只在服务器副本标记 cancelled，保留 `MIGRATION_NOT_REPLAYED` 原因，不重放；其余历史任务保留。本机原任务和数据不变。
- 系统 SMTP 从本机生产环境迁移到服务器权限 600 的 `deploy/compose.env`，公开根地址继续是正式 HTTPS 域名。JWT、数据库/队列/MinIO 密码仍使用服务器各自配置；不迁移浏览器会话，需重新登录。
- 迁移前服务器数据库 custom dump、MinIO 冷备和部署配置在 `/opt/daylight-backups/before-local-import-20261102/`，带 `SHA256SUMS`。本机迁移材料仅在被忽略的 `work/` 中，含私有数据，不应提交或公开。

## 本轮真实验证

| 项目 | 结果与范围 |
| --- | --- |
| 公网鉴权 | 浏览器通过正常图形验证码，以 why 原密码登录进入 `/app`；用户已确认真实手机扫码、登录和打开邮件成功；匿名 `/api/state` 401；生产免登录关闭 |
| 两个邮箱 IMAP | 服务器真实连接、认证及打开 INBOX 成功；不是仅保存字段 |
| 两个邮箱 SMTP | 服务器 TLS 连接与认证成功 |
| 系统 SMTP | TLS/认证成功，经用户当次授权发送纯测试邮件至 why 的 QQ 邮箱，实际在 INBOX 查到 |
| QQ 自发自收 | 经用户当次授权发出另一封纯测试邮件，实际在 QQ INBOX 查到；QQ Sent 也能查到。首次按 Message-ID 查找未命中，后续读取最近信封按专用主题和时间确认，两封均已到达 |
| 模型 | `deepseek-v4.1-flash` 普通对话与 JSON Object 请求真实成功 |
| Embedding | `qwen3-embedding-8b` 返回 4096 维有限数值向量 |
| 小 D | 390×844 公网页面发起真实调用，收到“公网助手连接正常”；没有要求其调用写入或发信工具 |
| 知识检索 | 使用 why 账号上下文和生产存储快照，真实返回 hybrid、3 命中、3 引用；未在报告中导出邮件片段 |
| PDF/OCR | 服务器运行项目 `extractPdf`，原创扫描测试 PDF 实际 OCR 1 页、92 字符，约 8.5 秒；不是 mock OCR |
| 附件预览 | QQ 发票页面可见原有 11 张模拟票据，站内鉴权读取迁移后的 PDF，390×844 预览实际显示 1/1 页；票据沿用“虚构/不可报销”标注。校园邮箱真实新图片、迁移旧图片及旧 PDF 在公网浏览器预览成功（图片为 blob 且 naturalWidth > 0，PDF 为 1/1 页、有 canvas）。用户随后确认微信内打开，现在能看到附件图片；真机 PDF 未单独确认 |
| 移动布局 | 总览、日历、招聘、发票页面 DOM 测得宽度与 scrollWidth 均 390；侧栏、邮箱切换和 PDF 预览可操作 |
| 自动同步 | 启动后由 Scheduler/Worker 实际拉取新邮件并调用模型，邮件/日程/待办数量出现正常增长；不是仅运行健康探针 |

## 补充运行依赖

原镜像缺少 PPT/PPTX 转 PDF 所需 LibreOffice。本轮在原应用镜像之上安装 `libreoffice-impress`，源码 Dockerfile 同步补入此依赖。构建仅更换系统运行依赖，原 Linux Node 依赖层与应用版本来源见 [首次部署记录](public-deployment-2026-10-29.md)。OCR 使用本机已有的英/中文语言包，避免演示首次执行依赖 CDN 下载。

服务器实际 `soffice` 为 7.4.7.2；项目转换函数对原创 PPTX 完成 PDF 转换并解析出 1 页及预期文字，约 10 秒。容器入口为各角色的可写临时目录填充中英文 OCR 语言缓存，启动后实际检查文件存在。

## 手机附件反馈与修复跟踪

用户先确认登录和邮件正文可用，但校园邮箱普通邮件点“预览”出现“请先登录”。实读该邮箱 88 个普通邮件附件描述，均为站内 `/api/attachments` 地址及 `s3` 存储，没有遗留的 OSS 直链或 localhost 来源；原迁移对象回读摘要均一致。公网浏览器同邮箱新旧图片及旧 PDF 可成功预览。发布后用户明确回复“微信打开，现在可以看到附件图片了”。没有取得原报错截图或请求记录，故不将原预览故障的根因确定为 OSS 或下载入口。

另发现附件列表的“下载”原为直接导航受保护 API，浏览器导航不会带 Bearer，已改为带鉴权读取后保存 blob；弹窗下载共用此实现。专项测试 `node --test server/attachment-download.test.js server/attachment-preview.test.js` 6/6 通过，构建通过（55 秒，保留原大包提示）。下载入口修复与用户微信图片恢复分别记录，没有据此推断原预览报错的唯一根因。

18:00 左右正式发布 `daylight:public-20261102-attachments`，镜像 ID `sha256:69dfd8fbad6202c03c8c79f58325a6f1982fda90e7df346e7caeddb7c8ee027f`，包含 LibreOffice、OCR 缓存及附件下载改动。旧镜像和更新前环境备份保留。公网实际下载旧校园 PDF 为 99,535 字节、文件头 `%PDF-`；发布后再预览显示 1/1 页，截图在 `work/public-campus-attachment-preview-20261102.jpg`。

18:02 复查 why 为 QQ 41 封、校园 81 封邮件，共 62 日程、13 待办；迁移后已有 50 个成功同步任务。最终三个应用角色 restart=0、OOM=false，8 个常驻服务 healthy，主机 available 约 1379 MiB、swap 为 0。双端浏览及后台同步期间 readiness 曾超时返回 503（约 5.7 秒），18:04 再次为 200（0.175 秒）；保留此资源争用记录，不将短时健康视为长稳或并发验收。

## 验收边界

这是同一套业务数据的单节点公网迁移和代表性功能实测。用户已确认手机扫码后登录、打开邮件、微信内查看附件图片成功。浏览器 390×844 验证不能称为真实 iPhone/Android 全量测试。

没有据此宣布生产验收、多人并发容量、长期稳定、每一种附件/邮件格式和全部第三方集成都通过。飞书、外部日历等虽然保留原配置，本轮没有创建真实会议或对外发邀约；学校教务/Piazza/Blackboard 的本机 Chrome Cookie 不会随数据库搬到 Linux 服务器，相关本机同步入口仍有平台限制，可使用已导入资料和现有连接器/手动导入路径。普通注册需要当次验证码流程，本轮系统 SMTP 投递成功不等于已逐个测试注册及找回密码流程。
