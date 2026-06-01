# Codex Phase 3 工作记录

日期：2026-05-31

## 分支与上下文

- 当前分支：`codex/reimbursement-tool`
- 目标：继续完成 Phase 3「行程录入 + 发票上传」
- 验收重点：行程卡片、其他费用项、发票上传/查看/金额确认、实时费用汇总、解析与补贴天数测试

## 已完成内容

### 前端

- 重做 `frontend/src/pages/ReportEdit.jsx`
  - 支持报销单基本信息编辑
  - 支持行程卡片新增、删除、拖拽排序、上下移动
  - 支持车船费发票按行程上传
  - 支持其他费用项卡片与备注编辑
  - 支持 XML/PDF/OFD/图片发票上传
  - 支持右侧实时费用汇总
  - 支持待确认发票不计入汇总

- 增强 `frontend/src/components/InvoiceViewer.jsx`
  - 发票查看弹窗同步当前选中发票金额
  - 支持金额确认失败时显示错误
  - 金额确认成功后刷新报销单详情

### 后端

- 更新 `backend/main.py`
  - 增加本地开发 CORS 正则，允许 `localhost` / `127.0.0.1` 的任意端口
  - 修复 Vite 自动从 5173 切到 5174 后前端保存时报 `Network Error` 的问题

- 更新 `backend/models/report.py` 和 `backend/schemas/report.py`
  - 增加 `active_invoices`
  - 报销单详情响应只返回未软删除发票

### 测试

- 新增 `tests/test_phase3.py`
  - XML 发票解析测试
  - PDF 发票解析测试
  - OFD 内嵌 XML 解析测试
  - 跨月补贴天数测试
  - 跨年补贴天数测试
  - 报销单补贴金额重算测试

- 更新 `tests/test_report_crud.py`
  - 将旧的手填 `total_amount` 断言调整为当前业务规则：总金额由确认发票金额 + 补贴金额重算

### 文档

- 更新 `docs/expense-reimbursement-plan.md`
  - Phase 3 清单已全部勾选完成

## 验证结果

- 后端测试：
  - 命令：`python -m pytest`
  - 结果：`24 passed`

- 前端构建：
  - 命令：`npm run build`
  - 结果：构建通过
  - 备注：Vite 提示 chunk size 超过 500 kB，这是构建警告，不影响当前功能运行

- 浏览器验证：
  - 使用本地页面创建草稿
  - 成功进入编辑页
  - 成功新增行程
  - 行程、其他费用、费用汇总模块均正常显示
  - 修复后未再出现 CORS / `Network Error`

## 本地运行状态

- 后端：`http://127.0.0.1:8000`
- 前端：`http://127.0.0.1:5174`
- 浏览器验证产生的临时报销单数据已清理，后端已重新启动为空数据状态

## 当前 Git 改动

- `backend/main.py`
- `backend/models/report.py`
- `backend/schemas/report.py`
- `docs/expense-reimbursement-plan.md`
- `frontend/src/components/InvoiceViewer.jsx`
- `frontend/src/pages/ReportEdit.jsx`
- `tests/test_report_crud.py`
- `tests/test_phase3.py`
