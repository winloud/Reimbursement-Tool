import assert from "node:assert/strict";
import test from "node:test";

import {
  browserRuntimeSummary,
  databaseCheckSeverity,
  databaseCheckSummary,
  databaseIssueSummary,
  defaultUpdateStagingSelection,
  formatFileSize,
  formatUpdateStagingTime,
  getMaintenanceUpdateAction,
  latestBackup,
  qrEngineSummary,
  restorePreviewSummary,
  selectedUpdateStagingSummary,
  updatePreviewSummary,
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

test("maintenance update action keeps one primary action across the update flow", () => {
  const base = { portableInstall: true };
  assert.deepEqual(getMaintenanceUpdateAction(base), {
    key: "choose",
    label: "选择更新 ZIP",
    interactive: true,
  });
  assert.equal(getMaintenanceUpdateAction({ ...base, busy: "update-preview", hasSelectedFile: true }).key, "previewing");
  assert.equal(
    getMaintenanceUpdateAction({ ...base, hasSelectedFile: true, hasPreview: true, previewCompatible: true }).key,
    "install",
  );
  assert.equal(
    getMaintenanceUpdateAction({ ...base, hasPreview: true, previewCompatible: true, confirmation: "install" }).key,
    "confirm-install",
  );
  assert.equal(getMaintenanceUpdateAction({ ...base, busy: "update" }).key, "installing");
  assert.equal(getMaintenanceUpdateAction({ ...base, restartRequired: true }).key, "restart");
});

test("maintenance update action handles invalid and installed packages", () => {
  const base = { portableInstall: true, hasSelectedFile: true, hasPreview: true };
  assert.equal(getMaintenanceUpdateAction(base).key, "reselect");
  assert.equal(
    getMaintenanceUpdateAction({
      ...base,
      previewCompatible: true,
      versionInstalled: true,
      versionCompatible: true,
    }).key,
    "switch",
  );
  assert.equal(
    getMaintenanceUpdateAction({
      ...base,
      previewCompatible: true,
      versionInstalled: true,
      versionCurrent: true,
      versionCompatible: true,
    }).key,
    "current",
  );
  assert.equal(
    getMaintenanceUpdateAction({
      ...base,
      previewCompatible: true,
      versionInstalled: true,
      versionCompatible: true,
      confirmation: "switch",
    }).key,
    "confirm-switch",
  );
  assert.equal(getMaintenanceUpdateAction({}).key, "unavailable");
});

test("update staging helpers default to expired packages and summarize selected size", () => {
  const packages = [
    { preview_id: "old", expired: true, size_bytes: 1024 },
    { preview_id: "recent", expired: false, size_bytes: 2048 },
  ];
  assert.deepEqual(defaultUpdateStagingSelection(packages), ["old"]);
  assert.deepEqual(selectedUpdateStagingSummary(packages, ["old", "recent"]), {
    count: 2,
    size_bytes: 3072,
  });
  assert.equal(formatUpdateStagingTime("2026-08-20T12:34:56"), "2026-08-20 12:34:56");
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
  assert.equal(
    browserRuntimeSummary({
      preferred_runtime: "Google Chrome app-mode",
      chromium_name: "Google Chrome",
      webview2_available: true,
    }),
    "Google Chrome app-mode，Google Chrome，WebView2 可用",
  );
});
