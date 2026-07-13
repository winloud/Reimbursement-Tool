# ADR 0003：GitHub 发布真源与不可变正式 tag

## 状态

已采纳。

## 背景

旧发布流程会在 GitHub Release 成功后把 workflow run、资产大小和发布状态写回冻结计划，再提交并 push 一次；重发同版本时还允许移动并 force-push 正式 tag。失败处理包含删除 tag 或重置本地分支，容易让本地、远端 `main`、tag 和 Release 进入不一致状态，也增加新手发布时的操作负担。

## 决策

- GitHub Actions 和 GitHub Release 是公开发布状态的权威来源；版本计划只表达内容是否冻结，不复制机器可查询的运行状态。
- `docs/releases/active-plan.md` 在正式 tag 创建前冻结为 `docs/releases/vX.Y.Z-plan.md`，冻结状态统一写“内容已冻结”，随后创建下一轮 active plan。
- 已推送的正式 `vX.Y.Z` tag 永不移动、删除或 force-push。同一版本需要重建资产时必须从原 tag commit 手工触发或续跑 workflow。
- 发布失败时保留 release commit 和 tag；workflow 修复先提交并推送到 `main`，随后使用当前 `main` 的 workflow 定义检出同一 tag 续跑；若应用源码或 tag 内构建脚本需要改变，则发布新的 patch 版本。
- 发布总控默认只准备版本文件并执行预检，不创建 commit 或 tag；显式 `-Publish` 时识别当前状态并安全续跑到 Release 校验完成。
- 正常发布成功后不再自动修改文档、提交和第二次 push。安装、升级、迁移等长期有价值的人工验证仍可按需作为普通 docs commit 记录。

## 影响

正向影响：

- tag、构建源码和公开资产保持一一对应，发布可追溯。
- 中断或失败后可以继续执行，不依赖破坏性回滚。
- 正常发布减少一次文档提交和 push，状态来源更清晰。

代价：

- workflow 和 Release 的运行状态不再复制到仓库索引，需要到 GitHub 查询。
- 已发布版本若发现源码问题不能复用原版本号，必须递增 patch 版本。
- 自动化必须支持从不可变 tag 手工重跑，并验证 tag commit 属于 `main`。
