# 当前开发计划

## 状态
- 版本号：v1.2.0
- 计划状态：本地定向验证完成
- 预计版本类型：minor

## 目标
- [x] 保持现有 ZIP 发布方式，不引入 Windows 安装器。
- [x] 增加本地 ZIP 升级辅助脚本，升级前创建完整备份并复制运行态目录。
- [x] 增加程序内完整备份、恢复预览、恢复执行和诊断信息导出。
- [x] 新增独立“数据维护”页面，用于升级、备份恢复和诊断。
- [x] 新增当前开发版 ZIP 安装、升级、备份恢复说明；正式发布时再同步 README。
- [x] 桌面 EXE 记住用户调整后的窗口大小和位置。
- [x] 将 ZIP 桌面发布调整为便携式安装根目录：根目录 launcher + `versions\<version>` 真实程序目录。
- [x] 新增程序内选择新版发布 ZIP、预览并安装更新，更新前自动创建完整备份。
- [x] 固化预览包命名规则：未绑定目标版本时使用 `preview-yyyymmdd-NNN`，绑定目标版本时使用 `vX.Y.Z-preview-yyyymmdd-NNN`，不得占用正式版本号。
- [x] 改进发票上传识别：图片发票走二维码识别，PDF 发票逐页识别，多页多发票 PDF 上传后拆成多条发票记录。
- [x] 新增 GitHub Actions 手动 preview artifact 构建入口，不创建 GitHub Release。
- [x] 增加数据库完整性检查。
- [x] 批量删除、导入覆盖、状态回退前自动创建安全快照。

## 范围
本次做：
- ZIP 发布包继续包含 `README.md` 和干净的 `报销管理/` 安装根目录，不包含运行态数据目录。
- `报销管理\报销管理.exe` 改为根目录 launcher，真实 PyInstaller 程序位于 `报销管理\versions\<version>\`。
- ZIP 根目录只包含 `报销管理\` 文件夹，不再额外放置 `README.md`、`portable-release.json`、`upgrade_zip_release.ps1` 等散文件。
- `报销管理\current-version.json` 决定 launcher 启动哪个版本；运行数据继续在 `报销管理\` 根目录。
- 新增 `scripts/upgrade_zip_release.ps1`，发布时复制到 ZIP 根目录，支持 `-OldAppDir`、`-NewAppDir`、`-BackupDir`。
- 发布 ZIP 额外携带 `zip-upgrade-guide.md`，用于当前开发版安装、迁移和程序内更新说明。
- 预览打包命名规则调整为：未绑定目标版本时输出 `报销管理-preview-yyyymmdd-NNN.zip`；如果 active-plan 已定义目标版本 `vX.Y.Z`，输出 `报销管理-vX.Y.Z-preview-yyyymmdd-NNN.zip`；正式发布才输出 `报销管理-vX.Y.Z-yyyymmdd.zip`。
- 新增 `/api/maintenance` 维护接口，用于备份、恢复、诊断和路径信息查询。
- 新增 `/api/maintenance/updates/preview` 和 `/api/maintenance/updates/execute`，用于程序内预览并安装新版 ZIP。
- 新增独立“数据维护”页面。
- 新增 `docs/zip-upgrade-guide.md`，更新 docs 索引和 CHANGELOG；README 保持 v1.1.1 发布说明定位。
- 桌面窗口状态写入 EXE 同级 `window-state.json`；保持 Google Chrome app-mode 优先策略，并在 Chrome/Edge app-mode 路径中读取和保存窗口大小位置，继续复用稳定 `browser-profile`。
- 图片发票优先复用现有二维码识别路线，不引入 OCR runtime；PDF 发票从只识别第一页改为逐页识别，识别到多张发票时拆分为独立 PDF 附件并创建多条发票记录。
- 新增 `.github/workflows/build-preview.yml`，支持零输入手动触发；默认从 active-plan 读取目标版本、按中国时区取日期、按已有 artifact 自动递增三位预览流水号，云端生成 preview ZIP 并作为 Actions artifact 保留 14 天。
- 新增 `/api/maintenance/database-check`，检查 SQLite `integrity_check`、`foreign_key_check`、报销业务一致性和发票附件状态，并在数据维护页面展示摘要。
- 批量软删除、批量彻底删除、导入覆盖和报销单状态回退前创建完整备份快照；快照失败时中止原操作，避免无保护地执行危险变更。

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。
- 不做安装器；不安装 Inno Setup、NSIS、WiX；不修改注册表；不做联网自动更新。
- 不迁移运行数据到 `%LOCALAPPDATA%`，继续保留安装根目录数据策略。
- 桌面 app 和 Linux server 暂不合并为同一升级执行链；只共享版本 manifest、升级前备份和可回滚原则。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- 新增 `backend/services/maintenance_service.py`、`backend/routers/maintenance.py` 和维护相关 schema。
- 新增完整备份 ZIP 格式：`backup-manifest.json`、`data/expense.db`、`uploads/`、可选 `vendor/` 和最近日志摘要。
- 扩展数据维护页“诊断信息”和诊断包导出：展示当前版本、数据目录、QR 引擎、浏览器/WebView2 状态和日志路径；导出 ZIP 包含 `diagnostics.json`、`summary.txt`、配置摘要、运行配置摘要、环境信息和日志尾部，不包含数据库或附件。
- 恢复执行前自动创建 `pre_restore_*.zip`，并在恢复数据库后运行现有 SQLite 迁移。
- 新增 `frontend/src/pages/MaintenancePage.jsx` 和 `frontend/src/pages/MaintenancePanel.jsx`，通过侧边栏独立入口提供升级、备份恢复和诊断导出入口。
- 新增 `scripts/upgrade_zip_release.ps1`，并由 `scripts/build_release.ps1` 复制到发布 ZIP 根目录。
- 新增 `docs/zip-upgrade-guide.md` 记录当前开发版 ZIP 本地安装、升级和备份恢复步骤；根目录 README 暂不写入未发布能力。
- 新增桌面窗口大小和位置记忆；pywebview 路径通过事件保存 `window-state.json`，Chrome/Edge app-mode 路径启动时读取已有窗口状态，并在窗口运行期间捕捉当前大小位置写回 `window-state.json`。
- 新增 `portable_launcher.py` 和 `reimbursement_launcher.spec`，发布时生成根目录 launcher。
- `backend/runtime_paths.py` 支持 `REIMBURSEMENT_APP_ROOT` 和 `versions\<version>` 自动识别，确保数据目录落在便携安装根目录。
- 维护接口新增更新包预览和执行；执行前创建 `pre_update_*.zip`，安装新版本目录后原子切换 `current-version.json`，不删除旧版本目录。
- `scripts/build_release.ps1` 生成 `portable-release.json`、`current-version.json` 和 `zip-upgrade-guide.md`，用于程序内更新校验和发布包说明。
- `scripts/build_release.ps1` 新增 `-PreviewBuild` 和 `-PreviewSerial NNN`，预览包命名从 `测试版<数字流水号>` 调整为 `preview-yyyymmdd-NNN`；如果 active-plan 已定义目标版本则使用 `vX.Y.Z-preview-yyyymmdd-NNN`。
- 新增 `Build Preview Artifact` GitHub Actions workflow：手动触发后自动解析版本/日期/流水号，运行测试和 preview 打包，只上传 Actions artifact，不创建或更新 GitHub Release。
- 修复云端 preview artifact 包装方式：上传 artifact 前先展开本地发布 ZIP，使 GitHub 下载的 artifact ZIP 顶层直接包含 `报销管理/portable-release.json`，可被程序内更新识别。
- 新增技术决策记录 `docs/decisions/0002-portable-install-root.md`。
- 修复报销单编辑页在自动保存等待期间上传发票会覆盖未保存表单的问题：发票上传前先执行现有保存保护，保存失败则中止上传。
- 图片格式发票新增二维码解析能力；未识别到二维码时仍进入手动确认，不引入 OCR。
- PDF 发票新增逐页解析能力；多页 PDF 中识别到多张发票时，上传一次会创建多条发票记录并进入逐张确认队列。
- 新增数据库完整性检查：覆盖 SQLite 物理完整性、外键一致性、重复 UID、无效状态、孤儿记录、软删除不一致、发票与行程所属报销单不一致、未知费用类别和发票附件缺失/越界。
- 数据维护页面新增“检查数据库”入口，并展示检查状态、表数量、问题数量和前几条问题摘要；诊断包附带数据库检查摘要。
- 新增 `create_safety_snapshot()` 自动快照守门：批量软删除、批量彻底删除、导入覆盖和 `printed -> draft` 状态回退前先尝试创建完整备份；快照失败则中止原操作。
- 桌面本地模式新增备份 ZIP 原生选择器：从数据维护页选择备份恢复时，优先打开 Windows 文件选择窗口并默认定位到应用备份目录；非桌面环境或原生选择器不可用时退回浏览器文件选择。
- 报销单管理列表新增“出差开始日期 / 出差结束日期 / 报销日期”前三个业务列；行程起止日期由现有行程年月日推导后随列表 API 返回。
- 草稿报销单 PDF 预览、单张下载和批量下载统一先刷新 `report_date` 为当天，再生成预览图片、PDF 内容和文件名；单张/批量下载随后标记为已打印。已打印或已报销记录不再自动改动 `report_date`；刷新导出日期不触发补贴天数或金额重算，失败时回滚本次日期变更。报销单管理列表和编辑页预览成功后会重新拉取数据，避免页面仍显示旧报销日期。
- 数据维护页为“备份恢复”补充独立标题和说明；程序更新安装完成后显示“重启程序”按钮，桌面便携模式下会启动根目录 launcher 并退出当前进程。

### 验证记录
- [x] 前端维护工具测试：`node --test src/pages/maintenanceUtils.test.js`，4 passed。
- [x] 前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 全量后端回归：`python -m pytest`，173 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] 发布打包验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version 1.1.1 -ReleaseDate 20260621 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.1.1-20260621.zip`。
- [x] ZIP 内容检查：根目录包含 `README.md` 和 `upgrade_zip_release.ps1`；`tar -tf ... | findstr /C:"/data/" /C:"/uploads/" /C:"/logs/" /C:"/browser-profile/" /C:"/vendor/"` 无匹配，确认运行态目录未进入发布包。
- [x] 桌面窗口记忆定向测试：`python -m pytest tests\test_desktop_dependencies.py`，9 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] 窗口记忆问题修复验证：保持 Chrome 优先策略，Chrome/Edge app-mode 启动时应用 `window-state.json` 并在运行期间捕捉窗口大小位置；`python -m pytest tests\test_desktop_dependencies.py`，10 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] 便携升级定向测试：`python -m pytest tests\test_maintenance_service.py tests\test_zip_upgrade_script.py tests\test_phase6_release.py tests\test_desktop_dependencies.py`，26 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] PowerShell 脚本语法检查：`scripts\build_release.ps1`、`scripts\upgrade_zip_release.ps1` 均可解析。
- [x] 预览包命名规则定向测试：`python -m pytest tests\test_phase6_release.py tests\test_zip_upgrade_script.py`，9 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] 便携发布打包验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version 1.2.1 -ReleaseDate 20260621 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.2.1-20260621.zip`。
- [x] 便携 ZIP 内容检查：`release\报销管理-v1.2.4-20260621.zip` 根目录只包含 `报销管理\`；安装根目录内包含 `portable-release.json`、`报销管理.exe` launcher、`current-version.json`、`zip-upgrade-guide.md`；真实程序位于 `versions\1.2.4\报销管理.exe`，且保留 `versions\1.2.4\_internal\`。
- [x] 便携 ZIP 运行态排除检查：`tar -tf ... | findstr /C:"/data/" /C:"/uploads/" /C:"/logs/" /C:"/browser-profile/" /C:"/vendor/" /C:"window-state.json"` 无匹配。
- [x] 真实发布 ZIP 更新预览验证：`create_update_preview()` 可识别 `release\报销管理-v1.2.4-20260621.zip`，返回版本 `1.2.4` 和 `versions/1.2.4/报销管理.exe`。
- [x] 真实发布 ZIP 更新执行验证：在临时便携安装根目录中执行 `execute_update()` 成功，创建 `pre_update_*.zip`，安装 `versions\1.2.4\报销管理.exe` 和 `_internal\frontend\dist\index.html`，并切换 `current-version.json`。
- [x] 旧测试版 ZIP 打包验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -TestBuild -TestBuildSerial 20260621002 -ReleaseDate 20260621 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-测试版20260621002-20260621.zip`。该命名已被新的 `preview` 规则取代，脚本后续同步。
- [x] 旧测试版 ZIP 内容检查：根目录只包含 `报销管理\`；真实程序位于 `versions\测试版20260621002\报销管理.exe`；`portable-release.json` 和 `current-version.json` 均记录 `测试版20260621002`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。
- [x] 旧测试版 ZIP 更新预览和执行验证：`create_update_preview()` 可识别 `测试版20260621002`；在临时便携安装根目录中执行 `execute_update()` 成功，创建 `pre_update_*.zip`，安装 `versions\测试版20260621002\报销管理.exe` 和 `_internal\frontend\dist\index.html`，并切换 `current-version.json`。
- [x] 预览包命名文档规则确认：正式包为 `报销管理-vX.Y.Z-yyyymmdd.zip`；未绑定目标版本的预览包为 `报销管理-preview-yyyymmdd-NNN.zip`；active-plan 已定义目标版本 `vX.Y.Z` 时，预览包为 `报销管理-vX.Y.Z-preview-yyyymmdd-NNN.zip`。
- [x] v1.2.0 preview 打包验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -PreviewBuild -Version 1.2.0 -PreviewSerial 001 -ReleaseDate 20260622 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.2.0-preview-20260622-001.zip`。
- [x] v1.2.0 preview ZIP 内容检查：根目录只包含 `报销管理\`；真实程序位于 `versions\1.2.0-preview-20260622-001\报销管理.exe`；`portable-release.json` 和 `current-version.json` 均记录 `1.2.0-preview-20260622-001`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。
- [x] v1.2.0 preview 更新预览和执行验证：`create_update_preview()` 可识别 `1.2.0-preview-20260622-001`；在临时便携安装根目录中执行 `execute_update()` 成功，创建 `pre_update_*.zip`，安装 `versions\1.2.0-preview-20260622-001\报销管理.exe` 和 `_internal\frontend\dist\index.html`，并切换 `current-version.json`。
- [x] v1.2.0 preview 全量复验：`python -m pytest`，173 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）；`git diff --check` 通过，仅有既有 CRLF 转换提示。
- [x] v1.2.0 preview 窗口记忆修复后重新打包：保持 Chrome 优先策略，修复 Chrome/Edge app-mode 路径窗口状态保存；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -PreviewBuild -Version 1.2.0 -PreviewSerial 002 -ReleaseDate 20260622 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.2.0-preview-20260622-002.zip`。
- [x] v1.2.0 preview-002 ZIP 内容检查：根目录只包含 `报销管理\`；真实程序位于 `versions\1.2.0-preview-20260622-002\报销管理.exe`；`portable-release.json` 和 `current-version.json` 均记录 `1.2.0-preview-20260622-002`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。
- [x] v1.2.0 preview-002 更新预览验证：`create_update_preview()` 可识别 `1.2.0-preview-20260622-002`，返回 `versions/1.2.0-preview-20260622-002/报销管理.exe`。
- [x] v1.2.0 preview-002 全量复验：`python -m pytest`，174 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）；`git diff --check` 通过，仅有既有 CRLF 转换提示。
- [x] `git diff --check` 通过；仅有既有 CRLF 转换提示。
- [x] 发票上传前保存保护定向测试：`node --test src/pages/reportEditUtils.test.js`，12 passed。
- [x] 前端构建复验：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 发票上传前保存保护后全量前端工具测试：`node --test src/**/*.test.js`，46 passed。
- [x] 发票上传前保存保护后全量后端回归：`python -m pytest`，174 passed，7 warnings（既有 PyInstaller/FastAPI deprecation warnings）。
- [x] v1.2.0 preview-20260623-001 测试包输出：`release\报销管理-v1.2.0-preview-20260623-001.zip`，大小约 44.98 MB。当前环境 `.release-venv` 引用的旧 Python 路径失效且网络受限无法重装打包依赖，因此本次复用 2026-06-22 已验证的 PyInstaller 输出，替换最新 `frontend\dist` 后生成预览 ZIP；本次修复仅涉及前端静态资源。
- [x] v1.2.0 preview-20260623-001 ZIP 内容校验：包含 `portable-release.json`、`current-version.json`、launcher、`versions\1.2.0-preview-20260623-001\报销管理.exe` 和最新前端 `index-BWW0mK91.js`；manifest/current-version 均为 `1.2.0-preview-20260623-001`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。
- [x] 图片发票二维码、PDF 逐页识别、多页 PDF 拆分上传定向测试：`python -m pytest tests\test_phase3.py`，47 passed，5 warnings（既有 PyInstaller/SWIG deprecation warnings）。
- [x] 多发票上传返回前端兼容复验：`node --test src/pages/reportEditUtils.test.js`，12 passed。
- [x] 发票识别改进后全量后端回归：`python -m pytest`，177 passed，7 warnings（既有 PyInstaller/FastAPI/SWIG deprecation warnings）。
- [x] 发票识别改进后全量前端工具测试：`node --test src/**/*.test.js`，46 passed。
- [x] 发票识别改进后前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 手动 preview artifact workflow 断言和全量后端回归：`python -m pytest`，178 passed，7 warnings（既有 PyInstaller/FastAPI/SWIG deprecation warnings）。
- [x] 手动 preview artifact workflow 后前端工具测试：`node --test src/**/*.test.js`，46 passed。
- [x] 手动 preview artifact workflow 后前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 零输入 preview artifact workflow 增强验证：`python -m pytest tests\test_changelog_release_notes.py`，4 passed；`python -m pytest`，178 passed，7 warnings（既有 PyInstaller/FastAPI/SWIG deprecation warnings）。
- [x] GitHub Actions 云端 preview artifact 构建：手动触发 `Build Preview Artifact`，ref `codex/reimbursement-tool`，run `28003609676` 成功，生成 artifact `reimbursement-tool-v1.2.0-preview-20260623-001`，大小约 45.34 MB。
- [x] GitHub Actions 直接可更新 preview artifact 构建：手动触发 `Build Preview Artifact`，ref `codex/reimbursement-tool`，run `28004126113` 成功，生成 artifact `reimbursement-tool-v1.2.0-preview-20260623-002`，workflow 在上传前展开发布 ZIP 并校验 `portable-release.json` 存在，artifact 大小约 45.38 MB。
- [x] 诊断信息前端工具测试：`node --test src/**/*.test.js`，47 passed。
- [x] 诊断信息前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 诊断信息后端语法检查：使用 Codex bundled Python 执行 `python -m py_compile backend\services\maintenance_service.py backend\routers\maintenance.py backend\schemas\maintenance.py tests\test_maintenance_service.py` 通过。
- [x] 诊断信息后端 pytest：用户在交互式 PowerShell 中执行 `py -3.10 -m pytest tests\test_maintenance_service.py`，9 passed。
- [x] 数据安全前端维护工具测试：`node --test src/pages/maintenanceUtils.test.js`，6 passed。
- [x] 数据安全前端构建：`npm.cmd run build` 成功；仍有既有 chunk size warning。
- [x] 数据安全后端语法检查：使用 Codex bundled Python 3.12 执行 `python -m py_compile backend\services\maintenance_service.py backend\routers\maintenance.py backend\schemas\maintenance.py backend\services\report_batch_service.py backend\services\report_service.py backend\services\data_transfer_service.py tests\test_maintenance_service.py tests\test_report_batch.py tests\test_report_trash.py tests\test_status_machine.py tests\test_phase5_2.py` 通过。
- [x] 数据安全后端 pytest：用户在交互式 PowerShell 中执行 `.\.release-venv\Scripts\python.exe -m pytest tests\test_maintenance_service.py tests\test_report_batch.py tests\test_report_trash.py tests\test_status_machine.py tests\test_phase5_2.py`，42 passed，5 warnings（既有 SWIG deprecation warnings）。
- [x] 诊断包摘要增强后端语法检查：`python -m py_compile backend\services\maintenance_service.py tests\test_maintenance_service.py` 通过。
- [x] 诊断包摘要增强后端定向测试：`python -m pytest tests\test_maintenance_service.py`，10 passed。
- [x] 诊断包摘要增强前端维护工具测试：`node --test src/pages/maintenanceUtils.test.js`，6 passed。
- [x] 诊断包摘要增强前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 诊断包摘要增强 diff 检查：`git diff --check` 通过；仅有既有 CRLF 转换提示。
- [x] 数据维护独立页面前端全量工具测试：`node --test src/**/*.test.js`，48 passed。
- [x] 数据维护独立页面前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 数据维护独立页面云端 preview artifact 构建：手动触发 `Build Preview Artifact`，ref `codex/reimbursement-tool`，run `28102911199` 成功，生成 artifact `reimbursement-tool-v1.2.0-preview-20260624-001`，大小约 45.39 MB，保留至 2026-07-08。
- [x] 备份选择器默认路径后端语法检查：`python -m py_compile backend\services\maintenance_service.py backend\routers\maintenance.py backend\schemas\maintenance.py desktop_app.py tests\test_maintenance_service.py` 通过。
- [x] 备份选择器默认路径后端定向测试：`python -m pytest tests\test_maintenance_service.py`，12 passed。
- [x] 备份选择器默认路径前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] 备份选择器默认路径前端全量工具测试：`node --test src/**/*.test.js`，48 passed。
- [x] 备份选择器默认路径 diff 检查：`git diff --check` 通过；仅有既有 CRLF 转换提示。
- [x] 报销单导出日期和列表列顺序后端语法检查：`python -m py_compile backend\routers\reports.py backend\services\report_service.py backend\services\report_batch_service.py backend\schemas\report.py backend\models\report.py tests\test_phase4.py tests\test_report_batch.py tests\test_report_crud.py` 通过。
- [x] 报销单导出日期和列表列顺序后端定向测试：`python -m pytest tests\test_phase4.py tests\test_report_batch.py tests\test_report_crud.py`，43 passed，5 warnings（既有 SWIG deprecation warnings）。
- [x] 报销单导出日期和列表列顺序后全量后端回归：`python -m pytest`，192 passed，7 warnings（既有 SWIG/FastAPI deprecation warnings）。
- [x] 报销单导出日期和列表列顺序后前端工具测试：`node --test src/**/*.test.js`，48 passed。
- [x] 报销单导出日期和列表列顺序后前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] v1.2.0 preview-20260624-002 本地完整打包：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -PreviewBuild -Version 1.2.0 -PreviewSerial 002 -ReleaseDate 20260624 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.2.0-preview-20260624-002.zip`，大小约 45.01 MB。
- [x] v1.2.0 preview-20260624-002 ZIP 内容校验：包含 `portable-release.json`、`current-version.json`、launcher、`versions\1.2.0-preview-20260624-002\报销管理.exe` 和最新前端 `dist\index.html`；manifest `app_version` 与 current-version `current_version` 均为 `1.2.0-preview-20260624-002`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。
- [x] 数据维护备份标题和更新后重启按钮后端语法检查：`python -m py_compile backend\services\maintenance_service.py backend\routers\maintenance.py backend\schemas\maintenance.py tests\test_maintenance_service.py` 通过。
- [x] 数据维护备份标题和更新后重启按钮后端定向测试：`python -m pytest tests\test_maintenance_service.py`，14 passed。
- [x] 数据维护备份标题和更新后重启按钮前端工具测试：`node --test src/**/*.test.js`，48 passed。
- [x] 数据维护备份标题和更新后重启按钮前端构建：`npm run build` 成功；仍有既有 chunk size warning。
- [x] v1.2.0 preview-20260624-003 本地完整打包：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -PreviewBuild -Version 1.2.0 -PreviewSerial 003 -ReleaseDate 20260624 -SkipDependencyInstall -ReuseReleaseVenv` 成功，生成 `release\报销管理-v1.2.0-preview-20260624-003.zip`，大小约 45.01 MB。
- [x] v1.2.0 preview-20260624-003 ZIP 内容校验：包含 `portable-release.json`、`current-version.json`、launcher、`versions\1.2.0-preview-20260624-003\报销管理.exe` 和最新前端 `dist\index.html`；manifest `app_version` 与 current-version `current_version` 均为 `1.2.0-preview-20260624-003`；未包含 `data/`、`uploads/`、`logs/`、`browser-profile/`、`vendor/`、`window-state.json`。

### 已同步到 CHANGELOG
- 已在 Unreleased 记录数据维护独立页面、备份选择器默认打开备份目录、备份恢复标题说明、更新完成后重启按钮、诊断信息与诊断包导出（含可读摘要和运行配置摘要）、数据库完整性检查、危险操作自动安全快照、ZIP 升级辅助脚本、当前开发版升级指南、桌面窗口记忆、便携根目录、程序内更新、发票上传前保存保护修复、图片发票二维码解析、多页 PDF 逐页识别、手动 preview artifact workflow、报销单管理列表列顺序调整，以及草稿 PDF 预览/下载按实际生成日期刷新报销日期且已打印后锁定报销日期。
