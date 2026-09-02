# 当前开发计划

> 只记录当前目标、范围、验收条件和阻塞；完成结果、长期验证和技术决策分别写入 `CHANGELOG.md`、`docs/testing/`、`docs/decisions/`。正式发布前冻结本文件。

## 状态

- 版本号：v2.0.0
- 计划状态：规划中
- 预计版本类型：正式发布

## 目标

- [x] 在不替换稳定 ZIP Target 的前提下增加 Tauri 桌面壳，Tauri 管窗口、安装、更新和进程生命周期。
- [x] Tauri 使用 PyInstaller API sidecar；ZIP 继续使用 `desktop_app.py` 和 pywebview/Chrome 回退。
- [x] Tauri 数据固定到 `%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime`；ZIP 继续使用便携根目录，两者隔离。
- [x] Tauri 更新使用 GitHub Releases `latest.json` + 签名 NSIS；ZIP 保留原有整包更新和版本切换。

## 范围

- 本轮包含：在共享业务源码上并行保留 ZIP 与 Tauri 两种桌面 Target，最终架构契约见 `docs/decisions/0011-final-dual-target-architecture.md`。业务逻辑、React、FastAPI、SQLite、schema v7 不变。
- 本轮不包含：Authenticode 代码签名（首期不做，保留 SmartScreen 风险说明）；差分更新；Linux 服务器部署同步（未明确版本号和发布前验证前不主动同步或部署）。

## 验收条件

- [x] 阶段 2 门槛：Tauri 启动真实 Python sidecar，窗口显示业务界面，正常关闭/崩溃/更新不遗留后台进程。
- [ ] 数据迁移：实际便携目录副本迁移后核对库行数、附件哈希、备份和设置一致；失败可重试，旧目录不变。
- [ ] 下载：PDF、批量 ZIP、数据导出、备份、诊断包覆盖保存成功、取消、重名、不可写路径及非法后端路径。
- [ ] 安装矩阵：Windows 10/11 x64；在线包有/无 WebView2；离线包断网无 WebView2 干净环境；卸载重装不删 AppLocalData 数据。
- [ ] 更新矩阵：测试签名和测试 feed 完成预览版间升级、安装后重启、升级前备份、签名篡改拒绝、不兼容数据结构拒绝。
- [ ] 业务烟测：报销单 CRUD、发票/附件上传与预览、PDF 生成与保存、数据导入导出、备份恢复、OpenCV 兼容模式。
- [x] `scripts/verify.ps1` 全档位（含新增 `Desktop`）通过。

## 阻塞

- 无。
