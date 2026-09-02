# 虚拟机打包与安装测试说明

本文分两部分：

1. **打包说明**：在虚拟机中从源码安装开发/打包依赖，并生成 Tauri NSIS 安装包。
2. **安装说明**：把安装包复制到用户电脑后，安装和运行需要哪些依赖、程序会自动处理什么。

v2.0.0 起新增并行的 Tauri NSIS 安装包 + API sidecar（见 `docs/decisions/0011-final-dual-target-architecture.md`），
Tauri 安装包自身不包含便携 ZIP 的 `versions/`、Chrome app-mode 或 pywebview；这些能力只属于并行的 ZIP Target。

---

## 一、打包说明

本段用于验证一台干净 Windows 虚拟机是否能从源码完整安装依赖、运行测试、构建前端与 sidecar，并打包出 NSIS 安装包。

### 1. 打包环境依赖

从源码打包需要安装以下依赖：

- **Windows 10 / Windows 11 64 位**
- **Python 3.10 或 3.11**
  - 安装时勾选 `Add python.exe to PATH`
  - 用于运行 FastAPI sidecar、测试、PyInstaller 打包
- **Node.js 20 LTS 或更高版本**
  - 用于安装前端依赖并执行 `npm run build`
  - 注意：Node.js 只在打包阶段需要，最终运行安装包不需要
- **npm**
  - 随 Node.js 一起安装
- **Rust stable（MSVC toolchain）+ Visual Studio 2022 C++ Build Tools**
  - 用于 `cargo tauri build` 编译桌面壳并产出 NSIS
- **Tauri CLI**：`cargo install tauri-cli --version "^2" --locked`
- **PowerShell**
  - 用于执行 `scripts/build_tauri_release.ps1`
- **网络访问**
  - 用于下载 Python 包、npm 包和 crates

验证基础工具：

```powershell
python --version
node --version
npm --version
cargo --version
cargo tauri --version
```

### 2. 安装 Python 依赖

进入项目根目录，例如：

```powershell
cd F:\Documents\报销单开发
```

升级 pip：

```powershell
python -m pip install --upgrade pip
```

开发和运行时可安装后端运行依赖：

```powershell
python -m pip install -r backend\requirements.txt
```

完整开发/测试环境使用：

```powershell
python -m pip install -r backend\requirements-dev.txt
```

打包 sidecar 需要：

```powershell
python -m pip install -r backend\requirements-packaging.txt
```

明确会安装/使用的主要 Python 依赖：

- `fastapi`
- `uvicorn`
- `sqlalchemy`
- `pydantic`
- `python-multipart`
- `pypdf`
- `PyMuPDF`
- `reportlab`
- `fonttools`
- `zxing-cpp`
- `pyinstaller`

sidecar 只提供 HTTP API，不再依赖 `pywebview`；前端由 Tauri 打包，不进 PyInstaller 产物。

`opencv-contrib-python-headless` 和 `numpy` 不进入主发布包。只有需要生成 OpenCV WeChatQRCode 兼容运行时包时，才由 `scripts/build_opencv_runtime.ps1` 额外安装并收集。

验证关键依赖：

```powershell
python -m PyInstaller --version
python -c "import uvicorn, fastapi, fitz, zxingcpp; print('python deps ok')"
```

### 3. 安装前端依赖

```powershell
cd frontend
npm ci
cd ..
```

前端主要依赖：

- `react`
- `react-dom`
- `react-router-dom`
- `@mui/material`
- `@mui/icons-material`
- `@emotion/react`
- `@emotion/styled`
- `@tauri-apps/api`
- `axios`
- `vite`
- `@vitejs/plugin-react`
- `recharts`
- `zustand`

这些依赖只用于源码开发/前端构建。安装包不要求用户电脑安装 Node.js 或 npm。

### 4. 运行测试与前端构建

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify.ps1 -Profile All
```

期望结果：

- 后端测试全部通过
- 前端 Node 测试全部通过
- 前端生产构建成功
- Tauri 配置与权限静态检查通过，Rust 单测与 `cargo clippy -D warnings` 通过
- PowerShell 脚本语法和 Git diff 空白检查通过
- Vite 可能提示 chunk size 警告，该警告不影响当前功能

只想单独跑桌面壳检查时用 `-Profile Desktop`。

### 5. 打包安装包

在项目根目录执行：

```powershell
.\scripts\build_tauri_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

该脚本会执行：

1. 同步版本号到 `src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json`
2. `python -m PyInstaller --clean --noconfirm reimbursement_sidecar.spec`
3. 复制 sidecar onedir 到 `src-tauri/resources/reimbursement-sidecar`
4. `cargo tauri build`（前端 `npm run build` 由 `beforeBuildCommand` 触发）
5. `cargo tauri signer sign` 对安装包签名，产出 `.sig`
6. `scripts/generate_updater_feed.ps1` 产出 `latest.json` + `data-compat.json`

成功后生成：

```text
src-tauri\target\release\bundle\nsis\报销管理_X.Y.Z_x64-setup.exe
src-tauri\target\release\bundle\nsis\报销管理_X.Y.Z_x64-setup.exe.sig
dist-feed\latest.json
dist-feed\data-compat.json
```

完全离线包（自带 WebView2 offline installer，体积约 +127 MB）：

```powershell
.\scripts\build_tauri_release.ps1 -Version X.Y.Z -Offline
```

如需额外生成 OpenCV 兼容运行时包：

```powershell
.\scripts\build_opencv_runtime.ps1 -OpenCvPackageVersion 4.10.0.84
```

生成：

```text
release\opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip
```

runtime ZIP 文件名中的版本号取 `opencv-contrib-python-headless` 包版本，不取报销工具版本。主安装包默认仍不包含 `cv2`、`numpy`、`numpy.libs` 或 `wechat_qrcode`。

校验本地产物：

```powershell
.\scripts\validate_tauri_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

### 6. 打包完成后验证

运行安装包完成当前用户安装，再从开始菜单启动“报销管理”。

期望行为：

- 打开 Tauri 原生窗口，显示业务界面
- Tauri 启动 `reimbursement-sidecar.exe` 子进程，随机本机端口 + 会话令牌鉴权
- 首次启动提示“新建空白数据”或“从旧便携版迁移”
- 数据落到 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime`
- 日志写入 `runtime\logs\sidecar.log`
- 关闭窗口后 sidecar 子进程退出

检查是否有残留进程：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*报销管理*' -or $_.ProcessName -like '*reimbursement-sidecar*' }
```

关闭窗口后，该命令应无输出。强杀主进程（模拟崩溃）后同样应无输出——sidecar 由 Windows Job Object 兜底回收。

---

## 二、安装说明

本段用于最终用户或测试人员运行已经打包好的安装包。此场景不需要安装源码依赖。

### 1. 运行需要的依赖

最终用户运行安装包时，明确需要：

- **Windows 10 / Windows 11 64 位**
- **Microsoft Edge WebView2 Runtime**
  - 常规安装包在缺失时联网自动下载安装（bootstrapper）
  - 完全离线安装包自带完整安装器，断网环境也能装

最终用户不需要安装：

- Node.js
- npm
- Python
- pip
- PyInstaller
- Rust / Visual Studio Build Tools
- Vite
- React 相关依赖

这些都已经在打包阶段处理完毕，或被打进安装包。

### 2. 安装方式

双击安装包：

```text
报销管理_X.Y.Z_x64-setup.exe
```

安装为当前用户安装，不需要管理员权限。安装包未做 Authenticode 代码签名，Windows SmartScreen 可能提示“已保护你的电脑”；确认来源后选择“更多信息”→“仍要运行”。

安装完成后从开始菜单或桌面快捷方式启动。

### 3. 首次启动与数据迁移

首次启动会提示两种选择：

1. **新建空白数据**：直接在 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime` 建立空数据目录。
2. **从旧便携版迁移**：选择旧的 `报销管理` 目录，迁移 `data\`（含 `data\backups\`）、`uploads\`、`vendor\` 和 `window-state.json`。

迁移在临时目录完成路径、哈希和数据库完整性校验后原子启用；失败时新目录不变、旧目录只读不动，可重试。`logs\`、`browser-profile\`、`versions\`、`current-version.json` 和 `portable-release.json` 不迁移。

发票二维码默认使用主包内的 `zxing-cpp`。如需切换到 OpenCV WeChatQRCode 兼容模式，先把 `opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip` 解压到 `runtime\vendor\`，再在「个性化设置」保存 OpenCV 选项。runtime 包缺失或损坏时设置保存失败并显示错误；历史设置为 OpenCV 但运行时不可用时，解析会记录诊断并回退 zxing。

### 4. 运行时数据目录

```text
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\data\expense.db
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\data\backups\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\uploads\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\logs\sidecar.log
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\vendor\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\window-state.json
```

说明：

- `data\expense.db`：SQLite 数据库
- `data\backups\`：备份 ZIP
- `uploads\`：上传的发票附件
- `logs\sidecar.log`：sidecar 启动和错误日志
- `vendor\`：可选运行时组件，例如 OpenCV 兼容包
- `window-state.json`：桌面窗口大小和位置

数据离开安装目录，卸载重装不会丢数据。备份或迁移时，复制整个 `runtime` 目录最稳。

### 5. 更新

程序启动时最多每 24 小时检查一次更新，也可在「数据维护」手动检查。有新版本时提示，确认后下载、验签（minisign 公钥内置于安装包）、创建 `pre_update` 备份，再以 NSIS `passive` 模式安装并自动重启。数据结构不兼容时拒绝安装。最近 3 份 `pre_update` 备份保留在 `runtime` 同级目录。

### 6. 安装后验证流程

启动后建议按以下顺序验证：

1. 新增报销单
2. 填写基础信息
3. 录入行程
4. 上传 PDF 发票或图片发票
5. 确认发票金额
6. 预览 PDF
7. 下载 PDF（走原生保存对话框）
8. 状态从草稿流转到已打印、已报销
9. 使用列表筛选和导出
10. 查看统计看板数据是否同步变化
11. 创建一次完整备份并导出诊断包

### 7. 常见问题

#### 双击快捷方式没有窗口

查看日志：

```powershell
Get-Content "$env:LOCALAPPDATA\com.winloud.reimbursementtool\runtime\logs\sidecar.log"
```

常见原因：

- 缺少 Microsoft Edge WebView2 Runtime，且目标电脑无法联网安装
- 安全软件拦截安装包、主程序或 `reimbursement-sidecar.exe` 子进程
- 本机回环端口被安全策略阻止，sidecar 无法输出 ready 握手，桌面壳等待 30 秒后报错

可处理方式：

- 使用完全离线安装包，或手动安装 Microsoft Edge WebView2 Evergreen Runtime
- 将安装目录和 `%LOCALAPPDATA%\com.winloud.reimbursementtool` 加入安全软件信任
- 重新启动程序

#### 关闭窗口后仍有进程

检查：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*报销管理*' -or $_.ProcessName -like '*reimbursement-sidecar*' }
```

正常情况下应无输出。如仍有进程，先手动结束，再查看 `runtime\logs\sidecar.log` 并反馈。

#### 中文路径显示乱码

PowerShell 输出中可能显示乱码，但不一定影响程序运行。以实际目录是否生成、程序是否能启动为准。
