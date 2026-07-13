# 报销管理 V1.2.5 发布说明

发布日期：2026-07-13

## 版本定位

报销管理 V1.2.5 是一个本地单机运行的出差旅费报销管理工具，用于录入出差信息、管理发票、生成公司模板报销 PDF，并查看历史报销统计。本版本延续 V1.2.0 的功能基线，并优化发布预检、GitHub Release 打包和可选 OpenCV runtime 复用流程。

## 核心功能

- 报销单新增、编辑、删除、恢复和彻底删除
- 出差基础信息、行程、途中补贴、预支旅费和其他费用录入
- PDF 发票逐页识别，图片发票二维码识别，金额解析后可手动确认
- 报销单 PDF 预览、单张下载、批量下载，以及下载后自动标记为已打印
- 草稿、已打印、已报销状态流转；已打印后不再自动改动报销日期
- 报销单管理页筛选、默认按出差开始日期倒序、批量操作和回收站
- 完整报销数据 ZIP 导入导出，危险操作前自动创建安全快照
- 独立“数据维护”页面：程序更新、版本切换、备份恢复、数据库检查、诊断包导出
- 总览看板金额、出差天数、费用分布、趋势和出差负荷热力图
- 个性化设置：默认部门、出差人、途中补贴标准、自动保存延时、PDF 填充字体、发票二维码识别引擎

## 运行要求

- Windows 10 / Windows 11 64 位
- Chromium 内核运行环境，满足其一即可：
  - Google Chrome
  - Microsoft Edge WebView2 Runtime
  - Microsoft Edge

最终用户不需要安装 Python、Node.js、npm、PyInstaller 或其他源码开发依赖。

## 安装和启动

1. 解压发布 ZIP，例如 `报销管理-v1.2.5-20260713.zip`。
2. 保留完整的 `报销管理` 文件夹，不要只复制单个 EXE。
3. 双击运行：

```text
报销管理\报销管理.exe
```

V1.2.5 使用便携式安装根目录。根目录 `报销管理.exe` 是启动器，真实程序保存在 `versions\1.2.5\` 下。程序首次启动会在 `报销管理\` 根目录创建本地数据库、附件目录、日志目录和浏览器配置目录。

## 从旧版升级

从旧版 ZIP 迁移到 V1.2.5 时，推荐新旧目录并行升级：

1. 关闭旧版 `报销管理.exe`。
2. 解压 V1.2.5 ZIP 到一个新目录，例如 `D:\新版\报销管理`。
3. 打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File "D:\新版\报销管理\upgrade_zip_release.ps1" -OldAppDir "D:\旧版\报销管理" -NewAppDir "D:\新版\报销管理"
```

脚本会先创建升级备份 ZIP，再复制旧目录中的 `data\`、`uploads\`、`vendor\` 和 `window-state.json`。脚本不会删除旧目录，也不会覆盖新版目录中已有的运行态数据。

完成便携式安装后，后续可以在「数据维护」中选择新版发布 ZIP，预览后安装更新。程序会先创建完整备份，再把新版本安装到 `versions\<version>\`，并在重启后生效。

## 数据位置和备份

运行数据保存在 `报销管理\` 安装根目录：

```text
报销管理\报销管理.exe
报销管理\current-version.json
报销管理\versions\
报销管理\data\expense.db
报销管理\uploads\
报销管理\logs\app.log
报销管理\browser-profile\
报销管理\vendor\
报销管理\window-state.json
```

说明：

- `报销管理.exe`：根目录启动器。
- `current-version.json`：当前启动版本指针。
- `versions\`：各版本真实程序目录。
- `data\expense.db`：本地 SQLite 数据库。
- `uploads\`：上传的发票附件。
- `logs\app.log`：启动和错误日志。
- `browser-profile\`：Chrome 或 Edge 独立窗口模式可能生成的浏览器配置。
- `vendor\`：可选运行时组件，例如 OpenCV 兼容包。
- `window-state.json`：桌面窗口大小和位置。

备份或迁移时，复制整个 `报销管理` 文件夹最稳妥。

## 数据维护

进入「数据维护」可以执行这些操作：

- 创建完整备份 ZIP，并下载最近备份。
- 选择备份 ZIP 预览后执行恢复；恢复前会自动创建 `pre_restore_*.zip`。
- 选择发布 ZIP 预览后安装更新；更新前会自动创建 `pre_update_*.zip`。
- 切换到已安装版本；切换前会自动创建 `pre_version_switch_*.zip`。
- 删除选中备份或旧版本，也可以一键清理旧备份和旧版本。
- 检查数据库完整性，覆盖 SQLite、外键、业务一致性和附件状态。
- 导出诊断包，包含版本号、数据目录、QR 引擎、浏览器/WebView2 状态、日志路径、配置摘要、环境信息和日志尾部。

程序内更新和版本切换会检查数据结构兼容范围。缺少兼容性信息或不兼容时，程序会禁止自动安装或切换，避免旧程序打开新结构数据。

## 首次使用建议

1. 打开「个性化设置」，填写默认部门、出差人和途中补贴标准。
2. 选择可用的 PDF 填充字体。
3. 新建一张测试报销单，录入行程并上传一张发票。
4. 确认发票金额后，测试 PDF 预览和下载。
5. 打开「数据维护」，创建一次完整备份，并导出一次诊断包确认路径正常。

## 常见问题

### 双击 EXE 没有窗口

先查看日志：

```powershell
Get-Content .\logs\app.log
```

常见原因：

- 未安装 Google Chrome、Microsoft Edge WebView2 Runtime 或 Microsoft Edge
- 目标电脑无法联网安装 WebView2 Runtime
- 安全软件拦截 EXE 或 WebView2 安装器
- 本机安全策略阻止本地服务端口

处理方式：

- 手动安装 Google Chrome、Microsoft Edge 或 Microsoft Edge WebView2 Runtime
- 将整个 `报销管理` 文件夹加入安全软件信任
- 重新启动 `报销管理.exe`

### 不要只复制 EXE

根目录 `报销管理.exe` 是启动器，`versions\1.2.1\` 和 `_internal\` 目录包含程序运行所需的前端文件、Python 运行库、PDF 模板和主程序依赖。只复制 EXE 会导致程序无法启动。

### OpenCV 兼容模式

V1.2.5 主包默认使用 `zxing-cpp` 识别发票二维码，不包含 OpenCV、NumPy 或 WeChatQRCode 模型。需要兼容模式时，将 `opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip` 放到 `报销管理.exe` 同级目录，再到「个性化设置」切换为 OpenCV WeChatQRCode。

### 如何回退旧版本

在「数据维护」的程序更新区域选择已安装版本并切换。切换前程序会自动备份，并检查数据结构兼容性。不建议手动修改 `current-version.json` 强行回退。

### 如何迁移到另一台电脑

关闭程序后，复制整个 `报销管理` 文件夹到新电脑。新电脑仍需满足运行要求中的 Chromium 内核运行环境。
