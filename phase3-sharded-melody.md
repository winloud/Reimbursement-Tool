# 重做前端 Phase 3 计划

## Context

Codex 的 Phase 3 后端上传/解析/汇总链路基本可用，但前端没有还原原型：新增页只展示基础信息和右侧汇总，行程/发票/其他费用区域被限制在编辑态；整体仍是顶部 AppBar + MUI Container，而原型是左侧 Sidebar + 单页录入工作台。用户已明确选择“重做前端 Phase3”，并补充了关键交互决策：

- 新增报销单进入页面即自动创建 draft，避免“先保存才能编辑/上传”的反直觉流程。
- 基础信息和行程修改采用自动保存。
- 仅当草稿仍为空时，离开页面弹窗询问；未确认删除的草稿都保留。
- 行程卡片需要拖拽排序、复制行程、折叠摘要、交换出发/到达、生成返程行程。
- 发票文件仍放在 `uploads/{report_id}/`，但文件名加费用类别前缀区分。
- 发票上传后若归错类别/行程，不支持改类别，用户删除重传。
- 发票上传支持卡片内上传、批量上传、拖放上传、上传后弹窗确认。
- `Test cases for invoices/` 中的样本用于先人工确认金额，再固化为 JSON 期望清单用于自动化回归。

## Recommended approach

### 1. 保留后端 API，做必要小改

- 复用 `frontend/src/api/client.js`：`getSettings`、`createReport`、`getReport`、`updateReport`、`deleteReport`、`uploadInvoice`、`updateInvoice`、`deleteInvoice`、`updateReportStatus`。
- 修改 `backend/services/invoice_service.py` 的 `save_upload_file`：将文件名从 `invoice_{uuid}.{ext}` 改为 `{expense_category}_invoice_{uuid}.{ext}`；车船费可用 `transport_fare_invoice_{uuid}.{ext}`，不再做目录分层。
- 相应调整 `upload_invoice` 调用签名，把 `expense_category` 传给保存函数。
- 保持“归错类别只能删除重传”的产品规则，不新增改类别 API。

### 2. 重做 App 壳层以贴近原型

- 修改 `frontend/src/App.jsx`：从顶部 AppBar 改为原型式 Sidebar + 主内容区。
- 保持 React Router 路由结构：`/`、`/reports`、`/reports/new`、`/reports/:id/edit`。
- Dashboard / ReportList 暂以兼容为主；Phase 3 的视觉重点放在 `ReportEdit`。

### 3. 重写 `frontend/src/pages/ReportEdit.jsx` 为“进入即建草稿 + 自动保存”的单页录入

- 新增态 `/reports/new`：
  1. 页面加载时先读取 settings。
  2. 调用 `createReport` 创建 draft（带默认部门/出差人/补贴）。
  3. `navigate('/reports/{id}/edit', { replace: true })`，之后统一使用编辑态逻辑。
- 编辑态 `/reports/:id/edit`：
  - 加载 report detail 后直接展示完整单页：基本信息、行程列表、其他费用、右侧 sticky 汇总、底部操作。
  - 所有字段修改进入本地 state，并 debounce 调用 `updateReport` 自动保存。
  - 页面明显显示保存状态：`保存中…` / `已自动保存` / `保存失败，请重试`。
  - `reimbursed` 状态保持只读：输入、拖拽、复制、交换、上传、删除、金额确认全部禁用。

### 4. 空草稿离开确认

- 定义“空草稿”：无出差事由、无行程、无发票，且基础字段仍为默认/空值。
- 当用户从编辑页返回列表或点击 Sidebar 切换，并且当前 draft 为空：弹窗询问：
  - “删除空草稿并离开” → 调用 `deleteReport` 软删除后跳转。
  - “保留草稿并离开” → 直接跳转。
  - “取消” → 留在当前页。
- 浏览器刷新/关闭无法可靠执行删除：按用户要求，未确认删除的一律保留。

### 5. 行程卡片交互

- 每张行程卡支持：
  - 展开/折叠：折叠时显示摘要，如 `6/1 08 深圳 → 6/1 11 成都 · 高铁/动车 · 发票 1 张 ¥123.45`。
  - 拖拽排序：用原生 drag/drop 或 MUI 友好的实现，必须有拖拽中高亮/占位反馈；排序后自动保存。
  - 复制行程：复制当前卡片为新行程，清空 id，插入到当前行程后，自动保存后获得新 trip id。
  - 交换出发/到达：仅在当前卡片内交换月/日/时/地点。
  - 生成返程：复制当前行程并交换出发/到达字段，插入到当前行程后；交通工具沿用，用户再微调时间。
- 上传车船费发票依赖后端 trip id；因为页面进入即建草稿且行程自动保存，新增行程保存成功后上传按钮才可用。保存中时上传按钮显示 disabled 和说明。

### 6. 发票上传/查看/确认

- 每个行程卡的“车船费发票”区域、每个其他费用卡片都提供：
  - 卡片内上传按钮。
  - 支持 `multiple` 批量上传。
  - 支持拖放上传到虚线区域。
  - 上传中显示每个文件的状态。
  - 上传完成后打开 InvoiceViewer 让用户确认解析金额；批量上传时可按队列逐张确认，或先打开第一张并在列表中保留其余待确认。
- 上传后发票列表显示：金额、确认状态、文件类型、发票号、查看、删除。
- 不支持发票改类别/改行程；UI 文案说明“归类错误请删除后重新上传”。

### 7. 调整 `frontend/src/components/InvoiceViewer.jsx`

- 保留 `getInvoiceFileUrl`、`updateInvoice` 的逻辑。
- 视觉改为原型风格弹窗：左侧关键字段与金额确认，右侧 PDF/image 预览；XML/OFD 提供关键字段展示与打开原文件按钮。
- 图片发票、未识别 PDF/OFD/XML 都允许手动输入金额并确认。
- 确认后触发 `onUpdated` 刷新 report detail 和右侧汇总。

### 8. 样本金额人工确认 + JSON 自动化

- 新增一个期望清单文件，例如 `tests/fixtures/invoice_expected_amounts.json`：
  ```json
  {
    "Test cases for invoices/PDF/动车 ￥53.5.pdf": { "expected_amount": "53.50", "status": "confirmed" }
  }
  ```
- 先做一个轻量脚本或测试辅助命令读取 `Test cases for invoices/**/*.{pdf,xml,ofd}`，输出当前解析金额，方便人工逐项确认。
- 人工确认后把正确金额写入 JSON；pytest 后续读取 JSON 对解析结果做回归测试。
- 不要求一开始覆盖所有样本；可以从 XML/OFD 和文件名明显含金额的 PDF 样本开始，逐步扩大覆盖。

## Critical files

- `frontend/src/App.jsx` — 应用壳层改为 Sidebar + 主内容区。
- `frontend/src/pages/ReportEdit.jsx` — Phase 3 前端主重写文件。
- `frontend/src/components/InvoiceViewer.jsx` — 发票查看/金额确认弹窗重做。
- `frontend/src/api/client.js` — 复用为主，必要时补充 helper。
- `backend/services/invoice_service.py` — 发票文件名加类别前缀。
- `tests/fixtures/invoice_expected_amounts.json` — 人工确认后的样本金额期望清单。
- `tests/test_phase3.py` 或新增 `tests/test_invoice_samples.py` — 使用 JSON 期望清单做解析回归。
- `docs/expense-tool-prototype.jsx` — 视觉和交互参考。

## Verification

1. 启动后端：`python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`。
2. 启动前端：`npm --prefix frontend run dev -- --host 127.0.0.1 --port 5174`。
3. 打开 `/reports/new`：
   - 页面应自动创建草稿并 replace 到 `/reports/{id}/edit`。
   - 不需要先点保存即可看到完整 Phase 3 单页录入界面。
4. 修改基础信息和行程：
   - 观察自动保存状态从“保存中…”变为“已自动保存”。
   - 刷新页面后内容仍保留。
5. 行程交互：
   - 新增、拖拽排序、复制、折叠/展开、交换出发到达、生成返程均可用，且刷新后顺序和数据保留。
6. 空草稿离开：
   - 新建后不填任何内容，点击返回/Sidebar，应弹窗询问删除/保留/取消。
   - 选择删除后列表不显示该草稿；选择保留后列表保留。
7. 发票上传：
   - 在车船费卡片批量上传 XML/PDF/OFD 样本；文件保存路径应包含类别前缀，例如 `uploads/{id}/transport_fare_invoice_xxx.pdf`。
   - 拖放上传到其他费用卡片可用。
   - 上传后 InvoiceViewer 打开并可确认金额。
8. 样本验证：
   - 用 `Test cases for invoices/` 的样本跑解析输出，人工确认若干金额后写入 JSON。
   - 后续运行相应 pytest，确认已录入 JSON 的样本解析金额不退化。
