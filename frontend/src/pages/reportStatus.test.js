import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessReportPdf,
  getBatchReportStatusActions,
  getHomogeneousReportStatus,
  getReportStatusActions,
  getReportStatusLabel,
  REPORT_STATUS_OPTIONS,
  STATUS_ACTIONS,
  STATUS_META,
} from "./reportStatus.js";

test("report statuses follow the reimbursement workflow", () => {
  assert.deepEqual(
    REPORT_STATUS_OPTIONS.map((item) => [item.value, item.label]),
    [
      ["draft", "草稿"],
      ["checked", "已核对"],
      ["printed", "已提交"],
      ["reimbursed", "已报销"],
    ],
  );
  assert.equal(STATUS_META.printed.label, "已提交");
  assert.equal(getReportStatusLabel("checked"), "已核对");
});

test("report edit actions only expose adjacent transitions", () => {
  assert.deepEqual(STATUS_ACTIONS.draft.map((item) => item.target), ["checked"]);
  assert.deepEqual(STATUS_ACTIONS.checked.map((item) => item.target), ["printed", "draft"]);
  assert.deepEqual(STATUS_ACTIONS.printed.map((item) => item.target), ["reimbursed", "checked"]);
  assert.deepEqual(STATUS_ACTIONS.reimbursed, []);
});

test("all report workflow statuses allow PDF preview and download", () => {
  for (const { value } of REPORT_STATUS_OPTIONS) {
    assert.equal(canAccessReportPdf(value), true, `${value} should allow PDF access`);
  }
  assert.equal(canAccessReportPdf("unknown"), false);
});

test("status action helpers expose only legal adjacent targets", () => {
  assert.deepEqual(getReportStatusActions("checked").map((item) => item.target), ["printed", "draft"]);
  assert.deepEqual(getReportStatusActions("unknown"), []);
  assert.equal(getHomogeneousReportStatus([{ status: "draft" }, { status: "draft" }]), "draft");
  assert.equal(getHomogeneousReportStatus([{ status: "draft" }, { status: "checked" }]), null);
  assert.equal(getHomogeneousReportStatus([]), null);
});

test("mixed batch actions report eligible and skipped counts", () => {
  const actions = getBatchReportStatusActions([
    { status: "draft" },
    { status: "checked" },
    { status: "printed" },
    { status: "reimbursed" },
  ]);

  assert.deepEqual(
    actions.map((action) => [action.target, action.eligibleCount, action.skippedCount]),
    [
      ["draft", 1, 3],
      ["checked", 2, 2],
      ["printed", 1, 3],
      ["reimbursed", 1, 3],
    ],
  );
});
