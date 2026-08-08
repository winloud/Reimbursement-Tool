import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPORT_CONFLICT_TABLE_MIN_WIDTH,
  copyImportConflictUid,
  getImportConflictViewModel,
  importConflictAtomicTextSx,
  importConflictLocalIdCellSx,
  importConflictMobileListSx,
  importConflictReasonTextSx,
  importConflictTableContainerSx,
  importConflictTableSx,
  importConflictTypeCellSx,
} from "./importConflictTableUtils.js";

test("import conflict view model preserves atomic values and complete descriptions", () => {
  assert.deepEqual(
    getImportConflictViewModel({
      item_type: "report",
      source_uid: "report-uid-123",
      local_id: 42,
      reason: "报销单 UID 已存在",
    }),
    {
      typeLabel: "报销单",
      sourceUid: "report-uid-123",
      localId: "42",
      reason: "报销单 UID 已存在",
    },
  );

  assert.deepEqual(getImportConflictViewModel({ item_type: "invoice" }), {
    typeLabel: "发票",
    sourceUid: "—",
    localId: "—",
    reason: "—",
  });
});

test("import conflict layouts switch to mobile cards and keep atomic fields stable", () => {
  assert.equal(importConflictTableSx.minWidth, IMPORT_CONFLICT_TABLE_MIN_WIDTH);
  assert.equal(importConflictTableSx.tableLayout, "fixed");
  assert.equal(importConflictTableContainerSx.overflow, "auto");
  assert.deepEqual(importConflictTableContainerSx.display, { xs: "none", sm: "block" });
  assert.deepEqual(importConflictMobileListSx.display, { xs: "flex", sm: "none" });
  assert.equal(importConflictMobileListSx.overflowY, "auto");
  assert.equal(importConflictAtomicTextSx.whiteSpace, "nowrap");
  assert.equal(importConflictTypeCellSx.whiteSpace, "nowrap");
  assert.equal(importConflictLocalIdCellSx.whiteSpace, "nowrap");
  assert.equal(importConflictReasonTextSx.WebkitLineClamp, 2);
  assert.equal(importConflictReasonTextSx.overflow, "hidden");
});

test("copyImportConflictUid writes the complete UID and handles unavailable or rejected clipboard access", async () => {
  const copied = [];
  assert.equal(
    await copyImportConflictUid("complete-source-uid", {
      writeText: async (value) => copied.push(value),
    }),
    true,
  );
  assert.deepEqual(copied, ["complete-source-uid"]);

  assert.equal(await copyImportConflictUid("complete-source-uid", null), false);
  assert.equal(
    await copyImportConflictUid("complete-source-uid", {
      writeText: async () => {
        throw new Error("clipboard denied");
      },
    }),
    false,
  );
});
