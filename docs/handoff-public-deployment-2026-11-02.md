# Daylight 公网部署交接（2026-11-02）

> **后续已执行（同日升级后）：**服务器已确认 2 vCPU / 3499 MiB；服务恢复健康，用户明确授权的本机整库、系统 SMTP 与 171 附件已迁移，why 正常公网登录及代表性真实功能已验证；用户确认手机登录、打开邮件及微信内附件图片成功。最新操作和边界见 [本次迁移记录](public-data-migration-2026-11-02.md) 和 STATUS 顶部。以下保留升级前交接原文，不能作为当前账号数或健康状态。

## 1. 用户目标与当前结论

用户希望别人扫码访问 Daylight，并能逐个展示每项功能，暂不要求多人并行处理重任务。

**公网 HTTPS 已部署，用户确认手机扫码能浏览。登录和完整业务体验尚未完成。** 线上使用独立新数据库，没有迁移本机账号、邮箱、密钥、日程或附件。11 月 2 日实读用户数为 0，系统 SMTP 未配置，同时发现 MinIO 和应用 readiness 异常。

用户最后询问“逐项展示用 2 核 / 4 GB 可以吗”，答复：**可以作为少量数据、重任务串行的演示配置，但升级后仍需实测。** 用户没有报告升级完成；最后实读仍是 2 核 / 894 MiB 内存。4 核 / 8 GB 是更有余量的试运行建议，不是用户此次必须采购的档位。

本文件仅整理交接，没有在整理期间连接、修改或重启服务器。最后实连检查时间为 **2026-11-02 16:33 左右，北京时间**。

## 2. 新对话阅读入口和 Git 状态

1. 先读 `AGENTS.md`、`README.md`、`STATUS.md`。
2. 再读本文、[部署细节](public-deployment-2026-10-29.md)、[通用公网方案](public-access.md)。

- 本工作区：`E:\AAAproject\UCloud2609\Daylight`，不能把这个绝对路径写入业务逻辑。
- 当前分支：`feat/public-server-deployment`。
- 本轮没有修改业务代码，没有提交或推送。已有未提交改动：`README.md`、`STATUS.md`、`docs/public-access.md`，新文件 `docs/public-deployment-2026-10-29.md`；本次交接另更新状态、导航并新增本文。保留这些改动。
- 服务器运行的是上传的当前代码镜像，不应假定远程分支已经包含本轮全部文件。

## 3. 公开入口与服务器

| 项目 | 值 |
| --- | --- |
| 公网 IP | `192.0.2.17` |
| 域名 | `daylight.yunforis.com` |
| DNS | 用户截图为 Cloudflare A 记录指向上述 IP，模式“仅 DNS”；部署当天本机、服务器解析均核对成功 |
| 游客页面 | <https://daylight.yunforis.com/campus> |
| 登录 / 工作区 | <https://daylight.yunforis.com/login> / <https://daylight.yunforis.com/app> |
| SSH | root，端口 22，用户此前已授权连接及部署 |
| 部署目录 | `/opt/daylight` |
| Compose 项目 | `daylight` |
| 系统 | Ubuntu 24.04.2 LTS，x86_64 |
| 最后确认硬件 | 2 vCPU、894 MiB 内存、30 GiB 根盘 |
| 工具 | Docker 29.1.3、Compose 2.40.3 |

**本文不保存凭据。** 旧对话曾提供 SSH 密码，已建议更换，但未确认更换完成。`work/remote-deploy.py` 从标准输入读取密码，没有硬编码。新对话若无可用凭据，应请用户安全配置 SSH 密钥或凭据，不要将密码写入代码、文档或日志。`work/deploy-known-hosts` 保存本轮 SSH 主机密钥，继续核对，不要随意清除检查。

## 4. 实际部署配置与运维

栈包含 API、Worker、Scheduler、PostgreSQL 17.6、Redis 7.4.5、RabbitMQ 4.1.4、MinIO、Caddy 2.10.2；迁移、建桶为一次性任务。

**必须保留当前三份 Compose 和同一环境文件、项目名：**

```text
/opt/daylight/docker-compose.yml
/opt/daylight/compose.lowmem.yml
/opt/daylight/compose.https.yml
/opt/daylight/deploy/compose.env
```

不能直接套通用 `deploy/up.sh`，否则可能改变卷映射、资源设置和公网端口。服务器环境文件权限 600，服务密码及 JWT 随机生成，没有复制本机私人配置。

运维入口 `/opt/daylight/manage.sh` 固定上述配置：

```sh
sudo /opt/daylight/manage.sh ps
sudo /opt/daylight/manage.sh logs --tail 80 api
sudo /opt/daylight/manage.sh logs --tail 80 minio
sudo /opt/daylight/manage.sh stop
sudo /opt/daylight/manage.sh up -d --no-build --pull never --wait
```

root 可省略 sudo。普通控制台账号曾因 Docker socket 权限不足报错，应使用 sudo，不要改成全员可写。容器 unhealthy 不会单凭 `restart: unless-stopped` 自动恢复。

### 数据和网络

- 首次 PostgreSQL 初始化被重启打断，旧卷 `daylight_postgres-data` 缺少系统数据库；已保留旧卷，当前使用 **`daylight_postgres-recovery-data`**，不要误切回旧卷。
- 数据库、附件、队列、缓存、指标、Caddy 证书使用命名卷。保留数据，操作前核对卷；不要执行 `down -v` 或清理卷。
- 网站公开 TCP 80/443；API 3000、数据库等宿主机端口绑定回环，SSH 保持原配置。
- 独立入口网段 `172.30.255.0/29`，Caddy 固定 `.2`、API 固定 `.3`，API 仅信任代理 `.2/32`。曾因 API 动态抢占 `.2` 导致代理无法启动，已修复，勿取消固定地址。
- Caddy 自动申请/续期 Let's Encrypt 证书，HTTP 308 跳转 HTTPS，gzip/zstd；无证书联系邮箱，可后续补。自动续期依赖 DNS、80/443、出站网络和证书卷，尚未经历续期验证。

### 小内存临时调整

- 4 GiB `/swap-daylight` 已加入 fstab；原 `vm.swappiness=0`，已设为 60，文件 `/etc/sysctl.d/90-daylight-swap.conf`。
- API / Worker Node 堆上限 192 MB，Scheduler 96 MB。**升级到 4 GB 后应重新评估上限**，否则 PDF/OCR 仍可能触及过低堆限制；堆上限不等于整个进程内存。
- PostgreSQL shared buffers 32 MB、work mem 2 MB、maintenance work mem 16 MB、max connections 40。
- RabbitMQ 限制 Erlang scheduler；MinIO GOMEMLIMIT 120 MiB（软目标）、GOGC 50，实际 RSS 可以更高。
- 应用健康检查间隔 60 秒。交换空间和服务调优不构成容量保证。

## 5. 部署过程与镜像来源

1. 检查空服务器，安装 Docker/Compose，增加交换空间；本机构建前端成功，保留既有大包提示。
2. 上传排除私人数据的源码与 dist。服务器 npm 安装 ECONNRESET，本机重新联网安装也失败。
3. 改用本机已有 `daylight:delivery-20261028` 的 Linux 依赖层；核对当前 lockfile 所需 Linux x64 glibc 生产依赖版本一致，覆盖当前代码、scripts 和 dist，关键模块与 PDF.js import 通过。
4. 导出上传 `daylight:ip-trial`。标签含 ip-trial，但实际已通过域名 HTTPS 使用。
5. 默认 MinIO 标签无法从所试镜像源获取，导入本机此前验证的兼容缓存镜像，二进制实际为 `RELEASE.2025-04-22T22-12-26Z`。这不是本次官方全新拉取，旧版本支持、安全与供应链需后续处理；未复用其他项目数据卷。
6. 修复被重启打断的 PostgreSQL 初始化、入口 IP 抢占，最终迁移和建桶成功、8 服务 healthy、证书签发成功。
7. 11 月 2 日因用户反馈登录问题重新检查，查到 0 账号及后台故障，**尚未执行这轮故障修复或数据迁移**。

应用镜像 ID：`sha256:d5860e1ff49b78df21b592036e4dcb04c36a30b60c5e238664ab5ece44d18311`。

`work/daylight-app.tar.gz` SHA-256：`8dcbafffcb07bf5b3b83caf0baa22855b481bfd9f5ea95d9fc890be9680dd260`，上传前后相同。详见 10 月 29 日部署记录中的镜像来源说明。

## 6. 验证按时间区分

### 2026-10-29 部署完成时

- 8 个常驻服务 healthy；迁移与建桶退出 0。
- 外网 `/campus`、readiness、校园目录 200，目录 109 地点；匿名私人状态与管理员目录 401。
- `requireAuth:true`、`allowLocalDemoLogin:false`、`systemMailReady:false`。
- Let's Encrypt 证书 SAN 覆盖域名，检查时有效期至 2027-01-27；HTTP 自动跳 HTTPS。
- 独立 Edge 390×844，地图真实加载，无 pageerror，无整页横向溢出。
- `npm run share:qr` 真实 HTTPS 和鉴权边界检查通过，生成二维码。
- 没有云端完整业务、容量、备份恢复或生产验收结论。

### 手机扫码

11 月 2 日用户明确确认手机扫码能访问 Daylight 页面。补足了手机真实访问证据，但不代表所有移动交互或登录业务通过。

### 2026-11-02 16:33（最近实读状态）

| 项目 | 结果 |
| --- | --- |
| uptime / load | 约 4 天 2 小时；load 约 0.57 / 0.33 / 0.28 |
| 内存 | 总 894 MiB，used 728 MiB，available 166 MiB |
| Swap | 使用 361 MiB / 4 GiB；短时 vmstat 后两次 si/so 为 0，不能称为已证明持续严重换页 |
| 根盘 | 用约 12 GiB，余约 17 GiB |
| PostgreSQL | healthy，`SELECT count(*) FROM users` = **0** |
| Redis / RabbitMQ / Caddy | healthy |
| API / Worker / Scheduler | unhealthy；API readiness `ok:false` |
| MinIO | ps 显示 Up/unhealthy，top 无进程，stats 0B / 0B，健康日志 `cannot exec in a stopped state` |
| API / Worker / Scheduler / Caddy | RestartCount 0、OOMKilled false |

**MinIO 故障根因尚未确认。** 不能直接断言因内存 OOM；下一轮需检查完整容器 State、Docker/containerd 和内核日志。页面可见不代表 readiness 可用。旧二维码报告不能证明当前后端健康。

## 7. 登录与配置缺口

线上没有账号，本机账号没有迁移；演示免登录有意关闭。系统 SMTP 未配置，普通访客无法自助注册。

**恢复登录不必导入整个本机数据库。** 可以先创建线上管理员。现有 `scripts/bootstrap-admin.js` 支持生产 PostgreSQL，使用 `manage.sh run --rm api ...` 沿用三份配置；创建前取得用户的管理员邮箱、用户名和安全密码设置方式，不写明文密码到文档/日志。已有账号登录仍需图形验证码，登录本身不依赖 SMTP。

用户若需要本机历史邮件、日程、账号和附件，再确认迁移范围并备份、保持一致性，不要擅自全部上传。邮箱、模型、Embedding/OCR、外部日历/飞书等按要展示的功能分别配置。系统 SMTP 供注册验证码和找回密码，与私人工作邮箱发信分开。

## 8. 资源建议的最终口径

| 配置 | 适用范围 |
| --- | --- |
| 2 核 / 1 GB | 修复后可观察公开页临时展示；当前不适合承诺完整体验 |
| **2 核 / 4 GB** | 用户逐项展示、少量数据、任务串行时可以尝试；没有实际升级与验证结果 |
| 4 核 / 8 GB | 更有余量的完整试运行建议，不是逐项演示必须买的档位 |

现有 30 GiB 盘尚余约 17 GiB，少量演示可先保留并监测，有条件扩到 60–80 GiB；保留 swap，公网 3–5 Mbps 起步。外部模型 API 不需要 GPU。2 核的 PDF/OCR 可能较慢，避免同时同步邮箱、OCR 和重建索引。升级硬件不会自动恢复服务、创建账号或导入配置。

## 9. 后续工作顺序

1. 确认服务器是否已升级，重新实读硬件；不要默认已经是 4 GB。
2. 核对并保存现有三份配置及卷映射，必要时备份。定位 MinIO 与 Docker/runtime 状态，恢复全部 readiness；不要重建数据库掩盖故障。
3. 如已升 4 GB，评估并调整为 1 GB 设置的进程堆等限制，验证代表性 PDF/OCR 任务。
4. 创建管理员并实际验证登录、权限；需要注册展示时再配置并验证系统 SMTP。
5. 按用户授权配置邮箱和模型，验证少量真实业务；模型费用、外发邮件等按用户授权范围执行，不自动复用本机私人 Key。
6. 准备逐项演示：校园、账号、邮件、日历待办、助手、招聘简历、发票、检索引用、模板、后台管理；缺外部授权及数据的功能列明。预置与真实结果分开标注。
7. 更新 README / STATUS / 部署记录，记录云端实测，不承诺未经测试的并发、长稳或生产就绪。

当前请求仅为整理交接，上述待办没有在本次整理中执行。

## 10. 本地临时材料

这些在 `.gitignore` 的 `work/`，重新克隆或换电脑可能不存在，按需保留；服务器文件可能后续变化，以实际文件为准。

| 文件 | 用途 |
| --- | --- |
| `remote-deploy.py` / `deploy-known-hosts` | SSH 上传、执行及主机密钥；密码仅标准输入 |
| `compose.lowmem.yml` / `compose.https.yml` | 专用 Compose 覆盖 |
| `Caddyfile.trial` / `remote-manage.sh` | HTTPS 配置、三份 Compose 运维入口 |
| `Dockerfile.upload` | 依赖层复用镜像；构建时需专用 dockerignore 允许 dist 进入上下文 |
| `daylight-app.tar.gz` | 当前应用镜像，约 324 MB |
| `daylight-minio.tar.gz` | 缓存对象存储镜像，约 140 MB |
| `daylight-server-source.tar.gz` / `deploy-source-manifest.json` | 源码与 dist 上传包、摘要，不含私人数据 |
| `daylight-public-qr.png` / 相邻 `.png.json` | 二维码、10 月 29 日验证报告 |
| `public-deploy-http-verification.json` / `public-deploy-ui-verification.json` | 部署当天 HTTP、TLS、浏览器记录 |
| `daylight-public-mobile.png` / `verify-public-ui.mjs` | 部署当天截图、验证脚本 |

服务器 `/opt/daylight-build.log`、`/opt/daylight-pull-deps.log` 等是首次部署过程日志，读取限范围并脱敏。最初构建失败不等于最终导入镜像失败。

## 11. 可复制到新对话的提示

> 请继续 Daylight 公网部署与功能演示工作。先读 AGENTS.md、README.md、STATUS.md、docs/handoff-public-deployment-2026-11-02.md。域名 daylight.yunforis.com，服务器 192.0.2.17，目录 /opt/daylight，manage.sh 固定三份 Compose。手机扫码已能浏览，但线上用户数为 0、SMTP 未配置，11 月 2 日发现 MinIO 和应用 readiness 异常，尚未修复。目标是逐项展示功能，计划使用 2 核 / 4 GB，请先确认是否已升级，再恢复服务、登录和演示。保留所有数据卷与本机私人数据，不要直接套通用 up.sh 或导入整套本机数据库。凭据通过安全方式另行提供，不写入文档或日志。
