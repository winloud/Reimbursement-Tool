# 发布流程

本文档记录正式发布的快速路径。GitHub Actions 和 GitHub Release 是公开发布状态的权威来源；仓库中的计划文档记录开发内容、冻结状态和必要的人工验证，不重复保存可从 GitHub 查询的机器状态。

## 核心约束

- 正式版本只从已合并并推送的 `main` 发布。
- `docs/releases/active-plan.md` 必须在创建正式 tag 前冻结，冻结计划状态统一为“内容已冻结”。
- 已推送的正式 `vX.Y.Z` tag 永不移动、删除或 force-push。
- 发布失败保留 release commit 和 tag，从同一 tag 续跑；源码需要修改时发布新的 patch 版本。
- 正常发布成功后不再自动修改文档或进行第二次 push。重要安装、升级、数据迁移等人工验证可按需作为普通 docs commit 补充。

## 标准发布顺序

1. 在开发分支完成开发、测试和文档记录。
2. 将开发分支合并到 `main`，推送并确认 `origin/main` 包含本次源码。
3. 在最新 `main` 上运行发布总控的准备模式，检查版本文件和预检结果。
4. 检查准备模式产生的 diff；确认后运行同一脚本的 `-Publish` 模式。
5. 脚本创建或识别 release commit/tag，推送必要状态，等待或续跑 workflow，并校验 GitHub Release。

```powershell
git checkout main
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
git diff
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -Publish
```

准备模式可重复运行，不创建 commit 或 tag。正式发布只需要一次 `-Publish` 调用；如果进程中断，再次运行相同命令会根据已有 release commit、本地/远端 tag、workflow 和 Release 状态继续执行。

## 发布总控接口

- `-Version X.Y.Z`：必填，正式版本号。
- `-ReleaseDate yyyymmdd`：可选；未传时按中国时区当天生成。日期必须与 `CHANGELOG.md` 对应版本标题一致。
- `-VersionType patch|minor|major|TBD`：可选，默认 `patch`，写入冻结发布计划。
- 不带 `-Publish`：准备版本文件、冻结 active plan、创建下一轮 active plan 并运行预检；不提交、不创建 tag、不 push。
- `-Publish`：从当前状态安全续跑，直至 workflow 和 GitHub Release 校验完成。
- `-AllowUntracked`：可选；只忽略未跟踪文件，已跟踪文件变更仍按发布状态规则检查。
- `-DownloadReleaseAssetForValidation`：可选；默认不下载主 ZIP，只下载小型 `release-manifest.json` 和 `SHA256SUMS.txt` 做完整性校验；需要模拟最终用户下载时再启用远端 ZIP 深校验。
- `-ReleaseBranch main`：可选，默认 `main`；仅在仓库正式发布分支更名时调整。
- `-SkipTests`：只用于临时烟测或测试已由其他可信流程完成的场景；正式发布默认不使用。

`-RepublishExistingTag` 和总控脚本中的 `-CompareRunId` 已移除：正式 tag 不允许重定向；耗时比较继续使用独立 metrics 工具。

## 状态识别与续跑

发布总控按以下状态处理：

- 尚未准备：更新版本元数据、冻结 CHANGELOG 和版本计划，重建 active plan，运行预检。
- 已准备但未提交：复用现有准备结果并完成预检；`-Publish` 时创建 release commit。
- 已有 release commit 或本地 tag：验证 tag 与预期 commit 一致后继续，不重复创建。
- 已有远端 tag：验证远端 tag SHA 与本地发布 commit 一致；不一致立即停止，不做 force-push。
- workflow 运行中：等待现有 run，不重复触发。
- workflow 失败或未找到：先把 workflow 修复提交并推送到 `main`，再由当前 `main` 上的 workflow 定义通过 `workflow_dispatch` 检出同一不可变 tag 重跑。
- GitHub Release 已成功：验证 Release notes、资产、manifest 和 checksum 后直接返回成功。

失败时不执行 `reset --hard`、自动删除 tag 或其他破坏性回滚。修复仅涉及 workflow 时从原 tag 重跑；修复涉及源码时更新 `CHANGELOG.md` 并发布新的 patch 版本。

## GitHub Release 工作流

`Publish Release` 支持两种入口：

- 推送严格匹配 `vX.Y.Z` 的 tag。
- 手工触发并传入既有 `tag`，用于从原 tag commit 重建或修复 Release 资产。

工作流必须确认 tag commit 属于 `origin/main`，从 `CHANGELOG.md` 对应版本标题读取发布日期，并为同一 tag 设置并发锁和超时。新 Release 先作为 draft 创建；测试、构建、ZIP 内容校验、`release-manifest.json` 和 `SHA256SUMS.txt` 全部成功后再公开。重跑已有 Release 只覆盖本次目标资产，不删除额外资产。

OpenCV runtime 可以复用旧 Release 的同版本资产，但复用前必须校验下载文件的 SHA256 和 ZIP 内容；校验失败时重新构建，不能只依赖文件名和非零大小。

## 独立验证工具

发布后按需复验 Release 资产；`-MetadataOnly` 不下载主 ZIP，但会下载 manifest 和 checksum 两个小型完整性资产：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -MetadataOnly
```

校验本地 ZIP 内容：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -ZipPath release\报销管理-vX.Y.Z-yyyymmdd.zip
```

需要模拟用户从 GitHub 下载时，省略 `-MetadataOnly` 和 `-ZipPath` 进行远端深校验。耗时采集和比较保持为独立命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect_release_metrics.ps1 -RunId <run-id> -CompareRunId <baseline-run-id> -Format Markdown
```

这些结果默认只在终端或 GitHub 中查看；只有能长期帮助安装、升级或迁移判断的人工验证才写回文档。

## 手工发布路径

发布总控不可用时：

1. 将 `Unreleased` 内容冻结到 `## vX.Y.Z - YYYY-MM-DD`。
2. 更新 README、后端和前端版本元数据。
3. 将 active plan 冻结为 `vX.Y.Z-plan.md`，状态写“内容已冻结”，并创建下一轮 active plan。
4. 运行 `scripts/prepare_release.ps1` 和必要测试。
5. 提交 release commit。
6. 仅在确认 release commit 已位于并推送到 `main` 后，创建一次 annotated tag 并推送。
7. 等待 tag workflow，或用 workflow 的手工 `tag` 输入从同一 tag 续跑。

```powershell
git add CHANGELOG.md README.md backend/app_metadata.py frontend/package.json frontend/package-lock.json docs
git commit -m "chore(release): publish vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

如果 tag 已存在，必须先验证其 SHA；不要移动或覆盖。Release 成功后无需再补一次机器状态提交。

## 本地正式 ZIP

GitHub tag workflow 的资产是正式交付物。本地只有在验证本机 PyInstaller 输出、程序内更新包行为或 GitHub Actions 暂不可用时才生成正式 ZIP：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -SkipDependencyInstall -ReuseReleaseVenv
```

本地 ZIP 必须留在 `release/`，不提交 Git；同名正式 ZIP 不自动覆盖，只能由用户明确处理。
