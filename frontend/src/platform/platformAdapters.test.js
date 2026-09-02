import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLATFORM_CAPABILITY_DEFAULTS } from "./contract.js";
import { detectPlatformKind } from "./index.js";
import { createTauriAdapter, tauriCapabilities } from "./tauri/adapter.js";
import { createZipAdapter, zipCapabilities } from "./zip/adapter.js";

describe("ZIP platform adapter", () => {
  it("bootstraps ordinary HTTP without a session token", async () => {
    const adapter = createZipAdapter({ apiBaseUrl: "http://127.0.0.1:8000/" });
    const config = await adapter.bootstrap();

    assert.equal(config.apiBaseUrl, "http://127.0.0.1:8000/");
    assert.equal(config.sessionToken, "");
    assert.equal(config.capabilities, zipCapabilities);
    assert.equal(config.capabilities.nativeSave, false);
    assert.equal(config.capabilities.portableVersionSwitch, true);
    assert.equal(config.capabilities.browserDiagnostics, true);
  });

  it("uses browser download behavior for prepared and blob resources", async () => {
    const events = [];
    const adapter = createZipAdapter({
      triggerBrowserDownload: async (url) => events.push(["url", url]),
      saveBlobDownload: async (download) => events.push(["blob", download.filename]),
    });

    assert.deepEqual(await adapter.saveDownload({ url: "/api/downloads/one", filename: "one.pdf" }), { browser: true });
    assert.deepEqual(
      await adapter.saveDownload({
        url: "/api/backups/one",
        filename: "backup.zip",
        fetchBlob: async () => ({ blob: new Blob(["backup"]), filename: "backup.zip" }),
      }),
      { browser: true },
    );
    assert.deepEqual(events, [["url", "/api/downloads/one"], ["blob", "backup.zip"]]);
  });

  it("opens protected resources as ordinary HTTP URLs", async () => {
    const adapter = createZipAdapter({ apiBaseUrl: "http://127.0.0.1:8000/" });
    assert.equal(
      await adapter.openProtectedResource("/api/invoices/7/file"),
      "http://127.0.0.1:8000/api/invoices/7/file",
    );
    assert.equal(zipCapabilities.protectedResourceAuth, false);
  });
});

describe("Tauri platform adapter", () => {
  it("bootstraps sidecar configuration and caches its session token", async () => {
    const calls = [];
    const adapter = createTauriAdapter({
      invokeCommand: async (command) => {
        calls.push(command);
        return {
          api_base_url: "http://127.0.0.1:51234",
          session_token: "sid-platform",
          app_version: "2.0.0",
        };
      },
    });

    const first = await adapter.bootstrap();
    const second = await adapter.bootstrap();
    assert.deepEqual(first, {
      apiBaseUrl: "http://127.0.0.1:51234",
      sessionToken: "sid-platform",
      appVersion: "2.0.0",
      capabilities: tauriCapabilities,
    });
    assert.equal(second, first);
    assert.deepEqual(calls, ["get_runtime_config"]);
  });

  it("allows a transient bootstrap failure to be retried", async () => {
    let attempts = 0;
    const adapter = createTauriAdapter({
      invokeCommand: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("sidecar not ready");
        return { api_base_url: "http://127.0.0.1:51234", session_token: "sid-retry" };
      },
    });

    await assert.rejects(adapter.bootstrap(), /sidecar not ready/);
    assert.equal((await adapter.bootstrap()).sessionToken, "sid-retry");
    assert.equal(attempts, 2);
  });

  it("uses the native save command and preserves cancellation", async () => {
    let failure = null;
    const calls = [];
    const adapter = createTauriAdapter({
      invokeCommand: async (command, args) => {
        calls.push({ command, args });
        if (failure) throw new Error(failure);
        return { saved_path: "D:\\下载\\report.pdf" };
      },
    });

    assert.deepEqual(
      await adapter.saveDownload({ url: "/api/downloads/one", filename: "report.pdf" }),
      { saved: true, saved_path: "D:\\下载\\report.pdf" },
    );
    assert.deepEqual(calls[0], {
      command: "save_backend_download",
      args: { url: "/api/downloads/one", suggestedFilename: "report.pdf" },
    });

    failure = "cancelled";
    assert.deepEqual(
      await adapter.saveDownload({ url: "/api/downloads/two", filename: "two.pdf" }),
      { cancelled: true },
    );
  });

  it("loads protected resources through authenticated Tauri bytes", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    let capturedBlob = null;
    const calls = [];
    URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return "blob:protected-resource";
    };
    const adapter = createTauriAdapter({
      invokeCommand: async (command, args) => {
        calls.push({ command, args });
        return { bytes_base64: "aW52b2ljZS1ieXRlcw==", mime_type: "application/pdf" };
      },
    });

    try {
      assert.equal(await adapter.openProtectedResource("/api/invoices/7/file"), "blob:protected-resource");
      assert.equal(capturedBlob.type, "application/pdf");
      assert.equal(await capturedBlob.text(), "invoice-bytes");
      assert.deepEqual(calls, [{
        command: "fetch_authenticated_blob",
        args: { url: "/api/invoices/7/file" },
      }]);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it("exposes only the capabilities currently required by Tauri", () => {
    assert.equal(tauriCapabilities.nativeSave, true);
    assert.equal(tauriCapabilities.signedUpdater, true);
    assert.equal(tauriCapabilities.protectedResourceAuth, true);
    assert.equal(tauriCapabilities.portableVersionSwitch, false);
    assert.equal(tauriCapabilities.browserDiagnostics, false);
  });
});

describe("platform contract", () => {
  it("keeps the capability shape stable and detects the host only inside platform", () => {
    assert.deepEqual(Object.keys(zipCapabilities), Object.keys(PLATFORM_CAPABILITY_DEFAULTS));
    assert.deepEqual(Object.keys(tauriCapabilities), Object.keys(PLATFORM_CAPABILITY_DEFAULTS));

    delete globalThis.window;
    assert.equal(detectPlatformKind(), "zip");
    globalThis.window = { __TAURI_INTERNALS__: {} };
    assert.equal(detectPlatformKind(), "tauri");
    delete globalThis.window;
  });
});
