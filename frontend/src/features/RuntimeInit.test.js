import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const source = await readFile(new URL("./RuntimeInit.jsx", import.meta.url), "utf8");

describe("runtime initialization flow", () => {
  it("delegates initialization and sidecar startup to one atomic Rust command", () => {
    assert.doesNotMatch(source, /\binitializeRuntime\b/);
    assert.equal((source.match(/await startSidecarAfterInit\(/g) || []).length, 2);
  });
});
