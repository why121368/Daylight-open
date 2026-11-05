# Windows 生产角色运行

`scripts/production.ps1` 在 Windows 当前用户会话中后台运行三个独立 Node.js 角色，始终设置 `DAYLIGHT_RUNTIME=production` 和 `NODE_ENV=production`。API 使用构建后的 `dist/`，Worker 执行持久任务，Scheduler 产生到期任务。需要 Node.js ≥22、已安装的 npm 依赖、可用的 PostgreSQL、Redis、RabbitMQ 和受支持的对象存储；数据库建表、配置及现有数据导入需在启动前显式完成。缺少依赖不会切到文件、内存或开发服务。

这套脚本适合当前 Windows 主机的生产模式运行与排障。进程在用户注销、系统重启或崩溃后不会自动恢复；需要无人值守开机运行的部署应使用容器编排或 [systemd](../deploy/systemd/README.md)。该脚本本身不代表完成云端或生产可靠性验收。

## 环境文件

默认读取仓库下 **`data/runtime/environment.json`**。该目录由现有 `.gitignore` 中的 `data/` 规则排除。文件为 UTF-8 JSON，顶层对象的每个键都是环境变量名称，值必须为字符串。此文件包含凭据，应限制为运行用户可读，不要上传、截图或粘贴到日志。

以下只是字段格式，须用部署时生成或已保存的有效值替换占位符；不能直接作为运行配置：

```json
{
  "DAYLIGHT_DATA_DIR": "data",
  "DAYLIGHT_DATABASE_URL": "postgresql://APP_USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/APP_DATABASE",
  "DAYLIGHT_REDIS_URL": "redis://:URL_ENCODED_PASSWORD@127.0.0.1:6379/0",
  "DAYLIGHT_AMQP_URL": "amqp://APP_USER:URL_ENCODED_PASSWORD@127.0.0.1:5672/%2F",
  "DAYLIGHT_JWT_SECRET": "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
  "DAYLIGHT_OSS_PROVIDER": "s3",
  "DAYLIGHT_OSS_ENDPOINT": "http://127.0.0.1:9000",
  "DAYLIGHT_OSS_REGION": "us-east-1",
  "DAYLIGHT_OSS_BUCKET": "YOUR_PRIVATE_BUCKET",
  "DAYLIGHT_OSS_ACCESS_KEY": "REPLACE_WITH_BUCKET_SCOPED_ACCESS_KEY",
  "DAYLIGHT_OSS_SECRET_KEY": "REPLACE_WITH_BUCKET_SCOPED_SECRET",
  "DAYLIGHT_OSS_FORCE_PATH_STYLE": "1",
  "HOST": "127.0.0.1",
  "PORT": "3000",
  "DAYLIGHT_WORKER_HEALTH_PORT": "3001",
  "DAYLIGHT_SCHEDULER_HEALTH_PORT": "3002",
  "DAYLIGHT_AUTO_PROXY": "0",
  "TZ": "Asia/Shanghai"
}
```

数据库、Redis 和 AMQP URL 中的用户名、密码、vhost 须按 URL 规则编码。对象存储生产权限与 TLS 应按实际部署配置；上方回环 HTTP 端点仅表示同机服务地址格式。`DAYLIGHT_DATA_DIR` 可为仓库相对路径或绝对路径，脚本会解析为绝对路径，工作目录固定为当前仓库，不依赖历史目录名称。生产权威业务存储仍为 PostgreSQL；该可写目录用于现有缓存、临时文件和运行材料。

其余生产变量（SMTP、管理员名单、TLS、指标、代理等）可直接增加到此对象，见 [DEPLOY.md](../DEPLOY.md)。角色子进程会清除调用方继承的 `DAYLIGHT_*`、`NODE_ENV`、`PORT`、`HOST`、`TZ` 与 HTTP/HTTPS/ALL/NO_PROXY，然后只应用此文件及脚本强制值，避免被终端的旧开发变量影响。需要代理时在文件中明确提供相应代理环境变量。脚本退出前恢复调用方环境，不回显任何环境变量值，也不把凭据放进进程命令行。

Worker 与 Scheduler 使用脚本专用的 `DAYLIGHT_WORKER_HEALTH_PORT` / `DAYLIGHT_SCHEDULER_HEALTH_PORT`，分别转换为各自进程的 `DAYLIGHT_HEALTH_PORT`；文件中的共享 `DAYLIGHT_HEALTH_PORT` 不会覆盖这两个角色端口。三个端口必须不同；默认绑定回环，面向外网请配置 HTTPS 反代。

## 构建、启动与检查

### 日常一键启停

首次生产配置和数据迁移完成后，在仓库根目录执行：

```powershell
npm run up
```

命令会保持前台运行。它复用已保存的 `environment.json`、`dependencies.env` 和 `daylight-services` 数据卷，在 Docker 引擎不可用时尝试启动已安装的 Docker Desktop，等待三个依赖容器健康后启动三个角色。`dist/index.html` 缺失时自动构建；已有构建保持复用，更新前端源码后先执行 `npm run build`。不会自动重装依赖、初始化配置、重新导入 JSON 或替换生产数据库。

引擎探测使用 `docker version --format '{{json .Server}}'`，同时要求退出成功且返回包含有效 `Version` 的服务端 JSON。部分 Docker 26 客户端在引擎不可用时执行格式化 `docker info` 仍返回退出码 0，因此不能仅凭该命令的退出码判断引擎已就绪。自动启动 Docker Desktop 后最多等待约 180 秒；超时请检查 Docker Desktop / WSL2，再运行 `npm run up`。停止与状态查询不会自动启动 Docker Desktop。

停止时在原终端按 **Ctrl+C**，或在另一个终端进入同一仓库并执行：

```powershell
npm run down
```

两种方式均先停止 Scheduler、Worker、API，成功后才用 Compose `stop` 停止 PostgreSQL、Redis、RabbitMQ，保留容器和数据卷。新终端停止会通过当前仓库专属的本地命名管道通知前台启动器，等待完整停止后返回，原终端同时退出；没有前台启动器时会直接调用生产停止脚本，因此也能关闭原先单独启动的角色和依赖。每个仓库只允许一个前台启动器，重复启动会提示使用原终端。重复停止不会删除数据。

Windows 下 npm/cmd 可能在 Ctrl+C 后先结束前台进程，隐藏的关闭保护进程会继续完成停止；此时可用 `npm run status` 确认最终状态。保护进程日志位于 `data/runtime/roles/startup-*.watchdog.stdout.log` 和对应的 `.stderr.log`，正常停止后保护进程也会退出。

启动过程中收到停止请求会写入本次启动专用的取消标记，在 Docker 引擎等待和角色就绪等待中检查；正在执行的构建或 Compose 步骤会先结束，然后执行清理。停止超时或失败不会报告成功，前台启动器仍允许再次 Ctrl+C 或 `npm run down` 重试。Docker 不可用时无法确认依赖是否已停止，会明确报错；不会为停止操作重新启动 Docker Desktop，也不会关闭 Docker Desktop 本身、其他项目容器或远程云对象存储。

```powershell
npm run status
```

状态命令显示三个角色的健康状态和依赖容器（包含已停止容器）；不启动服务。

### 多项目启动隔离

本机依赖 Compose 使用固定项目名 `daylight-services`，本地容器设置 `restart: "no"`，由 `npm run up` 显式启动。Docker Desktop 或引擎重启后需重新运行启动命令；容器异常退出也不自动重启。其他项目的本地容器应使用同样的显式启动策略，否则它们可能因各自的 `always` / `unless-stopped` 策略随引擎恢复。Daylight 的启停脚本仅管理自己的角色和 `daylight-services` 容器，两个已主动启动的项目可以并行运行。

修改 Compose 文件不会立即修改已有容器的策略。对于已有的本机环境，在 Docker 引擎可用时可执行以下一次性更新，不重建容器或数据卷：

```powershell
$daylightContainerIds = @(docker ps -aq --filter 'label=com.docker.compose.project=daylight-services')
if ($LASTEXITCODE -ne 0) { throw 'Cannot list Daylight containers.' }
if ($daylightContainerIds.Count -gt 0) {
    docker update --restart=no @daylightContainerIds
    if ($LASTEXITCODE -ne 0) { throw 'Cannot update Daylight restart policies.' }
}
```

### 单独管理角色

在仓库目录执行：

```powershell
npm run build
& .\scripts\production.ps1 -Action Start
& .\scripts\production.ps1 -Action Status | Format-Table -AutoSize
```

启动前会检查 `dist/index.html`、Node 主版本、必需配置和端口。脚本使用 `Start-Process -WindowStyle Hidden`，依次启动 Worker、API、Scheduler；每个角色的 `/health/ready` 返回 HTTP 200、`ok: true` 和正确的 `role` 后才继续。已经由同一运行目录管理且 ready 的角色会保留。默认单个角色就绪超时为 60 秒，可用 `-TimeoutSeconds 120` 调整。

启动失败或超时会给出日志路径。已经启动的角色保持可查询状态，便于检查依赖和恢复；脚本不自动终止端口上已有的其他服务。`Status` 只读取管理记录、验证进程身份并访问健康端口，无需读取含密钥的环境文件。`running; not ready` 表示进程仍在但依赖、schema 或业务配置未就绪。

PID、Node 路径、创建时间、随机启动 ID、端口和日志路径保存在 `data/runtime/roles/<role>.json`，不含连接串和密钥。标准输出与错误分别保存在同目录带时间戳的日志文件，脚本不自动显示日志内容。日志需按运行环境的保留策略归档和清理。

## 停止和重启

```powershell
& .\scripts\production.ps1 -Action Stop
& .\scripts\production.ps1 -Action Start

# 只重启 Worker
& .\scripts\production.ps1 -Action Stop -Roles worker
& .\scripts\production.ps1 -Action Start -Roles worker
```

停止顺序为 Scheduler、Worker、API。脚本先比对 PID、进程创建时间、Node 可执行文件路径、包装入口、角色与随机启动 ID，确认属于当前仓库本次启动后，写入只含随机 ID 的停止请求。`production-role.mjs` 在同一进程内触发现有 `SIGTERM` 关闭流程，停止接单、收回运行循环并关闭数据库等连接。Windows 的 `Stop-Process` 直接终止行为不会被当作正常优雅关闭。

默认等待 60 秒；超时仍保留进程。确认需要强制终止时可执行 `-Action Stop -Roles worker -Force`，该参数也先等待正常关闭超时，并且仍须通过相同的进程身份验证。

记录中的 PID 已不存在，或进程创建时间不同、证明 PID 已被 Windows 复用时，视为原角色已停止，不向当前占用该 PID 的程序发送停止请求。`Status` 显示 `stopped` 并保留记录；`Start` 检查端口空闲后创建新角色并替换记录；`Stop` 清理过期的角色记录和停止请求。正常关闭、或强制终止并确认退出后，也会清理这两类记录，保留日志。进程创建时间相同但可执行文件、启动 ID 等身份不匹配，或元数据损坏、身份无法读取时，仍拒绝停止，并保留依赖容器。不要删除仍在运行角色的管理记录；应先用脚本停止，避免失去安全管理依据。

可以用 `-EnvironmentFile` 指定其他环境文件、`-RuntimeDirectory` 指定独立管理目录，两者的相对路径都从当前脚本所属仓库解析：

```powershell
& .\scripts\production.ps1 -Action Start -EnvironmentFile data/runtime/environment.json -RuntimeDirectory data/runtime/roles
```

同一组角色的 Start、Stop 和 Status 必须使用同一 `RuntimeDirectory`。Start/Stop 通过该目录内的独占文件锁串行运行。每套独立实例还须使用不同端口、环境文件和适当隔离的业务依赖；更改管理目录不能用来接管其他进程。
