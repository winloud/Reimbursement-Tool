import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiClient, discardRailTicketPreview, getInvoiceFileUrl, importRailTickets, previewRailTickets } from "./client.js";

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
});
