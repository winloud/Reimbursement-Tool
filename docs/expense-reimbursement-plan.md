# 出差旅费报销管理工具 - 主开发计划

> 本文档只维护产品级总览、当前状态、能力基线和关键索引。文档目录见 `docs/README.md`；版本详细任务、测试证据和技术路线决策分别维护在 `docs/releases/`、`docs/testing/` 和 `docs/decisions/`。

---

## 一、产品定位

本项目是一个 Windows 本地单机运行的出差旅费报销管理工具，用于替代手工填写报销单、管理发票附件、生成公司模板 PDF，并提供历史报销数据统计。

核心目标：

- 本地录入和维护报销单、行程、费用和发票。
- 自动统计发票张数、发票金额、补贴金额和报销总额。
- 生成可预览、可下载的报销 PDF。
- 支持历史数据筛选、批量操作、导入导出和看板统计。
- 通过 PyInstaller onedir 方式发布为 Windows 桌面工具。

---

## 二、当前状态

- 当前源码版本：`v1.2.6`
- 公开稳定版本：[GitHub Releases](https://github.com/winloud/Reimbursement-Tool/releases/latest)
- 当前开发版：TBD
- 当前发布产物命名：`release/报销管理-vX.Y.Z-yyyymmdd.zip`
- 可选兼容包：`release/opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip`
- 发布方式：本地按需生成 ZIP；正式版本从 `main` 创建不可变 `vX.Y.Z` tag，由 GitHub Actions 构建、验证并发布 GitHub Release；用户解压后运行 `报销管理/报销管理.exe` 根目录 launcher，真实程序位于 `报销管理/versions/<version>/报销管理.exe`
- 默认发票二维码识别路线：`zxing-cpp`
- 可选兼容路线：`OpenCV + NumPy + WeChatQRCode`，通过 EXE 同目录 runtime ZIP 本地安装

---

## 三、当前能力基线

### 核心业务

- 报销单支持新增、编辑、状态流转、筛选、批量操作、回收站、恢复和彻底删除。
- 行程支持多段录入、排序、复制、返程生成和补贴起止标记。
- 途中补贴默认按行程区间和日标准自动计算，也可通过“调整途中补贴”人工核定最终总额；人工核定的 `0.00` 是有效值，该模式不计算、不展示或输出补贴天数，PDF 仅填写补贴总额。
- 费用支持车船费按行程归属、其他费用按类别归属；燃油补助手填报销金额可高于已确认发票合计，但发票不足时仅允许保存和预览，补足后才能打印。
- 全链路金额使用 `Decimal(18,2)`，自动计算补贴、总额、补领不足和归还多余。

### 发票与 PDF

- 支持 PDF 和图片发票上传；XML / OFD 发票当前不支持。
- PDF 发票逐页识别二维码，多页多发票 PDF 可拆分为多条发票记录；图片发票也通过二维码识别。
- 铁路电子客票 PDF 可批量解析为行程；同日或次日的连续站点默认合并，明显返程或路线回环自动拆分，并保留全部原始车票关联。
- 普通 PDF / 图片发票和铁路电子客票统一检查全库有效电子发票；附件内容或去除首尾空格后的发票号任一重复即禁止入库，查重覆盖所有报销状态并排除回收站、已删除发票和纸质发票。
- 新上传发票默认需要用户确认金额；未确认发票不计入汇总，也不允许生成 PDF。
- 支持报销单页预览、报销单和发票附件合并下载、PDF 字体设置、增值税专用发票附件打印两遍设置。

### 数据与统计

- SQLite 本地存储，运行态数据位于便携安装根目录 `data/`、`uploads/`、`logs/`。
- 支持完整报销数据 ZIP 导入导出，导入执行前自动备份数据库和受影响附件。
- 独立“数据维护”页面支持完整备份、恢复预览、恢复执行、程序内更新、已安装版本切换、备份/版本清理、数据库检查和诊断包导出。
- 程序内更新和版本切换包含数据结构兼容性门禁；缺少兼容性信息或不兼容时禁止自动安装或切换。
- 看板支持金额汇总、月份范围、费用分布、趋势图和出差负荷热力图。

### 发布与运行

- 前端：React 18 + Vite + MUI。
- 后端：FastAPI + SQLAlchemy + SQLite。
- 桌面启动：`desktop_app.py` 启动 FastAPI，等待健康检查后打开桌面窗口，关闭窗口后退出服务。
- 打包：`scripts/build_release.ps1 -Version <version>` 生成 `release/报销管理-v<version>-yyyymmdd.zip`。
- 主发布包默认不包含 OpenCV、NumPy、WeChatQRCode 模型。

---

## 四、版本索引

| 版本 | 状态 | 文档 |
| --- | --- | --- |
| `v1.2.6` | 内容已冻结 | [releases/v1.2.6-plan.md](releases/v1.2.6-plan.md) |
| `v1.2.5` | 内容已冻结 | [releases/v1.2.5-plan.md](releases/v1.2.5-plan.md) |
| `v1.2.4` | 内容已冻结 | [releases/v1.2.4-plan.md](releases/v1.2.4-plan.md) |
| `v1.2.3` | 内容已冻结 | [releases/v1.2.3-plan.md](releases/v1.2.3-plan.md) |
| `v1.2.2` | 内容已冻结 | [releases/v1.2.2-plan.md](releases/v1.2.2-plan.md) |
| `v1.2.1` | 内容已冻结 | [releases/v1.2.1-plan.md](releases/v1.2.1-plan.md) |
| `v1.2.0` | 内容已冻结 | [releases/v1.2.0-plan.md](releases/v1.2.0-plan.md) |
| `v1.1.1` | 内容已冻结 | [releases/v1.1.1-plan.md](releases/v1.1.1-plan.md) |
| `v1.1.0` | 内容已冻结 | [releases/v1.1.0-plan.md](releases/v1.1.0-plan.md) |
| 当前开发 | 规划中 | [releases/active-plan.md](releases/active-plan.md) |

---

## 五、技术决策索引

| 决策 | 结论 | 文档 |
| --- | --- | --- |
| 发票二维码识别路线 | 默认 `zxing-cpp`，OpenCV WeChatQRCode 作为可选兼容模式 | [decisions/0001-invoice-qr-engine.md](decisions/0001-invoice-qr-engine.md) |
| ZIP 桌面升级路线 | 采用便携式安装根目录、根目录 launcher 和版本目录，不与 Linux server 强行合并升级执行链 | [decisions/0002-portable-install-root.md](decisions/0002-portable-install-root.md) |
| 发布治理 | GitHub 是公开发布真源，正式远端 tag 不可变，发布失败从原 tag 续跑 | [decisions/0003-release-governance.md](decisions/0003-release-governance.md) |
| 铁路客票解析 | 按 PDF 字体 CMap 解码原始字节，不使用 OCR 或英文站名回退；连续站点按日期相邻默认合并 | [decisions/0004-rail-ticket-pdf-text-decoding.md](decisions/0004-rail-ticket-pdf-text-decoding.md) |

---

## 六、测试依据索引

| 测试 | 结论 | 文档 |
| --- | --- | --- |
| V1.2.4 发布验证 | 发布预检、GitHub Release workflow、Release notes 和资产均已验证 | [releases/v1.2.4-plan.md](releases/v1.2.4-plan.md) |
| V1.2.3 发布验证 | 发布预检、GitHub Release workflow、Release notes 和资产均已验证 | [releases/v1.2.3-plan.md](releases/v1.2.3-plan.md) |
| V1.2.2 发布验证 | 发布预检、GitHub Release workflow、Release notes 和资产均已验证 | [releases/v1.2.2-plan.md](releases/v1.2.2-plan.md) |
| V1.2.1 发布验证 | 发布预检、GitHub Release workflow、Release notes 和资产均已验证 | [releases/v1.2.1-plan.md](releases/v1.2.1-plan.md) |
| V1.2.0 发布验证 | 后端、前端工具测试、前端构建、CHANGELOG 提取、主 ZIP、ZIP 内容检查和 GitHub Release 均已验证 | [releases/v1.2.0-plan.md](releases/v1.2.0-plan.md) |
| V1.1.1 发布验证 | 后端、前端工具测试、前端构建、CHANGELOG 提取、主 ZIP、ZIP 内容检查和 GitHub Release 均已验证 | [releases/v1.1.1-plan.md](releases/v1.1.1-plan.md) |
| 发票 QR 两路线对照测试 | `test example/` 240 个 PDF 中，zxing 与 OpenCV payload 和最终解析结果均 `240/240` 一致 | [testing/invoice_qr_route_comparison_2026-06-09.md](testing/invoice_qr_route_comparison_2026-06-09.md) |
| V1.1.0 发布验证 | 后端、前端工具测试、前端构建、主 ZIP、可选 OpenCV runtime、冻结 EXE 短启动均已验证 | [releases/v1.1.0-plan.md](releases/v1.1.0-plan.md) |

---

## 七、下一阶段方向

优先级建议：

1. 评估增量包和增量更新，继续保留全量 ZIP 作为主交付方式。
2. 根据实际使用反馈打磨数据维护页的更新、备份和诊断流程。
3. 继续增强 GitHub Actions 内的 Release 资产校验和可恢复发布能力，避免在仓库中重复维护机器状态。
