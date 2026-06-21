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
