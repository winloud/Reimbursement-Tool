import axios from "axios";
import { buildReportExportPayload, buildReportQueryParams } from "./reportFilters.js";
import { isInTauriEnvironment, loadRuntimeConfig, saveBackendDownload } from "./tauriBridge.js";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// 阶段 4：在 Tauri 环境下用 sidecar 的 api_base_url 与会话令牌替换默认值。
// 浏览器开发模式无令牌（后端放行），baseURL 仍由 VITE_API_BASE_URL 决定。
//
// 请求拦截器在模块加载时同步注册，内部 await runtimeConfigReady，
// 确保首个业务请求不会在配置就绪前发出。配置必须延迟到首个请求再加载：
// 全新安装尚无 runtime 时，RuntimeInit 需要先显示初始化引导，此时调用
// get_runtime_config 会得到“未初始化”错误。
let runtimeConfigReady = null;
let sessionToken = "";
export const initRuntimeConfig = () => {
  if (!runtimeConfigReady) {
    runtimeConfigReady = loadRuntimeConfig().then((config) => {
      if (isInTauriEnvironment() && config.api_base_url) {
        apiClient.defaults.baseURL = config.api_base_url.replace(/\/$/, "");
      }
      sessionToken = config.session_token || "";
      return config;
    });
  }
  return runtimeConfigReady;
};

// 同步注册请求拦截器：每个请求 await 配置就绪后再注入令牌。
// 配置加载失败时 await 会抛错，请求失败——此时 sidecar 未就绪，属启动错误。
apiClient.interceptors.request.use(async (requestConfig) => {
  if (!runtimeConfigReady) initRuntimeConfig();
  let runtimeConfig = null;
  try {
    runtimeConfig = await runtimeConfigReady;
  } catch {
    // 配置加载失败：令牌缺失，放行请求让其按原逻辑失败，避免永久卡死后续请求。
  }
  // Axios 会在进入请求拦截器前把 defaults 合并到当前请求配置；只更新
  // apiClient.defaults.baseURL 不会影响这一次已经创建的请求。
  if (runtimeConfig?.api_base_url && isInTauriEnvironment()) {
    requestConfig.baseURL = runtimeConfig.api_base_url.replace(/\/$/, "");
  }
  if (sessionToken) {
    requestConfig.headers = requestConfig.headers || {};
    requestConfig.headers["X-Session-Token"] = sessionToken;
  }
  return requestConfig;
});

// 浏览器模式下，prepared download 的相对 URL 需补全为绝对路径供 <a> 下载使用；
// Tauri 模式下保持相对路径，由 save_backend_download 命令在 Rust 侧用 api_base_url 拼接。
const resolveApiDownloadUrl = (downloadUrl) => {
  if (!downloadUrl || isInTauriEnvironment() || /^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl;
  }
  const base = (apiClient.defaults.baseURL || API_BASE_URL).replace(/\/$/, "");
  if (!base) return downloadUrl;
  return `${base}/${downloadUrl.replace(/^\//, "")}`;
};

const resolvePreparedDownload = (responseData) => ({
  ...responseData,
  data: responseData?.data
    ? {
        ...responseData.data,
        download_url: resolveApiDownloadUrl(responseData.data.download_url),
      }
    : responseData?.data,
});

export const getHealth = async () => {
  const response = await apiClient.get("/api/health");
  return response.data;
};

export const getSettings = async () => {
  const response = await apiClient.get("/api/settings");
  return response.data;
};

export const getSettingFonts = async () => {
  const response = await apiClient.get("/api/settings/fonts");
  return response.data;
};

export const updateSettings = async (payload) => {
  const response = await apiClient.put("/api/settings", payload);
  return response.data;
};

export const getReports = async ({ page = 1, pageSize = 20, status, reportType, regularMode, filters } = {}) => {
  const response = await apiClient.get("/api/reports", {
    params: buildReportQueryParams({ page, pageSize, status, reportType, regularMode, filters }),
  });
  return response.data;
};

export const getTrashReports = async ({ page = 1, pageSize = 20, reportType, regularMode, filters } = {}) => {
  const response = await apiClient.get("/api/reports/trash", {
    params: buildReportQueryParams({ page, pageSize, status: "all", reportType, regularMode, filters }),
  });
  return response.data;
};

export const getReportFilterOptions = async ({ reportType } = {}) => {
  const response = await apiClient.get("/api/reports/filter-options", {
    params: reportType ? { report_type: reportType } : undefined,
  });
  return response.data;
};

export const prepareDataExport = async ({ status, reportType, regularMode, filters, reportIds } = {}) => {
  const response = await apiClient.post(
    "/api/data/export/prepare",
    buildReportExportPayload({ status, reportType, regularMode, filters, reportIds }),
  );
  return resolvePreparedDownload(response.data);
};

export const previewDataImport = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiClient.post("/api/data/import/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const executeDataImport = async (payload) => {
  const response = await apiClient.post("/api/data/import/execute", payload);
  return response.data;
};

export const getMaintenanceInfo = async () => {
  const response = await apiClient.get("/api/maintenance/info");
  return response.data;
};

export const createMaintenanceBackup = async () => {
  const response = await apiClient.post("/api/maintenance/backups");
  return response.data;
};

export const checkMaintenanceDatabase = async () => {
  const response = await apiClient.get("/api/maintenance/database-check", { timeout: 120000 });
  return response.data;
};

export const downloadMaintenanceBackup = async (backupId) => {
  try {
    const response = await apiClient.get(`/api/maintenance/backups/${encodeURIComponent(backupId)}/download`, {
      responseType: "blob",
    });
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]).replace(/\.pdf$/i, ".zip"),
    };
  } catch (err) {
    return normalizeBlobError(err);
  }
};

export const deleteMaintenanceBackup = async (backupId) => {
  const response = await apiClient.delete(`/api/maintenance/backups/${encodeURIComponent(backupId)}`, {
    data: { confirm_delete: true },
  });
  return response.data;
};

export const cleanupMaintenanceBackups = async () => {
  const response = await apiClient.post("/api/maintenance/backups/cleanup", { confirm_cleanup: true });
  return response.data;
};

export const previewMaintenanceRestore = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiClient.post("/api/maintenance/restore/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const previewMaintenanceRestoreFromBackupDialog = async () => {
  const response = await apiClient.post("/api/maintenance/restore/dialog-preview", null, { timeout: 0 });
  return response.data;
};

export const executeMaintenanceRestore = async (payload) => {
  const response = await apiClient.post("/api/maintenance/restore/execute", payload);
  return response.data;
};

export const previewMaintenanceUpdate = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiClient.post("/api/maintenance/updates/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
  return response.data;
};

export const executeMaintenanceUpdate = async (payload) => {
  const response = await apiClient.post("/api/maintenance/updates/execute", payload, { timeout: 120000 });
  return response.data;
};

export const cleanupMaintenanceUpdateStaging = async (previewIds) => {
  const response = await apiClient.post(
    "/api/maintenance/updates/staging/cleanup",
    { preview_ids: previewIds, confirm_cleanup: true },
    { timeout: 120000 },
  );
  return response.data;
};

export const switchMaintenanceVersion = async (payload) => {
  const response = await apiClient.post("/api/maintenance/versions/switch", payload, { timeout: 120000 });
  return response.data;
};

export const deleteMaintenanceVersion = async (version) => {
  const response = await apiClient.delete(`/api/maintenance/versions/${encodeURIComponent(version)}`, {
    data: { confirm_delete: true },
    timeout: 120000,
  });
  return response.data;
};

export const cleanupMaintenanceVersions = async () => {
  const response = await apiClient.post("/api/maintenance/versions/cleanup", { confirm_cleanup: true }, { timeout: 120000 });
  return response.data;
};

export const restartMaintenanceApp = async () => {
  const response = await apiClient.post("/api/maintenance/restart", null, { timeout: 5000 });
  return response.data;
};

export const downloadMaintenanceDiagnostics = async () => {
  try {
    const response = await apiClient.get("/api/maintenance/diagnostics", {
      responseType: "blob",
    });
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]).replace(/\.pdf$/i, ".zip"),
    };
  } catch (err) {
    return normalizeBlobError(err);
  }
};

export const getReport = async (id) => {
  const response = await apiClient.get(`/api/reports/${id}`);
  return response.data;
};

export const getReportDayOccupancies = async ({ employeeName = "", excludeReportId } = {}) => {
  const params = { employee_name: String(employeeName ?? "").trim() };
  if (excludeReportId !== null && excludeReportId !== undefined && String(excludeReportId).trim()) {
    params.exclude_report_id = excludeReportId;
  }
  const response = await apiClient.get("/api/reports/day-occupancies", { params });
  return response.data;
};

export const createReport = async (payload) => {
  const response = await apiClient.post("/api/reports", payload);
  return response.data;
};

export const updateReport = async (id, payload) => {
  const response = await apiClient.put(`/api/reports/${id}`, payload);
  return response.data;
};

export const deleteReportExpenseItem = async (reportId, category) => {
  const response = await apiClient.delete(
    `/api/reports/${encodeURIComponent(reportId)}/expense-items/${encodeURIComponent(category)}`,
  );
  return response.data;
};

export const deleteReport = async (id) => {
  const response = await apiClient.delete(`/api/reports/${id}`);
  return response.data;
};

export const purgeReport = async (id) => {
  const response = await apiClient.delete(`/api/reports/${id}/purge`);
  return response.data;
};

export const restoreReport = async (id) => {
  const response = await apiClient.post(`/api/reports/${id}/restore`);
  return response.data;
};

export const batchDeleteReports = async (reportIds) => {
  const response = await apiClient.post("/api/reports/batch/delete", { report_ids: reportIds });
  return response.data;
};

export const batchPurgeReports = async (reportIds) => {
  const response = await apiClient.post("/api/reports/batch/purge", { report_ids: reportIds });
  return response.data;
};

export const batchRestoreReports = async (reportIds) => {
  const response = await apiClient.post("/api/reports/batch/restore", { report_ids: reportIds });
  return response.data;
};

export const batchUpdateReportStatus = async (reportIds, status) => {
  const response = await apiClient.patch("/api/reports/batch/status", { report_ids: reportIds, status });
  return response.data;
};

export const updateReportStatus = async (id, status) => {
  const response = await apiClient.patch(`/api/reports/${id}/status`, { status });
  return response.data;
};

export const getReportPdfPreview = async (id) => {
  const response = await apiClient.get(`/api/reports/${id}/pdf/preview`);
  return response.data;
};

const filenameFromContentDisposition = (contentDisposition) => {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/);
  if (encodedMatch) {
    return decodeURIComponent(encodedMatch[1]);
  }
  const fallbackMatch = contentDisposition?.match(/filename="?([^";]+)"?/);
  return fallbackMatch?.[1] || "expense-report.pdf";
};

const normalizeBlobError = async (err) => {
  if (err.response?.data instanceof Blob) {
    const text = await err.response.data.text();
    try {
      err.response.data = JSON.parse(text);
    } catch {
      err.response.data = { message: text };
    }
  }
  throw err;
};

export const downloadReportPdf = async (id) => {
  try {
    const response = await apiClient.get(`/api/reports/${id}/pdf`, { responseType: "blob" });
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]),
    };
  } catch (err) {
    return normalizeBlobError(err);
  }
};

export const prepareReportPdfDownload = async (id) => {
  const response = await apiClient.post(`/api/reports/${id}/pdf/prepare`);
  return resolvePreparedDownload(response.data);
};

export const downloadReportBatchPdf = async (reportIds) => {
  try {
    const response = await apiClient.post(
      "/api/reports/batch/pdf",
      { report_ids: reportIds },
      { responseType: "blob" },
    );
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]).replace(/\.pdf$/i, ".zip"),
    };
  } catch (err) {
    return normalizeBlobError(err);
  }
};

export const prepareReportBatchPdfDownload = async (reportIds) => {
  const response = await apiClient.post("/api/reports/batch/pdf/prepare", { report_ids: reportIds });
  return resolvePreparedDownload(response.data);
};

/**
 * 保存 prepared-download 描述符指向的内容到磁盘。
 * Tauri 下走原生保存对话框（Rust 注入会话令牌取字节）；浏览器下回退到 <a> 下载。
 * 返回 { saved: true, saved_path } | { cancelled: true } | { browser: true } | { error }。
 */
export const triggerBackendDownload = async (prepared) => {
  const downloadUrl = prepared?.data?.download_url;
  const filename = prepared?.data?.filename || "download";
  if (!downloadUrl) throw new Error("下载链接无效，请重新生成");

  if (!isInTauriEnvironment()) {
    const { triggerBrowserDownload } = await import("../utils/browserDownload.js");
    triggerBrowserDownload(downloadUrl);
    return { browser: true };
  }

  return saveBackendDownload(downloadUrl, filename);
};

/**
 * 保存直接文件流端点（备份 ZIP、诊断包）到磁盘。
 * 与 triggerBackendDownload 的区别：这里不走 prepare 描述符，而是直接给定端点 URL。
 * Tauri 下走原生保存对话框（Rust 注入会话令牌取字节）；浏览器下用 fetchBlob 取回 blob
 * 再走 saveBlobDownload，保持浏览器模式原有行为。
 * 返回 { saved: true, saved_path } | { cancelled: true } | { browser: true } | { error }。
 *
 * @param url 资源端点相对/绝对 URL
 * @param filename 保存对话框默认文件名
 * @param fetchBlob 浏览器回退用的取 blob 函数，返回 { blob, filename }
 */
export const saveBackendResource = async (url, filename, fetchBlob) => {
  if (!url) throw new Error("下载链接无效，请重新生成");

  if (!isInTauriEnvironment()) {
    const { saveBlobDownload } = await import("../utils/browserDownload.js");
    saveBlobDownload(await fetchBlob());
    return { browser: true };
  }

  return saveBackendDownload(url, filename);
};

export const uploadInvoice = async ({ reportId, tripId, regularItemId, expenseCategory, file }) => {
  const formData = new FormData();
  formData.append("report_id", reportId);
  if (expenseCategory) {
    formData.append("expense_category", expenseCategory);
  }
  if (tripId) {
    formData.append("trip_id", tripId);
  }
  if (regularItemId) {
    formData.append("regular_item_id", regularItemId);
  }
  formData.append("file", file);
  const response = await apiClient.post("/api/invoices/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const updateInvoice = async (id, payload) => {
  const response = await apiClient.put(`/api/invoices/${id}`, payload);
  return response.data;
};

export const parseInvoice = async (id) => {
  const response = await apiClient.get(`/api/invoices/${id}/parse`);
  return response.data;
};

export const getInvoiceOpenCapability = async () => {
  const response = await apiClient.get("/api/invoices/open-capability");
  return response.data;
};

export const openInvoiceLocally = async (id) => {
  const response = await apiClient.post(`/api/invoices/${encodeURIComponent(id)}/open-local`);
  return response.data;
};

export const deleteInvoice = async (id) => {
  const response = await apiClient.delete(`/api/invoices/${id}`);
  return response.data;
};

export const getInvoiceFileUrl = (id) => `${apiClient.defaults.baseURL}/api/invoices/${id}/file`;

export const uploadReportAttachment = async ({ reportId, regularItemId, file }) => {
  const formData = new FormData();
  formData.append("report_id", reportId);
  if (regularItemId) {
    formData.append("regular_item_id", regularItemId);
  }
  formData.append("file", file);
  const response = await apiClient.post("/api/report-attachments/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const deleteReportAttachment = async (id) => {
  const response = await apiClient.delete(`/api/report-attachments/${encodeURIComponent(id)}`);
  return response.data;
};

export const getReportAttachmentFileUrl = (id) =>
  `${apiClient.defaults.baseURL}/api/report-attachments/${encodeURIComponent(id)}/file`;

export const previewRailTickets = async ({ reportId, files }) => {
  const formData = new FormData();
  formData.append("report_id", String(reportId));
  Array.from(files || []).forEach((file) => formData.append("files", file));
  const response = await apiClient.post("/api/tickets/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
  return response.data;
};

export const importRailTickets = async (reportId, payload) => {
  const response = await apiClient.post(`/api/tickets/import/${encodeURIComponent(reportId)}`, payload, {
    timeout: 120000,
  });
  return response.data;
};

export const discardRailTicketPreview = async ({ reportId, token }) => {
  const response = await apiClient.delete(`/api/tickets/preview/${encodeURIComponent(token)}`, {
    params: { report_id: reportId },
  });
  return response.data;
};

const buildStatsRangeParams = ({ startMonth, endMonth, reportStart, reportEnd, reportType, regularMode } = {}) => ({
  ...(startMonth ? { start_month: startMonth } : {}),
  ...(endMonth ? { end_month: endMonth } : {}),
  ...(reportStart ? { report_start: reportStart } : {}),
  ...(reportEnd ? { report_end: reportEnd } : {}),
  ...(reportType ? { report_type: reportType } : {}),
  ...(regularMode ? { regular_mode: regularMode } : {}),
});

export const getStatsSummary = async (options = {}) => {
  const response = await apiClient.get("/api/stats/summary", {
    params: buildStatsRangeParams(options),
  });
  return response.data;
};

export const getStatsCategory = async ({ startMonth, endMonth, reportType } = {}) => {
  const response = await apiClient.get("/api/stats/category", {
    params: buildStatsRangeParams({ startMonth, endMonth, reportType }),
  });
  return response.data;
};

export const getStatsCalendar = async ({ year, month, startMonth, endMonth, reportType } = {}) => {
  const response = await apiClient.get("/api/stats/calendar", {
    params: {
      ...(year ? { year } : {}),
      ...(month ? { month } : {}),
      ...buildStatsRangeParams({ startMonth, endMonth, reportType }),
    },
  });
  return response.data;
};
