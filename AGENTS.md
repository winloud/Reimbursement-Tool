# AGENTS.md

本文件是 AI 编程助手在本仓库工作的规则入口。开始任何实现、重构、发布、文档整理前，必须先阅读本文件。

## 文档入口

文档地图见 `docs/README.md`。不要在本文件重复维护完整文档目录。

## 读取规则

不要默认读取全部文档。按任务类型读取：

- 普通代码修改：读取 `docs/releases/active-plan.md` 和相关代码。
- 文档整理：读取 `docs/README.md`、`docs/expense-reimbursement-plan.md` 和相关文档。
- 技术路线变更：读取 `docs/decisions/` 中相关决策文档；没有则新建决策记录。
- 测试或验证：读取或更新 `docs/testing/` 中相关测试依据。
- 发布版本：读取 `docs/releases/active-plan.md`、根目录 `README.md`、`CHANGELOG.md` 和发布脚本。
- 不确定项目状态时：读取 `docs/README.md` 和 `docs/expense-reimbursement-plan.md`。
- Linux 服务器部署、迁移或运维：读取 `docs/deployment/linux-server.md`、`docs/releases/active-plan.md` 和相关部署脚本；涉及技术路线变化时同步读取或更新 `docs/decisions/`。

## 工作规则

- 不要把每个版本的详细任务继续写入主开发计划。
- 当前版本开发过程、重要改动、验证记录优先写入 `docs/releases/active-plan.md`。
- 面向用户可见的版本变化写入根目录 `CHANGELOG.md`；`active-plan` 记录过程，`CHANGELOG` 记录结果。
- 重要技术路线变化必须先说明依据，再写入 docs/decisions/。
- 重要测试结果必须写入 docs/testing/ 或 active-plan 的测试记录。
- 不要未经用户确认改变核心技术路线。
- 不要上传、push、发布到远端，除非用户明确要求。
- 开发阶段默认只在本地修改和测试，不要主动同步、部署或验证 Linux 服务器；仅当用户明确要求 server 测试、部署、同步，或发布前验证时，才操作 Linux 服务器。服务器 IP 地址不要写死，必须以用户当次提供或确认的地址为准；已记录的历史 IP 仅作验证记录，不作为默认目标。
- 不要把 release ZIP、运行态 data/uploads/logs、测试样本纳入 Git。
- 不要删除用户数据、测试样本或运行态目录，除非用户明确确认。

## 每次完成前检查

完成任务前必须检查：

- 是否需要更新 docs/releases/active-plan.md。
- 是否需要更新 docs/expense-reimbursement-plan.md 的状态或索引。
- 是否需要新增或更新 docs/decisions/。
- 是否需要新增或更新 docs/testing/。
- 是否需要更新 README.md 或 CHANGELOG.md。
- 如果 active-plan 中有“待同步到 CHANGELOG”的用户可见变化，是否已经同步。
- 是否运行了必要测试；未运行时说明原因。
- git status 是否只包含预期变更。
- 是否需要更新 `docs/deployment/linux-server.md` 中的部署步骤、环境约束或验证记录。

## 发布规则

发布前：

- 根据实际变化判断版本号：
  - patch：修复、文档、发布脚本、小问题。
  - minor：新增用户可见功能。
  - major：不兼容旧数据或旧使用方式。
- 运行测试和打包验证。
- 确认 release/ 只作为本地产物，不提交 Git。
- ZIP 包文件名规则为 `报销管理-vX.Y.Z-yyyymmdd.zip`，避免同名覆盖；已有 ZIP 只允许用户手动删除。
- 发布版本时，默认按 `docs/releases/active-plan.md`、`CHANGELOG.md`、`scripts/build_release.ps1` 和 `.github/workflows/publish-release.yml` 的 tag 发布流程执行；推送 `vX.Y.Z` tag 后由 GitHub Actions 创建或更新 GitHub Release，并自动从 `CHANGELOG.md` 抽取对应版本说明。
- GitHub Release 主 ZIP 资产使用 ASCII 文件名 `reimbursement-tool-vX.Y.Z-yyyymmdd.zip`，避免 GitHub 规范化非 ASCII 资产名；本地 `release/` 主 ZIP 仍使用 `报销管理-vX.Y.Z-yyyymmdd.zip`。
- 发布完成后，将 docs/releases/active-plan.md 冻结为 docs/releases/vX.Y.Z-plan.md。
- 再从模板创建新的 docs/releases/active-plan.md。
