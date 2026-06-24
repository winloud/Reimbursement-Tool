export const formatFileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

export const latestBackup = (backups = []) => backups[0] || null;

export const databaseCheckSeverity = (check) => {
  if (!check) return "info";
  if (check.status === "error") return "error";
  if (check.status === "warning") return "warning";
  return "success";
};

export const databaseCheckSummary = (check) => {
  if (!check) return "";
  const statusLabel = check.status === "ok" ? "通过" : check.status === "warning" ? "有警告" : "有错误";
  const issueCount = check.issues?.length || 0;
  const tableCount = Object.keys(check.tables || {}).length;
  return `数据库检查${statusLabel}，${tableCount} 张表，${issueCount} 个问题，耗时 ${check.elapsed_ms || 0} ms`;
};

export const databaseIssueSummary = (issue) => {
  if (!issue) return "";
  const count = issue.count ? `（${issue.count} 项）` : "";
  return `${issue.message}${count}`;
};

export const restorePreviewSummary = (preview) => {
  if (!preview) return "";
  const parts = [`${preview.files_total || 0} 个文件`, formatFileSize(preview.size_bytes)];
  if (preview.database_included) parts.push("包含数据库");
  if (preview.uploads_files) parts.push(`${preview.uploads_files} 个附件文件`);
  if (preview.vendor_files) parts.push(`${preview.vendor_files} 个运行时文件`);
  return parts.join("，");
};

export const updatePreviewSummary = (preview) => {
  if (!preview) return "";
  return `版本 ${preview.app_version}，${preview.files_total || 0} 个文件，${formatFileSize(preview.size_bytes)}`;
};

export const yesNo = (value) => (value ? "可用" : "不可用");

export const browserRuntimeSummary = (runtime) => {
  if (!runtime) return "-";
  const parts = [runtime.preferred_runtime || "-"];
  if (runtime.chromium_name) parts.push(runtime.chromium_name);
  if (runtime.webview2_available) parts.push("WebView2 可用");
  if (runtime.error) parts.push(`检测异常：${runtime.error}`);
  return parts.join("，");
};

export const qrEngineSummary = (qrEngine) => {
  if (!qrEngine) return "-";
  const parts = [qrEngine.selected_engine_label || qrEngine.selected_engine || "-"];
  if (qrEngine.selected_engine === "opencv_wechat") {
    parts.push(qrEngine.opencv_runtime_installed ? "OpenCV runtime 已安装" : "OpenCV runtime 未安装");
  }
  return parts.join("，");
};
