import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const selectorSource = await readFile(new URL("../platform/RuntimeBoundary.jsx", import.meta.url), "utf8");
const zipSource = await readFile(new URL("../platform/zip/RuntimeBoundary.jsx", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../platform/tauri/RuntimeBoundary.jsx", import.meta.url), "utf8");

describe("runtime initialization flow", () => {
  it("selects platform boundaries while ZIP remains a no-op", () => {
    assert.match(selectorSource, /platform\.kind === "tauri"/);
    assert.match(zipSource, /return children/);
  });

  it("delegates initialization and sidecar startup to one atomic Rust command", () => {
    assert.doesNotMatch(tauriSource, /\binitializeRuntime\b/);
    assert.equal((tauriSource.match(/await tauriAdapter\.startSidecarAfterInit\(/g) || []).length, 2);
  });
});
