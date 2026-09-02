import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const MAINTENANCE_SOURCES = [
  "./MaintenancePage.jsx",
  "./MaintenancePanel.jsx",
  "./MaintenanceSections.jsx",
  "../platform/UpdateSection.jsx",
  "../platform/zip/UpdateSection.jsx",
  "../platform/tauri/UpdateSection.jsx",
  "./maintenanceUtils.js",
];

describe("maintenance page keeps both desktop update targets", () => {
  it("selects the updater UI through the platform boundary", () => {
    const panel = read("./MaintenancePanel.jsx");
    const selector = read("../platform/UpdateSection.jsx");

    assert.ok(panel.includes("<PlatformUpdateSection"));
    assert.doesNotMatch(panel, /isInTauriEnvironment|tauriBridge/);
    assert.ok(selector.includes('platform.kind === "tauri"'));
    assert.ok(selector.includes("TauriUpdateSection"));
    assert.ok(selector.includes("ZipUpdateSection"));
  });

  it("keeps ZIP update, version switch and cleanup controls", () => {
    const sections = read("./MaintenanceSections.jsx");
    const client = read("../api/client.js");

    for (const label of ["切换版本", "已安装版本", "清理旧版本"]) {
      assert.ok(sections.includes(label), `ZIP maintenance UI lost: ${label}`);
    }
    for (const endpoint of [
      "/api/maintenance/updates",
      "/api/maintenance/versions",
      "/api/maintenance/restart",
    ]) {
      assert.ok(client.includes(endpoint), `ZIP maintenance endpoint lost: ${endpoint}`);
    }
  });

  it("shows browser diagnostics through platform capabilities", () => {
    const sections = read("./MaintenanceSections.jsx");

    assert.ok(sections.includes("browserRuntimeSummary"));
    assert.ok(sections.includes("capabilities.browserDiagnostics"));
    assert.ok(sections.includes("browser_runtime"));
  });

  it("keeps the Tauri updater section wired to the compatibility gate", () => {
    const text = read("../platform/tauri/UpdateSection.jsx");

    assert.ok(text.includes("tauriAdapter.checkForUpdate"));
    assert.ok(text.includes("tauriAdapter.installUpdate"));
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
