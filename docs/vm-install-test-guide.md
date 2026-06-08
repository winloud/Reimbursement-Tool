# 虚拟机打包与安装测试说明

本文分两部分：

1. **打包说明**：在虚拟机中从源码安装开发/打包依赖，并生成 `报销管理.exe`。
2. **安装说明**：把已经打包好的 `dist/报销管理` 复制到用户电脑后，运行 EXE 时需要哪些依赖、程序会自动检测和安装什么。

---

## 一、打包说明

本段用于验证一台干净 Windows 虚拟机是否能从源码完整安装依赖、运行测试、构建前端，并打包出桌面版 EXE。

### 1. 打包环境依赖

从源码打包需要安装以下依赖：

- **Windows 10 / Windows 11 64 位**
- **Python 3.10 或 3.11**
  - 安装时勾选 `Add python.exe to PATH`
  - 用于运行 FastAPI 后端、测试、PyInstaller 打包
- **Node.js 20 LTS 或更高版本**
  - 用于安装前端依赖并执行 `npm run build`
  - 注意：Node.js 只在打包阶段需要，最终运行 EXE 不需要
- **npm**
  - 随 Node.js 一起安装
- **PowerShell**
  - 用于执行 `scripts/build_release.ps1`
- **网络访问**
  - 用于下载 Python 包和 npm 包

验证基础工具：

```powershell
python --version
node --version
npm --version
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

安装后端运行依赖：

```powershell
python -m pip install -r backend\requirements.txt
```

安装打包依赖：

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
- `opencv-contrib-python-headless`
- `pyinstaller`
- `pywebview`

验证关键依赖：

```powershell
python -m PyInstaller --version
python -c "import webview, uvicorn, fastapi, fitz, cv2; print('python deps ok')"
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
- `axios`
- `vite`
- `@vitejs/plugin-react`
- `recharts`
- `zustand`

这些依赖只用于源码开发/前端构建。打包后的 EXE 不要求用户电脑安装 Node.js 或 npm。

### 4. 运行测试与前端构建

在项目根目录执行：

```powershell
python -m pytest
node --test frontend/src/**/*.test.js
cd frontend
npm run build
cd ..
```

期望结果：

- 后端测试全部通过
- 前端 Node 测试全部通过
- `npm run build` 成功
- Vite 可能提示 chunk size 警告，该警告不影响当前功能

### 5. 打包 EXE

在项目根目录执行：

```powershell
.\scripts\build_release.ps1
```

该脚本会执行：

1. `npm run build`
2. `python -m PyInstaller --clean --noconfirm reimbursement_tool.spec`

成功后生成：

```text
dist\报销管理\报销管理.exe
```

发布目录结构：

```text
dist\报销管理\
├── 报销管理.exe
├── _internal\
├── data\      # 首次启动后自动生成
├── uploads\   # 上传发票后自动生成
└── logs\      # 首次启动后自动生成
```

### 6. 打包完成后验证

双击：

```text
dist\报销管理\报销管理.exe
```

期望行为：

- 打开独立桌面窗口
- 不打开系统浏览器
- 自动启动本机 FastAPI 服务
- 首次启动后生成 `dist\报销管理\data\expense.db`
- 写入日志 `dist\报销管理\logs\app.log`
- 关闭窗口后后台进程退出

检查是否有残留进程：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*报销管理*' }
```

关闭窗口后，该命令应无输出。

---

## 二、安装说明

本段用于最终用户或测试人员运行已经打包好的 EXE。此场景不需要安装源码依赖。

### 1. 运行 EXE 需要的依赖

最终用户运行 `报销管理.exe` 时，明确需要：

- **Windows 10 / Windows 11 64 位**
- **Microsoft Edge WebView2 Runtime**
  - 用于显示 pywebview 桌面窗口
  - 程序启动时会自动检测
  - 如果缺失，程序会自动联网下载 Microsoft Evergreen Bootstrapper 并尝试静默安装

最终用户不需要安装：

- Node.js
- npm
- Python
- pip
- PyInstaller
- Vite
- React 相关依赖

这些都已经在打包阶段处理完毕，或被打进 EXE 发布目录。

### 2. 安装方式

将整个发布目录复制到目标电脑：

```text
dist\报销管理\
```

不要只复制单个 EXE。`_internal` 目录包含程序运行所需的 Python、前端静态文件、PDF 模板、二维码识别模型和其他库文件。

推荐交付目录：

```text
报销管理\
├── 报销管理.exe
└── _internal\
```

用户双击：

```text
报销管理.exe
```

### 3. 自动依赖检测与安装

EXE 启动后会先检测 WebView2 Runtime：

1. 如果检测到 WebView2 Runtime，继续启动应用。
2. 如果未检测到 WebView2 Runtime，自动下载微软 Evergreen Bootstrapper。
3. 下载完成后尝试静默安装。
4. 安装成功后继续启动应用。
5. 如果下载或安装失败，弹出错误提示，并写入日志。

自动安装要求：

- 目标电脑可以访问微软下载地址
- 当前用户权限允许安装 WebView2 Runtime
- 安全软件没有拦截安装器

### 4. 运行时数据目录

发布版数据默认保存在 EXE 同级目录：

```text
报销管理\data\expense.db
报销管理\uploads\
报销管理\logs\app.log
```

说明：

- `data\expense.db`：SQLite 数据库
- `uploads\`：上传的发票附件
- `logs\app.log`：启动和错误日志

备份或迁移时，复制整个 `报销管理` 目录最稳。

### 5. 安装后验证流程

启动 EXE 后，建议按以下顺序验证：

1. 新增报销单
2. 填写基础信息
3. 录入行程
4. 上传 PDF 发票或图片发票
5. 确认发票金额
6. 预览 PDF
7. 下载 PDF
8. 状态从草稿流转到已打印、已报销
9. 使用列表筛选和导出
10. 查看统计看板数据是否同步变化

### 6. 常见问题

#### EXE 双击没有窗口

查看日志：

```powershell
Get-Content .\logs\app.log
```

常见原因：

- WebView2 Runtime 缺失，且自动安装失败
- 目标电脑不能访问微软 WebView2 下载地址
- 安全软件拦截 EXE 或 WebView2 安装器
- 本机端口被安全策略阻止

可处理方式：

- 手动安装 Microsoft Edge WebView2 Evergreen Runtime
- 将整个 `报销管理` 目录加入安全软件信任
- 重新启动 EXE

#### 关闭窗口后仍有进程

检查：

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*报销管理*' }
```

如果仍有进程，可先手动结束，再查看 `logs\app.log`。

#### 中文路径显示乱码

PowerShell 输出中可能显示乱码，但不一定影响程序运行。以实际目录是否生成、EXE 是否能启动为准。
