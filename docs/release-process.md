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

## 后续可选优化

- OpenCV runtime 很少变化，可评估复用既有 Release 资产，只有 runtime 版本变化时才重建。
- GitHub Actions 的 setup action 若继续提示 Node.js 运行时弃用，可升级到新的 action 主版本。
