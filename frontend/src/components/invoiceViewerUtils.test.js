import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldOpenInvoiceLocally } from "./invoiceViewerUtils.js";

describe("invoice original file opening", () => {
  it("uses the system default program only for supported local PDFs", () => {
    assert.equal(shouldOpenInvoiceLocally("pdf", true), true);
    assert.equal(shouldOpenInvoiceLocally("pdf", false), false);
    assert.equal(shouldOpenInvoiceLocally("pdf", undefined), false);
  });

  it("keeps image originals in the browser", () => {
    assert.equal(shouldOpenInvoiceLocally("image", true), false);
  });
});
