# ADR 0012：统一双 Target Release，并退役 Tauri 离线包

## 状态

已采纳。本文补充 ADR 0011，并取代 ADR 0009 中“同时发布常规与完全离线 NSIS”的决定。

## 背景

便携 ZIP 与 Tauri 是长期并行的两个 Windows Distribution Target，但分别运行发布 workflow 会重复测试、生成两份 manifest，并可能让同一 tag 的 Release 在两个任务间被交叉覆盖。Tauri 离线 NSIS 体积大，还需要单独维护 WebView2 离线安装与验收矩阵，实际交付价值不足。

## 决策

- 每个正式 `vX.Y.Z` tag 只运行一个 `Publish Release` workflow。
- workflow 从同一个不可变 tag 调用 `scripts/build_target.ps1 -Target All`，依次构建并校验便携 ZIP 与 Tauri。
- 同一个 GitHub Release 必须至少包含一个便携 ZIP、一个生产 updater 签名的 Tauri 在线 NSIS、该 NSIS 的签名、`latest.json`、`data-compat.json`、统一 manifest 和 SHA-256 清单。
- Tauri 只维护在线 NSIS。删除 `-Offline` 构建参数、离线输出目录和对应验收项，不再发布 `*-setup-offline.exe`。
- 目标电脑缺少 WebView2 时由常规安装包联网 bootstrap；断网环境需预先安装 WebView2 Runtime，不再由本项目提供内置 Runtime 的离线 NSIS。
- OpenCV 兼容运行库仍可作为辅助资产随 Release 发布，不视为第三个桌面 Distribution Target。

## 影响

正式发布只有一个状态机、一个 manifest 和一个 Release，ZIP 与 Tauri 的版本、日期和 commit 保持一致。发布耗时会集中到同一 Windows runner，因此 workflow 超时上限相应提高。完全断网且未安装 WebView2 的新机器不再属于 Tauri 安装支持范围，但便携 ZIP Target 继续可供用户选择。
