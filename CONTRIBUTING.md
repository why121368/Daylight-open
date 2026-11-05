# 参与 Daylight / Contributing

感谢你帮助改进 Daylight。可以从使用反馈、文档、翻译、场景模板、邮件格式或功能修复开始。当前仓库未提供 LICENSE，贡献前请确认你有权提交相关代码与素材；此文不额外授予项目使用许可。

## 提交问题 / Report an issue

在 [Issues](https://github.com/why121368/Daylight/issues) 提供：

- 使用的 Commit/Tag、操作系统、Node/Docker 版本。
- 本地或生产模式、启动方式、问题页面。
- 复现步骤、预期结果、实际结果与脱敏错误信息。
- 是否使用预置示例、模拟服务或真实依赖。

不要上传真实邮箱授权码、API Key、私密 ICS 地址、完整数据库连接串、私人邮件或未经授权的简历。敏感安全问题先通过维护者提供的私下渠道沟通，不在公开 Issue 放可利用细节。

Include version/environment, runtime/startup method, reproduction steps, expected/actual behavior, and sanitized errors. Identify preset, mocked, and live-service runs separately. Keep credentials and private content out of public reports.

## 本地开发 / Development

需要 Node.js ≥22、npm。先阅读根目录 README、STATUS 与 AGENTS 中的项目约定。

```bash
npm ci
npm run dev
```

在独立分支或工作树修改，遵循当前仓库分支约定，不直接提交 master。保留用户数据；不要将测试指向既有业务 `data/`。

```bash
DAYLIGHT_DATA_DIR="$PWD/work/contribution-test" npm test
npm run build
```

按改动范围选择有意义的检查。纯文档修改检查路径、命令和图片；业务修改补充行为回归；涉及共享状态、外部操作和任务恢复时增加相应集成检查。门控测试没有执行要如实说明，不能用跳过测试表示通过。真实模型调用可能付费，真实发信需要明确授权，常规验证优先使用隔离夹具。

Use a separate branch/worktree, preserve user data, and run checks appropriate to the change. Document skipped integration gates. Do not send mail or trigger paid calls as an incidental documentation/test step.

## Pull request

PR 说明应包含：解决的问题、用户操作前后变化、验证命令与结果、已知限制，以及必要的 README/STATUS 更新。UI 变化附脱敏截图；接口变化说明兼容性。不要为了小改动复制现有模块或引入无必要依赖。

Explain the problem, behavior change, validation, limitations, and compatibility. Include sanitized UI screenshots where relevant, and update the affected documentation.

## 场景模板 / Templates

从 [校园事务示例](docs/examples/campus-followup.template.json) 或工作台导出定义开始。模板为声明式数据，通过平台白名单校验；不要提交任意执行代码或凭据。样例使用合成内容，说明预期动作与需要人工确认的地方。

社区发布功能尚未开放。可以先通过 PR 提交定义或 Issue 讨论真实流程；提交模板不代表已经发布到社区，也不自动赋予发信或外部操作权限。

Start with the example/exported definition. Use synthetic samples and describe confirmations. Community publishing is planned, so an accepted proposal is not automatically a published plugin or execution permission.
