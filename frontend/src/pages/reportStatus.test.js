import assert from "node:assert/strict";
import test from "node:test";

import {
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
