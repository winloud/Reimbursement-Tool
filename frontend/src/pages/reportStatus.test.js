import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessReportPdf,
  getBatchReportStatusActions,
  getHomogeneousReportStatus,
  getReportStatusActions,
  getReportStatusDirectionalActions,
  getReportStatusLabel,
  REPORT_STATUS_OPTIONS,
  STATUS_CHIP_WIDTH,
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

test("report status chips use the approved semantic colors", () => {
  assert.deepEqual(
    Object.entries(STATUS_META).map(([status, meta]) => [status, meta.chipSx.bgcolor, meta.chipSx.color]),
    [
      ["draft", "#F1EFE8", "#444441"],
      ["checked", "#E6F1FB", "#0C447C"],
      ["printed", "#FAEEDA", "#633806"],
      ["reimbursed", "#EAF3DE", "#27500A"],
    ],
  );

  assert.deepEqual(
    Object.values(STATUS_META).map((meta) => meta.chipSx.width),
    Array(REPORT_STATUS_OPTIONS.length).fill(STATUS_CHIP_WIDTH),
  );
  assert.equal(STATUS_CHIP_WIDTH, 80);
});

test("report edit actions only expose adjacent transitions", () => {
  assert.deepEqual(STATUS_ACTIONS.draft.map((item) => item.target), ["checked"]);
  assert.deepEqual(STATUS_ACTIONS.checked.map((item) => item.target), ["printed", "draft"]);
  assert.deepEqual(STATUS_ACTIONS.printed.map((item) => item.target), ["reimbursed", "checked"]);
  assert.deepEqual(STATUS_ACTIONS.reimbursed.map((item) => item.target), ["printed"]);
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

test("directional status actions expose the previous and next workflow steps", () => {
  assert.deepEqual(getReportStatusDirectionalActions("draft"), {
    previous: null,
    next: STATUS_ACTIONS.draft[0],
  });
  assert.deepEqual(getReportStatusDirectionalActions("checked"), {
    previous: STATUS_ACTIONS.checked[1],
    next: STATUS_ACTIONS.checked[0],
  });
  assert.deepEqual(getReportStatusDirectionalActions("printed"), {
    previous: STATUS_ACTIONS.printed[1],
    next: STATUS_ACTIONS.printed[0],
  });
  assert.deepEqual(getReportStatusDirectionalActions("reimbursed"), {
    previous: STATUS_ACTIONS.reimbursed[0],
    next: null,
  });
  assert.deepEqual(getReportStatusDirectionalActions("unknown"), { previous: null, next: null });
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
      ["printed", 2, 2],
      ["reimbursed", 1, 3],
    ],
  );
});
