import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDraftPayload,
  buildReportPayload,
  calculateSummary,
  cloneTripAfter,
  isEmptyDraft,
  makeBlankTrip,
  makeReturnTripAfter,
  moveTrip,
  normalizeTrip,
  swapTripEndpoints,
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
        },
      ],
      expense_items: [{ id: 2, category: "luggage", remark: "箱子" }],
    });
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
});
