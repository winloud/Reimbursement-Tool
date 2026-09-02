import assert from "node:assert/strict";
import { describe, it } from "node:test";

// 回归全新安装：模块加载时 runtime 尚不存在，任何 get_runtime_config 调用都会
// 抢在 RuntimeBoundary 引导之前发生。client 只能注册拦截器，不能主动读取配置。
const invokeCalls = [];
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd) => {
      invokeCalls.push(cmd);
      if (cmd === "get_runtime_config") {
        return {
          api_base_url: "http://127.0.0.1:51234",
          session_token: "sid-lazy-init",
          app_version: "2.0.0",
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    },
  },
};

const { apiClient } = await import("./client.js");

describe("lazy runtime config initialization", () => {
  it("does not read runtime config merely by importing the client", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(invokeCalls, []);
  });

  it("loads runtime config before the first business request", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    let capturedConfig = null;
    apiClient.defaults.adapter = async (config) => {
      capturedConfig = config;
      return { data: { success: true }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      await apiClient.get("/api/health");

      assert.deepEqual(invokeCalls, ["get_runtime_config"]);
      assert.equal(apiClient.defaults.baseURL, "http://127.0.0.1:51234");
      assert.equal(capturedConfig.baseURL, "http://127.0.0.1:51234");
      assert.equal(capturedConfig.headers["X-Session-Token"], "sid-lazy-init");
    } finally {
      apiClient.defaults.adapter = originalAdapter;
    }
  });
});
