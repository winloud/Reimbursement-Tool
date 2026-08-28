import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseCheckSeverity,
  databaseCheckSummary,
  databaseIssueSummary,
  formatFileSize,
  latestBackup,
  qrEngineSummary,
  restorePreviewSummary,
  yesNo,
} from "./maintenanceUtils.js";

test("formatFileSize formats byte units", () => {
  assert.equal(formatFileSize(12), "12 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
});

test("latestBackup returns the first backup", () => {
  assert.equal(latestBackup([{ backup_id: "a" }, { backup_id: "b" }]).backup_id, "a");
  assert.equal(latestBackup([]), null);
});

test("database check summaries format status and issues", () => {
  const check = {
    status: "warning",
    elapsed_ms: 12,
    tables: { expense_reports: 1, invoices: 2 },
    issues: [{ message: "存在缺失的发票附件文件", count: 2 }],
  };
  assert.equal(databaseCheckSeverity(check), "warning");
  assert.equal(databaseCheckSummary(check), "数据库检查有警告，2 张表，1 个问题，耗时 12 ms");
  assert.equal(databaseIssueSummary(check.issues[0]), "存在缺失的发票附件文件（2 项）");
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

test("diagnostic summaries format runtime states", () => {
  assert.equal(yesNo(true), "可用");
  assert.equal(yesNo(false), "不可用");
  assert.equal(
    qrEngineSummary({
      selected_engine: "opencv_wechat",
      selected_engine_label: "OpenCV WeChatQRCode",
      opencv_runtime_installed: true,
    }),
    "OpenCV WeChatQRCode，OpenCV runtime 已安装",
  );
});
