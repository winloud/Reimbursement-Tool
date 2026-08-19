import axios from "axios";
import { buildReportExportPayload, buildReportQueryParams } from "./reportFilters.js";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

const resolveApiDownloadUrl = (downloadUrl) => {
  if (!downloadUrl || !API_BASE_URL || /^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl;
  }
  return `${API_BASE_URL.replace(/\/$/, "")}/${downloadUrl.replace(/^\//, "")}`;
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

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
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
