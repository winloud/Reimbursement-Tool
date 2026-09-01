# ZIP / Tauri 双 Target 重构基线

> 本文只冻结双 Target 重构的行为与代码对照点。后续阶段的自动化或人工验证结果应记录在各自的验证文档中，不回写或移动以下基线提交。

- 冻结日期：2026-09-01
- 双 Target 集成分支：`refactor/dual-target`
- 集成 worktree：`F:\Documents\Reimbursement-Tool-dual-target`
- 共同历史基线：`35f4f81698e62663e233c9517bf1044eb79f6f62`（v1.4.1）

## ZIP v1.4.2 基线

- 分支：`main`
- 提交：`0afd5da1cf8943e62f28ab216b02b642c25d755b`
- tag：`v1.4.2`
- 用途：稳定 ZIP / Chrome app-mode / pywebview 发布方式的代码与行为对照。
- 对照 worktree：`F:\Documents\报销单开发`

## Tauri A 阶段验收基线

- 分支：`codex/tauri-shell-v2`
- 提交：`5a52f43d5a686efcdb5ef2b32e4059445231854d`
- 用途：Tauri 壳、Python sidecar、AppLocalData、原生下载、NSIS 与已完成功能的代码和行为对照。
- 验收边界：用户已确认 A 阶段人工测试通过；B 阶段签名更新与升级流程尚未测试。
- 对照 worktree：`F:\Documents\Reimbursement-Tool-tauri-v2`

## 后续使用约束

- `refactor/dual-target` 从 Tauri A 阶段验收基线创建，阶段 1 只同步 ZIP v1.4.2 相对共同基线新增的共享业务代码。
- 两个对照 worktree 保持不动；双 Target 重构仅在独立集成 worktree 进行。
- 后续代码变化不能自动继承上述人工验收结论；凡触及相应路径，应按阶段重新验证。
- B 阶段通过前，不把 Tauri updater 视为已验收或可正式发布。
