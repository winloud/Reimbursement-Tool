# 报销管理 V1.4.2 发布说明

发布日期：2026-08-29

## 版本定位

报销管理 V1.4.2 是一个本地单机运行的出差旅费报销管理工具，用于录入出差信息、管理发票、生成公司模板报销 PDF，并查看历史报销统计。桌面端由 Tauri 承载窗口、安装、更新和进程生命周期，业务后端以本机 API sidecar 方式运行。

## 核心功能

- 报销单新增、编辑、删除、恢复和彻底删除
- 出差基础信息、行程、途中补贴、预支旅费和其他费用录入
- PDF 发票逐页识别，图片发票二维码识别，金额解析后可手动确认
- 报销单 PDF 预览、单张下载、批量下载，以及下载后自动标记为已打印
- 草稿、已打印、已报销状态流转；已打印后不再自动改动报销日期
- 报销单管理页筛选、默认按出差开始日期倒序、批量操作和回收站
- 完整报销数据 ZIP 导入导出，危险操作前自动创建安全快照
- 独立“数据维护”页面：备份恢复、数据库检查、诊断包导出、程序更新
- 总览看板金额、出差天数、费用分布、趋势和出差负荷热力图
- 个性化设置：默认部门、出差人、途中补贴标准、自动保存延时、PDF 填充字体、发票二维码识别引擎

## 运行要求

- Windows 10 / Windows 11 64 位
- Microsoft Edge WebView2 Runtime；常规安装包在缺失时联网自动安装，离线安装包自带完整安装器

最终用户不需要安装 Python、Node.js、npm、PyInstaller 或其他源码开发依赖。

## 安装和启动

1. 下载安装包，例如 `报销管理_1.4.2_x64-setup.exe`。
2. 双击运行安装程序，按提示完成安装。安装为当前用户安装，不需要管理员权限。
3. 从开始菜单或桌面快捷方式启动“报销管理”。

首次安装的安装包未做 Authenticode 代码签名，Windows SmartScreen 可能提示“已保护你的电脑”。确认来源无误后选择“更多信息”→“仍要运行”即可。

## 从旧版升级

### 从便携 ZIP 版（V1.x）升级

1. 关闭旧版 `报销管理.exe`。
2. 安装新版安装包。
3. 首次启动时选择“从旧便携版迁移”，指定旧的 `报销管理` 目录。

迁移会复制旧目录中的 `data\`（含 `data\backups\`）、`uploads\`、`vendor\` 和 `window-state.json`，在临时目录完成路径、哈希和数据库完整性校验后原子启用。迁移不修改旧目录，失败时新目录保持不变，可重试；旧便携目录本身就是恢复点。

`logs\`、`browser-profile\`、`versions\`、`current-version.json` 和 `portable-release.json` 属于旧发行体系，不迁移。

### 从已安装的新版升级

程序启动时最多每 24 小时检查一次更新。有新版本时会提示，确认后自动下载、验签并安装，安装前自动创建 `pre_update` 备份，安装完成后自动重启。卸载重装不会删除运行数据。

## 数据位置和备份

运行数据保存在用户本地应用数据目录，与安装目录分离：

```text
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\data\expense.db
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\data\backups\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\uploads\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\logs\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\vendor\
%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\window-state.json
```

说明：

- `data\expense.db`：本地 SQLite 数据库。
- `data\backups\`：备份 ZIP。
- `uploads\`：上传的发票附件。
- `logs\`：启动和错误日志。
- `vendor\`：可选运行时组件，例如 OpenCV 兼容包。
- `window-state.json`：桌面窗口大小和位置。

备份或迁移时，复制整个 `runtime` 文件夹最稳妥。程序内的完整备份 ZIP 同样覆盖数据库和附件。

## 数据维护

进入「数据维护」可以执行这些操作：

- 创建完整备份 ZIP，并下载最近备份。
- 选择备份 ZIP 预览后执行恢复；恢复前会自动创建 `pre_restore_*.zip`。
- 删除选中备份，或一键清理旧备份。
- 检查数据库完整性，覆盖 SQLite、外键、业务一致性和附件状态。
- 导出诊断包，包含版本号、数据目录、QR 引擎、日志路径、配置摘要、环境信息和日志尾部。
- 查看更新状态并手动检查更新。

更新会检查数据结构兼容范围。缺少兼容性信息或不兼容时，程序会拒绝安装，避免旧程序打开新结构数据。

## 首次使用建议

1. 打开「个性化设置」，填写默认部门、出差人和途中补贴标准。
2. 选择可用的 PDF 填充字体。
3. 新建一张测试报销单，录入行程并上传一张发票。
4. 确认发票金额后，测试 PDF 预览和下载。
5. 打开「数据维护」，创建一次完整备份，并导出一次诊断包确认路径正常。

## 常见问题

### 双击快捷方式没有窗口

先查看日志：

```powershell
Get-Content "$env:LOCALAPPDATA\com.winloud.reimbursementtool\runtime\logs\sidecar.log"
```

常见原因：

- 缺少 Microsoft Edge WebView2 Runtime，且目标电脑无法联网安装
- 安全软件拦截安装包、主程序或 API sidecar 子进程
- 本机安全策略阻止本地回环端口

处理方式：

- 使用离线安装包，或手动安装 Microsoft Edge WebView2 Runtime
- 将安装目录和 `%LOCALAPPDATA%\com.winloud.reimbursementtool` 加入安全软件信任
- 重新启动程序

### OpenCV 兼容模式

V1.4.2 主包默认使用 `zxing-cpp` 识别发票二维码，不包含 OpenCV、NumPy 或 WeChatQRCode 模型。需要兼容模式时，把 `opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip` 解压到 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime\vendor\`，再到「个性化设置」切换为 OpenCV WeChatQRCode。

### 如何回退旧版本

下载并运行目标旧版本的安装包覆盖安装。旧版安装器可以直接读取现有 `runtime` 数据。每次自动更新前保留的最近 3 份 `pre_update` 备份放在 `runtime` 同级目录，可用于恢复。

### 如何迁移到另一台电脑

关闭程序后，在新电脑上安装同版本安装包，再把旧电脑的 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime` 整个文件夹复制过去。
