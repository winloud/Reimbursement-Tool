# 当前开发计划

## 状态
- 版本号：TBD
- 计划状态：规划中 / 实现中 / 测试中 / 待发布
- 预计版本类型：待定

## 目标
[x] 独立服务重启脚本，避免AI每次浪费token重写脚本重启前后端。
[x] ZIP 文件名规则是 报销管理-vX.Y.Z-yyyymmdd ，同步到发布脚本。

## 范围
本次做：
...

本次不做：
...

## 版本号判断
- 如果只是修复问题：v1.1.1
- 如果增加用户可见功能：v1.2.0
- 如果数据结构或使用方式有不兼容变化：v2.0.0


---

## 完成记录

### 重要改动
- [x] 新增源码开发服务重启入口：`restart-dev.cmd` + `scripts/restart-dev.ps1`
- [x] 新增 `AGENTS.md` / `CLAUDE.md` AI 协作入口
- [x] 新增 `CHANGELOG.md`，并明确 active-plan 记录过程、CHANGELOG 记录结果
- [x] 补齐历史更新日志：将首次发布能力归入 `v1.0.0`，将二维码识别与发布包优化归入 `v1.1.0`
- [x] 新增 `docs/README.md`、`docs/releases/active-plan.md`、`docs/backlog.md`
- [x] 主开发计划瘦身为产品总览，V1.1.0 详细记录冻结到 `docs/releases/v1.1.0-plan.md`
- [x] 新增发票二维码识别 ADR，并将 240 个样本对照测试记录移动到 `docs/testing/`
- [x] 发布 ZIP 命名改为 `报销管理-vX.Y.Z-yyyymmdd.zip`
- [x] 发布脚本不再清空 `release/` 目录
- [x] 同名主 ZIP 或 OpenCV runtime ZIP 已存在时，脚本报错并要求手动删除

### 验证记录
- [ ] PowerShell 脚本语法检查：
- [ ] 发布打包：
- [ ] ZIP 内容检查：

### 已同步到 CHANGELOG
- [x] 源码开发服务重启入口
- [x] AI 协作规则入口和开发文档入口
- [x] 主开发计划瘦身、V1.1.0 计划冻结、ADR/testing 文档迁移
- [x] 发布包命名增加日期后缀
- [x] 发布脚本避免覆盖历史 ZIP
- [x] active-plan 记录过程，CHANGELOG 记录面向用户的版本结果
- [x] V1.0.0 / V1.1.0 历史版本更新日志口径修正
