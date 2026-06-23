import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyDefaultSubsidyMarkers,
  buildTripDateRanges,
  buildDraftPayload,
  buildCustomExpenseCategory,
  buildReportPayload,
  calculateSubsidyDays,
  calculateSummary,
  cloneTripAfter,
  getExpenseCategoryLabel,
  getExpenseCategoryOptions,
  getTripYearRangeLabel,
  isEmptyDraft,
  validateCustomExpenseName,
  makeBlankTrip,
  makeReturnTripAfter,
  moveTrip,
  normalizeTrip,
  swapTripEndpoints,
  validateFuelSubsidyAmount,
} from "./reportEditUtils.js";

describe("report edit utilities", () => {
  it("detects an untouched auto-created draft as empty", () => {
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
    assert.equal(isEmptyDraft({ form, defaults, trips: [makeBlankTrip("2026-06-03")], invoices: [] }), false);
  });

  it("saves pending report edits before uploading invoices", () => {
    const source = readFileSync(new URL("./ReportEdit.jsx", import.meta.url), "utf8");
    const handlerStart = source.indexOf("const handleFilesUpload = async");
    const handlerEnd = source.indexOf("const handleDeleteInvoice", handlerStart);
    assert.notEqual(handlerStart, -1);
    assert.notEqual(handlerEnd, -1);

    const handler = source.slice(handlerStart, handlerEnd);
    const saveIndex = handler.indexOf("ensureSavedBeforeAction()");
    const uploadStateIndex = handler.indexOf("setUploadState");
    const uploadIndex = handler.indexOf("uploadInvoice");
    const reloadIndex = handler.indexOf("await loadForEdit({ quiet: true })");

    assert.ok(saveIndex > -1);
    assert.ok(saveIndex < uploadStateIndex);
    assert.ok(saveIndex < uploadIndex);
    assert.ok(saveIndex < reloadIndex);
  });

  it("builds create and update payloads using backend field names", () => {
    const form = {
      report_date: "2026-06-03",
      department: "研发部",
      employee_name: "李四",
      purpose: "客户拜访",
      daily_subsidy: "100",
      advance_date_month: "",
      advance_date_day: "4",
      advance_amount: "",
    };
    const trips = [
      normalizeTrip(
        {
          id: 8,
          depart_month: "6",
          depart_day: "3",
          depart_hour: "",
          depart_place: "深圳",
          arrive_month: "6",
          arrive_day: "3",
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
      advance_date_month: null,
      advance_date_day: 4,
      advance_amount: "0.00",
      trips: [
        {
          id: 8,
          sort_order: 1,
          depart_month: 6,
          depart_day: 3,
          depart_hour: null,
          depart_place: "深圳",
          arrive_month: 6,
          arrive_day: 3,
          arrive_hour: 12,
          arrive_place: "成都",
          transport: "高铁",
          subsidy_start: false,
          subsidy_end: false,
        },
      ],
      expense_items: [{ id: 2, category: "luggage", remark: "箱子", reimbursable_amount: null }],
    });

    assert.deepEqual(
      buildReportPayload({
        form,
        trips: [],
        expenseItems: [
          { id: 3, category: "fuel_subsidy", remark: "", reimbursable_amount: "180.00" },
        ],
      }).expense_items,
      [{ id: 3, category: "fuel_subsidy", remark: null, reimbursable_amount: "180.00" }],
    );
  });

  it("supports trip reorder, copy, swap, and return trip generation", () => {
    const first = normalizeTrip({ id: 1, depart_place: "深圳", arrive_place: "成都", transport: "高铁" }, 0);
    const second = normalizeTrip({ id: 2, depart_place: "成都", arrive_place: "北京", transport: "飞机" }, 1);

    assert.deepEqual(moveTrip([first, second], 0, 1).map((trip) => trip.id), [2, 1]);

    const cloned = cloneTripAfter([first, second], 0);
    assert.equal(cloned.length, 3);
    assert.equal(cloned[1].id, null);
    assert.equal(cloned[1].depart_place, "深圳");

    const swapped = swapTripEndpoints(first);
    assert.equal(swapped.depart_place, "成都");
    assert.equal(swapped.arrive_place, "深圳");

    const returned = makeReturnTripAfter([first], 0);
    assert.equal(returned[1].id, null);
    assert.equal(returned[1].depart_place, "成都");
    assert.equal(returned[1].arrive_place, "深圳");
    assert.equal(returned[1].transport, "高铁");
  });

  it("summarizes only confirmed invoices plus trip-based subsidy", () => {
    const summary = calculateSummary({
      reportDate: "2026-06-01",
      dailySubsidy: "80",
      advanceAmount: "100",
      trips: [
        normalizeTrip({ depart_month: 6, depart_day: 1, arrive_month: 6, arrive_day: 3 }, 0),
      ],
      invoices: [
        { amount: "50.50", amount_confirmed: true },
        { amount: "999.00", amount_confirmed: false },
      ],
    });

    assert.deepEqual(summary, {
      subsidyDays: 3,
      subsidyTotal: 240,
      invoiceTotal: 50.5,
      total: 290.5,
      shortfall: 190.5,
      surplus: 0,
    });
  });

  it("summarizes fuel subsidy by reimbursable amount and validates invoice ceiling", () => {
    const summary = calculateSummary({
      reportDate: "2026-06-01",
      dailySubsidy: "0",
      advanceAmount: "0",
      trips: [],
      invoices: [
        { trip_id: 8, amount: "50.00", amount_confirmed: true },
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

    assert.equal(summary.invoiceTotal, 230);
    assert.equal(summary.total, 230);
    assert.equal(
      validateFuelSubsidyAmount({ category: "fuel_subsidy", reimbursable_amount: "301.00", invoice_total: "300.00" }),
      "报销金额不能大于发票合计",
    );
  });

  it("calculates subsidy days from default start and end markers", () => {
    const trips = [
      normalizeTrip({ depart_month: 3, depart_day: 4, depart_place: "杭州", arrive_month: 3, arrive_day: 4, arrive_place: "芜湖" }, 0),
      normalizeTrip({ depart_month: 3, depart_day: 4, depart_place: "芜湖", arrive_month: 3, arrive_day: 4, arrive_place: "杭州" }, 1),
      normalizeTrip({ depart_month: 3, depart_day: 12, depart_place: "杭州", arrive_month: 3, arrive_day: 12, arrive_place: "芜湖" }, 2),
      normalizeTrip({ depart_month: 3, depart_day: 15, depart_place: "芜湖", arrive_month: 3, arrive_day: 15, arrive_place: "杭州" }, 3),
    ];

    const marked = applyDefaultSubsidyMarkers(trips);

    assert.deepEqual(marked.map((trip) => [trip.subsidy_start, trip.subsidy_end]), [
      [true, false],
      [false, true],
      [true, false],
      [false, true],
    ]);
    assert.equal(calculateSubsidyDays("2026-03-01", trips), 5);
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
