import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteDialogActionLabels,
  formatBatchPdfFailureMessage,
  isTrashStatus,
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

test("delete dialog action labels keep destructive action first", () => {
  assert.deepEqual(deleteDialogActionLabels, ["彻底删除", "放入回收站"]);
});
