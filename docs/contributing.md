# 协作与提交规范

## Git 提交信息

所有提交必须遵循 Conventional Commits：

```text
<type>(<scope>): <description>
```

- `type` 必填，使用小写英文：`feat`（新增用户可见功能）、`fix`（修复问题）、`docs`（文档）、`style`（不改变行为的格式或样式）、`refactor`（重构）、`test`（测试）、`build`（构建或依赖）、`ci`（持续集成）、`chore`（其他维护）或 `perf`（性能）。
- `scope` 可选，用于指出受影响区域，例如 `report-edit`、`ticket-import`、`backend`、`release` 或 `docs`。
- `description` 必填，简洁说明实际改动；可使用中文或英文，不使用含糊的“更新”“修改”等描述。
- 每个提交只包含一个完整、可验证的逻辑改动；混合工作区时只暂存本次提交涉及的文件。
- 不兼容变更在类型或范围后追加 `!`，并在提交正文中补充 `BREAKING CHANGE:` 说明。

示例：

```text
feat(ticket-import): 支持粘贴铁路电子客票 PDF
fix(report-edit): 修复日期输入框截断
docs(contributing): 说明提交信息规范
chore(release): publish v1.2.5
```
