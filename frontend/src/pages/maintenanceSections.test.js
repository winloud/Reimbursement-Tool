import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// 阶段 8 守卫：ZIP 更新、版本切换和版本清理区块随便携发行链路一并删除，
// 数据维护页只保留备份/恢复/数据库检查/诊断包，加上 Tauri updater 状态区块。
// 这些断言防止旧 UI 或旧 API 调用被回归带回来。

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const MAINTENANCE_SOURCES = [
  "./MaintenancePage.jsx",
  "./MaintenancePanel.jsx",
  "./MaintenanceSections.jsx",
  "./MaintenanceUpdateSection.jsx",
  "./maintenanceUtils.js",
];

describe("maintenance page drops the portable ZIP update chain", () => {
  it("has no ZIP update, version switch or version cleanup UI left", () => {
    for (const source of MAINTENANCE_SOURCES) {
      const text = read(source);
      for (const removed of [
        "版本切换",
        "已安装版本",
        "清理旧版本",
        "current-version",
        "portable-release",
        "installed_versions",
      ]) {
        assert.equal(
          text.includes(removed),
          false,
          `${source} still references the removed portable chain: ${removed}`,
        );
      }
    }
  });

  it("calls no removed maintenance endpoints", () => {
    for (const source of [...MAINTENANCE_SOURCES, "../api/client.js"]) {
      const text = read(source);
      for (const endpoint of [
        "/api/maintenance/updates",
        "/api/maintenance/versions",
        "/api/maintenance/restart",
      ]) {
        assert.equal(
          text.includes(endpoint),
          false,
          `${source} still calls the removed endpoint: ${endpoint}`,
        );
      }
    }
  });

  it("no longer renders browser/WebView2 runtime diagnostics", () => {
    // Tauri 统一了 WebView2，三级窗口回退与 browser-profile 已删除。
    for (const source of MAINTENANCE_SOURCES) {
      const text = read(source);
      assert.equal(text.includes("browserRuntimeSummary"), false, source);
      assert.equal(text.includes("browser_runtime"), false, source);
    }
  });

  it("keeps the Tauri updater section wired to the compatibility gate", () => {
    const text = read("./MaintenanceUpdateSection.jsx");

    assert.ok(text.includes("checkForUpdate"));
    assert.ok(text.includes("installUpdate"));
    // 数据结构不兼容时不得提供安装入口。
    assert.ok(text.includes("data_compatible"));
    assert.ok(text.includes('if (!updateInfo?.available || !updateInfo?.data_compatible) return;'));
  });

  it("keeps backup, restore, database check and diagnostics available", () => {
    const combined = MAINTENANCE_SOURCES.map(read).join("\n");

    for (const kept of ["备份", "恢复", "数据库检查", "诊断"]) {
      assert.ok(combined.includes(kept), `maintenance page lost: ${kept}`);
    }
  });
});
