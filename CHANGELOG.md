# 更新日志

本文件记录面向用户可见的版本变化，以及会影响交付、安装、发布或协作流程的重要变化。开发过程、实施细节和验证记录维护在 `docs/releases/active-plan.md`。

## Unreleased

### Added

- 新增程序内“数据维护”能力：可创建完整备份 ZIP、下载最近备份、上传备份 ZIP 预览并执行恢复，恢复前会自动生成恢复前备份。
- 新增诊断信息导出，包含版本号、运行数据路径、数据库/附件/备份状态和最近备份摘要。
- 新增 ZIP 本地升级辅助脚本 `upgrade_zip_release.ps1`，用于从旧版 `报销管理` 目录复制运行态数据到新版目录，并在复制前创建升级备份。
- 桌面窗口会记住用户调整后的大小和位置，下次启动时自动恢复。
- 新增便携式安装根目录：根目录 `报销管理.exe` 作为 launcher，真实程序按版本保存在 `versions/<version>/`。
- 新增程序内更新：在“数据维护”中选择新版发布 ZIP，预览后安装，安装前自动创建完整备份，重启后生效。

### Changed

- 发布 ZIP 会携带 `upgrade_zip_release.ps1`，继续保持不包含 `data/`、`uploads/`、`logs/`、`browser-profile/` 等运行态目录。
- 发布 ZIP 的 `报销管理/` 目录改为稳定安装根目录，运行数据继续保存在该根目录，程序版本保存在 `versions/`。
- 新增当前开发版 ZIP 本地安装、程序内更新和备份指南；正式发布时再同步到根目录 README。
- 预览打包命名规则调整为 `报销管理-preview-yyyymmdd-NNN.zip`；如果 active-plan 已定义目标版本 `vX.Y.Z`，则使用 `报销管理-vX.Y.Z-preview-yyyymmdd-NNN.zip`，避免预览包占用或混淆正式 `vX.Y.Z` 版本号。

### Fixed

- 修复报销单编辑页在自动保存等待期间上传发票会重新加载服务端旧数据，导致未保存的出差事由和行程内容被清空的问题；现在上传前会先保存当前修改。

## v1.1.1 - 2026-06-20

### Added

- 新增源码开发服务重启入口：`restart-dev.cmd` 调用 `scripts/restart-dev.ps1`，可统一重启后端 `127.0.0.1:8000` 和前端 `127.0.0.1:5174`。
- 新增 AI 协作规则入口 `AGENTS.md`，并用 `CLAUDE.md` 指向同一套规则。
- 新增开发文档入口 `docs/README.md` 和当前开发计划 `docs/releases/active-plan.md`。
- 燃油补助新增可手动填写的报销金额；为空时仍按已确认发票合计计算。
- 个性化设置新增自动保存延时，可在 3-60 秒之间调整报销单编辑页的自动保存等待时间。
- 新增 GitHub tag 发布工作流：推送 `v*` 标签后自动构建主 ZIP 和可选 OpenCV runtime ZIP，并从本文件对应版本段落生成 GitHub Release notes。
- GitHub Release 资产使用 ASCII 文件名 `reimbursement-tool-vX.Y.Z-yyyymmdd.zip` 上传，避免 GitHub 规范化非 ASCII 资产名时剥掉中文；本地发布 ZIP 仍保持 `报销管理-vX.Y.Z-yyyymmdd.zip`。

### Changed

- 发布 ZIP 命名规则改为 `报销管理-vX.Y.Z-yyyymmdd.zip`。
- 发布脚本不再清空 `release/` 目录，也不覆盖已有主 ZIP 或 OpenCV runtime ZIP；如同名文件已存在，脚本会报错并要求手动删除。
- 发布脚本默认版本更新为 `1.1.1`。
- 发布脚本支持显式传入 `-ReleaseDate yyyymmdd`，供 GitHub Actions 按中国时区固定发布日期。
- 根目录 `README.md` 保持最终用户发布说明定位，移除源码开发服务重启说明。
- 报销单编辑页自动保存改为延时保存，并新增手动保存；PDF 预览、下载、状态流转和页面导航前会先尝试保存未提交修改。
- 总览看板出差负荷热力图色阶改为从绿色过渡到赭黄色，便于区分连续出差负荷。
- 个性化设置页改为更紧凑的设置面板布局，并将字体授权风险和内置字体目录提示归入 PDF 填充字体卡片。
- 行程日期校验仅对跨年到达的单段行程保留 7 天限制；同年跨月长行程可以正常保存。

### Fixed

- 修复 Linux 服务器部署时 PDF 字体列表为空，导致个性化设置无法保存默认报销信息的问题；服务器可通过本地字体目录提供宋体、黑体、微软雅黑、楷体和仿宋。
- 修复 Linux 服务器部署时报销单 PDF 其他费用项目名未按模板规则使用楷体的问题。
- 修复自动保存错误提示占用页面空间、干扰录入焦点的问题。
- 修复燃油补助按发票合计全额计入报销总额的问题；现在可按报销标准填写较低金额，且不能超过已确认发票合计。
- 修复同年跨月长行程被误判为“到达日期不能早于出发日期”的问题。

### Documentation

- 主开发计划瘦身为产品总览、当前状态、能力基线和关键索引。
- 将 V1.1.0 详细开发记录冻结到 `docs/releases/v1.1.0-plan.md`。
- 新增发票二维码识别路线决策记录 `docs/decisions/0001-invoice-qr-engine.md`。
- 将 240 个发票样本的二维码路线对照测试记录移动到 `docs/testing/`。
- 新增 Linux 服务器部署文档 `docs/deployment/linux-server.md`，记录 Python 3.13、systemd、Nginx 和服务器本地字体部署要求。
- 新增 `CHANGELOG.md`，并明确 `active-plan` 记录过程、`CHANGELOG` 记录面向用户和交付流程的结果。
- 冻结本轮发布记录到 `docs/releases/v1.1.1-plan.md`，并重建下一轮 `docs/releases/active-plan.md`。

## v1.1.0 - 2026-06-09

### Added

- 新增发票二维码识别引擎设置，可在 `zxing-cpp` 和 OpenCV WeChatQRCode 兼容模式之间切换。
- 新增 OpenCV WeChatQRCode 可选 runtime 包，本地放到 EXE 同级后可由程序安装到运行目录。

### Changed

- 默认发票二维码识别路线改为 `zxing-cpp`。
- 主发布 ZIP 不再包含 OpenCV、NumPy 和 WeChatQRCode 模型，减小默认发布包体积。
- OpenCV runtime ZIP 文件名使用 OpenCV 包版本号，例如 `opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip`。
- 发布包清理运行态目录，主 ZIP 不包含 `data/`、`uploads/`、`logs/`、`browser-profile/`。

### Fixed

- OpenCV 兼容模式运行时缺失或损坏时，发票解析记录诊断并回退到 `zxing-cpp`，避免解析流程中断。
- 处理 OpenCV WeChatQRCode 模型在中文路径下加载失败的问题。

### Verification

- 使用 `test example/` 中 240 个 PDF 发票样本完成两条二维码识别路线对照测试，zxing 与 OpenCV 的 payload 和最终解析结果均 `240/240` 一致。

## v1.0.0 - 2026-06-09

### Added

- 发布 Windows 本地桌面版报销管理工具。
- 支持报销单管理、行程录入、发票上传、金额确认、PDF 预览/下载、状态流转、筛选批量操作、回收站、导入导出、看板和个性化设置。
- 支持 PDF 发票和图片发票上传、预览、金额解析与手动确认。
- 支持报销单 PDF 预览、下载，以及下载成功后自动标记为已打印。
- 支持报销数据 ZIP 导入导出，导入执行前自动备份数据库和受影响附件。
- 支持 PyInstaller onedir 本地发布包，最终用户不需要安装 Python、Node.js 或 npm。
