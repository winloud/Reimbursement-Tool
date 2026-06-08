import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { apiClient, getInvoiceFileUrl } from "./client.js";

describe("api client release defaults", () => {
  it("uses same-origin requests when VITE_API_BASE_URL is not set", () => {
    assert.equal(apiClient.defaults.baseURL, "");
    assert.equal(getInvoiceFileUrl(7), "/api/invoices/7/file");
  });
});
