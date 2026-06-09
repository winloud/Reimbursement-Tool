import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAmountAxisMax,
  buildCategoryChartData,
  buildCategoryLegendItems,
  buildDashboardCardReportTarget,
  dashboardQuickRangeGroupSx,
  dashboardRangeFieldsSx,
  dashboardRangeToolbarSx,
  buildMonthCalendarWeeks,
  buildRangeCalendarMonths,
  buildSummaryCards,
  buildTripHeatLevels,
  buildTrendChartData,
  buildYearCalendarMonths,
  formatStatsAmount,
  monthRangeToDates,
} from "./dashboardUtils.js";

describe("dashboard utilities", () => {
  it("formats stats amounts as Chinese yuan values", () => {
    assert.equal(formatStatsAmount("1234.5"), "¥1,234.50");
    assert.equal(formatStatsAmount(null), "¥0.00");
  });

  it("builds four summary cards for the selected period", () => {
    const summary = {
      selected_period: {
        pending_amount: "120.00",
        pending_count: 1,
        reimbursed_amount: "300.00",
        reimbursed_count: 2,
        total_amount: "420.00",
        total_count: 3,
        trip_days: 5,
      },
    };

    assert.deepEqual(buildSummaryCards(summary), [
      {
        key: "total_amount",
        title: "总报销金额",
        primary: "¥420.00",
        secondary: "共 3 单 · 点击查看明细",
        target: "total",
      },
      {
        key: "reimbursed_amount",
        title: "已报销金额",
        primary: "¥300.00",
        secondary: "2 单 · 点击查看明细",
        target: "reimbursed",
      },
      {
        key: "pending_amount",
        title: "待报销金额",
        primary: "¥120.00",
        secondary: "1 单 · 点击查看明细",
        target: "pending",
      },
      {
        key: "trip_days",
        title: "出差天数",
        primary: "5 天",
        secondary: "按实际行程日期统计",
        target: "trip_days",
        clickable: false,
      },
    ]);
  });

  it("builds empty summary cards before API data loads", () => {
    assert.deepEqual(
      buildSummaryCards(null).map((card) => card.primary),
      ["¥0.00", "¥0.00", "¥0.00", "0 天"],
    );
  });

  it("builds report-list targets for dashboard card drilldowns", () => {
    assert.deepEqual(monthRangeToDates("2023-01", "2023-02"), {
      startDate: "2023-01-01",
      endDate: "2023-02-28",
    });
    assert.equal(
      buildDashboardCardReportTarget({ target: "reimbursed", startMonth: "2023-01", endMonth: "2023-02" }),
      "/reports?page=1&status=reimbursed&report_start=2023-01-01&report_end=2023-02-28",
    );
    assert.equal(
      buildDashboardCardReportTarget({ target: "total", startMonth: "2024-02", endMonth: "2024-02" }),
      "/reports?page=1&statuses=printed%2Creimbursed&report_start=2024-02-01&report_end=2024-02-29",
    );
  });

  it("keeps dashboard month-range toolbar responsive instead of horizontally scrolling", () => {
    assert.equal(dashboardRangeToolbarSx.flexWrap, "wrap");
    assert.equal(dashboardRangeToolbarSx.overflowX, "visible");
    assert.equal(dashboardQuickRangeGroupSx.flexWrap, "wrap");
    assert.notEqual(dashboardRangeToolbarSx.overflowX, "auto");
  });

  it("keeps dashboard date fields on one row when desktop width is available", () => {
    assert.deepEqual(dashboardRangeFieldsSx.flexWrap, { xs: "wrap", sm: "nowrap" });
    assert.equal(dashboardRangeFieldsSx.flex, "0 0 auto");
    assert.equal(dashboardRangeFieldsSx.maxWidth, "100%");
    assert.notEqual(dashboardRangeFieldsSx.flex, "1 1 360px");
  });

  it("adapts trend data and computes a padded amount axis max", () => {
    const trend = buildTrendChartData([
      { month: "2023-01", total_amount: "10000.00", pending_amount: "100.00", reimbursed_amount: "9900.00", trip_days: "8" },
      { month: "2023-02", total_amount: "65000.00", pending_amount: "0.00", reimbursed_amount: "65000.00", trip_days: 12 },
    ]);

    assert.equal(trend[0].total_amount, 10000);
    assert.equal(trend[0].trip_days, 8);
    assert.ok(buildAmountAxisMax(trend) > 65000);
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

  it("builds category legend rows with amount and percent", () => {
    assert.deepEqual(
      buildCategoryLegendItems([
        { category: "transport_fare", label: "车船费", amount: 300 },
        { category: "subsidy", label: "途中补贴", amount: 100 },
      ]),
      [
        { category: "transport_fare", label: "车船费", amountText: "¥300.00", percentText: "75.0%" },
        { category: "subsidy", label: "途中补贴", amountText: "¥100.00", percentText: "25.0%" },
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

  it("builds continuous range calendar month cards", () => {
    assert.deepEqual(
      buildRangeCalendarMonths([
        { month: "2024-02", dates: ["2024-02-01", "2024-02-29"], days: 2 },
        { month: "2024-03", dates: [], days: 0 },
      ]),
      [
        {
          month: "2024-02",
          year: 2024,
          monthNumber: 2,
          label: "2024年2月",
          showYear: true,
          activeDates: [1, 29],
          days: 2,
          dates: ["2024-02-01", "2024-02-29"],
        },
        {
          month: "2024-03",
          year: 2024,
          monthNumber: 3,
          label: "2024年3月",
          showYear: false,
          activeDates: [],
          days: 0,
          dates: [],
        },
      ],
    );
  });

  it("builds trip heat levels from consecutive dates and resets after gaps", () => {
    const heat = buildTripHeatLevels([
      "2024-01-30",
      "2024-01-31",
      "2024-02-01",
      "2024-02-02",
      "2024-02-10",
    ]);

    assert.equal(heat["2024-01-30"].streak, 1);
    assert.equal(heat["2024-02-01"].streak, 3);
    assert.equal(heat["2024-02-01"].level, 1);
    assert.equal(heat["2024-02-02"].streak, 4);
    assert.equal(heat["2024-02-02"].level, 2);
    assert.equal(heat["2024-02-10"].streak, 1);

    const weeks = buildMonthCalendarWeeks(2024, 2, ["2024-02-01", "2024-02-02", "2024-02-10"], heat);
    assert.equal(weeks[0][4].date, 1);
    assert.equal(weeks[0][4].heatLevel, 1);
    assert.equal(weeks[1][6].date, 10);
    assert.equal(weeks[1][6].heatLevel, 1);
  });
});
