# Daylight · 赛道 B 技术报告框架

## 2026 年 11 月 6 日提交入口

当前图文技术报告已按五项考核整理为 **17 页 PDF**，包含 v10 核验快照、架构与数据流、RAG 前后数据、手机截图、成本性能及12项证据索引。请使用 [PDF](../../public/competition/technical-report.pdf)、[手机图文版](https://daylight.yunforis.com/competition/technical-report.html) 或 [可编辑正文与构建说明](../competition-submission-2026-11-04/README.md)。下文保存10月报告与LaTeX材料的使用说明。

新版为七章 LaTeX 框架（v0.2，2026-10-16），采用 A4、深蓝与晨光金、中文宋体正文与黑体标题。含品牌封面、摘要、评分项索引、可点击目录、逻辑架构示意图、执行流程、故障矩阵及验证/成本填表区。

- 源码：`daylight-report.tex`
- 最终 PDF：`../../output/pdf/daylight-report.pdf`
- 可移植源码包：`../../output/pdf/daylight-report-source.zip`
- 配套图片：`assets/`，编译和上传 Overleaf 时必须一并保留。

## 七章结构

1. 场景与价值
2. 系统架构
3. Agent 执行链路
4. 可靠性与异常处理
5. 效果与验证
6. 成本与性能
7. 部署与局限

以保研多校申请为主展示场景，申博/RA、校招、投稿会议和智能招聘用于说明扩展能力。本文是填写框架，不是已完成验收的最终技术报告。架构示意图明确区分逻辑关系与目标 Worker 边界，提交时须补充实际部署拓扑。

## 填写与交付

修改顶部 `TeamName`、`ProjectVersion`，搜索 `todo`、`待填写`、`待测`、`待执行`，按最终提交版本填写。E01–E12 是建议证据编号，不代表已有证据文件。补充环境、样本、原始结果和版本信息，删除写作提示，保留未完成项。不要把历史联调、模拟测试和云端验证混在一起。

## 编译

在仓库根目录运行（完整 TeX Live / MacTeX，XeLaTeX，使用自带 Fandol 字体）：

```bash
mkdir -p work/report-qa output/pdf
xelatex -interaction=nonstopmode -halt-on-error -output-directory=work/report-qa docs/hackathon-report/daylight-report.tex
xelatex -interaction=nonstopmode -halt-on-error -output-directory=work/report-qa docs/hackathon-report/daylight-report.tex
cp work/report-qa/daylight-report.pdf output/pdf/daylight-report.pdf
```

也可在本目录运行两次 `xelatex daylight-report.tex`。Overleaf 解压源码包后选 XeLaTeX。Codex 内置单文件编译器目前不能读取配套图片，本版本使用本机 XeLaTeX 编译。文档编辑后检查溢出、分页、表格和图片。

## 素材来源

- Daylight 字标与 Banner：用户于 2026-10-16 提供的生成图片，按原图使用。
- UCloud：2026-10-16 从 https://www.ucloud.cn/ 首页导航中的官方品牌标志截取，保留原色与比例，仅用于赛事关联；不是项目背书或主办方官方模板声明。

旧模板已在原路径更新，可通过 Git 历史查看原版。未修改业务代码或用户数据。
