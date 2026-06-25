# 发布流程

本文档记录正式发布的快速路径。详细版本任务和验证记录仍写入 `docs/releases/active-plan.md` 或冻结后的 `docs/releases/vX.Y.Z-plan.md`。

## 标准发布顺序

多人协作时，正式版本必须从主线发布。开发分支可以做本地预检、preview artifact 或测试包，但不直接创建正式 tag。

标准顺序：

1. 在 `codex/*`、`feat/*` 或 `fix/*` 分支完成开发和测试。
2. 将开发分支合并到 `main`。
3. 推送 `main` 到远端，确认 `origin/main` 包含本次发布源码。
4. 切到最新 `main` 后运行发布总控脚本。
5. 总控脚本在 `main` 上创建 release commit 和 `vX.Y.Z` tag，推送 `main` 和 tag，由 GitHub Actions 构建 GitHub Release。

```powershell
git checkout main
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -Publish
```

## 自动发布总控

正式发布优先使用总控脚本，让脚本完成发布治理编排，AI 只负责确认输入、处理异常和解释结果。脚本默认要求 `-Publish` 在 `main` 上运行；如果当前分支不是 `main`，会在修改版本文件或创建 tag 前停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -Publish
```

常用参数：

- `-Version X.Y.Z`：必填，正式版本号。
- `-ReleaseDate yyyymmdd`：可选；未传时按中国时区当天生成。
- `-VersionType patch|minor|major|TBD`：可选，默认 `patch`，写入冻结发布计划。
- `-Publish`：从发布分支推送 `main` 和 tag，等待 GitHub Actions，校验 Release 资产，采集耗时，写回冻结计划并提交验证记录。
- `-RepublishExistingTag`：可选；只用于重发已存在的 GitHub Release。脚本会跳过 changelog/版本文件冻结，先运行预检，再移动并 force-push 同名 tag 触发 workflow。
- `-AllowUntracked`：可选；只忽略未跟踪文件，已跟踪文件变更仍会阻断发布。用于本地存在草稿文件但不会进入 Git/tag 的场景。
- `-CompareRunId <id>`：可选，用于发布后自动生成与基线 run 的耗时对比。
- `-DownloadReleaseAssetForValidation`：可选；默认不下载 GitHub Release 主 ZIP，只检查资产元数据。只有需要发布后从公网下载主 ZIP 再深校验时才使用。
- `-ReleaseBranch main`：可选，默认 `main`；仅当仓库主发布分支更名时才改。
- `-SkipTests`：仅用于临时烟测或已经由其他可信流程完成测试的场景；正式发布默认不要使用。

脚本自动执行：

- 检查工作区、发布分支和本地/远端 tag。
- 将 `CHANGELOG.md` 的 `Unreleased` 冻结到 `## vX.Y.Z - YYYY-MM-DD`。
- 更新 `README.md`、`backend/app_metadata.py`、`frontend/package.json` 和 `frontend/package-lock.json`。
- 将 `docs/releases/active-plan.md` 冻结为 `docs/releases/vX.Y.Z-plan.md`，并重建新的 active plan。
- 更新 docs 索引，运行 `scripts/prepare_release.ps1`。
- 创建 `chore(release): publish vX.Y.Z` commit 和本地 tag。
- GitHub Actions 在上传资产前调用 `scripts/validate_release_asset.ps1 -ZipPath ...`，对 runner 本地刚构建出的主 ZIP 做内容校验。
- 带 `-Publish` 时推送 `main` 和 tag，等待 `Publish Release` workflow，默认以 metadata-only 方式检查 GitHub Release 资产是否存在且命名正确，采集耗时，写回冻结计划，再提交并推送 `docs(release): record vX.Y.Z verification`。

重发既有版本时必须显式使用 `-RepublishExistingTag`，例如：

```powershell
git checkout main
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -Publish -RepublishExistingTag -CompareRunId <baseline-run-id>
```

该模式用于修正发布流程或重建同版本资产；仍应从 `main` 执行。它会更新同名 GitHub Release 资产和 notes，但不会把 `Unreleased` 再冻结到该版本。

## 独立工具

发布后可单独复验 Release 资产：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -MetadataOnly
```

校验本地 ZIP 内容，不需要联网下载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -ZipPath release\报销管理-vX.Y.Z-yyyymmdd.zip
```

只有需要模拟用户从 GitHub 下载主 ZIP 时，才运行远端下载深校验：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

采集或对比 GitHub Actions 耗时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect_release_metrics.ps1 -RunId <run-id> -CompareRunId <baseline-run-id> -Format Markdown
```

两个工具都支持写出 JSON，供总控脚本或其他自动化读取。

## 手工路径

正式发布包以 GitHub tag workflow 产物为准。本地默认做发布预检，不重复生成正式 ZIP，除非需要验证本机 PyInstaller 输出、程序内更新包行为，或 GitHub Actions 暂不可用。

当总控脚本不可用或需要排查细节时，使用手工流程：

1. 冻结 `CHANGELOG.md`：把 `Unreleased` 内容移动到 `## vX.Y.Z - YYYY-MM-DD`。
2. 更新 `README.md`、`backend/app_metadata.py`、`frontend/package.json` 和 `frontend/package-lock.json` 的版本信息。
3. 将 `docs/releases/active-plan.md` 冻结为 `docs/releases/vX.Y.Z-plan.md`，并重建新的 `active-plan.md`。
4. 运行发布预检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd
```

5. 提交发布准备：

```powershell
git add CHANGELOG.md README.md backend/app_metadata.py frontend/package.json frontend/package-lock.json docs
git commit -m "chore(release): publish vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

6. 等待 `Publish Release` workflow 完成，核对 GitHub Release notes 和资产。
7. 将远端发布验证结果补入冻结计划；这一步可以在确认 Release 成功后单独提交。

## 本地正式 ZIP

需要本地包时再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version X.Y.Z -ReleaseDate yyyymmdd -SkipDependencyInstall -ReuseReleaseVenv
```

本地 ZIP 必须留在 `release/`，不要提交 Git。若同名正式 ZIP 已存在，发布脚本会拒绝覆盖，需要手动确认后再处理。

## 发布耗时参考

v1.2.0 的 GitHub Release workflow 用时约 3m16s：

- 前端依赖安装约 34s。
- 后端测试依赖安装约 27s。
- 测试和 release notes 抽取约 10s。
- 云端构建正式 ZIP 和 OpenCV runtime 约 1m24s。
- 发布资产约 7s。

总体发布体感较长主要来自本地重复测试、重复构建正式 ZIP、等待远端 workflow，以及发布后补验证记录。后续发布默认走“本地预检 + 远端打包”的快速路径。

v1.2.1 的 GitHub Release workflow run `28121701414` 成功，但没有变快，run 总耗时 `266s`，job 用时 `4m21s`：

- 前端依赖安装 `30s`，略快于 v1.2.0 的 `34s`。
- 后端测试依赖安装 `73s`，慢于 v1.2.0 的 `27s`；本次 pip cache 首次未命中，run 结束后才写入缓存。
- 测试 `17s`，慢于 v1.2.0 的 `9s`。
- OpenCV runtime 成功从 v1.2.0 Release 复用，新增恢复步骤 `13s`，主构建从 `84s` 降到 `78s`。
- 发布资产 `8s`，与 v1.2.0 的 `7s` 基本一致。

结论：runtime 复用已生效，但本次收益被首次 cache miss 和后端依赖安装波动抵消；下一次发布需要继续观察 pip/npm cache 命中后的真实耗时。

## 后续可选优化

- 正式发布 workflow 已复用既有 OpenCV runtime 资产；只有找不到匹配 `opencv-contrib-python-headless` 版本的资产时才重建。
- GitHub Actions 的 checkout/setup/upload-artifact action 已升级到当前可用的新主版本，避免继续使用旧 Node.js 运行时。
