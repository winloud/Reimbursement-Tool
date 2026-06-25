# 当前开发计划

## 状态
- 版本号：TBD
- 计划状态：发布治理自动化中
- 预计版本类型：patch

## 目标
- [x] 新增发布总控脚本，降低正式发布对 AI 手工编排的依赖。
- [x] 新增 Release 资产校验脚本，自动检查主 ZIP 内容和运行态目录排除规则。
- [x] 新增 GitHub Actions 耗时采集脚本，自动输出 JSON/Markdown 并支持基线对比。
- [x] 更新发布流程文档，优先使用总控脚本，保留手工 fallback。

## 范围
本次做：
- 新增 `scripts/release_publish.ps1`，自动完成版本文件更新、CHANGELOG 冻结、active-plan 冻结/重建、发布预检、release commit、本地 tag；带 `-Publish` 时继续推送分支/tag、等待 GitHub Actions、校验 Release 资产、采集耗时、写回冻结计划并提交验证记录。
- 新增 `scripts/validate_release_asset.ps1`，支持校验本地 ZIP、GitHub Release metadata-only 校验和按需下载远端主 ZIP 深校验；下载失败会自动重试。
- 新增 `scripts/collect_release_metrics.ps1`，读取 GitHub Actions run、计算 job/step 耗时，并可与基线 run 对比。
- 更新 `.github/workflows/publish-release.yml`，在上传资产前对 runner 本地构建出的主 ZIP 做内容校验；总控脚本发布后默认只做 metadata-only 远端资产校验，避免重复下载主 ZIP。
- 更新 `docs/release-process.md` 和测试断言。

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。
- 不改变 GitHub Release tag workflow 的资产生成路径；总控脚本继续以 tag workflow 为正式包来源。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- 新增发布总控脚本和两个可独立复用的发布验证工具，目标是把发布治理从 AI 手工编排推进到脚本驱动。

### 验证记录
- [x] PowerShell 语法检查：`release_publish.ps1`、`validate_release_asset.ps1`、`collect_release_metrics.ps1` 均可由 PowerShell parser 解析。
- [x] Release 资产校验工具真实数据验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version 1.2.1 -ReleaseDate 20260625 -MetadataOnly` 成功，确认 v1.2.1 GitHub Release 主 ZIP 和 OpenCV runtime asset 元数据；远端下载深校验仍保留为按需模式，并为下载步骤增加 3 次重试。
- [x] Release 本地 ZIP 内容校验烟测：构造临时便携发布 ZIP 后执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate_release_asset.ps1 -Version 9.9.9 -ReleaseDate 20990101 -ZipPath <temp.zip>` 成功，确认 `-ZipPath` 可在不联网下载 GitHub 资产的情况下校验 ZIP 内容结构、manifest 和兼容范围。
- [x] Release 耗时采集工具真实数据验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\collect_release_metrics.ps1 -RunId 28121701414 -CompareRunId 28118440660 -Format Markdown` 成功，输出 v1.2.1 与 v1.2.0 的步骤耗时对比。
- [x] 发布总控脚本临时克隆烟测：在临时本地 clone 中补入测试用 Unreleased 记录后执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release_publish.ps1 -Version 9.9.9 -ReleaseDate 20990101 -SkipTests` 成功，完成版本文件更新、active-plan 冻结/重建、预检、release commit 和本地 tag；未带 `-Publish`，未推送远端。

### 已同步到 CHANGELOG
- 已在 Unreleased 记录发布总控脚本、Release 资产校验工具、Actions 耗时采集工具和发布流程文档调整。
