# ZIP 本地安装、升级和备份指南

> 本文档记录当前开发版的 ZIP 本地升级方案。正式发布时，再将对应内容同步到根目录 `README.md` 的发布说明。

## 首次安装

1. 解压发布 ZIP，例如 `报销管理-vX.Y.Z-yyyymmdd.zip`。
2. 保留完整的 `报销管理` 文件夹，不要只复制单个 EXE。
3. 双击运行 `报销管理\报销管理.exe`。

新版 ZIP 使用便携式安装根目录。根目录 `报销管理.exe` 是启动器，真实程序保存在 `versions\<version>\` 下。程序首次启动会在 `报销管理\` 根目录创建本地运行数据。

发布 ZIP 根目录只包含 `报销管理\` 文件夹；说明文档、升级脚本和版本 manifest 都放在这个文件夹内，解压时不会散落到外层目录。

## 从旧 ZIP 版本升级

从旧版单目录 ZIP 迁移到便携式安装根目录时，推荐使用“新旧目录并行升级”，不要直接把新版文件覆盖到旧目录上：

1. 关闭旧版 `报销管理.exe`。
2. 解压新版 ZIP 到一个新目录。
3. 在新版 ZIP 根目录打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\upgrade_zip_release.ps1 -OldAppDir "D:\旧版\报销管理" -NewAppDir "D:\新版\报销管理"
```

脚本会先创建升级备份 ZIP，再把旧目录中的 `data\`、`uploads\`、`vendor\` 和 `window-state.json` 复制到新版 `报销管理\` 根目录。脚本不会删除旧目录，也不会覆盖新版目录中已有的运行态数据。

手动升级时，至少复制以下目录：

```text
data\
uploads\
vendor\
window-state.json
```

不要把新版 ZIP 中的空程序目录直接覆盖旧目录后再清理文件；这样容易误删本地数据库或发票附件。

## 后续程序内更新

完成便携式安装后，后续更新可以在程序内完成：

1. 打开旧版程序，进入「个性化设置」→「数据维护」。
2. 点击“选择更新 ZIP”，选择新版 `报销管理-vX.Y.Z-yyyymmdd.zip`。
3. 确认预览版本号后点击“安装更新”。
4. 程序会先创建 `pre_update_*.zip` 完整备份，再把新版本安装到 `versions\<version>\` 并切换 `current-version.json`。
5. 关闭程序，重新双击根目录 `报销管理\报销管理.exe`。

程序内更新不会删除旧版本目录。若新版本启动异常，可保留现场后人工检查 `current-version.json`、`versions\` 和 `data\backups\`。

## 运行态目录

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

- `报销管理.exe`：根目录启动器。
- `current-version.json`：当前启动版本指针。
- `versions\`：各版本真实程序目录。
- `data\expense.db`：本地 SQLite 数据库。
- `uploads\`：上传的发票附件。
- `logs\app.log`：启动和错误日志。
- `browser-profile\`：Chrome 或 Edge 独立窗口模式可能生成的浏览器配置。
- `vendor\`：可选运行时组件，例如 OpenCV 兼容包。
- `window-state.json`：桌面窗口大小和位置。

## 程序内备份和恢复

进入「个性化设置」→「数据维护」：

- “创建备份”会生成完整备份 ZIP，包含数据库、发票附件、可选运行时组件和最近日志摘要。
- “下载最近备份”可保存当前最新备份。
- “选择备份 ZIP”会先预览备份内容。
- “执行恢复”会替换当前数据库和附件；执行前程序会自动创建 `pre_restore_*.zip` 恢复前备份。
- “选择更新 ZIP”会预览新版发布包；“安装更新”执行前会自动创建 `pre_update_*.zip` 完整备份。
- “导出诊断”会下载版本号、运行路径、数据库/附件/备份状态和最近备份摘要。
