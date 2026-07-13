# 当前开发计划

## 状态
- 版本号：TBD
- 计划状态：规划中
- 预计版本类型：TBD

## 目标
- [ ] 收集下一轮需求并确认版本范围。

## 范围
本次做：
- TBD

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- [x] 发布治理调整为单命令、可恢复流程：默认只准备和预检，`-Publish` 从已有状态续跑到 GitHub Release 校验完成。
- [x] GitHub Actions 和 GitHub Release 作为公开发布状态真源；正常发布完成后不再自动产生第二次文档提交和 push。
- [x] 正式远端 tag 改为永久不可变；失败时保留发布状态并从原 tag 续跑，源码变化使用新 patch 版本。
- [x] 冻结计划状态统一为“内容已冻结”，并在创建 tag 前完成冻结和下一轮 active plan 初始化。

### 验证记录
- [x] 发布文档与全局 `release-governance` 技能静态一致性检查通过：所有历史冻结计划状态统一为“内容已冻结”，规则入口、流程文档、ADR、技能主说明和三个 reference 模板均覆盖发布真源、不可变 tag、失败续跑和无默认二次 docs push。
- [x] `git diff --check` 通过；仅显示仓库现有 Windows 行尾转换提示，无空白错误。
- [x] 发布治理专项测试 `41 passed`：覆盖 CHANGELOG 元数据、workflow 契约与 PowerShell 语法、Release manifest/checksum 健康校验、额外旧 runtime 资产兼容、prepare 幂等、严格 SemVer、单次发布、重复运行、失败 workflow 从当前 `main` 续跑、精确 run-name 匹配、tag 冲突阻断、旧 tag 恢复不推送当前分支和无破坏性回滚路径。
- [x] GitHub workflow YAML 可解析，7 个 PowerShell `run` block 均通过语法解析；发布总控也通过 Windows PowerShell 语法解析。
- [x] 后端完整测试 `249 passed`；前端 Node 测试 `52 passed`；`npm run build` 通过，仅保留现有大 chunk 警告。

### 已同步到 CHANGELOG
- [x] 发布治理简化、安全续跑和不可变 tag 规则已写入 `Unreleased`。
