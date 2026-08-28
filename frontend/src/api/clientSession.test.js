import assert from "node:assert/strict";
import { describe, it } from "node:test";

// 本文件必须在导入 client.js / tauriBridge.js 之前装好 Tauri 桩，
// 因为 tauriBridge 在模块级缓存 runtime config，client.js 在模块加载时就注册拦截器
// 并触发一次 initRuntimeConfig。node --test 为每个测试文件开独立进程，
// 因此这里的 window 污染不会影响其他测试文件。

const invokeCalls = [];
const invokeResults = {
  get_runtime_config: {
    api_base_url: "http://127.0.0.1:51234/",
    session_token: "sid-deadbeef",
    app_version: "2.0.0",
  },
  fetch_authenticated_blob: {
    // "invoice-bytes" 的 base64。
    bytes_base64: "aW52b2ljZS1ieXRlcw==",
    mime_type: "application/pdf",
  },
  save_backend_download: { saved_path: "D:\\下载\\report.pdf" },
};

globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd, args) => {
      invokeCalls.push({ cmd, args });
      if (cmd in invokeResults) return invokeResults[cmd];
      throw new Error(`unexpected command: ${cmd}`);
    },
  },
};

const { apiClient, getInvoiceFileUrl, getReportAttachmentFileUrl, initRuntimeConfig } = await import(
  "./client.js"
);
const { fetchAuthenticatedBlobUrl, saveBackendDownload } = await import("./tauriBridge.js");

describe("session auth in the Tauri shell", () => {
  it("adopts the sidecar api base url and trims the trailing slash", async () => {
    await initRuntimeConfig();

    assert.equal(apiClient.defaults.baseURL, "http://127.0.0.1:51234");
    assert.ok(invokeCalls.some((call) => call.cmd === "get_runtime_config"));
  });

  it("injects the session token header on every request", async () => {
    await initRuntimeConfig();
    const originalAdapter = apiClient.defaults.adapter;
    const requests = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push(config);
      return { data: { success: true }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      await apiClient.get("/api/health");
      await apiClient.post("/api/maintenance/backups");

      assert.equal(requests.length, 2);
      for (const request of requests) {
        assert.equal(request.headers["X-Session-Token"], "sid-deadbeef");
      }
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });

  it("keeps resource URLs relative so the Rust side prefixes the sidecar base", () => {
    // 令牌只存在 Rust 侧；前端不得把它拼进 <img src>。
    assert.equal(getInvoiceFileUrl(7), "http://127.0.0.1:51234/api/invoices/7/file");
    assert.equal(
      getReportAttachmentFileUrl(3),
      "http://127.0.0.1:51234/api/report-attachments/3/file",
    );
  });
});

describe("authenticated resource loading through Tauri commands", () => {
  it("turns the authenticated payload into a blob URL", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    let capturedBlob = null;
    URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return "blob:invoice-preview";
    };

    try {
      const url = await fetchAuthenticatedBlobUrl("/api/invoices/7/file");

      assert.equal(url, "blob:invoice-preview");
      assert.equal(capturedBlob.type, "application/pdf");
      assert.equal(await capturedBlob.text(), "invoice-bytes");
      const call = invokeCalls.find((entry) => entry.cmd === "fetch_authenticated_blob");
      assert.deepEqual(call.args, { url: "/api/invoices/7/file" });
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it("routes downloads through the native save command", async () => {
    const result = await saveBackendDownload("/api/reports/downloads/token", "report.pdf");

    assert.deepEqual(result, { saved: true, saved_path: "D:\\下载\\report.pdf" });
    const call = invokeCalls.find((entry) => entry.cmd === "save_backend_download");
    assert.deepEqual(call.args, {
      url: "/api/reports/downloads/token",
      suggestedFilename: "report.pdf",
    });
  });

  it("reports cancellation separately from real errors", async () => {
    const originalInvoke = globalThis.window.__TAURI_INTERNALS__.invoke;
    try {
      globalThis.window.__TAURI_INTERNALS__.invoke = async () => {
        throw new Error("cancelled");
      };
      assert.deepEqual(await saveBackendDownload("/api/x", "x.pdf"), { cancelled: true });

      globalThis.window.__TAURI_INTERNALS__.invoke = async () => {
        throw new Error("磁盘已满");
      };
      const failure = await saveBackendDownload("/api/x", "x.pdf");
      assert.equal(failure.saved, undefined);
      assert.match(failure.error, /磁盘已满/);
    } finally {
      globalThis.window.__TAURI_INTERNALS__.invoke = originalInvoke;
    }
  });
});
