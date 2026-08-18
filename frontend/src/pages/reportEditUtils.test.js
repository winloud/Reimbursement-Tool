import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TRIP_CARD_ACTION_POLICY,
  buildTripDateRanges,
  buildDraftPayload,
  buildCustomExpenseCategory,
  buildReportPayload,
  calculateSubsidyDays,
  calculateSummary,
  cloneTripAfter,
  createInvoiceUploadIssue,
  getExpenseCategoryLabel,
  getExpenseCategoryOptions,
  getClipboardInvoiceFilename,
  getClipboardInvoiceFiles,
  getClipboardReportAttachmentFilename,
  getClipboardReportAttachmentFiles,
  getExpenseItemAmount,
  getFuelSubsidyInvoiceShortfall,
  getInvoiceUploadFeedback,
  getPaperInvoiceCount,
  getSubsidySpans,
  getTripGapWarnings,
  getTripPdfGate,
  getVisibleExpenseCategories,
  hasExpenseItemData,
  hasPaperInvoice,
  getTripYearRangeLabel,
  hydrateTripDates,
  isEmptyDraft,
  isSupportedReportAttachmentFile,
  isSupportedInvoiceFile,
  shouldExpandExpenseItem,
  validateCustomExpenseName,
  makeBlankTrip,
  makeReturnTripAfter,
  moveTrip,
  normalizeTrip,
  appendTripWithAutoStart,
  swapTripEndpoints,
  validateFuelSubsidyAmount,
  validateManualSubsidyTotal,
  validatePaperInvoice,
  validatePurposeForStatusTransition,
  validateTrips,
} from "./reportEditUtils.js";

describe("report edit utilities", () => {
  it("derives month and day from the trip date and keeps them in sync", () => {
    const trip = normalizeTrip({ depart_date: "2025-12-30", arrive_date: "2026-01-02" }, 0);

    assert.equal(trip.depart_date, "2025-12-30");
    assert.deepEqual([trip.depart_month, trip.depart_day], [12, 30]);
    assert.deepEqual([trip.arrive_month, trip.arrive_day], [1, 2]);
  });

  it("keeps legacy month and day when a trip has no stored date", () => {
    const trip = normalizeTrip({ depart_month: 6, depart_day: 3, arrive_month: 6, arrive_day: 4 }, 0);

    assert.equal(trip.depart_date, "");
    assert.deepEqual([trip.depart_month, trip.depart_day], [6, 3]);
  });

  it("blanks a new trip with the report date instead of a bare month and day", () => {
    assert.equal(makeBlankTrip("2026-06-03").depart_date, "2026-06-03");
    assert.equal(makeBlankTrip("2026-06-03").arrive_date, "2026-06-03");
  });

  it("counts subsidy days from stored dates instead of guessing the year", () => {
    // 报销单日期在 2026 年初：靠月日推断会把 12/30 算成 2026-12-30，存了日期就按日期算。
    const trips = [normalizeTrip({ depart_date: "2025-12-30", arrive_date: "2026-01-02" }, 0)];

    assert.equal(calculateSubsidyDays("2026-01-06", trips), 4);
    const [range] = buildTripDateRanges("2026-01-06", trips);
    assert.equal(range.depart.getFullYear(), 2025);
    assert.equal(range.arrive.getFullYear(), 2026);
  });

  it("realigns inferred years to the last stored trip date", () => {
    const trips = [
      normalizeTrip({ depart_date: "2025-03-01", arrive_date: "2025-03-02" }, 0),
      normalizeTrip({ depart_month: 3, depart_day: 5, arrive_month: 3, arrive_day: 6 }, 1),
    ];

    const ranges = buildTripDateRanges("2026-06-01", trips);

    assert.deepEqual(
      ranges.map((range) => range.depart.getFullYear()),
      [2025, 2025],
    );
  });

  it("hydrates legacy trips with inferred dates and leaves stored ones alone", () => {
    const hydrated = hydrateTripDates("2026-01-05", [
      { depart_month: 12, depart_day: 30, arrive_month: 12, arrive_day: 31 },
      { depart_date: "2026-01-02", arrive_date: "2026-01-02" },
    ]);

    assert.deepEqual(
      hydrated.map((trip) => [trip.depart_date, trip.arrive_date]),
      [
        ["2025-12-30", "2025-12-31"],
        ["2026-01-02", "2026-01-02"],
      ],
    );
  });

  it("swaps trip dates along with the endpoints", () => {
    const swapped = swapTripEndpoints(
      normalizeTrip({ depart_date: "2026-06-01", depart_place: "杭州", arrive_date: "2026-06-02", arrive_place: "北京" }, 0),
    );

    assert.deepEqual(
      [swapped.depart_date, swapped.depart_place, swapped.arrive_date, swapped.arrive_place],
      ["2026-06-02", "北京", "2026-06-01", "杭州"],
    );
  });

  it("rejects saving a trip whose date was cleared", () => {
    assert.match(validateTrips([normalizeTrip({ depart_date: "", arrive_date: "2026-06-02" }, 0)]), /行程的出发日期/);
    assert.equal(validateTrips([normalizeTrip({ depart_date: "2026-06-01", arrive_date: "2026-06-02" }, 0)]), "");
  });

  it("keeps start, end, and return visible while secondary trip actions use overflow", () => {
    assert.deepEqual(TRIP_CARD_ACTION_POLICY, {
      directActions: ["start", "end", "return"],
      overflowActions: ["duplicate", "swap", "delete"],
    });

    const timelineSource = readFileSync(
      new URL("../features/report-edit/TripTimeline.jsx", import.meta.url),
      "utf8",
    );
    const dividerMarkup = '<Divider orientation="vertical" flexItem sx={{ mx: 1 }} />';
    const leadingDividerIndex = timelineSource.indexOf(dividerMarkup);
    const startMarkerIndex = timelineSource.indexOf('toggleTripMarker(index, "subsidy_start")');
    const endMarkerIndex = timelineSource.indexOf('toggleTripMarker(index, "subsidy_end")');
    const trailingDividerIndex = timelineSource.indexOf(dividerMarkup, leadingDividerIndex + 1);

    assert.match(timelineSource, /useFlexGap/);
    assert.equal((timelineSource.match(/<Divider orientation="vertical" flexItem sx=\{\{ mx: 1 \}\} \/>/g) || []).length, 2);
    assert.ok(leadingDividerIndex < startMarkerIndex);
    assert.ok(startMarkerIndex < endMarkerIndex);
    assert.ok(endMarkerIndex < trailingDividerIndex);
  });

  it("blocks both PDF actions while invoices are unconfirmed", () => {
    const gate = getTripPdfGate({ unconfirmedCount: 3, confirmedInvoiceCount: 1 });
    assert.equal(gate.severity, "warning");
    assert.equal(gate.previewBlocked, true);
    assert.equal(gate.downloadBlocked, true);
    assert.equal(gate.unconfirmedCount, 3);
    assert.equal(gate.dialogTitle, "存在未确认发票");
    assert.match(gate.message, /3 张发票待确认/);
  });

  it("blocks both PDF actions when trip start and end markers are unmatched", () => {
    const gate = getTripPdfGate({ hasTripMarkerIssue: true, confirmedInvoiceCount: 2 });

    assert.equal(gate.severity, "warning");
    assert.equal(gate.previewBlocked, true);
    assert.equal(gate.downloadBlocked, true);
    // 行程数据问题需要弹窗解释，默认状态下按钮仍可点击；状态门槛仍由 disabled 字段独立控制。
    assert.equal(gate.previewDisabled, false);
    assert.equal(gate.downloadDisabled, false);
    assert.equal(gate.previewBlockedLabel, "补齐起止后预览");
    assert.equal(gate.downloadBlockedLabel, "补齐起止后下载");
    assert.equal(gate.hasTripMarkerIssue, true);
    assert.equal(gate.dialogTitle, "行程起止未成对");
    assert.match(gate.message, /“起”“止”没有成对/);
  });

  it("blocks only download when the fuel subsidy invoice total falls short, and keeps it clickable", () => {
    const gate = getTripPdfGate({ fuelSubsidyShortfall: 42.5, confirmedInvoiceCount: 2 });
    assert.equal(gate.severity, "warning");
    assert.equal(gate.previewBlocked, false);
    assert.equal(gate.downloadBlocked, true);
    // blocked 但不 disabled：按钮仍可点，由页面弹窗解释原因。
    assert.equal(gate.downloadDisabled, false);
    assert.equal(gate.downloadBlockedLabel, "补足后下载");
    assert.equal(gate.dialogTitle, "燃油补助发票金额不足");
  });

  it("clears the gate once invoices are confirmed and distinguishes the empty report", () => {
    const ready = getTripPdfGate({ confirmedInvoiceCount: 2 });
    assert.equal(ready.severity, "info");
    assert.equal(ready.previewBlocked, false);
    assert.equal(ready.downloadBlocked, false);
    assert.equal(ready.message, "发票已确认，可生成 PDF。");

    const empty = getTripPdfGate({ confirmedInvoiceCount: 0 });
    assert.equal(empty.message, "暂无已确认发票，可先录入行程和费用。");
  });

  it("disables both PDF actions when the status or empty draft forbids output", () => {
    const byStatus = getTripPdfGate({ confirmedInvoiceCount: 2, canAccessPdf: false });
    assert.equal(byStatus.previewDisabled, true);
    assert.equal(byStatus.downloadDisabled, true);

    const byEmptyDraft = getTripPdfGate({ confirmedInvoiceCount: 0, canCreateOutput: false });
    assert.equal(byEmptyDraft.previewDisabled, true);
    assert.equal(byEmptyDraft.downloadDisabled, true);
  });

  it("detects an untouched client-side draft as empty and every meaningful edit as non-empty", () => {
    const defaults = {
      report_date: "2026-06-03",
      department: "财务部",
      employee_name: "张三",
      daily_subsidy: "120.00",
    };
    const form = {
      ...defaults,
      purpose: "",
      advance_date_month: "",
      advance_date_day: "",
      advance_amount: "0.00",
    };

    assert.equal(isEmptyDraft({ form, defaults, trips: [], invoices: [] }), true);
    assert.equal(isEmptyDraft({ form: { ...form, purpose: "成都出差" }, defaults, trips: [], invoices: [] }), false);
    assert.equal(isEmptyDraft({ form: { ...form, department: "研发部" }, defaults, trips: [], invoices: [] }), false);
    assert.equal(isEmptyDraft({ form: { ...form, advance_date_month: "6" }, defaults, trips: [], invoices: [] }), false);
    assert.equal(isEmptyDraft({ form: { ...form, advance_amount: "1.00" }, defaults, trips: [], invoices: [] }), false);
    assert.equal(isEmptyDraft({ form, defaults, trips: [makeBlankTrip("2026-06-03")], invoices: [] }), false);
    assert.equal(isEmptyDraft({ form, defaults, trips: [], invoices: [{ id: 1 }] }), false);
    assert.equal(isEmptyDraft({ form, defaults, trips: [], invoices: [], attachments: [{ id: 1 }] }), false);
    assert.equal(
      isEmptyDraft({ form, defaults, trips: [], invoices: [], expenseItems: [{ paper_invoice_amount: "18.00", paper_invoice_count: 1 }] }),
      false,
    );
    assert.equal(
      isEmptyDraft({ form, defaults, trips: [], invoices: [], expenseItems: [{ category: "luggage", remark: "打包" }] }),
      false,
    );
    assert.equal(
      isEmptyDraft({ form, defaults, trips: [], invoices: [], expenseItems: [{ category: "fuel_subsidy", reimbursable_amount: "0" }] }),
      false,
    );
    assert.equal(
      isEmptyDraft({ form, defaults, trips: [], invoices: [], expenseItems: [{ category: "custom:资料费" }] }),
      false,
    );
  });

  it("expands other expenses only when they contain business data or are custom", () => {
    const emptyFixed = { category: "luggage", remark: "", reimbursable_amount: "", paper_invoice_amount: "0.00", paper_invoice_count: 0 };
    assert.equal(hasExpenseItemData(emptyFixed), false);
    assert.equal(shouldExpandExpenseItem(emptyFixed, []), false);
    assert.equal(shouldExpandExpenseItem(emptyFixed, [{ id: 1, amount_confirmed: false }]), true);
    assert.equal(shouldExpandExpenseItem({ ...emptyFixed, paper_invoice_amount: "12.00", paper_invoice_count: 1 }, []), true);
    assert.equal(shouldExpandExpenseItem({ ...emptyFixed, remark: "无票说明" }, []), true);
    assert.equal(shouldExpandExpenseItem({ ...emptyFixed, category: "fuel_subsidy", reimbursable_amount: "0" }, []), true);
    assert.equal(shouldExpandExpenseItem({ ...emptyFixed, category: "custom:资料费" }, []), true);
  });

  it("lists an other-expense category only when it has data, invoices, or was just added", () => {
    const categories = [
      { value: "luggage", label: "行李费" },
      { value: "accommodation", label: "住宿费" },
      { value: "toll", label: "通行费" },
      { value: "postal", label: "邮电费" },
      { value: "custom:资料费", label: "资料费", custom: true },
    ];
    // 后端总会为 7 个固定类别回填空行，因此过滤不能只看 item 是否存在。
    const emptyFields = { remark: "", reimbursable_amount: "", paper_invoice_amount: "0.00", paper_invoice_count: 0 };
    const expenseItems = [
      { category: "luggage", ...emptyFields },
      { category: "accommodation", ...emptyFields },
      { category: "toll", ...emptyFields, paper_invoice_amount: "12.00", paper_invoice_count: 1 },
      { category: "postal", ...emptyFields },
      { category: "custom:资料费", ...emptyFields },
    ];
    // 住宿费只上传了发票、item 字段全空：必须仍然可见，否则发票会在界面上失踪。
    const invoicesByCategory = { accommodation: [{ id: 1, amount_confirmed: false }] };

    const visible = getVisibleExpenseCategories({
      categories,
      expenseItems,
      getInvoices: (category) => invoicesByCategory[category] || [],
      pinnedCategories: new Set(["postal"]),
    });
    assert.deepEqual(visible.map((category) => category.value), [
      "accommodation",
      "toll",
      "postal",
      "custom:资料费",
    ]);

    // 没有手动添加时，空的固定类别全部隐藏；自定义类别始终显示。
    const withoutPinned = getVisibleExpenseCategories({
      categories,
      expenseItems,
      getInvoices: () => [],
      pinnedCategories: [],
    });
    assert.deepEqual(withoutPinned.map((category) => category.value), ["toll", "custom:资料费"]);

    assert.deepEqual(getVisibleExpenseCategories(), []);
  });

  it("requires purpose only for the draft to checked transition", () => {
    const missingPurpose = { currentStatus: "draft", targetStatus: "checked", purpose: "  " };
    assert.match(validatePurposeForStatusTransition(missingPurpose), /出差事由不能为空/);
    assert.equal(validatePurposeForStatusTransition({ ...missingPurpose, purpose: "客户拜访" }), "");
    assert.equal(validatePurposeForStatusTransition({ ...missingPurpose, targetStatus: "draft" }), "");
    assert.equal(
      validatePurposeForStatusTransition({ currentStatus: "checked", targetStatus: "submitted", purpose: "" }),
      "",
    );
  });

  it("saves pending report edits before uploading invoices", () => {
    const source = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
    const handlerStart = source.indexOf("const handleFilesUpload = async");
    const handlerEnd = source.indexOf("const handleDeleteInvoice", handlerStart);
    assert.notEqual(handlerStart, -1);
    assert.notEqual(handlerEnd, -1);

    const handler = source.slice(handlerStart, handlerEnd);
    const saveIndex = handler.indexOf("ensureSavedBeforeAction({ allowEmptyCreate: true })");
    const uploadStateIndex = handler.indexOf("setUploadState");
    const uploadIndex = handler.indexOf("uploadInvoice");
    const reloadIndex = handler.indexOf("await loadForEdit({ quiet: true, reportId: saved.reportId })");

    assert.ok(saveIndex > -1);
    assert.ok(saveIndex < uploadStateIndex);
    assert.ok(saveIndex < uploadIndex);
    assert.ok(saveIndex < reloadIndex);
  });

  it("renders one report-level non-invoice attachment area after all other expenses with shared section and upload feedback", () => {
    const source = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
    const viewSource = readFileSync(new URL("./ReportEditView.jsx", import.meta.url), "utf8");
    const attachmentSource = readFileSync(
      new URL("../features/report-edit/ReportAttachmentSection.jsx", import.meta.url),
      "utf8",
    );
    const uploadPlaceholderSource = readFileSync(
      new URL("../components/FileUploadPlaceholder.jsx", import.meta.url),
      "utf8",
    );
    const fileListShellSource = readFileSync(
      new URL("../features/report-edit-shared/FileListShell.jsx", import.meta.url),
      "utf8",
    );
    const handlerStart = source.indexOf("const handleAttachmentFilesUpload = async");
    const handlerEnd = source.indexOf("const handleDeleteReportAttachment", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    assert.equal((viewSource.match(/<ReportAttachmentSection/g) || []).length, 1);
    assert.ok(viewSource.indexOf('id="expense-section"') < viewSource.indexOf("<ReportAttachmentSection"));
    assert.ok(handler.indexOf("ensureSavedBeforeAction({ allowEmptyCreate: true })") < handler.indexOf("uploadReportAttachment"));
    assert.match(viewSource, /<BlockCard[\s\S]*?id="basic-info-section"[\s\S]*?title="基本信息"[\s\S]*?basicInfoSummary/);
    assert.doesNotMatch(viewSource, /<Card id="basic-info-section"/);
    assert.doesNotMatch(viewSource, /editSectionNavSx|EDIT_SECTIONS|onClick=\{\(\) => scrollToSection/);
    assert.match(attachmentSource, /<BlockCard[\s\S]*?id="report-attachment-section"[\s\S]*?非发票附件/);
    assert.match(attachmentSource, /不计入发票数量，导出时排在全部发票之后/);
    assert.match(attachmentSource, /暂无非发票附件/);
    // 附件与发票共用同一列表外壳，上传入口始终排在已上传文件之后。
    assert.match(attachmentSource, /<AttachmentCardList/);
    assert.ok(fileListShellSource.indexOf("{children}") < fileListShellSource.indexOf("!readonly && uploadSlot"));
    assert.match(uploadPlaceholderSource, /const uploadConfirm = keyframes/);
    assert.match(uploadPlaceholderSource, /transform: activeVisual \? "translateY\(-2px\)"/);
    assert.match(uploadPlaceholderSource, /animation: received \? `\$\{uploadConfirm\} 480ms ease-out`/);
    assert.match(uploadPlaceholderSource, /transition: activeVisual \? "transform 700ms ease"/);
    assert.match(uploadPlaceholderSource, /submitFiles\(event\.dataTransfer\.files\)/);
    assert.match(uploadPlaceholderSource, /event\.currentTarget\.focus\(\)/);
    assert.match(uploadPlaceholderSource, /<Button component="label"/);
    assert.match(uploadPlaceholderSource, /Ctrl\+V/);
  });

  it("accepts supported invoice files from clipboard items or file fallback", () => {
    const png = { name: "", type: "image/png" };
    const pdf = { name: "invoice.PDF", type: "" };
    const unsupported = { name: "notes.txt", type: "text/plain" };

    assert.equal(isSupportedInvoiceFile(png), true);
    assert.equal(isSupportedInvoiceFile(pdf), true);
    assert.equal(isSupportedInvoiceFile(unsupported), false);
    assert.deepEqual(
      getClipboardInvoiceFiles({
        items: [
          { kind: "string", getAsFile: () => null },
          { kind: "file", getAsFile: () => png },
          { kind: "file", getAsFile: () => unsupported },
        ],
        files: [pdf],
      }),
      [png],
    );
    assert.deepEqual(getClipboardInvoiceFiles({ items: [], files: [unsupported, pdf] }), [pdf]);
  });

  it("adds a backend-compatible filename to unnamed clipboard images", () => {
    assert.equal(getClipboardInvoiceFilename({ name: "invoice.webp", type: "image/webp" }, 0, 1234), "invoice.webp");
    assert.equal(getClipboardInvoiceFilename({ name: "", type: "image/png" }, 1, 1234), "clipboard-invoice-1234-2.png");
    assert.equal(getClipboardInvoiceFilename({ name: "clipboard", type: "application/pdf" }, 0, 1234), "clipboard-invoice-1234-1.pdf");
  });

  it("uses the same supported file boundary for report-level non-invoice attachments", () => {
    const png = { name: "", type: "image/png" };
    const pdf = { name: "evidence.pdf", type: "application/pdf" };
    const unsupported = { name: "notes.txt", type: "text/plain" };

    assert.equal(isSupportedReportAttachmentFile(png), true);
    assert.equal(isSupportedReportAttachmentFile(unsupported), false);
    assert.deepEqual(getClipboardReportAttachmentFiles({ items: [], files: [unsupported, pdf] }), [pdf]);
    assert.equal(
      getClipboardReportAttachmentFilename(png, 0, 1234),
      "clipboard-attachment-1234-1.png",
    );
  });

  it("classifies invoice upload issues and keeps their filenames", () => {
    assert.deepEqual(createInvoiceUploadIssue("invoice-a.pdf", "该发票已存在", 409), {
      fileName: "invoice-a.pdf",
      message: "该发票已存在",
      type: "duplicate",
    });
    assert.deepEqual(createInvoiceUploadIssue("", "", 500), {
      fileName: "未命名文件",
      message: "上传失败",
      type: "error",
    });
  });

  it("summarizes successful and failed invoice uploads", () => {
    assert.deepEqual(
      getInvoiceUploadFeedback({ totalFileCount: 1, successfulFileCount: 1 }),
      {
        totalFileCount: 1,
        successfulFileCount: 1,
        duplicateCount: 0,
        failedCount: 0,
        issues: [],
        hasIssues: false,
        toastMessage: "发票已上传，请确认发票信息",
      },
    );
    const duplicateIssue = createInvoiceUploadIssue("duplicate.pdf", "该发票已存在", 409);
    assert.deepEqual(
      getInvoiceUploadFeedback({ totalFileCount: 3, successfulFileCount: 2, issues: [duplicateIssue] }),
      {
        totalFileCount: 3,
        successfulFileCount: 2,
        duplicateCount: 1,
        failedCount: 0,
        issues: [duplicateIssue],
        hasIssues: true,
        toastMessage: "",
      },
    );
    const duplicateIssues = [
      createInvoiceUploadIssue("first.pdf", "文件重复", 409),
      createInvoiceUploadIssue("second.pdf", "发票号重复", 409),
    ];
    assert.deepEqual(
      getInvoiceUploadFeedback({
        totalFileCount: 2,
        successfulFileCount: 0,
        issues: duplicateIssues,
      }),
      {
        totalFileCount: 2,
        successfulFileCount: 0,
        duplicateCount: 2,
        failedCount: 0,
        issues: duplicateIssues,
        hasIssues: true,
        toastMessage: "",
      },
    );

    const failedIssue = createInvoiceUploadIssue("broken.pdf", "解析失败", 500);
    assert.deepEqual(
      getInvoiceUploadFeedback({
        totalFileCount: 3,
        successfulFileCount: 1,
        issues: [duplicateIssue, failedIssue],
      }),
      {
        totalFileCount: 3,
        successfulFileCount: 1,
        duplicateCount: 1,
        failedCount: 1,
        issues: [duplicateIssue, failedIssue],
        hasIssues: true,
        toastMessage: "",
      },
    );
  });

  it("uses one upload-result dialog before confirming partial successes", () => {
    const reportEditSource = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
    const dialogSource = readFileSync(
      new URL("../components/InvoiceUploadResultDialog.jsx", import.meta.url),
      "utf8",
    );

    assert.match(reportEditSource, /setUploadResult\(\{ \.\.\.feedback, uploadedInvoices: confirmationQueue \}\)/);
    assert.match(reportEditSource, /const handleUploadResultContinue/);
    assert.match(dialogSource, /发票上传结果/);
    assert.match(dialogSource, /继续确认 \{uploadedInvoiceCount\} 张/);
    assert.match(dialogSource, /知道了/);
    assert.match(dialogSource, /重复文件（未上传）/);
    assert.match(dialogSource, /上传失败/);
  });

  it("builds create and update payloads using backend field names", () => {
    const form = {
      report_date: "2026-06-03",
      department: "研发部",
      employee_name: "李四",
      purpose: "客户拜访",
      daily_subsidy: "100",
      manual_subsidy_total: null,
      advance_date_month: "",
      advance_date_day: "4",
      advance_amount: "",
    };
    const trips = [
      normalizeTrip(
        {
          id: 8,
          depart_date: "2026-06-03",
          depart_hour: "",
          depart_place: "深圳",
          arrive_date: "2026-06-03",
          arrive_hour: "12",
          arrive_place: "成都",
          transport: "高铁",
        },
        0,
      ),
    ];

    assert.deepEqual(buildDraftPayload(form), {
      report_date: "2026-06-03",
      department: "研发部",
      employee_name: "李四",
      purpose: null,
      daily_subsidy: "100",
      manual_subsidy_total: null,
      advance_date_month: null,
      advance_date_day: 4,
      advance_amount: "0.00",
    });

    assert.deepEqual(buildReportPayload({ form, trips, expenseItems: [{ id: 2, category: "luggage", remark: "  箱子  " }] }), {
      report_date: "2026-06-03",
      department: "研发部",
      employee_name: "李四",
      purpose: "客户拜访",
      daily_subsidy: "100",
      manual_subsidy_total: null,
      advance_date_month: null,
      advance_date_day: 4,
      advance_amount: "0.00",
      trips: [
        {
          id: 8,
          sort_order: 1,
          depart_date: "2026-06-03",
          depart_month: 6,
          depart_day: 3,
          depart_hour: null,
          depart_place: "深圳",
          arrive_date: "2026-06-03",
          arrive_month: 6,
          arrive_day: 3,
          arrive_hour: 12,
          arrive_place: "成都",
          transport: "高铁",
          subsidy_start: false,
          subsidy_end: false,
          paper_invoice_amount: "0.00",
          paper_invoice_count: 0,
        },
      ],
      expense_items: [
        { id: 2, category: "luggage", remark: "箱子", reimbursable_amount: null, paper_invoice_amount: "0.00", paper_invoice_count: 0 },
      ],
    });

    assert.deepEqual(
      buildReportPayload({
        form,
        trips: [],
        expenseItems: [
          { id: 3, category: "fuel_subsidy", remark: "", reimbursable_amount: "180.00" },
        ],
      }).expense_items,
      [{ id: 3, category: "fuel_subsidy", remark: null, reimbursable_amount: "180.00", paper_invoice_amount: "0.00", paper_invoice_count: 0 }],
    );
  });

  it("supports trip reorder, copy, swap, and return trip generation", () => {
    const first = normalizeTrip(
      { id: 1, depart_place: "深圳", arrive_place: "成都", transport: "高铁", subsidy_start: true, subsidy_end: true, paper_invoice_amount: "88.00", paper_invoice_count: 2 },
      0,
    );
    const second = normalizeTrip({ id: 2, depart_place: "成都", arrive_place: "北京", transport: "飞机" }, 1);

    assert.deepEqual(moveTrip([first, second], 0, 1).map((trip) => trip.id), [2, 1]);

    const cloned = cloneTripAfter([first, second], 0);
    assert.equal(cloned.length, 3);
    // 复制段追加到末尾（不再插在源行程后面）
    assert.equal(cloned[2].id, null);
    assert.equal(cloned[2].depart_place, "深圳");
    assert.equal(cloned[2].subsidy_start, false);
    assert.equal(cloned[2].subsidy_end, false);
    assert.equal(cloned[2].paper_invoice_amount, "0.00");
    assert.equal(cloned[2].paper_invoice_count, 0);

    const swapped = swapTripEndpoints(first);
    assert.equal(swapped.depart_place, "成都");
    assert.equal(swapped.arrive_place, "深圳");

    const returned = makeReturnTripAfter([first], 0);
    assert.equal(returned[1].id, null);
    assert.equal(returned[1].depart_place, "成都");
    assert.equal(returned[1].arrive_place, "深圳");
    assert.equal(returned[1].transport, "高铁");
    // 返程自动标「止」收尾，不继承源段的「起」
    assert.equal(returned[1].subsidy_start, false);
    assert.equal(returned[1].subsidy_end, true);
    assert.equal(returned[1].paper_invoice_amount, "0.00");
    assert.equal(returned[1].paper_invoice_count, 0);
  });

  it("splits confirmed legacy invoices into transport and other expenses", () => {
    const summary = calculateSummary({
      reportDate: "2026-06-01",
      dailySubsidy: "80",
      advanceAmount: "100",
      trips: [
        normalizeTrip({ depart_month: 6, depart_day: 1, arrive_month: 6, arrive_day: 3 }, 0),
      ],
      invoices: [
        { trip_id: 8, expense_category: "transport_fare", amount: "50.50", amount_confirmed: true },
        { expense_category: "luggage", amount: "20.00", amount_confirmed: true },
        { trip_id: 9, expense_category: "fuel_subsidy", amount: "300.00", amount_confirmed: true },
        { trip_id: 10, expense_category: "transport_fare", amount: "999.00", amount_confirmed: false },
      ],
    });

    assert.deepEqual(summary, {
      subsidyDays: 3,
      subsidyTotal: 240,
      transportTotal: 50.5,
      otherExpenseTotal: 20,
      invoiceTotal: 70.5,
      total: 310.5,
      shortfall: 210.5,
      surplus: 0,
    });
  });

  it("uses a manual subsidy total including zero without changing automatic days", () => {
    const base = {
      reportDate: "2026-06-01",
      dailySubsidy: "80.00",
      advanceAmount: "0.00",
      trips: [normalizeTrip({ depart_month: 6, depart_day: 1, arrive_month: 6, arrive_day: 3 }, 0)],
      invoices: [],
    };

    const manualSummary = calculateSummary({ ...base, manualSubsidyTotal: "75.50" });
    assert.equal(manualSummary.subsidyDays, 3);
    assert.equal(manualSummary.subsidyTotal, 75.5);
    assert.equal(manualSummary.total, 75.5);

    const zeroSummary = calculateSummary({ ...base, manualSubsidyTotal: "0.00" });
    assert.equal(zeroSummary.subsidyDays, 3);
    assert.equal(zeroSummary.subsidyTotal, 0);
    assert.equal(zeroSummary.total, 0);
  });

  it("preserves nullable and zero manual subsidy totals in report payloads", () => {
    const baseForm = {
      report_date: "2026-06-03",
      department: "财务部",
      employee_name: "张三",
      purpose: "短时外出",
      daily_subsidy: "100.00",
      manual_subsidy_total: null,
      advance_date_month: "",
      advance_date_day: "",
      advance_amount: "0.00",
    };

    assert.equal(buildReportPayload({ form: baseForm, trips: [], expenseItems: [] }).manual_subsidy_total, null);
    assert.equal(
      buildReportPayload({ form: { ...baseForm, manual_subsidy_total: "0.00" }, trips: [], expenseItems: [] }).manual_subsidy_total,
      "0.00",
    );
  });

  it("validates a required non-negative manual subsidy amount with at most two decimals", () => {
    assert.match(validateManualSubsidyTotal(""), /请输入/);
    assert.match(validateManualSubsidyTotal("-1"), /不能为负数/);
    assert.match(validateManualSubsidyTotal("1.234"), /两位小数/);
    assert.equal(validateManualSubsidyTotal("0.00"), "");
    assert.equal(validateManualSubsidyTotal("75.5"), "");
  });

  it("treats selecting manual subsidy zero as an edited draft", () => {
    const defaults = {
      report_date: "2026-06-03",
      department: "财务部",
      employee_name: "张三",
      daily_subsidy: "120.00",
      manual_subsidy_total: null,
    };
    const form = {
      ...defaults,
      purpose: "",
      manual_subsidy_total: "0.00",
      advance_date_month: "",
      advance_date_day: "",
      advance_amount: "0.00",
    };

    assert.equal(isEmptyDraft({ form, defaults, trips: [], invoices: [] }), false);
    assert.equal(
      isEmptyDraft({
        form: { ...form, manual_subsidy_total: null },
        defaults: { ...defaults, manual_subsidy_total: "0.00" },
        trips: [],
        invoices: [],
      }),
      false,
    );
  });

  it("summarizes fuel subsidy by reimbursable amount and reports an invoice shortfall without blocking save", () => {
    const summary = calculateSummary({
      reportDate: "2026-06-01",
      dailySubsidy: "0",
      advanceAmount: "0",
      trips: [],
      invoices: [
        { trip_id: 8, expense_category: "transport_fare", amount: "50.00", amount_confirmed: true },
        { expense_category: "fuel_subsidy", amount: "300.00", amount_confirmed: true },
      ],
      expenseItems: [
        {
          category: "fuel_subsidy",
          reimbursable_amount: "180.00",
          invoice_total: "300.00",
          amount: "180.00",
        },
      ],
    });

    assert.equal(summary.transportTotal, 50);
    assert.equal(summary.otherExpenseTotal, 180);
    assert.equal(summary.invoiceTotal, 230);
    assert.equal(summary.total, 230);
    const insufficientItem = { category: "fuel_subsidy", reimbursable_amount: "301.00", invoice_total: "300.00" };
    assert.equal(validateFuelSubsidyAmount(insufficientItem), "");
    assert.equal(getFuelSubsidyInvoiceShortfall(insufficientItem), 1);
    assert.equal(getFuelSubsidyInvoiceShortfall({ category: "fuel_subsidy", reimbursable_amount: "", invoice_total: "300.00" }), 0);
  });

  it("adds paper invoices to live summaries and validates their paired fields", () => {
    const summary = calculateSummary({
      reportDate: "2026-06-01",
      dailySubsidy: "0",
      advanceAmount: "0",
      trips: [normalizeTrip({ paper_invoice_amount: "88.00", paper_invoice_count: 2 }, 0)],
      invoices: [{ trip_id: 8, expense_category: "transport_fare", amount: "12.00", amount_confirmed: true }],
      expenseItems: [
        { category: "luggage", paper_invoice_amount: "30.00", paper_invoice_count: 3, amount: "0.00" },
        { category: "fuel_subsidy", reimbursable_amount: "80.00", paper_invoice_amount: "80.00", paper_invoice_count: 1, amount: "0.00" },
      ],
    });

    assert.equal(summary.transportTotal, 100);
    assert.equal(summary.otherExpenseTotal, 110);
    assert.equal(summary.total, 210);
    assert.equal(
      getFuelSubsidyInvoiceShortfall(
        { category: "fuel_subsidy", reimbursable_amount: "81.00", paper_invoice_amount: "80.00", paper_invoice_count: 1 },
        [],
      ),
      1,
    );
    assert.equal(getPaperInvoiceCount({ paper_invoice_count: 2 }), 2);
    assert.equal(hasPaperInvoice({ paper_invoice_amount: "1.00", paper_invoice_count: 1 }), true);
    assert.equal(validatePaperInvoice({ paper_invoice_amount: "12.00", paper_invoice_count: 1 }), "");
    assert.match(validatePaperInvoice({ paper_invoice_amount: "12.00", paper_invoice_count: 0 }), /同时填写/);
    assert.match(validatePaperInvoice({ paper_invoice_amount: "12.00", paper_invoice_count: "1.5" }), /非负整数/);
  });

  it("filters zero-valued other expense items from summary details", () => {
    const expenseItems = [
      { category: "luggage", amount: "0.00" },
      { category: "fuel_subsidy", invoice_total: "300.00", reimbursable_amount: "0.00" },
      { category: "accommodation", amount: "120.00" },
    ];
    const visibleItems = expenseItems.filter((item) => getExpenseItemAmount(item) > 0);
    const source = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
    const viewSource = readFileSync(new URL("./ReportEditView.jsx", import.meta.url), "utf8");
    const expenseSource = readFileSync(
      new URL("../features/report-edit/ExpenseCategoryList.jsx", import.meta.url),
      "utf8",
    );
    const paperInvoiceSource = readFileSync(
      new URL("../features/report-edit/PaperInvoiceEntry.jsx", import.meta.url),
      "utf8",
    );

    assert.deepEqual(visibleItems.map((item) => item.category), ["accommodation"]);
    assert.match(source, /const summaryPanelView = \{/);
    assert.match(source, /visibleOtherExpenseItems,/);
    assert.match(viewSource, /summaryPanel/);
    assert.match(viewSource, /visibleOtherExpenseItems\.map/);
    assert.match(viewSource, /<ExpenseCategoryList/);
    assert.match(expenseSource, /<PaperInvoiceEntry/);
    assert.match(paperInvoiceSource, /添加纸质发票/);

    const expenseSummaryStart = expenseSource.indexOf("const summary =");
    const expenseSummaryEnd = expenseSource.indexOf("const actions =", expenseSummaryStart);
    const expenseSummarySource = expenseSource.slice(expenseSummaryStart, expenseSummaryEnd);
    assert.match(expenseSummarySource, /<Metric label="报销"/);
    assert.match(expenseSummarySource, /invoiceCount/);
    assert.doesNotMatch(expenseSummarySource, /<Metric label="发票"/);
  });

  it("collapses loaded trip, expense, and regular rows while expanding newly added rows", () => {
    const timelineSource = readFileSync(
      new URL("../features/report-edit/TripTimeline.jsx", import.meta.url),
      "utf8",
    );
    const expenseSource = readFileSync(
      new URL("../features/report-edit/ExpenseCategoryList.jsx", import.meta.url),
      "utf8",
    );
    const regularSource = readFileSync(
      new URL("./RegularReportEditView.jsx", import.meta.url),
      "utf8",
    );

    assert.match(timelineSource, /const \[expandedKeys, setExpandedKeys\] = useState\(\(\) => new Set\(\)\)/);
    assert.match(timelineSource, /const addedKeys = keys\.filter\(\(key\) => !knownKeysRef\.current\.has\(key\)\)/);
    assert.match(timelineSource, /addedKeys\.forEach\(\(key\) => next\.add\(key\)\)/);
    assert.match(expenseSource, /const \[expandedCategories, setExpandedCategories\] = useState\(\(\) => new Set\(\)\)/);
    assert.match(expenseSource, /if \(!ready\)[\s\S]*?initializedRef\.current = false/);
    assert.match(expenseSource, /if \(!initializedRef\.current\)[\s\S]*?knownCategoriesRef\.current = current/);
    assert.match(expenseSource, /if \(!knownCategoriesRef\.current\.has\(category\.value\)\)/);
    assert.match(expenseSource, /next\.add\(category\.value\)/);
    assert.match(readFileSync(new URL("./ReportEditView.jsx", import.meta.url), "utf8"), /ready:\s*!loading/);
    assert.match(regularSource, /defaultExpanded=\{!item\.id\}/);
    assert.doesNotMatch(regularSource, /defaultExpanded=\{index === 0 \|\| !item\.id\}/);
  });

  it("defaults subsidy to first depart through last arrive when unmarked", () => {
    const trips = [
      normalizeTrip({ depart_month: 3, depart_day: 4, depart_place: "杭州", arrive_month: 3, arrive_day: 4, arrive_place: "芜湖" }, 0),
      normalizeTrip({ depart_month: 3, depart_day: 4, depart_place: "芜湖", arrive_month: 3, arrive_day: 4, arrive_place: "杭州" }, 1),
      normalizeTrip({ depart_month: 3, depart_day: 12, depart_place: "杭州", arrive_month: 3, arrive_day: 12, arrive_place: "芜湖" }, 2),
      normalizeTrip({ depart_month: 3, depart_day: 15, depart_place: "芜湖", arrive_month: 3, arrive_day: 15, arrive_place: "杭州" }, 3),
    ];

    // 新模型：无显式标记 → 第 1 段出发(3/4) → 最后 1 段到达(3/15) 连续 = 12 天
    assert.equal(calculateSubsidyDays("2026-03-01", trips), 12);
  });

  it("excludes the home gap when manually split with end/start markers", () => {
    const trips = [
      normalizeTrip({ depart_month: 6, depart_day: 1, arrive_month: 6, arrive_day: 2, subsidy_end: true }, 0),
      normalizeTrip({ depart_month: 6, depart_day: 8, arrive_month: 6, arrive_day: 9, subsidy_start: true }, 1),
    ];

    // [6/1,6/2]=2 天 + [6/8,6/9]=2 天 = 4 天；中间 6/3-6/7 在家不算
    assert.equal(calculateSubsidyDays("2026-06-01", trips), 4);
  });

  it("forms separate trips via auto-finalized returns and auto-started appends", () => {
    // 第一次往返：行程1（去）+ 生成返程（自动标「止」收尾）
    let trips = [
      normalizeTrip({ depart_month: 6, depart_day: 26, depart_place: "北京", arrive_month: 6, arrive_day: 26, arrive_place: "上海" }, 0),
    ];
    trips = makeReturnTripAfter(trips, 0);
    assert.equal(trips[1].subsidy_end, true);

    // 添加行程（前一段是「止」→ 自动标「起」），填第二次去程，再生成返程
    trips = appendTripWithAutoStart(trips, { depart_month: 6, depart_day: 30, depart_place: "北京", arrive_month: 6, arrive_day: 30, arrive_place: "上海" });
    assert.equal(trips[2].subsidy_start, true);
    trips = makeReturnTripAfter(trips, 2);
    assert.equal(trips[3].subsidy_end, true);

    // 两次独立出差：[6/26] + [6/30] = 2 天（中间 6/27-6/29 在家不算）
    assert.equal(calculateSubsidyDays("2026-06-01", trips), 2);
  });

  it("calculates subsidy days from manual start and end markers", () => {
    const trips = [
      normalizeTrip({ depart_month: 3, depart_day: 4, arrive_month: 3, arrive_day: 4, subsidy_start: true }, 0),
      normalizeTrip({ depart_month: 3, depart_day: 4, arrive_month: 3, arrive_day: 4, subsidy_end: true }, 1),
      normalizeTrip({ depart_month: 3, depart_day: 12, arrive_month: 3, arrive_day: 12, subsidy_start: true }, 2),
      normalizeTrip({ depart_month: 3, depart_day: 15, arrive_month: 3, arrive_day: 15, subsidy_end: true }, 3),
    ];

    assert.equal(calculateSubsidyDays("2026-03-01", trips), 5);
  });

  it("builds subsidy spans with the same merged day total for multiple trips", () => {
    const trips = [
      normalizeTrip({ depart_date: "2026-06-01", arrive_date: "2026-06-03", subsidy_end: true }, 0),
      normalizeTrip({ depart_date: "2026-06-03", arrive_date: "2026-06-05", subsidy_start: true }, 1),
    ];

    const spans = getSubsidySpans("2026-06-01", trips);

    assert.deepEqual(spans, [
      { startIndex: 0, endIndex: 0, days: 3 },
      { startIndex: 1, endIndex: 1, days: 2 },
    ]);
    assert.equal(
      spans.reduce((sum, span) => sum + span.days, 0),
      calculateSubsidyDays("2026-06-01", trips),
    );
  });

  it("builds a cross-year subsidy span with the same day total", () => {
    const trips = [normalizeTrip({ depart_date: "2025-12-30", arrive_date: "2026-01-02" }, 0)];

    const spans = getSubsidySpans("2026-01-06", trips);

    assert.deepEqual(spans, [{ startIndex: 0, endIndex: 0, days: 4 }]);
    assert.equal(
      spans.reduce((sum, span) => sum + span.days, 0),
      calculateSubsidyDays("2026-01-06", trips),
    );
  });

  it("points to unmatched subsidy markers and zeros every span day", () => {
    const duplicateStartTrips = [
      normalizeTrip({ depart_date: "2026-06-01", arrive_date: "2026-06-01" }, 0),
      normalizeTrip({ depart_date: "2026-06-02", arrive_date: "2026-06-02", subsidy_start: true }, 1),
      normalizeTrip({ depart_date: "2026-06-03", arrive_date: "2026-06-03" }, 2),
    ];
    const unmatchedEndTrips = [
      normalizeTrip({ depart_date: "2026-06-01", arrive_date: "2026-06-01", subsidy_end: true }, 0),
      normalizeTrip({ depart_date: "2026-06-02", arrive_date: "2026-06-02", subsidy_end: true }, 1),
    ];

    const duplicateStartSpans = getSubsidySpans("2026-06-01", duplicateStartTrips);
    const unmatchedEndSpans = getSubsidySpans("2026-06-01", unmatchedEndTrips);

    assert.deepEqual(duplicateStartSpans, [
      { startIndex: 0, endIndex: 2, days: 0 },
      { startIndex: 1, endIndex: null, days: 0, issue: "start" },
    ]);
    assert.deepEqual(unmatchedEndSpans, [
      { startIndex: 0, endIndex: 0, days: 0 },
      { startIndex: null, endIndex: 1, days: 0, issue: "end" },
    ]);
    for (const [trips, spans] of [
      [duplicateStartTrips, duplicateStartSpans],
      [unmatchedEndTrips, unmatchedEndSpans],
    ]) {
      assert.equal(spans.reduce((sum, span) => sum + span.days, 0), calculateSubsidyDays("2026-06-01", trips));
      assert.equal(calculateSubsidyDays("2026-06-01", trips), 0);
    }
  });

  it("warns about place gaps only within the same subsidy span", () => {
    const trips = [
      normalizeTrip({ depart_date: "2026-06-01", arrive_date: "2026-06-01", depart_place: "公司", arrive_place: "机场", subsidy_end: true }, 0),
      normalizeTrip({ depart_date: "2026-06-08", arrive_date: "2026-06-08", depart_place: "酒店", arrive_place: "车站", subsidy_start: true }, 1),
      normalizeTrip({ depart_date: "2026-06-09", arrive_date: "2026-06-09", depart_place: "机场", arrive_place: "公司" }, 2),
    ];
    const spans = getSubsidySpans("2026-06-01", trips);

    assert.deepEqual(getTripGapWarnings(trips, spans), [
      { index: 2, previousIndex: 1, previousPlace: "车站", currentPlace: "机场" },
    ]);
  });

  it("allows a short cross-year trip and rejects invalid trip spans", () => {
    assert.equal(
      calculateSubsidyDays("2026-06-19", [
        normalizeTrip({ depart_month: 5, depart_day: 10, arrive_month: 6, arrive_day: 8 }, 0),
      ]),
      30,
    );
    assert.equal(
      calculateSubsidyDays("2026-12-01", [
        normalizeTrip({ depart_month: 12, depart_day: 30, arrive_month: 1, arrive_day: 2 }, 0),
      ]),
      4,
    );
    assert.equal(
      calculateSubsidyDays("2026-06-01", [
        normalizeTrip({ depart_month: 6, depart_day: 1, depart_hour: 14, arrive_month: 6, arrive_day: 1, arrive_hour: 9 }, 0),
      ]),
      0,
    );
    assert.equal(
      calculateSubsidyDays("2026-12-01", [
        normalizeTrip({ depart_month: 12, depart_day: 20, arrive_month: 1, arrive_day: 5 }, 0),
      ]),
      0,
    );
  });

  it("infers previous-year December trips from a January report date", () => {
    const trips = [
      normalizeTrip({ depart_month: 12, depart_day: 30, arrive_month: 12, arrive_day: 31 }, 0),
      normalizeTrip({ depart_month: 1, depart_day: 2, arrive_month: 1, arrive_day: 2 }, 1),
    ];

    const ranges = buildTripDateRanges("2026-01-05", trips);

    assert.equal(calculateSubsidyDays("2026-01-05", trips), 4);
    assert.equal(ranges[0].depart.getFullYear(), 2025);
    assert.equal(ranges[1].depart.getFullYear(), 2026);
    assert.equal(getTripYearRangeLabel("2026-01-05", trips), "行程按 2025/12 - 2026/1 计算");
    assert.equal(
      getTripYearRangeLabel("2026-06-01", [
        normalizeTrip({ depart_month: 6, depart_day: 1, arrive_month: 6, arrive_day: 3 }, 0),
      ]),
      "",
    );
  });

  it("builds fixed plus custom expense category options in order", () => {
    const options = getExpenseCategoryOptions([
      { category: "custom:宴请" },
      { category: "luggage" },
      { category: "custom:材料" },
    ]);

    assert.equal(options[0].value, "luggage");
    assert.equal(options.at(-2).label, "宴请");
    assert.equal(options.at(-1).value, "custom:材料");
    assert.equal(getExpenseCategoryLabel("custom:宴请"), "宴请");
  });

  it("validates custom expense category names", () => {
    assert.equal(buildCustomExpenseCategory(" 宴请 "), "custom:宴请");
    assert.equal(validateCustomExpenseName("宴请", []), "");
    assert.match(validateCustomExpenseName("", []), /1-20/);
    assert.match(validateCustomExpenseName("宴:请", []), /不能包含/);
    assert.match(validateCustomExpenseName("行李费", []), /固定费用类别/);
    assert.match(validateCustomExpenseName("宴请", [{ category: "custom:宴请" }]), /不能重复/);
  });
});
