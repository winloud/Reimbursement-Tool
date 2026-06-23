import assert from "node:assert/strict";
import test from "node:test";

import { formatFileSize, latestBackup, restorePreviewSummary, updatePreviewSummary } from "./maintenanceUtils.js";

test("formatFileSize formats byte units", () => {
  assert.equal(formatFileSize(12), "12 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
});

test("latestBackup returns the first backup", () => {
  assert.equal(latestBackup([{ backup_id: "a" }, { backup_id: "b" }]).backup_id, "a");
  assert.equal(latestBackup([]), null);
});

test("restorePreviewSummary includes key restore contents", () => {
  assert.equal(
    restorePreviewSummary({
      files_total: 3,
      size_bytes: 2048,
      database_included: true,
      uploads_files: 2,
      vendor_files: 1,
    }),
    "3 个文件，2.0 KB，包含数据库，2 个附件文件，1 个运行时文件",
  );
});

test("updatePreviewSummary includes version and package size", () => {
  assert.equal(
    updatePreviewSummary({
      app_version: "1.2.0",
      files_total: 10,
      size_bytes: 3 * 1024 * 1024,
    }),
    "版本 1.2.0，10 个文件，3.0 MB",
  );
});
