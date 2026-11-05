# 让别人扫码访问 Daylight

## 当前交付与访问方式

**2026-11-02 更新：**已在原公网服务器升级后完成本机业务数据迁移及 why 登录，系统 SMTP 真实测试邮件到达，代表性模型/邮箱/OCR/检索和移动宽度页面通过。当前环境、备份位置、登录方式及仍需分别验证的第三方功能见 [本轮迁移记录](public-data-migration-2026-11-02.md)。下方 10 月 29 日“尚未配置 SMTP/账号”的描述是首次部署历史状态。

二维码保存的是一个网页地址。要让不同网络中的手机都能打开这个地址，需要一台持续运行的公网服务器、稳定域名和 HTTPS。新增的校园指南 `/campus` 是游客页面；邮箱、日程、招聘、管理后台等私人工作区继续要求登录。分享按钮可显示二维码、复制链接和下载 PNG，不会自动开通云资源或把本地电脑发布到互联网。

本方案使用现有的 API、Worker、Scheduler、PostgreSQL、Redis、RabbitMQ、MinIO Compose 栈，在前面增加 Caddy，自动签发和续期 HTTPS 证书。公网只需开放 TCP 80/443；API 的原宿主机端口被强制绑定到 `127.0.0.1`，数据库等依赖仍只绑定回环。助手 SSE 由代理即时转发。

**状态边界：** 2026-10-29 已在用户服务器完成 [daylight.yunforis.com/campus](https://daylight.yunforis.com/campus) 的单节点试运行，真实 HTTPS 和本机外网浏览器检查通过；具体低内存调整及限制见 [部署记录](public-deployment-2026-10-29.md)。手机移动网络扫码、容量、长稳与完整生产验收尚未完成。以下通用配置仍以 4 vCPU / 8 GiB 起步建议为准。

### 游客访问、账号与注册的区别

可以先开放游客校园指南，再开通普通用户注册。**匿名浏览不需要系统 SMTP，也不需要先创建账号或连接私人邮箱。** 生产鉴权应保持开启，保护个人邮箱、日程与管理员接口；它不会要求游客登录后才能浏览 `/campus`。

| 使用方式 | 是否登录 | 是否需要系统 SMTP | 当前可用范围 |
| --- | --- | --- | --- |
| 游客扫码访问 `/campus` | 否 | 否 | 公共地图、地点、活动、路线、餐饮和社区浏览；游客个人安排保存在当前浏览器 |
| 首个管理员维护资料 | 是，通过第 3 节在数据库创建管理员 | 否 | 登录、导入目录、维护地图与活动、审核来源等 |
| 已有账号登录 | 是 | 否 | 登录仍需图形验证码；校园资料可随账号同步，互动与签到按接口权限执行 |
| 普通访客自助注册 | 注册时验证邮箱 | **是** | 图形验证码、系统邮件验证码与有效注册信息缺一不可 |
| 忘记密码后通过邮件恢复 | 无需先登录 | **是** | 需实际收到恢复邮件并使用有效链接 |
| 连接私人工作邮箱、调用模型 | 按业务登录 | 与系统 SMTP 分开配置 | IMAP/个人发信、模型及 OCR 能力按各自配置和权限执行，不是游客浏览的前提 |

`deploy/public/up.sh` 默认生成 `DAYLIGHT_SYSTEM_MAIL_ENABLED=0`。它不会发送邮件，也不会把 SMTP 配置当成启动或二维码校验门槛。`/api/auth/config` 中 `requireAuth:true`、`allowLocalDemoLogin:false` 与 `systemMailReady:false` 可以同时成立，表示正式鉴权开启、系统发信未配置；这时公共页面仍可用。

本公开部署仍使用完整生产基础设施栈。即使暂时只接待游客，也需完成 Compose 的数据库、缓存、对象存储等依赖初始化与健康检查；不配置 SMTP 不会把系统切换为纯静态网站。

## 1. 准备资源

以下收费资源由你自行选择、购买和续费，脚本不会触发购买。

| 项目 | 试运行建议 | 说明 |
| --- | --- | --- |
| UCloud 云主机 | Ubuntu 24.04 LTS，4 vCPU、8 GiB 内存 | 是单节点试运行参考，不能据此承诺并发容量；OCR、邮件同步与模型调用需实测 |
| 系统/数据盘 | 至少预留约 60 GiB 可用空间，再按附件量扩容 | 数据库、MinIO、构建缓存与日志都会占用空间；应配置磁盘用量告警 |
| 公网 IP 与带宽 | 固定公网 IP、按预计访问量选带宽 | 用户需承担云主机、磁盘、公网流量等费用；模型与邮件服务另算 |
| 域名 | 自己控制的域名，例如 `daylight.你的域名` | 中国大陆公开网站应按云服务商和监管要求完成备案；准备资源时确认可用性 |
| Docker | Docker Engine + Compose 插件 **≥ 2.24.4** | 本方案使用 `!override` 替换 API 端口，旧版 Compose 会被脚本拒绝 |
| 其他工具 | Git、`sh`、`openssl`、`curl` | 无需宿主机安装 Node.js 或数据库 |

单台主机仍有单点风险，MinIO 也没有跨主机副本。长期运营需按负载补备份恢复、托管对象存储、数据库高可用与入口冗余，并测量延迟、资源、成本和恢复时间。

### UCloud 起步选型

在 [UCloud 控制台](https://console.ucloud.cn/) 先保存一份报价单，再创建以下资源。选同一地域，优先选择靠近主要用户、模型服务和邮箱出口延迟较低的地域；中国大陆地域还需核对域名备案与接入条件。

| 控制台资源 | 首次试运行的选择 | 后续调整依据 |
| --- | --- | --- |
| VPC / 子网 | 一个专用于 Daylight 的私有网络和子网，记录地域、可用区与网段 | 后续数据库、缓存、消息队列与应用尽量走同地域私网 |
| 云主机 UHost | 一台通用型或计算与内存均衡机型，**4 vCPU / 8 GiB，Ubuntu 24.04 LTS，x86_64** | 按 API p95、CPU、RSS、任务等待时间与并发同步实测升级或拆分 Worker |
| 系统盘 / UDisk 数据盘 | 系统盘用于系统及镜像；持久化数据合计至少预留约 **60 GiB 可用空间**，按附件增长另配数据盘 | 监测 PostgreSQL、附件、镜像与日志各自占用，按备份恢复和增长量扩容 |
| 弹性公网 IP EIP | 固定公网地址绑定 UHost；询价时可比较 **5 Mbps 固定带宽**与按流量计费方案 | 带宽数值仅为询价起点；集中扫码与附件下载需要真实压测，再按出口峰值和账单选计费方式 |
| 安全组 | 入站 80/443 对游客开放；SSH 限管理地址；依赖端口留在私网或回环 | 使用到托管服务时按应用来源增加最小范围的私网规则 |
| 域名 / DNS | 使用自己控制的域名，添加指向 EIP 的 A 记录 | 后续换入口 IP 时保留域名，原印刷二维码可继续使用 |
| 备份存储 | 将数据库备份、附件副本放到与该 UHost 不同的故障域，例如私有 US3 桶 | 按保留周期、恢复目标和实际附件量计费；试运行阶段也要实际恢复一次 |

Compose 命名卷默认存放在 Docker 的数据目录。新空机若使用独立数据盘，应在首次启动前完成开机挂载和 Docker 数据目录规划；已有部署应先备份，并按 Docker 的数据迁移流程操作。单独购买数据盘不会自动移动现有卷。UCloud 的机型、磁盘类型、托管数据库引擎与可售地域，以创建时控制台显示为准。

### 月费用怎样估算

这里不填实时价格。计费地域、购买时长、活动优惠、公网计费方式和模型供应商都会改变报价。用控制台当日的含税报价与实际账单填写下表，分别记录“购买前估算”和“上线后实测”：

| 费用项 | 计算方法 | 数据从哪里取 |
| --- | --- | --- |
| UHost | 包月报价，或实例小时单价 × 实际运行小时 | 选定机型的订单报价；整月按实际月份小时数计算 |
| 系统盘 / 数据盘 | 每 GiB 月单价 × 配置容量，或控制台给出的磁盘总价 | 系统盘是否已含在实例价内需核对，避免重复计算 |
| 公网 EIP | 固定带宽套餐价，或公网出站流量 × 流量单价，再加实际适用的 IP/保有费用 | EIP 计费说明、网络监控与账单；两种计费方式分开比价 |
| 备份 / 对象存储 | 平均存储量 × 存储单价 + 请求次数费用 + 实际外网下载流量费用 | 数据库备份大小、附件增长、保留天数及 US3 账单 |
| 域名 / 可选服务 | 域名年费 ÷ 12；另计实际启用的 CDN、付费证书或监控 | 域名与服务订单；本方案 Caddy 使用 ACME 自动证书，无单独软件许可费 |
| 模型 | 输入 token / 计费单位 × 输入单价 + 输出 token / 计费单位 × 输出单价；embedding、OCR 另按各服务规则 | Daylight trace / 成本记录及模型服务商账单；同一请求可能包含多轮工具调用 |
| 邮件与地图 | SMTP 套餐或实际发送量；地图瓦片 / API 按供应商规则 | 邮件服务与地图授权方案；浏览器直连第三方瓦片按其用量另计 |

例如，只为估算**本站静态资源出站量**，假设每天 1,000 人访问、每人从本站下载 4 MB、每月 30 天，则约为 `1,000 × 4 × 30 / 1,000 = 120 GB/月`（按十进制 MB/GB）。这不是 Daylight 的实测流量，也未包含附件下载、服务端模型流量或第三方地图请求。缓存命中率和手机重复访问会改变结果，应在试运行后替换为账单数据。

月总预算为以上实际启用项目之和。采购前同时记录域名续费与云资源续费价，在 UCloud 和模型供应商侧设置预算提醒；试运行后按每天活跃人数、每次同步成本、每次助手请求成本与出口峰值复核。无需为了未来容量一次购买全部托管组件。

### DNS 与安全组

1. 将域名的 A 记录指向服务器公网 IPv4。只有服务器确实具备公网 IPv6 时才设置 AAAA；错误的 AAAA 会造成部分手机连接失败。
2. 云安全组放行入站 **TCP 80、443**。SSH 22 仅允许自己的管理地址。
3. 在服务器防火墙上允许相同端口。不要开放数据库、Redis、RabbitMQ、MinIO 控制台或 API 的 3000 端口。
4. 保持出站 DNS、HTTP/HTTPS 可用，用于镜像、系统包、ACME 证书、模型等；邮箱还需相应 IMAP/SMTP 出站端口。
5. 如域名配置了 CAA，确保允许 Caddy 使用的证书颁发机构；先直接解析到服务器，完成验证后再考虑 CDN。

检查 DNS 后再启动。Caddy 通过 80/443 完成域名控制权验证，证书签发依赖真实 DNS 和网络，填写域名本身不等于证书已经可用。

### 反向代理信任与入口网段

公开覆盖文件为 Caddy 与 API 增加独立的 `public-ingress` 网络，默认网段 `172.30.255.0/29`，Caddy 固定地址 `172.30.255.2`。API 只信任该 Caddy 地址的 `/32` 转发头；数据库、Worker 等继续使用原内部网络。应用默认关闭代理信任，不能把 `DAYLIGHT_TRUST_PROXY` 设置成 `true`、跳数、通配符或所有地址网段。

Caddy 在此配置下按直接连接来源处理请求，默认忽略并覆盖来自不可信客户端的 `X-Forwarded-For` 等转发头，再把连接信息传给 API。请先让域名直接解析到这台入口；将来加入 CDN 或其他负载均衡时，需要同时明确上游代理地址范围和来源校验，再调整两层信任策略，不能直接相信互联网提交的头。

如果 Docker 报该网段与现有 Docker/VPC 路由重叠，先核对服务器已有网络，再选择无冲突的私有网段，并**同时**调整入口网段和 Caddy 在其中的未占用地址。例如，确认下面的替代网段在自己的环境可用后执行：

```sh
sh deploy/public/up.sh --domain daylight.你的真实域名.cn --email 你的联系邮箱@example.cn \
  --ingress-subnet 172.30.254.0/29 --proxy-ip 172.30.254.2
```

示例替代值不是自动保证可用的网段。脚本校验 IPv4、私有网络、网段边界及地址归属，并排除网络、默认网关和广播地址，Docker 再检查实际分配与冲突。两项写入权限 `600` 的 `.public` 配置，重跑时按“命令参数 → 已导出的同名环境变量 → 既有 `.public` → 默认值”的顺序选择；读取旧文件仅解析这两个键，不作为 shell 脚本执行。之后使用同一配置文件、项目名和网络值更新与回滚，只改其中一项可能导致校验失败。已有部署变更网络可能重建连接，安排在维护窗口进行。

## 2. 在新服务器安装

先按 [Docker 官方 Ubuntu 安装步骤](https://docs.docker.com/engine/install/ubuntu/) 装好 Engine 与 Compose 插件。使用具备 Docker 权限的终端执行：

```sh
git clone https://github.com/why121368/Daylight.git
cd Daylight
# 切换到已发布且包含本次代码的版本；若代码尚未推送，请先发布/复制当前项目。
# git checkout <已发布的版本或分支>
docker version
docker compose version

# 将下面两项改为你实际控制的域名与证书联系邮箱。
sh deploy/public/up.sh \
  --domain daylight.你的真实域名.cn \
  --email 你的联系邮箱@example.cn
```

示例命令中的中文与示例域名需要替换，脚本使用 ASCII 域名；国际化域名请使用 DNS 中实际的 Punycode 名称。安装必须包含本次公开访问代码；合并前以包含 `deploy/public/up.sh` 的分支或发布版本为准，代码仓库的旧分支不会自动获得新脚本。

首次运行会生成 `deploy/compose.env`，保存各服务独立随机密码与 JWT secret（权限 `600`），并生成 `deploy/compose.env.public`，保存公开域名、证书联系邮箱、Caddy 镜像及入口网段/IP 等非密钥配置。两者都由现有忽略规则保护。脚本依次校验 Compose、构建、启动、检查容器健康，再探测公共 HTTPS readiness。它不会改 DNS、安全组或注册管理员。

需要先检查配置时追加 `--check`。该模式可能生成缺失的配置文件，但不构建镜像、不启动服务，也不验证公网连通。

### 复用已有 Compose 部署

必须使用原来的配置文件和 **同一个项目名**，以复用原命名卷：

```sh
sh deploy/public/up.sh \
  --domain daylight.你的真实域名.cn \
  --email 你的联系邮箱@example.cn \
  --env-file /opt/daylight/compose.env \
  --project daylight
```

已有 `compose.env` 的密码、JWT、依赖端口和 API 宿主端口不会重写；公开域名通过第二个配置文件与覆盖文件注入。API 宿主端口会收为回环地址，Caddy 经 Docker 内网访问 API。Worker、Scheduler 和迁移进程也使用相同的公共根地址，供邮件链接使用。不要为同一份数据随意改项目名；新项目名会获得另一组空数据卷。

后续命令统一带两个 Compose 文件。建议设置当前终端变量，并使用封装脚本：

```sh
export DAYLIGHT_ENV_FILE=/opt/daylight/compose.env
export DAYLIGHT_PROJECT=daylight
sh deploy/public/compose.sh ps
sh deploy/public/compose.sh logs --tail 80 caddy
```

使用默认 `deploy/compose.env` 时可以省略 `DAYLIGHT_ENV_FILE`。不要运行会输出完整密钥配置的 `compose config`；只需检查时使用 `config --quiet`。

## 3. 创建首个管理员

无默认管理员密码。下面在容器中交互读取密码，避免把密码放入命令历史：

```sh
sh deploy/public/compose.sh exec api sh -c '
  printf "管理员邮箱: "; IFS= read -r DAYLIGHT_ADMIN_EMAIL
  printf "管理员用户名: "; IFS= read -r DAYLIGHT_ADMIN_USERNAME
  trap "stty echo" EXIT
  printf "管理员密码（至少8位）: "; stty -echo
  IFS= read -r DAYLIGHT_ADMIN_PASSWORD
  stty echo; printf "\n"
  export DAYLIGHT_ADMIN_EMAIL DAYLIGHT_ADMIN_USERNAME DAYLIGHT_ADMIN_PASSWORD
  node scripts/bootstrap-admin.js
'
```

脚本直接在 PostgreSQL 创建管理员。访问 `https://你的域名/admin/login` 登录；重复引导同一邮箱会更新其密码和角色，请在需要时使用。

### 普通用户注册 SMTP

如果当前只想让大家扫码浏览校园指南，保持 `DAYLIGHT_SYSTEM_MAIL_ENABLED=0` 即可，直接进行第 4 节的外网验收；管理员仍可使用上面的账号维护资料。

需要开通普通用户自助注册时，在服务器安全编辑 `compose.env` 中的 `DAYLIGHT_SYSTEM_MAIL_*`，按你的 SMTP 服务填写主机、端口、用户和授权码，并设置 `DAYLIGHT_SYSTEM_MAIL_ENABLED=1`。不要把实际值粘到文档、工单或 Git。465 端口通常使用 `DAYLIGHT_SYSTEM_MAIL_SECURE=1`；587 等 STARTTLS 场景按服务商要求配置，代码在非直连 TLS 时仍要求升级 TLS。

```sh
sh deploy/public/compose.sh up -d --wait api worker scheduler
```

生产系统 SMTP 由环境变量管理。私人工作邮箱的 IMAP/SMTP 由用户登录后在设置页面连接，与系统注册发信相互独立。当前**没有独立的“开放注册”开关或邀请码限制**：系统 SMTP 启用并能投递后，普通访客便可在公开的 `/register` 页面申请验证码并注册。`DAYLIGHT_SYSTEM_MAIL_ENABLED` 控制系统发信，不是独立的注册授权策略；关闭它会停止新验证码邮件和密码恢复邮件，不应把它当成严格的账号准入开关。

按以下步骤完成实际开通：

1. 保存环境文件并运行上述 `up -d --wait api worker scheduler`，让三个进程读取相同新配置。
2. 从外部浏览器打开 `https://你的域名/api/auth/config`，确认 `requireAuth:true`、`allowLocalDemoLogin:false`；`systemMailReady:true` 只说明 SMTP 必填字段齐全。
3. 用自己有权使用且尚未注册的测试邮箱打开 `/register`，填写图形验证码，点击发送邮箱验证码；核对实际收件、发件人、垃圾箱与投递耗时。发送后按页面要求重新填写新的图形验证码，再完成注册。
4. 新账号登录 `/campus`，保存一项个人资料，确认其他账号无法读取；邮箱授权码只在需要使用私人工作区时再连接。
5. 如要开放密码恢复，同样用自有测试账号验证收到的链接使用当前 HTTPS 域名，并完成一次有效期内的恢复流程。

填好字段、看到 ready 或容器健康，都不能替代上述真实邮件投递与注册检查。本次未使用实际 SMTP 发送注册测试邮件。

## 4. 验证与生成二维码

安装结束后先在自己的电脑浏览器访问 `https://你的域名/campus`，再用手机**关闭 Wi-Fi、打开移动数据**访问同一地址。应满足：

- 首页/校园指南正常显示，HTTPS 证书有效。
- 游客浏览校园指南不要求私人邮箱授权。
- 无登录、无私人邮箱授权时，`/api/campus-guide/catalog` 返回公共目录；`/api/campus-guide/me` 返回 `401`。
- 私人工作区要求登录，未登录请求 `/api/state` 返回 `401`。
- `/health/ready` 返回 HTTP 200 与 `ok:true`。
- 使用小 D 时响应可逐步显示；实际模型能力还需要有效模型配置与真实请求验证。

网页分享按钮可以直接复制公开地址或下载 PNG，二维码由浏览器本地生成。在本地电脑访问时会明确标注“本地预览”；二维码不会让 `localhost`、`127.0.0.1` 或内网地址自动变成公网网站。

支持 Web Share 的手机浏览器还会显示“打开手机分享菜单”，可由用户选择系统中的分享目标。浏览器或系统未提供该能力时继续使用复制链接和 PNG；打开系统菜单不代表已向某个联系人发送成功。

活动详情及维护列表还可下载原创活动海报 PNG，包含北京时间、地点、主办方与活动二维码。海报在本机绘制，不读取跨域活动图片；示例、取消、未公开及本地预览状态会标注。长标题或摘要会折行并在固定区域截断，完整内容以活动详情和原通知为准。隐藏活动的维护海报仅供预览，游客无法通过二维码查看该隐藏记录。

也可在**服务器之外**、装有 Node.js 22+ 并已 `npm ci` 的项目目录运行：

```sh
node scripts/public-qr.mjs \
  --url https://你的真实域名.cn/campus \
  --output work/daylight-campus-public-qr.png
```

此脚本默认要求公共 HTTPS，依次检查页面、readiness、匿名私人 API 的鉴权与生产认证配置，通过后生成 PNG 和相邻 `.png.json` 验证记录。DNS 指向私网、证书错误、页面打不开或匿名读到私人状态均会失败，不会生成新的“已验证”二维码。它只能证明运行脚本的那台机器在当时能访问，仍需独立手机试扫；不会证明全国可达、长期可用或性能验收通过。

二维码校验不要求 `systemMailReady:true`，因此可以在尚未开通普通用户注册时验收和分享游客页面。它也不会替你验证 SMTP、注册、模型或私人邮箱的真实服务连接。

已有同名文件时脚本拒绝覆盖，请换输出名保留旧证据。只需排版占位时可显式使用：

```sh
# 本地演示，不是对外可用码；默认输出文件名含 local-preview。
node scripts/public-qr.mjs --url http://127.0.0.1:3000/campus --allow-local-preview

# 公共域名尚未部署时仅生成占位，记录会标为 unverified，不能称为在线。
node scripts/public-qr.mjs --url https://你的真实域名.cn/campus --skip-verify
```

不要将带登录 token、私密 ICS 订阅或密钥的 URL 制成公开二维码。分享 `/campus` 等公开页面即可；二维码不会赋予别人读取你的邮箱的权限。

### 校园图片与公网域名

管理员批量上传使用 `/api/campus-guide/admin/media`，素材读取使用 `/api/campus-guide/media/<UUID>`。目录保存的是绝对图片 URL，素材记录包含上传时的 origin（协议、域名和端口），因此应通过最终 HTTPS 域名上传要公开的图片。上传只保存素材，仍需在地图编辑器预览布点、应用草稿并保存目录；未被公共目录投影引用的素材仅管理员可读。

本机或旧域名素材不会在切换域名时自动改写。迁移时应继续保留原素材地址，或在新域名重新上传并替换目录引用；仅把目录 URL 的域名改掉不足以迁移原素材的公开引用记录。数据库与附件需一起备份，迁移后使用未登录浏览器确认公开图片可读、已撤下引用的图片不可匿名读取。媒体大小和格式说明见 [校园资料维护](campus-guide.md#3-维护地点道路与图像)。

## 5. 持久化、备份与更新

Compose 项目命名卷保留 PostgreSQL、Redis、RabbitMQ、MinIO、指标，以及 Caddy 证书和配置。`up` 或普通重建会复用它们；`down --volumes` 会删除数据，真实部署中不要作为重启步骤。

至少定期做以下备份，并加密放到不同故障域，限制读取权限：

管理页的“导出目录”只导出校园目录，也包含管理员隐藏的活动；它不导出个人安排、反馈、未审核邮件草案或系统配置。导出内容仍需核对公开文字和链接。下方 `pg_dump` 是完整数据库备份，可能包含私人邮件、个人日程、账号密码哈希和邮箱授权码、模型 Key 等运行凭据；`compose.env` 与证书卷也属于敏感备份，均不能作为比赛公开材料、静态网页文件或公开下载附件。

- PostgreSQL：用 `pg_dump` 做可恢复备份，记录备份对应的应用版本。
- MinIO：使用对象存储工具复制原附件，并保留对象 key 及元数据。数据库与附件应在一致的备份窗口保存；需要严格一致时在维护窗口暂停写入。
- 配置：安全保存 `compose.env`、`.public` 及项目名，保留 Caddy 证书卷；密码不能随代码仓库公开。
- 定期在独立环境恢复一次，核对用户、邮件、附件、待办与日程，记录恢复耗时；仅存在备份文件不等于恢复可用。

数据库备份命令示例（输出目录由当前用户拥有，文件不提交 Git）：

```sh
umask 077
mkdir -p /opt/daylight/backups
sh deploy/public/compose.sh exec -T postgres \
  pg_dump -U daylight -d daylight -Fc > "/opt/daylight/backups/daylight-$(date +%Y%m%d-%H%M%S).dump"
```

### 管理员运维概览与只读备份清单

校园生活“维护 → 概览”包含目录与互动汇总、账号数、认证会话、当前 API 进程运行时间与内存、配置布尔状态。账号计数来自当前权威账号存储；“近 24h 活跃账号”仅从**仍存续且会话版本有效**的认证会话去重，已退出或过期会话不会留在该集合内，不能据此当作完整 DAU 或当前在线人数。若会话数量超过扫描上限或依赖不可用，界面报告不可用，不填估算值。

进程内存和运行时间只属于当前响应请求的 API 进程，多实例请求可能落到不同进程；没有汇总 Worker、Scheduler、数据库或整台服务器的资源。配置状态只投影开关布尔值与 SMTP 字段齐全状态，不返回域名、账号、连接串或密钥，且不能替代真实依赖探测。

备份清单默认未配置。需要在管理页查看 `/opt/daylight/backups` 中的文件时，先按上面的命令准备备份目录，再新建一个**仅在服务器保留的** `/opt/daylight/compose.backups.yml`：

```yaml
services:
  api:
    environment:
      DAYLIGHT_BACKUP_DIR: /app/backups
    volumes:
      - type: bind
        source: /opt/daylight/backups
        target: /app/backups
        read_only: true
        bind:
          create_host_path: false
```

在项目根目录定义命令（替换成部署时实际使用的 env 文件和项目名），并在后续每次重建 API 时保留第三个覆盖文件：

```sh
daylight_compose() {
  docker compose \
    --env-file /opt/daylight/compose.env \
    --env-file /opt/daylight/compose.env.public \
    -p daylight \
    -f docker-compose.yml \
    -f deploy/public/compose.public.yml \
    -f /opt/daylight/compose.backups.yml "$@"
}
daylight_compose config --quiet
daylight_compose up -d --wait api
```

如果原 env 文件是项目默认的 `deploy/compose.env`，将上述两个 env 路径分别换成该文件及 `.public`。加入这项自定义配置后，日常维护与更新使用包含三个文件的 `daylight_compose` 命令；基础 `up.sh` / `compose.sh` 使用两个文件，不自动加载这个自选覆盖文件。请将函数保存在受限的运维脚本或管理终端配置中。

API 用户必须对该目录有遍历权限、对文件有读取元信息的权限；保持备份正文权限受限，不为展示清单放宽为全员可读。清单只包含顶层常规备份文件，跳过符号链接、子目录、隐藏文件和 env 文件，仅返回名称、时间和大小，不提供下载、路径参数或在线恢复。目录缺失、权限不足会明确显示不可用；文件存在不证明备份可恢复。

`/api/campus-guide/admin/stats`、`/api/campus-guide/admin/operations` 与 `/api/campus-guide/admin/backups` 均要求管理员，响应使用私有且不可缓存策略。目录导入预览仍只替换目录；完整校园状态还分布在个人文档、反馈、来源草案、社区图片及其他数据库记录中。完整恢复应在独立环境使用数据库、附件、配置和证书的一致备份，按应用版本执行迁移与核对；当前没有将目录导入包装成全系统恢复操作。

更新前备份，检出明确发布版本，保留原项目名、配置与卷，再使用相同入口与完整 Compose 文件组合重建。基础部署可重跑相同 `up.sh` 命令；增加了上面的自选只读备份挂载时，使用 `daylight_compose up -d --build --wait` 保留第三个文件。回滚应用镜像不能自动回滚数据库迁移；先在备份副本上验证迁移兼容与恢复步骤。

### 从单节点到共享服务

先用上面的单节点 Compose 完成真实业务试运行。API、Worker、Scheduler 已有独立进程入口；负载、数据可靠性或维护窗口达到单机约束时，再按下表逐步拆分。现有 `deploy/public/up.sh` 部署的是本机完整依赖栈，**不能仅在 `compose.env` 增加远程 URL 就切换托管服务**：根 Compose 把容器内地址写在 `x-app-environment` 中，还包含本地依赖的 `depends_on`。迁移时需要单独制作并校验外部依赖的 Compose 覆盖文件，或使用 [Kubernetes 交付入口](../deploy/README.md#kubernetes-with-external-managed-dependencies)。

| 拆分项 | UCloud 优先的选择方向 | 代码配置与迁移验证 |
| --- | --- | --- |
| 附件与备份 | 私有 US3 桶，同地域端点；只给应用所需桶和操作权限 | 已有 `us3` / S3 适配。覆盖所有角色的 `DAYLIGHT_OSS_PROVIDER/ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY`；复制对象时保留 key，抽样校验字节和私有下载授权。真实 US3 连通、签名及权限隔离仍需验证 |
| PostgreSQL | 所选地域可用的托管 PostgreSQL，或独立数据库节点；核对版本、连接数、备份和高可用选项 | `DAYLIGHT_DATABASE_URL`，需要时启用 `DAYLIGHT_DATABASE_SSL=1` 并配置可信 CA。先恢复数据副本、跑迁移、核对用户和业务数据，再安排切换；API、Worker、Scheduler、迁移进程必须连接同一权威库 |
| Redis | 所选地域兼容 Redis 协议的托管缓存，或独立持久化节点 | `DAYLIGHT_REDIS_URL`；使用实际支持的鉴权与 TLS 地址。验证验证码、限流、共享状态及故障行为，迁移窗口评估已有验证码与会话辅助状态 |
| RabbitMQ | 当前可售且兼容 RabbitMQ/AMQP 的托管服务，或私网独立 RabbitMQ 节点 | `DAYLIGHT_AMQP_URL`；应用依赖 RabbitMQ 语义，其他消息产品需先做适配。验证重连、确认、任务租约恢复和重复消息幂等后切换，保留 PostgreSQL 持久任务记录 |
| API / Worker / Scheduler | 多台 UHost 或后续 UCloud Kubernetes 集群；共享上述依赖 | Worker 按任务延迟扩容，API 按并发与延迟扩容；Scheduler 副本按现有协调机制验证。共享 JWT secret、公共根 URL、对象存储与模型配置，运行多实例隔离、并发幂等、滚动更新与故障恢复测试 |
| 公网入口 | 将 HTTPS 入口移到独立代理或可用的负载均衡服务，统一证书管理 | 原域名指向新入口；检查健康探针、长连接、SSE 无缓冲、超时及可信代理配置，重新从外网验证二维码和匿名鉴权 |

托管产品的当前供应、协议版本和权限模型需要在购买前核对。本次提供了适配入口与演进步骤，尚未取得 UCloud 托管服务集成通过的结论。Kubernetes 清单也需要镜像发布、Secret、Ingress/证书和真实依赖配置，现有文件不是已安装的集群。

每次切换都先在独立副本完成恢复与故障演练，记录应用版本、备份时间、切换窗口和回滚条件。开始向新存储写入后，回滚必须处理切换后的增量，不能直接让应用回连旧快照。最终验收需补真实依赖连接、跨账号隔离、并发任务幂等、故障恢复、发布回滚，以及延迟、吞吐、资源和成本实测，参见 [云原生建设与比赛验收基线](cloud-native-roadmap.md)。

## 6. 排障

| 现象 | 检查位置 |
| --- | --- |
| 域名解析失败 | A/AAAA、DNS 生效、域名备案/接入要求 |
| Caddy 申请证书失败 | 80/443 安全组与主机防火墙、DNS、CAA、出站网络、`compose.sh logs caddy` |
| `--wait` 成功但公共 HTTPS 探针失败 | 容器健康不含公网证书验证；按脚本提示修复 DNS/TLS，未验证前不发布二维码 |
| API 502 或 readiness 503 | `compose.sh ps` 与 API/Worker/依赖日志，检查磁盘和数据库连通；不要把错误请求正文公开 |
| 注册无法收验证码 | 系统 SMTP 的授权码、端口、发信限制及垃圾邮件；游客页仍可浏览 |
| 助手不逐步输出 | 确认使用本覆盖文件；额外 CDN/网关也需关闭 SSE 缓冲和过短超时 |
| 手机扫码无法打开 | 检查二维码地址是否 localhost/内网、是否实际使用公网域名，切移动网络复验 |

部署脚本不自动开放防火墙、不购买服务器、不创建临时隧道，也不声称本地模拟通过即为云端或生产验收。
