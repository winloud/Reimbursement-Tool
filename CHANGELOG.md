# 更新日志

本文件记录面向用户可见的版本变化，以及会影响交付、安装、发布或协作流程的重要变化。开发过程、实施细节和验证记录维护在 `docs/releases/active-plan.md`。

## Unreleased

### Added

- 新增源码开发服务重启入口：`restart-dev.cmd` 调用 `scripts/restart-dev.ps1`，可统一重启后端 `127.0.0.1:8000` 和前端 `127.0.0.1:5174`。
- 新增 AI 协作规则入口 `AGENTS.md`，并用 `CLAUDE.md` 指向同一套规则。
- 新增开发文档入口 `docs/README.md` 和当前开发计划 `docs/releases/active-plan.md`。

### Changed

- 发布 ZIP 命名规则改为 `报销管理-vX.Y.Z-yyyymmdd.zip`。
- 发布脚本不再清空 `release/` 目录，也不覆盖已有主 ZIP 或 OpenCV runtime ZIP；如同名文件已存在，脚本会报错并要求手动删除。
- 根目录 `README.md` 保持最终用户发布说明定位，移除源码开发服务重启说明。

### Documentation

- 主开发计划瘦身为产品总览、当前状态、能力基线和关键索引。
- 将 V1.1.0 详细开发记录冻结到 `docs/releases/v1.1.0-plan.md`。
- 新增发票二维码识别路线决策记录 `docs/decisions/0001-invoice-qr-engine.md`。
- 将 240 个发票样本的二维码路线对照测试记录移动到 `docs/testing/`。
- 新增 `CHANGELOG.md`，并明确 `active-plan` 记录过程、`CHANGELOG` 记录面向用户和交付流程的结果。

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
