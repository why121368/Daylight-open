# 公网性能复测脚本

这些脚本为 2026-11-03 的现场测试保留可复现入口。报告与已脱敏样本在 [报告目录](../../docs/performance-2026-11-03/README.md)。脚本不会输出密码、Token、邮件正文或附件名。

## 生成已有样本的统计与报告

在仓库根目录执行：

```bash
python scripts/performance/summarize.py
python scripts/performance/figures.py
python scripts/performance/build-report.py
```

Python 需要 matplotlib、numpy、markdown。绘图默认 Microsoft YaHei / SimHei；Linux 可替换为安装的中文字体。输出为 summary.json、CSV、PNG/SVG、Markdown 和包含内嵌图片的 HTML。

## 连接真实服务复测

运行位置是授权生产容器 `/app`，使用容器注入的数据库、Redis 和对象存储配置；宿主机不打印环境变量。先记录部署版本并备份，确保业务账号明确授权。

1. 将 `probe-http.mjs`、`probe-sync.mjs` 或 `browser-session.mjs` 复制到容器可写 `/tmp`。只读根文件系统不能直接使用 docker cp 写入 tmpfs，使用 `docker compose exec -T api sh -c 'cat > /tmp/probe-http.mjs' < scripts/performance/probe-http.mjs`。
2. 设置 `PERF_USERNAME` 为授权账号，运行 `node /tmp/probe-http.mjs before`；优化后使用 `after`。结果写入容器 `/tmp/perf-before.json` 或 `/tmp/perf-after.json`。`PERF_ORIGIN` 默认正式站点 HTTPS，可改为另一个有权测试的入口。
3. HTTP 脚本的 before 模式会按基线行为切换邮箱，**原版本会因此触发真实收信和可能的模型调用**；after 使用摘要接口和不收信的视图切换。脚本结束会恢复原活动邮箱、撤销自己的验证会话。不要把 `before/after` 当成服务器版本切换命令，它只选择客户端调用口径；部署版本需操作者另行确认。
4. `probe-sync.mjs before/after` 会实际发起 **3 次真实 IMAP 同步**并等待任务终态。用现有账号配置的服务，可能处理新邮件和调用模型；不发送邮件，不将结果称为新邮件吞吐。`PERF_USERNAME` 与配置范围需由有权操作者选定。
5. 读取文件时用 `docker compose exec -T api cat /tmp/perf-after.json > ...`，避免依赖 docker cp 对 tmpfs 的行为。
6. cgroup 采样器运行在有读取 Docker PID 和 `/sys/fs/cgroup` 权限的 Linux 主机：`python3 sample-cgroups.py /tmp/resources.jsonl /tmp/stop-marker`。每秒一条；创建 stop-marker 后退出。默认容器名为 `daylight-<role>-1`，不同项目名需调整。CPU 是累计 usage_usec，内存是 memory.current（含缓存）。

## 浏览器复测

`browser-session.mjs` 在授权生产环境建立短期本人会话；令牌仅写容器 `/tmp/perf-browser-session.json`，权限 0600。通过私有传输放到本地 `work/perf-browser-session.json`，不要输出文件内容。

`probe-browser.mjs before/after` 使用本地 `playwright-core` 与独立 Edge headless（可按机器修改 executablePath），390×844，每个样本新建 context。各行为 5 次。真实工作区测量不含人工输入密码和验证码。它读本地会话文件并把令牌写入独立浏览器存储，结果只保留资源类别、耗时与字节数。

所有浏览器测试结束，在原容器运行 `node /tmp/browser-session.mjs close` 撤销这一个会话，再删除本地与宿主机临时会话 JSON。若进程被强制停止，立即撤销测试会话；不得以删除 JSON 代替服务端撤销。不要覆盖仍需清理的 session 文件。

## 统计约定与边界

- nearest-rank：排序后取第 ceil(n×p) 项；n=3/5 时 p95=最大值。
- HTTP 组合全部读取结束；四并发按整批 8 请求统计，另计子请求和逻辑工作区成功率。
- 以数据库 finished_at-created_at 计算同步完成时间，202 不是任务成功。
- CPU 时间比较固定任务工作量；CPU 百分比的窗口不同，不能据此夸大资源节省。
- 本脚本为短时间问题定位工具，不是容量、负载到达率、长期稳定或高可用验收工具。
