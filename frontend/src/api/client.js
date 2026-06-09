import axios from "axios";
import { buildReportExportPayload, buildReportQueryParams } from "./reportFilters.js";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

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

export const getReports = async ({ page = 1, pageSize = 20, status, filters } = {}) => {
  const response = await apiClient.get("/api/reports", {
    params: buildReportQueryParams({ page, pageSize, status, filters }),
  });
  return response.data;
};

export const getTrashReports = async ({ page = 1, pageSize = 20, filters } = {}) => {
  const response = await apiClient.get("/api/reports/trash", {
    params: buildReportQueryParams({ page, pageSize, status: "all", filters }),
  });
  return response.data;
};

export const getReportFilterOptions = async () => {
  const response = await apiClient.get("/api/reports/filter-options");
  return response.data;
};

export const downloadDataExport = async ({ status, filters } = {}) => {
  try {
    const response = await apiClient.post("/api/data/export", buildReportExportPayload({ status, filters }), {
      responseType: "blob",
    });
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]).replace(/\.pdf$/i, ".zip"),
    };
  } catch (err) {
    if (err.response?.data instanceof Blob) {
      const text = await err.response.data.text();
      try {
        err.response.data = JSON.parse(text);
      } catch {
        err.response.data = { message: text };
      }
    }
    throw err;
  }
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

export const uploadInvoice = async ({ reportId, tripId, expenseCategory, file }) => {
  const formData = new FormData();
  formData.append("report_id", reportId);
  formData.append("expense_category", expenseCategory);
  if (tripId) {
    formData.append("trip_id", tripId);
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

export const deleteInvoice = async (id) => {
  const response = await apiClient.delete(`/api/invoices/${id}`);
  return response.data;
};

export const getInvoiceFileUrl = (id) => `${apiClient.defaults.baseURL}/api/invoices/${id}/file`;

const buildStatsRangeParams = ({ startMonth, endMonth } = {}) => ({
  ...(startMonth ? { start_month: startMonth } : {}),
  ...(endMonth ? { end_month: endMonth } : {}),
});

export const getStatsSummary = async ({ startMonth, endMonth } = {}) => {
  const response = await apiClient.get("/api/stats/summary", {
    params: buildStatsRangeParams({ startMonth, endMonth }),
  });
  return response.data;
};

export const getStatsCategory = async ({ startMonth, endMonth } = {}) => {
  const response = await apiClient.get("/api/stats/category", {
    params: buildStatsRangeParams({ startMonth, endMonth }),
  });
  return response.data;
};

export const getStatsCalendar = async ({ year, month, startMonth, endMonth } = {}) => {
  const response = await apiClient.get("/api/stats/calendar", {
    params: {
      ...(year ? { year } : {}),
      ...(month ? { month } : {}),
      ...buildStatsRangeParams({ startMonth, endMonth }),
    },
  });
  return response.data;
};
