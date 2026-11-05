# 校园小 D 默认模型与任务引导：公网发布

发布时间：2026-11-03 17:09，北京时间。入口：[Daylight 校园生活](https://daylight.yunforis.com/campus)。

## 使用

刷新校园页，打开右下角「小 D 助手」。登录且模型已配置时默认使用本人工作区模型；点击「能做什么」可再次展开「从一句话开始」。六个示例先填入输入框，修改后发送。日期示例显示明天。

场景包括预算控糖晚餐、日程与地点、下一项安排导航、自习空档、不冲突的讲座、带避雨偏好的问路。结果来自服务端工具查询，包含数据卡片和处理依据。模型可规划最多四步只读查询；地点不唯一或尚未匹配时要求补充。

## 发布范围与备份

- 基础镜像：`daylight:public-menu-20261109`，保留已发布的两周菜单与既有服务依赖。
- 新镜像：`daylight:public-campus-assistant-20261103`。
- 镜像 ID：`sha256:3d66fccdc0c5c2d4f54c9f4acf672d8fdb3e73b1d3979fb93ca7ed852a77a72d`。
- 后端覆盖 `server/campus-guide/assistant.js`、`server/campus-guide/extras.js`。前端从已发布菜单版本的构建源码单独复制，只覆盖校园助手组件后构建，没有包含其他进行中的附件改动。
- API、Worker、Scheduler 使用同一镜像；未新增基础设施、修改数据库 schema 或清空业务数据。
- 发布前备份：`/opt/daylight-backups/before-campus-assistant-20261103170857/`，包含 PostgreSQL custom dump、可读取的 dump 目录、环境与 Compose 配置、旧源码、旧前端和原镜像标识。备份未执行完整恢复演练。
- 首次发布后，验收脚本因只读容器无法通过 `docker cp` 拷入，发布流程自动回到原菜单镜像并恢复健康。随后使用标准输入在容器中执行验收脚本，保持只读保护，重新发布成功。

需要回退时，恢复备份的 `compose.env` 至 `/opt/daylight/deploy/compose.env`，从 `/opt/daylight` 执行 `./manage.sh up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker scheduler`，再检查 readiness 与业务接口。本轮没有业务数据迁移，镜像回退不需要恢复数据库。

## 验证结果

| 项目 | 实际结果 |
| --- | --- |
| 部署前定向回归 | 31/31通过 |
| 新镜像内隔离测试 | 20/20通过；测试数据位于临时容器，不访问真实邮箱或模型 |
| 前端隔离构建 | 通过；保留既有大 chunk 提示 |
| 服务状态 | 8个服务 healthy；三个应用角色 restart=0、OOM=false；正式 HTTPS readiness 成功 |
| 已发布菜单保留 | 本周782条、下周782条，共1564条 |
| 匿名权限 | 私人学校邮箱接口401；游客查空档提示登录，不把未读取日程当作空闲 |
| 基础查询 | 中文“11月4日”及10–25元预算筛选成功 |
| 真实配置模型默认调用 | 不传 `useModel`，晚餐请求使用 `weekly_menu`，返回1组符合菜品预算的搭配，单次3221ms |
| 真实组合任务 | 日程后导航请求识别出 `personal_calendar → ground_navigation` 计划，单次4141ms；返回4张安排卡，因目的地不唯一要求补充，未生成路线卡 |
| 公网手机尺寸浏览器 | 390×844，默认本人模型提示、六个示例、引导切换、点击只填入与输入聚焦通过；页面宽390、对话框宽374，无捕获到的浏览器错误 |
| 临时会话 | 服务内建立的短期验收会话已撤销；令牌未写入本地报告或回复 |

脱敏接口证据：[verification JSON](campus-assistant-public-2026-11-03.json)。本机补充材料为 `work/campus-assistant-public-deploy-final.log`、`work/campus-assistant-release-build.log`、`work/campus-assistant-deploy-tests.log` 与 `work/campus-assistant-public-mobile.jpg`。

## 结论边界

两次真实模型请求验证了本人配置的默认使用及工具计划解析，不构成各场景的效果或延迟统计，也不等于真实路线或现场供应验收。未触发额外收信、发信、报名、下单或日程写入。未做微信真实定位、实际行走或长期容量测试。控糖建议依菜名筛选，主食另计；空档和活动冲突检查尚未包含路程及未录入事项。
