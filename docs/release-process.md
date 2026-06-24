# 发布流程

本文档记录正式发布的快速路径。详细版本任务和验证记录仍写入 `docs/releases/active-plan.md` 或冻结后的 `docs/releases/vX.Y.Z-plan.md`。

## 快速路径

正式发布包以 GitHub tag workflow 产物为准。本地默认做发布预检，不重复生成正式 ZIP，除非需要验证本机 PyInstaller 输出、程序内更新包行为，或 GitHub Actions 暂不可用。

推荐流程：

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
git push origin <branch>
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
