import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteDialogActionLabels,
  formatBatchPdfFailureMessage,
  getReportRowInteractionPolicy,
  getSubsidyDaysLabel,
  isReportStatusVisible,
  isTrashStatus,
  reportFilterActionsSx,
  reportFilterMoreButtonSx,
  reportFilterToolbarSx,
  reportTableActionCellSx,
  reportTableDateCellSx,
  reportTableHeadSx,
  reportTableMoreActionButtonSx,
  reportTableNoWrapCellSx,
  reportTablePrimaryActionButtonSx,
  reportTablePrimaryActionsSx,
  reportTableTrashActionCellSx,
  toggleCurrentPageSelection,
  toggleReportSelection,
} from "./reportListUtils.js";

test("toggleReportSelection adds and removes a report id", () => {
  assert.deepEqual(toggleReportSelection([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(toggleReportSelection([1, 2, 3], 2), [1, 3]);
});

test("toggleCurrentPageSelection only affects visible page ids", () => {
  assert.deepEqual(toggleCurrentPageSelection([9], [1, 2], true), [9, 1, 2]);
  assert.deepEqual(toggleCurrentPageSelection([9, 1, 2, 3], [1, 2], false), [9, 3]);
});

test("formatBatchPdfFailureMessage displays failed report ids and reasons", () => {
  assert.equal(
    formatBatchPdfFailureMessage([
      { report_id: 1, reason: "存在未确认发票" },
      { report_id: 2, reason: "发票文件不存在" },
    ]),
    "报销单 1：存在未确认发票；报销单 2：发票文件不存在",
  );
});

test("isTrashStatus detects the recycle bin tab", () => {
  assert.equal(isTrashStatus("trash"), true);
  assert.equal(isTrashStatus("draft"), false);
});

test("isReportStatusVisible respects tabs and dashboard status scopes", () => {
  assert.equal(isReportStatusVisible({ tab: "all" }, "checked"), true);
  assert.equal(isReportStatusVisible({ tab: "checked" }, "printed"), false);
  assert.equal(isReportStatusVisible({ tab: "all", statuses: "checked,printed,reimbursed" }, "draft"), false);
  assert.equal(isReportStatusVisible({ tab: "all", statuses: "checked,printed,reimbursed" }, "printed"), true);
  assert.equal(isReportStatusVisible({ tab: "trash" }, "draft"), true);
});

test("delete dialog action labels keep destructive action first", () => {
  assert.deepEqual(deleteDialogActionLabels, ["彻底删除", "放入回收站"]);
});

test("report filter toolbar wraps controls without squeezing button content", () => {
  assert.equal(reportFilterToolbarSx.flexWrap, "wrap");
  assert.equal(reportFilterActionsSx.flexWrap, "wrap");
  assert.equal(reportFilterMoreButtonSx.flexShrink, 0);
  assert.equal(reportFilterMoreButtonSx.minWidth, "max-content");
});

test("report table keeps dense semantic columns and primary actions on one line", () => {
  assert.equal(reportTableHeadSx["& .MuiTableCell-root"].whiteSpace, "nowrap");
  assert.equal(reportTableDateCellSx.minWidth, 112);
  assert.equal(reportTableDateCellSx.whiteSpace, "nowrap");
  assert.equal(reportTableNoWrapCellSx.whiteSpace, "nowrap");
  assert.equal(reportTableActionCellSx.minWidth, 192);
  assert.equal(reportTableTrashActionCellSx.minWidth, 112);
  assert.equal(reportTablePrimaryActionsSx.flexWrap, "nowrap");
  assert.equal(reportTablePrimaryActionButtonSx.minWidth, 0);
  assert.equal(reportTableMoreActionButtonSx.width, 32);
});

test("report row interaction policy keeps recycle-bin status read-only and purge in overflow", () => {
  assert.deepEqual(getReportRowInteractionPolicy(true), {
    statusMutable: false,
    primaryActions: ["restore"],
    overflowActions: ["purge"],
  });
  assert.deepEqual(getReportRowInteractionPolicy(false), {
    statusMutable: true,
    primaryActions: ["preview", "download"],
    overflowActions: ["open", "delete"],
  });
});

test("getSubsidyDaysLabel distinguishes manual subsidy including zero", () => {
  assert.equal(getSubsidyDaysLabel({ subsidy_days: 3, manual_subsidy_total: null }), "3");
  assert.equal(getSubsidyDaysLabel({ subsidy_days: 0, manual_subsidy_total: "0.00" }), "人工核定");
  assert.equal(getSubsidyDaysLabel({ subsidy_days: 5, manual_subsidy_total: 0 }), "人工核定");
});
