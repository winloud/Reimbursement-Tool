import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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

export const updateSettings = async (payload) => {
  const response = await apiClient.put("/api/settings", payload);
  return response.data;
};

export const getReports = async ({ page = 1, pageSize = 20, status } = {}) => {
  const response = await apiClient.get("/api/reports", {
    params: {
      page,
      page_size: pageSize,
      ...(status && status !== "all" ? { status } : {}),
    },
  });
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

export const downloadReportPdf = async (id) => {
  try {
    const response = await apiClient.get(`/api/reports/${id}/pdf`, { responseType: "blob" });
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(response.headers["content-disposition"]),
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
