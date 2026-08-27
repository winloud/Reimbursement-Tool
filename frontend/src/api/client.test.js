import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiClient,
  deleteReportExpenseItem,
  discardRailTicketPreview,
  getInvoiceFileUrl,
  getInvoiceOpenCapability,
  getReportDayOccupancies,
  importRailTickets,
  openInvoiceLocally,
  prepareDataExport,
  prepareReportBatchPdfDownload,
  prepareReportPdfDownload,
  previewRailTickets,
  getStatsSummary,
  saveBackendResource,
  uploadInvoice,
  uploadReportAttachment,
} from "./client.js";

describe("api client release defaults", () => {
  it("uses same-origin requests when VITE_API_BASE_URL is not set", () => {
    assert.equal(apiClient.defaults.baseURL, "");
    assert.equal(getInvoiceFileUrl(7), "/api/invoices/7/file");
  });

  it("posts multiple ticket PDFs for preview and confirms an import", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: { success: true, data: { ok: true } }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      const first = new Blob(["first"], { type: "application/pdf" });
      const second = new Blob(["second"], { type: "application/pdf" });
      const preview = await previewRailTickets({ reportId: 17, files: [first, second] });
      const imported = await importRailTickets(17, { token: "ticket-token", tickets: [], groups: [] });
      const discarded = await discardRailTicketPreview({ reportId: 17, token: "ticket-token" });

      assert.equal(preview.success, true);
      assert.equal(imported.success, true);
      assert.equal(discarded.success, true);
      assert.equal(requests[0].url, "/api/tickets/preview");
      assert.equal(requests[0].timeout, 120000);
      assert.equal(requests[0].data.get("report_id"), "17");
      assert.equal(requests[0].data.getAll("files").length, 2);
      assert.equal(requests[1].url, "/api/tickets/import/17");
      assert.deepEqual(JSON.parse(requests[1].data), { token: "ticket-token", tickets: [], groups: [] });
      assert.equal(requests[2].url, "/api/tickets/preview/ticket-token");
      assert.equal(requests[2].params.report_id, 17);
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("queries local PDF capability and requests a system open", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: { success: true, data: { opened: true } }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      const capability = await getInvoiceOpenCapability();
      const opened = await openInvoiceLocally(27);

      assert.equal(capability.success, true);
      assert.equal(opened.success, true);
      assert.equal(requests[0].method, "get");
      assert.equal(requests[0].url, "/api/invoices/open-capability");
      assert.equal(requests[1].method, "post");
      assert.equal(requests[1].url, "/api/invoices/27/open-local");
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("binds regular invoices and evidence to a stable regular item", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: { success: true, data: {} }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      const file = new Blob(["regular"], { type: "application/pdf" });
      await uploadInvoice({ reportId: 5, regularItemId: 17, file });
      await uploadReportAttachment({ reportId: 5, regularItemId: 17, file });
      await getStatsSummary({
        reportType: "regular",
        regularMode: "no_invoice",
        reportStart: "2026-08-01",
        reportEnd: "2026-08-31",
      });

      assert.equal(requests[0].url, "/api/invoices/upload");
      assert.equal(requests[0].data.get("report_id"), "5");
      assert.equal(requests[0].data.get("regular_item_id"), "17");
      assert.equal(requests[0].data.has("expense_category"), false);
      assert.equal(requests[1].url, "/api/report-attachments/upload");
      assert.equal(requests[1].data.get("regular_item_id"), "17");
      assert.deepEqual(requests[2].params, {
        report_start: "2026-08-01",
        report_end: "2026-08-31",
        report_type: "regular",
        regular_mode: "no_invoice",
      });
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("deletes an other-expense item through the report-scoped cascade endpoint", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: { success: true, data: {} }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      const deleted = await deleteReportExpenseItem(29, "custom:宴请");

      assert.equal(deleted.success, true);
      assert.equal(requests[0].method, "delete");
      assert.equal(requests[0].url, "/api/reports/29/expense-items/custom%3A%E5%AE%B4%E8%AF%B7");
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("queries occupied travel dates for one employee and excludes the current report", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return {
        data: { success: true, data: [{ date: "2026-07-19", report_id: 1 }] },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    try {
      const result = await getReportDayOccupancies({ employeeName: "  张三  ", excludeReportId: 2 });

      assert.deepEqual(result.data, [{ date: "2026-07-19", report_id: 1 }]);
      assert.equal(requests[0].method, "get");
      assert.equal(requests[0].url, "/api/reports/day-occupancies");
      assert.deepEqual(requests[0].params, { employee_name: "张三", exclude_report_id: 2 });
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("prepares native single and batch report downloads", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return {
        data: {
          success: true,
          data: {
            download_url: `/api/reports/downloads/token-${requests.length}`,
            filename: requests.length === 1 ? "report.pdf" : "reports.zip",
            expires_in_seconds: 300,
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    try {
      const single = await prepareReportPdfDownload(17);
      const batch = await prepareReportBatchPdfDownload([17, 18]);

      assert.equal(single.data.download_url, "/api/reports/downloads/token-1");
      assert.equal(batch.data.download_url, "/api/reports/downloads/token-2");
      assert.equal(requests[0].method, "post");
      assert.equal(requests[0].url, "/api/reports/17/pdf/prepare");
      assert.equal(requests[1].url, "/api/reports/batch/pdf/prepare");
      assert.deepEqual(JSON.parse(requests[1].data), { report_ids: [17, 18] });
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("prepares a repeatable native data-export download for selected reports", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return {
        data: {
          success: true,
          data: {
            download_url: "/api/data/exports/export-token",
            filename: "expense-data.zip",
            expires_in_seconds: 300,
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    try {
      const result = await prepareDataExport({
        status: "checked",
        reportType: "travel",
        filters: { keyword: "张三" },
        reportIds: [17, 18],
      });

      assert.equal(result.data.download_url, "/api/data/exports/export-token");
      assert.equal(requests[0].method, "post");
      assert.equal(requests[0].url, "/api/data/export/prepare");
      assert.deepEqual(JSON.parse(requests[0].data), {
        report_type: "travel",
        status: "checked",
        keyword: "张三",
        report_ids: [17, 18],
      });
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });
});

describe("saveBackendResource browser fallback", () => {
  it("fetches the blob and drives a browser download when not in Tauri", async () => {
    const originalDocument = globalThis.document;
    const originalSetTimeout = globalThis.setTimeout;
    const createCalls = [];
    // saveBlobDownload 需要 document.createElement('a') 与 body.appendChild，
    // 以及 URL.createObjectURL/revokeObjectURL。这里装最小 fake 让其走完整流程。
    const fakeLink = { click() {}, remove() {} };
    globalThis.document = {
      createElement: (tag) => {
        assert.equal(tag, "a");
        return fakeLink;
      },
      body: { appendChild() {} },
    };
    globalThis.setTimeout = (cb) => {
      createCalls.push("scheduled");
      // 不立即触发 revoke，避免副作用；返回假 id 即可。
      return 0;
    };
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      createCalls.push("blob:url");
      return "blob:save-backend-resource";
    };
    URL.revokeObjectURL = () => {};

    let fetched = 0;
    const fetchBlob = async () => {
      fetched += 1;
      return { blob: new Blob(["backup"], { type: "application/zip" }), filename: "backup.zip" };
    };

    try {
      const result = await saveBackendResource("/api/maintenance/backups/b.zip/download", "backup.zip", fetchBlob);
      assert.equal(result.browser, true);
      assert.equal(fetched, 1);
      assert.deepEqual(createCalls, ["blob:url", "scheduled"]);
    } finally {
      globalThis.document = originalDocument;
      globalThis.setTimeout = originalSetTimeout;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("rejects when url is missing", async () => {
    await assert.rejects(
      () => saveBackendResource("", "x.zip", async () => ({ blob: new Blob([]), filename: "x.zip" })),
      /下载链接无效/,
    );
  });
});
