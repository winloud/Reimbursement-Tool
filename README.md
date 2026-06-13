# 报销管理 V1.1.0 发布说明

发布日期：2026-06-09

## 版本定位

报销管理 V1.1.0 是一个本地单机运行的出差旅费报销管理工具，用于录入出差信息、管理发票、生成公司模板报销 PDF，并查看历史报销统计。

## 核心功能

- 报销单新增、编辑、删除、恢复和彻底删除
- 出差基础信息、行程、途中补贴、预支旅费和其他费用录入
- PDF 发票和图片发票上传、预览、金额解析与手动确认
- 报销单 PDF 预览、下载，以及下载后自动标记为已打印
- 草稿、已打印、已报销状态流转和已报销锁定
- 报销单管理页筛选、单张预览/下载、批量下载、批量删除
- 回收站恢复和彻底删除
- 完整报销数据 ZIP 导入导出
- 总览看板金额、出差天数、费用分布、趋势和出差负荷热力图
- 个性化设置：默认部门、出差人、途中补贴标准、PDF 填充字体、发票二维码识别引擎

## 运行要求

- Windows 10 / Windows 11 64 位
- Chromium 内核运行环境，满足其一即可：
  - Google Chrome
  - Microsoft Edge WebView2 Runtime
  - Microsoft Edge

最终用户不需要安装 Python、Node.js、npm、PyInstaller 或其他源码开发依赖。

## 安装和启动

1. 解压发布 ZIP，例如 `报销管理-v1.1.0-20260614.zip`。
2. 保留完整的 `报销管理` 文件夹，不要只复制单个 EXE。
3. 双击运行：

```text
报销管理\报销管理.exe
```

程序首次启动会自动创建本地数据库、附件目录和日志目录。

## 数据位置和备份

运行数据保存在 EXE 同级目录：

```text
报销管理\data\expense.db
报销管理\uploads\
报销管理\logs\app.log
报销管理\browser-profile\
```

说明：

- `data\expense.db`：本地 SQLite 数据库
- `uploads\`：上传的发票附件
- `logs\app.log`：启动和错误日志
- `browser-profile\`：使用 Chrome 或 Edge 独立窗口模式时可能生成

备份或迁移时，复制整个 `报销管理` 文件夹最稳妥。

## 首次使用建议

1. 打开「个性化设置」，填写默认部门、出差人和途中补贴标准。
2. 选择可用的 PDF 填充字体。
3. 新建一张测试报销单，录入行程并上传一张发票。
4. 确认发票金额后，测试 PDF 预览和下载。
5. 下载成功后，检查报销单状态是否流转为「已打印」。

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

`_internal` 目录包含程序运行所需的前端文件、Python 运行库、PDF 模板和主程序依赖。只复制 EXE 会导致程序无法启动。

### OpenCV 兼容模式

V1.1.0 主包默认使用 `zxing-cpp` 识别发票二维码，不包含 OpenCV、NumPy 或 WeChatQRCode 模型。需要兼容模式时，将 `opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip` 放到 `报销管理.exe` 同级目录，再到「个性化设置」切换为 OpenCV WeChatQRCode。

### 如何迁移到另一台电脑

关闭程序后，复制整个 `报销管理` 文件夹到新电脑。新电脑仍需满足运行要求中的 Chromium 内核运行环境。
