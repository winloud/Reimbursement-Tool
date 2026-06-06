import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCategoryChartData,
  buildMonthCalendarWeeks,
  buildSummaryCards,
  buildYearCalendarMonths,
  formatStatsAmount,
} from "./dashboardUtils.js";

describe("dashboard utilities", () => {
  it("formats stats amounts as Chinese yuan values", () => {
    assert.equal(formatStatsAmount("1234.5"), "¥1,234.50");
    assert.equal(formatStatsAmount(null), "¥0.00");
  });

  it("builds four summary cards with amount and trip-day priorities", () => {
    const summary = {
      current_month: {
        pending_amount: "120.00",
        pending_count: 1,
        reimbursed_amount: "300.00",
        reimbursed_count: 2,
        trip_days: 5,
      },
      current_year: {
        pending_amount: "800.00",
        pending_count: 3,
        reimbursed_amount: "1500.00",
        reimbursed_count: 4,
        trip_days: 18,
      },
    };

    assert.deepEqual(buildSummaryCards(summary), [
      {
        key: "month_amount",
        title: "本月金额",
        primary: "已报销 ¥300.00",
        secondary: "待报销 ¥120.00 · 共 3 单",
      },
      {
        key: "year_amount",
        title: "今年金额",
        primary: "已报销 ¥1,500.00",
        secondary: "待报销 ¥800.00 · 共 7 单",
      },
      {
        key: "month_days",
        title: "本月出差天数",
        primary: "5 天",
        secondary: "",
      },
      {
        key: "year_days",
        title: "今年出差天数",
        primary: "18 天",
        secondary: "",
      },
    ]);
  });

  it("builds empty summary cards before API data loads", () => {
    assert.deepEqual(
      buildSummaryCards(null).map((card) => card.primary),
      ["已报销 ¥0.00", "已报销 ¥0.00", "0 天", "0 天"],
    );
  });

  it("converts category amounts to numbers for chart rendering", () => {
    assert.deepEqual(
      buildCategoryChartData([
        { category: "luggage", label: "行李费", amount: "1530.72" },
        { category: "subsidy", label: "途中补贴", amount: null },
      ]),
      [
        { category: "luggage", label: "行李费", amount: 1530.72 },
        { category: "subsidy", label: "途中补贴", amount: 0 },
      ],
    );
  });

  it("marks year calendar months and selected month weeks from API dates", () => {
    const dates = ["2026-05-31", "2026-06-01", "2026-06-02", "2026-06-10"];

    const months = buildYearCalendarMonths(2026, dates);
    assert.equal(months.length, 12);
    assert.equal(months[4].activeDates.length, 1);
    assert.deepEqual(months[5].activeDates, [1, 2, 10]);

    const weeks = buildMonthCalendarWeeks(2026, 6, dates);
    assert.equal(weeks[0][0], null);
    assert.equal(weeks[0][1].date, 1);
    assert.equal(weeks[0][1].active, true);
    assert.equal(weeks[1][3].date, 10);
    assert.equal(weeks[1][3].active, true);
  });
});
