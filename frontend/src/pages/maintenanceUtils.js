export const formatFileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

export const latestBackup = (backups = []) => backups[0] || null;

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
