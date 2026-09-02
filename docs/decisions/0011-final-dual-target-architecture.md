# ADR 0011：冻结 ZIP / Tauri 双 Distribution Target 最终架构

## 状态

已采纳。本文取代 ADR 0009 中“Tauri 取代 ZIP”的单轨结论，并取代 ADR 0010 的迁移期边界描述；ADR 0009、0010 保留为历史决策。

## 背景

便携 ZIP 与 Tauri 是同一报销产品的两种 Windows 桌面发行形态。两者共享业务模型、数据库结构、Python/FastAPI 后端和 React/MUI 前端，实际差异集中在桌面壳、运行路径、HTTP 会话鉴权、文件保存和更新发布链。用长期 Git 分支或复制业务源码区分发行形态会让修复和数据契约持续漂移。

## 决策

- 仓库长期维护一套业务源码；ZIP 与 Tauri 是两个 Distribution Target，不是两个产品或两条长期 Git 分支。
- Python/FastAPI backend、React/MUI frontend、SQLite schema 与业务服务保持共享。
- 前端只通过 `frontend/src/platform` 的 Platform Adapter 使用运行时初始化、受保护资源读取、文件保存、运行时边界和更新区能力；业务页面不直接依赖 Tauri API。
- 后端只通过显式 `REIMBURSEMENT_DISTRIBUTION_TARGET=zip|tauri` 选择发行边界。缺失、空字符串或非法值均立即失败，不使用 session token、路径变量或其他副作用猜测 Target。
- ZIP 入口显式指定 `zip`；Tauri sidecar 显式指定 `tauri`。源码 Web/FastAPI 开发、Linux 部署和默认 pytest 套件显式使用 `zip`。
- ZIP updater、版本切换与便携升级保持独立；Tauri 使用自身的签名 updater，两者不合并。
- ZIP 与 Tauri 各自保留 PyInstaller spec、构建器和 validator。`scripts/build_target.ps1` 只负责固定版本、日期、commit、构建顺序和隔离输出，再编排两条现有链路，不替代其实现。
- Git 分支只表达代码变化。长期主线是 `main`；功能、修复和重构可使用临时分支，分支名不表示发行 Target。
- 同一个干净 commit 可以分别构建 ZIP 与 Tauri，或用 `-Target All` 生成两套产物；产物携带同一个版本、发布日期和 commit 元数据。

## 目标边界

| 边界 | ZIP Target | Tauri Target |
| --- | --- | --- |
| 桌面壳 | `desktop_app.py` + portable launcher | Rust/Tauri + `sidecar_app.py` |
| 数据目录 | 便携安装根目录 | AppLocalData `runtime` |
| API 会话 | 普通本机 HTTP | 随机 session token |
| 文件保存 | 浏览器 HTTP 下载 | Tauri 原生保存 |
| 更新 | ZIP manifest、安装与版本切换 | 签名 NSIS 与 updater feed |
| 构建/校验 | ZIP builder + ZIP validator | Tauri builder + Tauri validator |

两个 Target 不共享数据库、附件、日志、更新暂存或构建输出目录。Tauri 的 AppLocalData 优先规则和 ZIP 的便携路径 fallback 均不得被另一 Target 改写。

## 影响

业务修复只需进入一套共享源码和测试；平台差异有明确边界。同一 commit 能生成两种发行产物，但发布验收仍需分别覆盖 ZIP 便携升级路径以及 Tauri 安装、迁移、原生保存和签名更新路径。
