# ADR 0009：Tauri + NSIS + AppLocalData 取代便携 ZIP 桌面发行

## 状态

已被 [ADR 0011](0011-final-dual-target-architecture.md) 取代并保留为历史决策。“Tauri 取代 ZIP”的单轨结论不再适用。

## 背景

ADR 0002 采用便携式安装根目录承载 ZIP 桌面升级：根目录 launcher、`versions\<version>\` 多版本目录、`current-version.json` 指针、程序内上传 ZIP 更新。当前桌面壳 `desktop_app.py` 用 FastAPI + 随机端口 + 健康检查，再以 Chrome app-mode / pywebview / Edge 三级回退打开窗口。

这套体系有三个结构性问题：

- 下载链路依赖浏览器或 IDM 接管，Chrome app-mode 窗口能力不受控，进程回收靠 subprocess poll，崩溃和更新时容易遗留后台进程。
- 更新体验不直接：用户要手动下载 ZIP、在程序内预览安装、再重启；版本切换和版本目录清理是额外维护负担。
- 桌面壳暴露面大：pywebview 与 Chrome app-mode 两套窗口路径、`browser-profile`、多版本目录都在安装根，与"只认一个文件夹"的目标有距离。

业务逻辑、React、FastAPI、SQLite、数据结构（schema v7）稳定且不夹带在本次发行体系变更中。

## 决策

Windows 桌面版用 Tauri 管理窗口、安装、更新和进程生命周期；现有 Python 后端改为 PyInstaller API sidecar，只提供 HTTP API，不再携带前端和 pywebview。

- 应用标识 `com.winloud.reimbursementtool`，Windows x64 当前用户安装，不要求管理员权限。
- Sidecar 随机本机端口 + 会话令牌鉴权；Tauri 用 Windows Job Object 回收子进程，单实例保护。
- 运行数据固定到 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime`，离开安装目录。
- 更新采用 GitHub Releases `latest.json` + 签名 NSIS + `passive` 安装模式；启动最多每 24h 检查一次，安装需用户确认，安装前创建 `pre_update` 备份，安装后自动重启。
- 发布常规 NSIS（缺 WebView2 联网 bootstrap）和完全离线 NSIS（含 WebView2 offline installer）两种 x64 包。
- 全量更新，不做差分；首期不做 Authenticode，保留 SmartScreen 风险说明。
- 数据结构继续使用 schema v7，本次只换桌面与发行体系。

### 首次迁移清单

从旧便携根目录迁移到 `runtime` 时，迁/不迁边界固定如下：

迁入新 `runtime`：

- `data/`（含 `expense.db` 及 `data/backups/`）
- `uploads/`
- `vendor/`（OpenCV 兼容包等可选运行时组件）
- `window-state.json`（转换一次窗口位置到新坐标空间）

不迁：

- `logs/`、`browser-profile/`、`versions/`、`staging/`
- launcher、`current-version.json`、`portable-release.json`

迁移在临时目录完成路径、哈希和数据库完整性校验后原子启用；失败不改变新目录，旧目录始终只读不修改。

### 回退路径

- 首次迁移时旧便携目录本身是恢复点，迁移不修改旧目录。
- 后续更新保留最近 3 份 `pre_update` 备份，放 `runtime` 同级；回退由用户通过旧版安装器完成，旧安装器可读取 `runtime` 数据。
- 每次 `pre_update` 备份是数据库 + 附件的完整快照。

## 影响

正向影响：

- 统一 WebView2，消除 Chrome app-mode / pywebview 双路径和 `browser-profile` 维护。
- 原生保存窗口、标准安装/更新、可靠进程回收，下载不再依赖浏览器/IDM。
- 运行数据离开安装目录，卸载重装不丢数据。

代价：

- 引入 Rust 工具链（Rust stable MSVC + VS 2022 C++ Build Tools）作为构建依赖。
- 包体不会大幅缩小，离线包因 WebView2 installer 额外增加约 127 MB。
- 首期不做 Authenticode，未签名 NSIS 在全新 Windows 11 上首次更新可能被 SmartScreen 拦截，需用户手动信任。
- 选择 Tauri Target 的旧便携用户需首次迁移到 `runtime`；ZIP Target 本身继续遵循 ADR 0002。
