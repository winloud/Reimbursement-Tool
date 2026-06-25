# 更新日志

本文件记录面向用户可见的版本变化，以及会影响交付、安装、发布或协作流程的重要变化。开发过程、实施细节和验证记录维护在 `docs/releases/active-plan.md`。

## Unreleased

### Added

- 新增 `scripts/release_publish.ps1` 发布总控脚本，可自动准备版本文件、冻结发布计划、运行预检、创建 release commit/tag，并在 `-Publish` 时推送 tag、等待 GitHub Actions、校验资产、采集耗时并写回验证记录。
- 新增 `scripts/validate_release_asset.ps1`，可校验本地发布 ZIP、只检查 GitHub Release 资产元数据，或按需下载远端主 ZIP 做深校验；下载资产时会自动重试。
- 新增 `scripts/collect_release_metrics.ps1`，可采集 GitHub Actions run 的总耗时和步骤耗时，并输出 JSON 或 Markdown，支持与基线 run 对比。
- 发布总控脚本新增显式重发既有 tag 和忽略未跟踪本地草稿文件的参数，便于修正同版本 Release 或在干净的已跟踪文件状态下继续发布。

### Changed

- 发布流程文档改为优先使用总控脚本，手工步骤保留为故障排查或脚本不可用时的 fallback。
- GitHub Release workflow 在上传资产前对 runner 本地构建出的主 ZIP 做内容校验；总控脚本发布后默认只做 Release 资产元数据校验，避免因网络慢反复下载主 ZIP。
- 发布总控脚本等待 GitHub Actions 时只匹配本次 tag push 之后的新 run，避免重发既有 tag 时误抓历史 run。

## v1.2.1 - 2026-06-25

### Added

- 新增 `scripts/prepare_release.ps1` 发布预检脚本，用于在不重复本地正式打包的情况下校验版本号、CHANGELOG、README、冻结计划、release notes、测试和 diff。
- 新增 `docs/release-process.md`，记录以 GitHub tag workflow 产物为准的快速发布路径。

### Changed

- GitHub 正式发布和 preview artifact workflow 启用 Python pip cache，减少后端与打包依赖重复下载时间。
- GitHub 正式发布 workflow 优先复用已有 OpenCV runtime Release 资产，仅在缺少匹配 OpenCV 包版本资产时重建。
- GitHub Actions workflow 升级 checkout、setup-python、setup-node 和 upload-artifact action 主版本，避免旧 Node.js action runtime 弃用提示。
- GitHub 正式发布 workflow 改用 PowerShell 显式参数表调用打包脚本，避免正式发布日期被误判为预览流水号。

## v1.2.0 - 2026-06-25

### Added

- 新增程序内“数据维护”能力：可创建完整备份 ZIP、下载最近备份、上传备份 ZIP 预览并执行恢复，恢复前会自动生成恢复前备份。
- 新增诊断信息和诊断包导出，包含版本号、数据目录、QR 引擎、浏览器/WebView2 状态、日志路径、配置摘要、运行配置摘要、环境信息、日志尾部和可读摘要，便于排查问题。
- 新增数据库完整性检查，可在“数据维护”中检查 SQLite 物理完整性、外键、业务一致性和发票附件状态。
- 新增 ZIP 本地升级辅助脚本 `upgrade_zip_release.ps1`，用于从旧版 `报销管理` 目录复制运行态数据到新版目录，并在复制前创建升级备份。
- 桌面窗口会记住用户调整后的大小和位置，下次启动时自动恢复。
- 新增便携式安装根目录：根目录 `报销管理.exe` 作为 launcher，真实程序按版本保存在 `versions/<version>/`。
- 新增程序内更新：在“数据维护”中选择新版发布 ZIP，预览后安装，安装前自动创建完整备份，重启后生效。
- 新增程序内版本切换：可在“数据维护”中切换到已安装版本，切换前自动创建完整备份，重启后生效。
- 新增数据结构兼容性门禁：程序内更新和已安装版本切换会检查当前数据库结构版本是否在目标版本支持范围内，缺少兼容性信息或不兼容时禁止自动安装/切换。
- 数据维护页新增备份文件和已安装版本管理，可删除选中备份/版本，并一键清理旧备份或旧版本；清理备份会保留最近备份，清理版本会保留当前版本。
- 图片格式发票新增二维码识别能力；未识别到二维码时仍可手动确认金额。
- PDF 发票新增逐页识别能力；一个多页 PDF 中识别到多张发票时，会创建多条发票记录并逐张确认。
- 新增 GitHub Actions 手动 preview artifact 构建入口，可零输入在云端生成 preview ZIP 供测试下载，不创建 GitHub Release。

### Changed

- 发布 ZIP 会携带 `upgrade_zip_release.ps1`，继续保持不包含 `data/`、`uploads/`、`logs/`、`browser-profile/` 等运行态目录。
- “数据维护”从个性化设置中拆出为独立页面，升级、备份恢复和诊断导出不再挤在个性化设置里。
- 报销单管理列表调整为优先展示“出差开始日期 / 出差结束日期 / 报销日期”，便于按行程时间核对。
- 报销单管理列表默认按出差开始日期倒序排列；无行程日期的报销单排在后面。
- 数据维护页为“备份恢复”补充独立标题和说明，并在程序更新安装完成后提供“重启程序”按钮。
- 侧边栏导航将“数据维护”移到末尾，降低日常录入路径中的干扰。
- 优化数据维护页结构：将备份恢复、程序更新、诊断检查拆成独立任务区，并让更新、恢复、诊断错误就近显示在对应区域。
- 已安装版本再次选择对应 ZIP 时，会提示使用版本切换而不是重复安装已有版本目录。
- 发布 ZIP 的 `报销管理/` 目录改为稳定安装根目录，运行数据继续保存在该根目录，程序版本保存在 `versions/`。
- 批量删除、批量彻底删除、导入覆盖和报销单状态回退前会自动创建安全快照；快照创建失败时会中止原操作。
- 新增 ZIP 本地安装、程序内更新和备份指南，并同步到根目录 README。
- 预览打包命名规则调整为 `报销管理-preview-yyyymmdd-NNN.zip`；如果 active-plan 已定义目标版本 `vX.Y.Z`，则使用 `报销管理-vX.Y.Z-preview-yyyymmdd-NNN.zip`，避免预览包占用或混淆正式 `vX.Y.Z` 版本号。

### Fixed

- 修复报销单编辑页在自动保存等待期间上传发票会重新加载服务端旧数据，导致未保存的出差事由和行程内容被清空的问题；现在上传前会先保存当前修改。
- 修复云端 preview artifact 下载后不能直接用于程序内更新的问题；现在 artifact ZIP 顶层就是便携更新包内容。
- 桌面版选择备份 ZIP 进行恢复时，文件选择窗口默认打开应用备份目录；非桌面环境仍使用浏览器默认文件选择。
- 修复草稿报销单 PDF 预览、单张下载和批量下载未按实际生成日期更新“报销日期”的问题；现在会先更新报销日期，再生成预览图片、PDF 内容和文件名，并在预览后同步刷新页面日期，已打印或已报销记录不会被自动改动报销日期。
- 修复桌面版程序内重启只打开新窗口、不关闭旧窗口的问题；Chrome/Edge app-mode 会先关闭旧应用窗口，再启动新版本。

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
