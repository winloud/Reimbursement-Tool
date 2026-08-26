# 报销单工具开发文档

## 当前状态
- 当前源码版本：v1.4.1
- 公开稳定版本：[GitHub Releases](https://github.com/winloud/Reimbursement-Tool/releases/latest)
- 当前开发状态：[releases/active-plan.md](releases/active-plan.md)

## 核心文档
- 产品与能力概览：[product-overview.md](product-overview.md)
- 当前开发计划：releases/active-plan.md
- 更新日志：../CHANGELOG.md
- 待办需求池：backlog.md
- 发布流程：release-process.md
- 固定验证入口：[scripts/verify.ps1](../scripts/verify.ps1)（`Backend`、`Frontend`、`Release`、`All`）

## 版本文档
- releases/

## 技术决策
- decisions/
- ZIP 桌面升级路线：[decisions/0002-portable-install-root.md](decisions/0002-portable-install-root.md)
- 发布治理与不可变 tag：[decisions/0003-release-governance.md](decisions/0003-release-governance.md)
- 铁路客票文本解码与中转分组：[decisions/0004-rail-ticket-pdf-text-decoding.md](decisions/0004-rail-ticket-pdf-text-decoding.md)
- 桌面端视口支持边界：[decisions/0005-desktop-viewport-support.md](decisions/0005-desktop-viewport-support.md)
- 常规报销数据模型：[decisions/0006-regular-reimbursement-model.md](decisions/0006-regular-reimbursement-model.md)
- 行程完整日期存储：[decisions/0007-trip-full-date-storage.md](decisions/0007-trip-full-date-storage.md)
- 跨报销单日期占用：[decisions/0008-report-day-occupancy.md](decisions/0008-report-day-occupancy.md)

## 测试依据
- testing/

## 部署
- Linux 服务器部署：[deployment/linux-server.md](deployment/linux-server.md)

## 历史归档
- archive/

## 开发与调试
- 本地开发服务启动/重启：[dev-server.md](dev-server.md)
- ZIP 本地安装、升级和备份指南：[zip-upgrade-guide.md](zip-upgrade-guide.md)
- 提交与协作规范：[contributing.md](contributing.md)
