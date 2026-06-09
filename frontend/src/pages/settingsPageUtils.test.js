import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupFontsBySource } from "./settingsPageUtils.js";

describe("settings page utilities", () => {
  it("groups fonts by system and bundled source in display order", () => {
    const groups = groupFontsBySource([
      { key: "bundled:myfont", name: "My Font", source: "bundled", source_label: "项目内置字体" },
      { key: "system:simsun", name: "宋体", source: "system", source_label: "系统字体" },
    ]);

    assert.deepEqual(groups, [
      {
        source: "system",
        label: "系统字体",
        fonts: [{ key: "system:simsun", name: "宋体", source: "system", source_label: "系统字体" }],
      },
      {
        source: "bundled",
        label: "项目内置字体",
        fonts: [{ key: "bundled:myfont", name: "My Font", source: "bundled", source_label: "项目内置字体" }],
      },
    ]);
  });
});
