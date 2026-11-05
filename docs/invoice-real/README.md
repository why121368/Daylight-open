# 第二批发票附件材料

生成日期：2026-10-16（北京时间）。批次：`invoice-real-b02`。

共 **5 份 PDF、3 份 PNG、2 份 JPG**，每份文件是一张不同的虚构发票；票号、购销方和交易内容与 `docs/invoice-test/` 首批不同。目录名 `invoice-real` 仅用于区分材料，全部票面均注明模拟与不可报销。

## 文件清单

| 编号 | 格式 | 内容 | 价税合计 |
| --- | --- | --- | ---: |
| 01 | PDF | [实验耗材](01_lab-consumables.pdf)，样品瓶与手套，13% | CNY 491.55 |
| 02 | PDF | [会议室租赁](02_meeting-room-rental.pdf)，专用发票、9% | CNY 850.20 |
| 03 | PDF | [云计算服务](03_cloud-computing.pdf)，云主机与存储，6% | CNY 436.19 |
| 04 | PDF | [印刷服务](04_printing-service.pdf)，培训手册、13% | CNY 587.60 |
| 05 | PDF | [个人购书](05_personal-books.pdf)，免税、购买方税号未提供 | CNY 152.00 |
| 06 | PNG | [网络维护](06_network-service.png)，6% | CNY 593.60 |
| 07 | JPG | [显示设备采购](07_monitor-purchase.jpg)，显示器与支架，13% | CNY 1,952.64 |
| 08 | PNG | [设备检修](08_equipment-maintenance.png)，专用发票、13% | CNY 508.50 |
| 09 | JPG | [技术文档翻译](09_translation-service.jpg)，6%、税额合计未提供 | CNY 477.00 |
| 10 | PNG | [英文托管服务](10_usd-hosting.png)，USD、代码及购销方税号未提供 | USD 75.00 |

按币种价税合计：**CNY 6,049.28**、**USD 75.00**。缺失税号/税额字段应保持未识别，不应由其他字段推算补全。

## 手动验证

1. 选择这些文件作为新邮件附件，每封附一份或按需要组合。邮件正文只说明票据交付/报销，不提供字段答案。
2. 使用实际邮箱同步后，在发票助手对照原件核对票号、日期、购销方、金额及项目明细。
3. [expected-results.json](expected-results.json) 提供人工核对字段和每个原件的 SHA-256，只供核对，不是模型预置响应。

本次仅生成和本地检查文件，没有发送这批邮件、调用真实模型或进行这批图片的 OCR 准确性验证。5 份 PDF 均为单页、未加密且包含文字层，5 份图片为 2000 × 1400 像素；全部 10 页已渲染检查排版。

生成脚本：`work/create-invoice-real.py`；临时渲染与核对材料：`work/invoice-real-generation/`。
