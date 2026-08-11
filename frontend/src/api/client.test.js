import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiClient,
  discardRailTicketPreview,
  getInvoiceFileUrl,
  getInvoiceOpenCapability,
  importRailTickets,
  openInvoiceLocally,
  prepareReportBatchPdfDownload,
  prepareReportPdfDownload,
  previewRailTickets,
  getStatsSummary,
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
});
