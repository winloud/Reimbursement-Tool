import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  chooseLegacyRoot,
  checkForUpdate,
  fetchAuthenticatedBlobUrl,
  getRuntimeInitStatus,
  initializeRuntime,
  installUpdate,
  isInTauriEnvironment,
  loadRuntimeConfig,
  startSidecarAfterInit,
} from "./tauriBridge.js";

// 本文件只覆盖浏览器回退分支（无 window.__TAURI_INTERNALS__）。
// Tauri 分支在 clientSession.test.js 中用独立进程注入桩对象后验证。

describe("tauriBridge browser fallbacks", () => {
  beforeEach(() => {
    delete globalThis.window;
  });

  it("reports a non-Tauri environment when the internals object is absent", () => {
    assert.equal(isInTauriEnvironment(), false);
    globalThis.window = {};
    assert.equal(isInTauriEnvironment(), false);
    delete globalThis.window;
  });

  it("returns an empty session token so the backend dev-mode bypass applies", async () => {
    const config = await loadRuntimeConfig();

    assert.equal(config.session_token, "");
    assert.equal(config.api_base_url, "");
  });

  it("treats the browser as already initialized and skips the migration wizard", async () => {
    assert.equal(await getRuntimeInitStatus(), "browser");
    assert.equal(await chooseLegacyRoot(), null);
    assert.equal(await startSidecarAfterInit(null), "");

    const initialized = await initializeRuntime(null);
    assert.equal(initialized.success, true);
    assert.equal(initialized.migrated, false);
    assert.deepEqual(initialized.migrated_entries, []);
  });

  it("builds a plain URL for authenticated resources instead of a blob", async () => {
    assert.equal(await fetchAuthenticatedBlobUrl("/api/invoices/7/file"), "/api/invoices/7/file");
    assert.equal(await fetchAuthenticatedBlobUrl("api/invoices/8/file"), "/api/invoices/8/file");
  });

  it("refuses updater actions outside Tauri", async () => {
    const check = await checkForUpdate();
    assert.equal(check.available, false);
    assert.equal(check.data_compatible, true);
    assert.match(check.message, /浏览器模式/);

    const install = await installUpdate();
    assert.equal(install.success, false);
    assert.match(install.error, /浏览器模式/);
  });
});
