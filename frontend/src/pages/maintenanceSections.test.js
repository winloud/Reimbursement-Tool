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
  "./MaintenanceUpdateSection.jsx",
  "./maintenanceUtils.js",
];

describe("maintenance page keeps both desktop update targets", () => {
  it("selects the updater UI with the existing Tauri environment check", () => {
    const panel = read("./MaintenancePanel.jsx");

    assert.ok(panel.includes("isInTauriEnvironment() ?"));
    assert.ok(panel.includes("<TauriMaintenanceUpdateSection />"));
    assert.ok(panel.includes("<ZipMaintenanceUpdateSection"));
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

  it("shows browser diagnostics only outside Tauri", () => {
    const sections = read("./MaintenanceSections.jsx");

    assert.ok(sections.includes("browserRuntimeSummary"));
    assert.ok(sections.includes("!isInTauriEnvironment()"));
    assert.ok(sections.includes("browser_runtime"));
  });

  it("keeps the Tauri updater section wired to the compatibility gate", () => {
    const text = read("./MaintenanceUpdateSection.jsx");

    assert.ok(text.includes("checkForUpdate"));
    assert.ok(text.includes("installUpdate"));
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
