import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReportExportPayload, buildReportQueryParams } from "./reportFilters.js";

describe("buildReportQueryParams", () => {
  it("keeps pagination and omits empty filter values", () => {
    assert.deepEqual(buildReportQueryParams({ page: 2, pageSize: 50, status: "all" }), {
      page: 2,
      page_size: 50,
    });
  });

  it("maps enhanced report filters to backend query params", () => {
    assert.deepEqual(
      buildReportQueryParams({
        page: 1,
        pageSize: 20,
        status: "printed",
        filters: {
          reportStart: "2026-04-01",
          reportEnd: "2026-04-30",
          tripStart: "2026-05-01",
          tripEnd: "2026-05-31",
          keyword: " 客户 ",
          amountMin: "100",
          amountMax: "900",
          invoiceState: "has_unconfirmed",
          category: "accommodation",
          hasAttachment: "yes",
          subsidyDaysMin: "2",
          subsidyDaysMax: "5",
        },
      }),
      {
        page: 1,
        page_size: 20,
        status: "printed",
        report_start: "2026-04-01",
        report_end: "2026-04-30",
        trip_start: "2026-05-01",
        trip_end: "2026-05-31",
        keyword: "客户",
        amount_min: "100",
        amount_max: "900",
        invoice_state: "has_unconfirmed",
        category: "accommodation",
        has_attachment: true,
        subsidy_days_min: "2",
        subsidy_days_max: "5",
      },
    );
  });

  it("maps no attachment filter to false", () => {
    assert.equal(
      buildReportQueryParams({
        filters: { hasAttachment: "no" },
      }).has_attachment,
      false,
    );
  });

  it("maps dashboard multi-status drilldown filters", () => {
    assert.deepEqual(
      buildReportQueryParams({
        status: "all",
        filters: {
          statuses: "printed,reimbursed",
          tripStart: "2024-02-01",
          tripEnd: "2024-02-29",
        },
      }),
      {
        page: 1,
        page_size: 20,
        statuses: "printed,reimbursed",
        trip_start: "2024-02-01",
        trip_end: "2024-02-29",
      },
    );
  });

  it("builds export payload without pagination", () => {
    assert.deepEqual(
      buildReportExportPayload({
        status: "reimbursed",
        reportType: "travel",
        filters: { keyword: "差旅" },
      }),
      {
        report_type: "travel",
        status: "reimbursed",
        keyword: "差旅",
      },
    );
  });

  it("isolates regular reports by type and immutable mode", () => {
    assert.deepEqual(
      buildReportQueryParams({
        page: 3,
        pageSize: 10,
        reportType: "regular",
        regularMode: "invoice",
        filters: { reportStart: "2026-08-01", reportEnd: "2026-08-31" },
      }),
      {
        page: 3,
        page_size: 10,
        report_type: "regular",
        regular_mode: "invoice",
        report_start: "2026-08-01",
        report_end: "2026-08-31",
      },
    );
  });
});
