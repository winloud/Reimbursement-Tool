# ADR 0010：同一源码同时支持 ZIP 与 Tauri 桌面 Target

## 状态

已被 [ADR 0011](0011-final-dual-target-architecture.md) 取代并保留为迁移期历史决策。双 Target 最终契约以 ADR 0011 为准。

## 背景

便携 ZIP 已长期稳定运行，Tauri A 阶段也已完成人工验收。两种发行方式共享 React/MUI、FastAPI、SQLite、schema 和业务服务，差异主要位于桌面壳、运行路径、会话鉴权、文件保存和构建发布链。

用长期 Git 分支或两套业务源码区分产品形态会导致业务修复、数据结构和测试持续漂移。

## 决策

- 长期目标是一套源码、两个平台适配边界、两个 Build Target。
- ZIP Target 保留 desktop_app.py、便携 launcher、versions/、程序内 ZIP 更新和便携数据目录。
- Tauri Target 保留 Rust 壳、Python sidecar、会话令牌、AppLocalData、原生文件保存和签名 updater。
- REIMBURSEMENT_APP_ROOT 与 REIMBURSEMENT_APP_VERSION 注入优先于冻结产物路径推断，确保 Tauri 不退回 ZIP 数据目录。
- 两个 Target 不共享 SQLite、附件、日志或更新暂存目录。
- ZIP 与 Tauri 构建输出保持分离；阶段 5 再统一 build 命令和 CI 编排。

## 阶段 2 临时边界

为先恢复共存，本阶段允许两处待收敛的平台判断：

- 后端用是否存在 REIMBURSEMENT_SESSION_TOKEN 决定是否注册 ZIP 更新、版本切换和桌面重启路由。
- 前端维护页用现有 isInTauriEnvironment() 在 ZIP 更新 UI 与 Tauri updater UI 之间选择。

这些判断不扩展为通用 adapter；阶段 3/4 再分别收敛到前端 Platform Adapter 和后端双 Target 配置。
