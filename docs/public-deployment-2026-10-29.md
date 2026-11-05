# 2026-10-29 公网试运行部署

入口：[公开校园生活](https://daylight.yunforis.com/campus)。这是用户授权下的小内存单机试运行，尚未进行生产验收。

## 环境和数据

- Ubuntu 24.04.2 LTS，x86_64，2 vCPU、894 MiB 内存、30 GiB 磁盘。
- Docker 29.1.3，Compose 2.40.3；4 GiB `/swap-daylight`，已写入 fstab；`/etc/sysctl.d/90-daylight-swap.conf` 设置 `vm.swappiness=60`。
- 服务器部署目录 `/opt/daylight`，Compose 项目名 `daylight`。全新账号及业务数据库，没有上传开发机 `data/`、私人账号、邮箱、密钥或附件。
- 首次初始化在重启前未完成，保留 `daylight_postgres-data`，当前数据库使用 `daylight_postgres-recovery-data`；不要将旧卷误作当前业务库。
- 业务数据库、附件、队列和缓存使用各自命名卷。`down -v` 会删除数据，不作为日常停止命令。

## 实际运行配置

服务器使用三份 Compose 文件：项目 `docker-compose.yml`、`compose.lowmem.yml` 和 `compose.https.yml`。最后两份是此次专用配置，不能省略后直接运行通用 `deploy/up.sh`，否则会改变数据库卷、内存设置或公开端口。

- PostgreSQL：32 MB shared buffers、2 MB work mem、16 MB maintenance work mem、40 连接。
- RabbitMQ：限制 Erlang scheduler 数量；API / Worker 的 Node 堆上限 192 MB，Scheduler 96 MB。堆上限不等于整个进程或容器内存上限。
- MinIO：120 MiB Go 内存软目标、GOGC 50；这不是硬上限，实际 RSS 可以更高。
- 应用健康检查间隔 60 秒，以减少小主机检查进程的压力。交换空间改善启动能力，不代表并发或 OCR 任务已验证。
- Caddy 2.10.2，Let's Encrypt 自动证书，无联系邮箱注册，后续可补真实联系邮箱。80 自动跳转 443；开启 gzip/zstd。证书状态存于命名卷，续期依赖 DNS、80/443 和出站网络持续可用。
- 独立入口网络 `172.30.255.0/29`，Caddy `.2`、API `.3`，API 仅信任 `.2/32`；API 3000 与各依赖宿主机端口只在回环监听。固定 API 地址避免 API 动态分配抢占代理地址。
- 私有服务随机密码和 JWT secret 仅保存在服务器 `deploy/compose.env`（600），目录及管理脚本仅 root 可管理。

### 镜像与构建

服务器 npm 下载发生 ECONNRESET。前端在开发机执行 `npm run build` 成功，应用镜像由已有 `daylight:delivery-20261028` 的 Linux 依赖层加当前 `server/`、`shared/`、`scripts/` 和 `dist/` 生成。对照当前 lockfile 核对 Linux x64 glibc 的生产依赖版本一致；锁文件中的可选 musl canvas 包不适用于该 glibc 镜像。应用关键模块及 PDF.js import 通过。镜像不包含用户数据。

应用镜像 ID：`sha256:d5860e1ff49b78df21b592036e4dcb04c36a30b60c5e238664ab5ece44d18311`，本次标签 `daylight:ip-trial`（标签名不表示只支持 HTTP）。压缩导出包 SHA-256：`8dcbafffcb07bf5b3b83caf0baa22855b481bfd9f5ea95d9fc890be9680dd260`，上传前后相同。

PostgreSQL 17.6、Redis 7.4.5、RabbitMQ 4.1.4、Caddy 2.10.2 使用所列版本的 Docker Hub 镜像，经 `docker.m.daocloud.io` 镜像入口获取。镜像源可达性不保证长期可用；后续发布应建立可复现的可信镜像仓库。

默认 MinIO 标签无法从所试镜像源获取；导入本机此前依赖验证使用的 Debian 兼容缓存镜像，实际二进制版本为 `RELEASE.2025-04-22T22-12-26Z`，commit `0d7408fc9969caf07de6a8c3a84f9fbb10a6739e`，本次标签 `daylight-minio:RELEASE.2025-04-22T22-12-26Z`。该镜像源自本机已有构建，非本次从官方仓库全新拉取；健康检查使用 bash TCP HTTP 探针。后续正式部署需核对旧版本支持、安全更新与镜像供应链。

## 运维命令

服务器上通过 root，或使用有 sudo 权限的账号运行：

```sh
sudo /opt/daylight/manage.sh ps
sudo /opt/daylight/manage.sh logs --tail 80 api
sudo /opt/daylight/manage.sh stop
sudo /opt/daylight/manage.sh up -d --no-build --pull never --wait
```

`manage.sh` 固定项目目录、环境文件、项目名和三份 Compose 文件。普通账号直接执行 Docker 可能提示 socket permission denied；使用 sudo，不要将 Docker socket 改成全员可写。

SMTP 当前禁用，未创建首个管理员。游客可直接浏览；普通用户注册与找回密码需要配置真实 SMTP 并验证投递。管理员初始化参考 [公网方案](public-access.md)，执行时使用此次三份 Compose 配置或 `manage.sh run --rm api ...`。管理员邮箱和随机强密码应由维护者提供或私下保存，不使用公开演示账号。

## 验证和限制

- 8 个常驻服务 healthy；migrate、minio-init 退出 0。
- 外网 HTTPS：校园页面、readiness 与公共目录 200，目录包含 109 地点；匿名私人状态和管理员目录 401。认证开启、演示登录关闭。
- Let's Encrypt 证书 SAN 覆盖域名，检查时有效期至 2027-01-27；HTTP 返回 308 跳转 HTTPS。
- `npm run share:qr` 检查真实 HTTPS、readiness、匿名拒绝及认证配置通过，二维码 `work/daylight-public-qr.png`。
- 独立 Edge 390×844：无 pageerror、无整页横向溢出，学校地图实际加载。记录：`work/public-deploy-http-verification.json`、`work/public-deploy-ui-verification.json`。
- 短时空闲快照：可用内存约 320 MiB，swap 使用约 640 MiB，磁盘余约 17 GiB；API / Worker / Scheduler / Caddy 重启数为 0、OOM 标记 false。

尚未验证手机移动网络扫码、真实用户登录及注册、邮箱/模型/OCR、备份恢复、故障重启后的整栈恢复、容量和长期运行。学校资料、导航精度及公开运营许可仍遵循原校园说明的限制。本次能启动不构成 1 GiB 服务器的容量保证，正式试运行采购仍建议至少 4 vCPU / 8 GiB。
