# 当前开发计划

## 状态
- 版本号：TBD
- 计划状态：发布流程维护中
- 预计版本类型：patch

## 目标
- [x] 缩短正式发布体感耗时，减少本地和 GitHub Actions 重复打包。
- [x] 增加发布预检脚本，把版本号、文档冻结、release notes、测试和 diff 检查收束成一个命令。
- [x] 为 GitHub 正式发布和 preview artifact workflow 增加 pip cache。
- [x] 更新 release-governance skill，沉淀“单一权威打包路径”的通用原则。

## 范围
本次做：
- 新增 `scripts/prepare_release.ps1`，用于正式发布前预检；默认不生成正式 ZIP，由 GitHub tag workflow 生成正式资产。
- 新增 `docs/release-process.md`，记录快速发布路径、本地正式 ZIP 何时需要、v1.2.0 耗时拆解和后续可选优化。
- 更新 `.github/workflows/publish-release.yml` 和 `.github/workflows/build-preview.yml`，为 Python 依赖安装启用 pip cache。
- 更新 `CHANGELOG.md` 的 Unreleased 发布流程变化。

本次不做：
- 暂不改变 OpenCV runtime 发布资产策略；是否复用旧 runtime 需要单独确认。
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- 新增发布预检脚本和发布流程文档。
- GitHub 正式发布和 preview artifact workflow 增加 pip cache。
- release-governance skill 增加快速发布路径说明。

### 验证记录
- [x] 发布预检脚本语法检查：PowerShell `scriptblock` 解析通过。
- [x] 发布预检脚本完整验证：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare_release.ps1 -Version 1.2.0 -ReleaseDate 20260625` 成功；后端 `210 passed`、前端 `48 passed`，并校验 v1.2.0 版本元数据、CHANGELOG、README、冻结计划、release notes 抽取和 `git diff --check`。
- [x] diff 检查：`git diff --check` 通过；仅有既有 CRLF 转换提示。

### 已同步到 CHANGELOG
- 已在 Unreleased 记录发布预检脚本、快速发布流程文档和 workflow pip cache。
