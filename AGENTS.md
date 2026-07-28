# AGENTS.md

本文件只保留每次任务都适用的仓库规则。文档地图见 `docs/README.md`；不要默认读取全部文档。

## 按需读取

- 任务涉及当前版本目标、范围或验收条件时，读取 `docs/releases/active-plan.md`；普通代码修改优先读取相关代码和测试。
- 产品能力不清楚时读取 `docs/product-overview.md`；技术路线变化读取 `docs/decisions/` 中相关记录，没有则新增决策记录。
- 需要长期保存的人工验证依据时读取或更新 `docs/testing/`；不要为了普通自动化测试结果先读历史验证文档。
- 预览包或正式发布读取 `docs/release-process.md`、`docs/releases/active-plan.md`、`CHANGELOG.md` 和相关发布脚本。
- Linux 部署、迁移或运维读取 `docs/deployment/linux-server.md` 和相关脚本；服务器目标必须由用户当次提供或确认。
- 文档整理读取 `docs/README.md` 和任务直接涉及的文档。

## 硬边界

- 不要未经用户确认改变核心技术路线；重要变化说明依据并记录到 `docs/decisions/`。
- 不要上传、push、发布或部署到远端，除非用户明确要求。
- 不要删除用户数据、测试样本或运行态目录，除非用户明确确认；不要把 release ZIP、`data/`、`uploads/`、`logs/` 或测试样本纳入 Git。
- Git 提交信息遵循 [Conventional Commits](docs/contributing.md)。

## 记录与完成

- `docs/releases/active-plan.md` 只记录当前目标、范围、验收条件和阻塞，不追加完成流水、历史测试次数或 CHANGELOG 内容副本。
- 面向用户的完成结果写入 `CHANGELOG.md`；长期有价值的验证、技术决策或部署约束分别写入 `docs/testing/`、`docs/decisions/` 或 `docs/deployment/`。
- 运行与改动风险相称的测试和检查；组合验证使用 `scripts/verify.ps1` 的固定档位，未运行时说明原因。
- 完成前检查 `git diff` 和 `git status`，确认只包含预期变更并报告剩余风险。

## 发布

发布细节以 `docs/release-process.md`、`scripts/release_publish.ps1` 和 `.github/workflows/publish-release.yml` 为准。正式发布必须由用户明确授权，并从脚本的准备模式开始。
