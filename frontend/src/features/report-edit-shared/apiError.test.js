import assert from "node:assert/strict";
import test from "node:test";

import { getApiErrorMessage } from "./apiError.js";

test("api error message prefers detail, then message, then fallback", () => {
  assert.equal(getApiErrorMessage({ response: { data: { detail: "后端拒绝" } } }, "回退"), "后端拒绝");
  assert.equal(
    getApiErrorMessage({ response: { data: { detail: [{ msg: "字段 A" }, { msg: "字段 B" }] } } }, "回退"),
    "字段 A；字段 B",
  );
  assert.equal(getApiErrorMessage({ response: { data: { message: "服务器错误" } } }, "回退"), "服务器错误");
  assert.equal(getApiErrorMessage({ message: "网络断开" }, "回退"), "网络断开");
  assert.equal(getApiErrorMessage({}, "回退"), "回退");
});
