import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRegularReportPayload,
  buildRegularSummaryCards,
  calculateRegularSummary,
  canDeleteRegularItem,
  getRegularItemDerived,
  getRegularPdfGate,
  makeBlankRegularItem,
  moveRegularItem,
  normalizeRegularItem,
  regularItemSummary,
  runAfterRegularReportSaved,
  validateRegularReport,
} from "./regularReportUtils.js";

test("regular payload keeps the locked type, mode, and stable item ids", () => {
  const item = normalizeRegularItem({ id: 9, sort_order: 4, occurred_on: "2026-08-10", description: "办公用品", amount: 88 });
  const payload = buildRegularReportPayload({
    form: { report_date: "2026-08-11", employee_name: "张三" },
    mode: "no_invoice",
    items: [item],
    attachments: [{ id: 2, regular_item_id: 9, page_count: 3 }],
  });
  assert.equal(payload.report_type, "regular");
  assert.equal(payload.regular_mode, "no_invoice");
  assert.deepEqual(payload.regular_items[0], {
    id: 9,
    sort_order: 1,
    occurred_on: "2026-08-10",
    description: "办公用品",
    amount: "88.00",
    remark: null,
  });
});

test("invoice mode derives confirmed total and counts every invoice record", () => {
  const item = normalizeRegularItem({ id: 3, amount: 999 });
  const invoices = [
    { id: 1, regular_item_id: 3, amount: "20.50", amount_confirmed: true },
    { id: 2, regular_item_id: 3, amount: "10.00", amount_confirmed: false },
  ];
  assert.deepEqual(getRegularItemDerived({ item, mode: "invoice", invoices }), {
    amount: 20.5,
    documentCount: 2,
    invoices,
    attachments: [],
  });
  assert.deepEqual(calculateRegularSummary({ mode: "invoice", items: [item], invoices }), {
    totalAmount: 20.5,
    documentCount: 2,
  });
  const payload = buildRegularReportPayload({
    form: { report_date: "2026-08-11", employee_name: "张三" },
    mode: "invoice",
    items: [{ ...item, occurred_on: "2026-08-10", description: "材料费" }],
    invoices,
  });
  assert.equal(Object.hasOwn(payload.regular_items[0], "amount"), false);
  assert.equal(Object.hasOwn(payload.regular_items[0], "document_count"), false);
});

test("regular validation allows optional evidence but requires complete invoice items", () => {
  const form = { report_date: "2026-08-11", employee_name: "李四" };
  const item = { ...makeBlankRegularItem(), id: 12, occurred_on: "2026-08-10", description: "材料费", amount: "50" };
  assert.equal(validateRegularReport({ form, mode: "no_invoice", items: [item] }), "");
  assert.match(validateRegularReport({ form, mode: "invoice", items: [item], invoices: [] }), /至少需要上传一张发票/);
  assert.match(
    validateRegularReport({ form, mode: "invoice", items: [item], invoices: [{ regular_item_id: 12, amount_confirmed: false }] }),
    /未确认发票/,
  );
});

test("items with related files cannot be removed implicitly", () => {
  const item = { id: 7 };
  assert.equal(canDeleteRegularItem({ item, mode: "no_invoice", attachments: [{ regular_item_id: 7 }] }), false);
  assert.equal(canDeleteRegularItem({ item, mode: "invoice", invoices: [{ regular_item_id: 7 }] }), false);
  assert.equal(canDeleteRegularItem({ item: { id: null }, mode: "invoice" }), true);
});

test("pdf gate blocks on unconfirmed invoices first, then on completeness", () => {
  const form = { report_date: "2026-08-11", employee_name: "李四" };
  const item = { ...makeBlankRegularItem(), id: 12, occurred_on: "2026-08-10", description: "材料费", amount: "50" };
  const confirmed = { regular_item_id: 12, amount: "10", amount_confirmed: true };
  const unconfirmed = { regular_item_id: 12, amount: "10", amount_confirmed: false };

  const unconfirmedGate = getRegularPdfGate({ form, mode: "invoice", items: [item], invoices: [confirmed, unconfirmed] });
  assert.equal(unconfirmedGate.previewBlocked, true);
  assert.equal(unconfirmedGate.downloadBlocked, true);
  assert.equal(unconfirmedGate.severity, "warning");
  assert.equal(unconfirmedGate.unconfirmedCount, 1);
  assert.match(unconfirmedGate.message, /1 张发票待确认/);

  const incompleteGate = getRegularPdfGate({ form: { ...form, employee_name: "" }, mode: "no_invoice", items: [item] });
  assert.equal(incompleteGate.previewBlocked, false);
  assert.equal(incompleteGate.downloadBlocked, true);
  assert.equal(incompleteGate.severity, "info");
  assert.match(incompleteGate.message, /报销人/);

  const readyGate = getRegularPdfGate({ form, mode: "no_invoice", items: [item] });
  assert.equal(readyGate.previewBlocked, false);
  assert.equal(readyGate.downloadBlocked, false);
  assert.match(readyGate.message, /可生成 PDF/);
});

test("related file mutations wait for a successful report save", async () => {
  const abortedCalls = [];
  const aborted = await runAfterRegularReportSaved({
    ensureSaved: async () => {
      abortedCalls.push("save");
      return { ok: false, reportId: 7 };
    },
    action: async () => abortedCalls.push("action"),
  });
  assert.equal(aborted, false);
  assert.deepEqual(abortedCalls, ["save"]);

  const completedCalls = [];
  const completed = await runAfterRegularReportSaved({
    ensureSaved: async () => {
      completedCalls.push("save");
      return { ok: true, reportId: 7 };
    },
    action: async ({ reportId }) => completedCalls.push(`action:${reportId}`),
  });
  assert.equal(completed, true);
  assert.deepEqual(completedCalls, ["save", "action:7"]);
});

test("item ordering and list summaries stay compact", () => {
  const items = [
    { id: 1, description: "材料", sort_order: 1 },
    { id: 2, description: "邮寄", sort_order: 2 },
    { id: 3, description: "维修", sort_order: 3 },
  ];
  assert.deepEqual(moveRegularItem(items, 2, 0).map((item) => item.id), [3, 1, 2]);
  assert.equal(regularItemSummary(items), "材料、邮寄 等 3 项");
});

test("regular summary cards use existing pending semantics", () => {
  assert.deepEqual(
    buildRegularSummaryCards({ selected_period: { total_amount: 130, total_count: 3, pending_amount: 50, pending_count: 2 } }),
    [
      { key: "total_amount", title: "总报销金额", value: "¥130.00" },
      { key: "report_count", title: "报销单数", value: "3 单" },
      { key: "pending_amount", title: "待报销金额", value: "¥50.00" },
      { key: "pending_count", title: "待处理数", value: "2 单" },
    ],
  );
});

test("regular frontend keeps independent routes, flat navigation, and item-bound uploads", () => {
  const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("./Dashboard.jsx", import.meta.url), "utf8");
  const travelListSource = readFileSync(new URL("./ReportList.jsx", import.meta.url), "utf8");
  const travelListViewSource = readFileSync(new URL("./ReportListView.jsx", import.meta.url), "utf8");
  const regularListSource = readFileSync(new URL("./RegularReportList.jsx", import.meta.url), "utf8");
  const travelEditSource = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
  const editSource = readFileSync(new URL("./RegularReportEdit.jsx", import.meta.url), "utf8");
  const viewSource = readFileSync(new URL("./RegularReportEditView.jsx", import.meta.url), "utf8");
  const invoiceCardListSource = readFileSync(
    new URL("../features/report-edit-shared/InvoiceCardList.jsx", import.meta.url),
    "utf8",
  );
  const evidenceSource = readFileSync(new URL("../features/regular-report/RegularEvidenceSection.jsx", import.meta.url), "utf8");
  const invoiceViewerSource = readFileSync(new URL("../components/InvoiceViewer.jsx", import.meta.url), "utf8");
  assert.ok(appSource.indexOf('label: "出差报销单"') < appSource.indexOf('key: "report-type-divider"'));
  assert.ok(appSource.indexOf('key: "report-type-divider"') < appSource.indexOf('label: "常规报销单"'));
  assert.match(appSource, /path="\/regular-reports\/new"/);
  assert.match(appSource, /path="\/regular-reports\/:id\/edit"/);
  assert.match(dashboardSource, /reportType: "travel"/);
  assert.match(travelListSource, /reportType: "travel"/);
  assert.match(travelListSource, /prepareDataExport\(\{ status, reportType: "travel", filters, reportIds \}\)/);
  assert.match(travelListViewSource, /导出已选数据/);
  assert.match(regularListSource, /reportType: "regular"/);
  assert.match(regularListSource, /prepareDataExport\(\{/);
  assert.match(regularListSource, /handleDataExport\(selectedIds\)/);
  assert.match(regularListSource, />导出已选<\/Button>/);
  assert.match(regularListSource, /prepareReportPdfDownload\(report\.id\)/);
  assert.match(regularListSource, /prepareReportBatchPdfDownload\(selectedIds\)/);
  assert.match(editSource, /prepareReportPdfDownload\(saved\.reportId\)/);
  assert.match(travelEditSource, /report_date: res\.data\.report_date/);
  assert.match(editSource, /report_date: response\.data\.report_date/);
  assert.doesNotMatch(regularListSource, /createObjectURL/);
  assert.doesNotMatch(editSource, /createObjectURL/);
  assert.match(regularListSource, /regularMode,/);
  assert.match(regularListSource, /filters: queryFilters/);
  assert.match(regularListSource, /\/reports\?import_data=1/);
  assert.match(travelListSource, /params\.get\("import_data"\) !== "1"/);
  assert.match(travelEditSource, /report\.report_type !== "travel"/);
  assert.match(travelEditSource, /navigate\(`\/regular-reports\/\$\{report\.id\}\/edit`/);
  assert.match(editSource, /uploadInvoice\(\{ reportId: saved\.reportId, regularItemId, file \}\)/);
  assert.match(editSource, /uploadReportAttachment\(\{ reportId: saved\.reportId, regularItemId, file \}\)/);
  assert.match(editSource, /runAfterRegularReportSaved\(\{/);
  assert.match(invoiceViewerSource, /await onUpdated\?\.\(\)/);
  assert.match(regularListSource, /const \[summaryError, setSummaryError\] = useState\(""\)/);
  assert.match(regularListSource, /unavailable=\{Boolean\(summaryError\)\}/);
  assert.equal((regularListSource.match(/`选择报销单 \$\{report\.id\}`/g) || []).length, 2);
  assert.match(viewSource, /InvoiceDropzone/);
  assert.match(viewSource, /RegularEvidenceSection/);
  assert.match(viewSource, /InvoiceCardList/);
  assert.ok(invoiceCardListSource.indexOf("invoices.map") < invoiceCardListSource.indexOf("!readonly && uploadSlot"));
  assert.ok(evidenceSource.indexOf("attachments.map") < evidenceSource.indexOf("<FileUploadPlaceholder"));
  assert.match(evidenceSource, /attachments\.length === 0 && disabled/);
  assert.match(evidenceSource, /暂无报销凭据/);
  assert.doesNotMatch(viewSource, /PaperInvoiceEntry/);
});
