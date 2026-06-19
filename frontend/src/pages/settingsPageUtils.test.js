import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSettingsPayload,
  groupFontsBySource,
  INVOICE_QR_ENGINE_OPTIONS,
  normalizeAutosaveDelaySeconds,
  normalizeSettingsForm,
  validateAutosaveDelaySeconds,
} from "./settingsPageUtils.js";

describe("settings page utilities", () => {
  it("groups fonts by system and bundled source in display order", () => {
    const groups = groupFontsBySource([
      { key: "bundled:myfont", name: "My Font", source: "bundled", source_label: "项目内置字体" },
      { key: "system:simsun", name: "宋体", source: "system", source_label: "系统字体" },
    ]);

    assert.deepEqual(groups, [
      {
        source: "system",
        label: "系统字体",
        fonts: [{ key: "system:simsun", name: "宋体", source: "system", source_label: "系统字体" }],
      },
      {
        source: "bundled",
        label: "项目内置字体",
        fonts: [{ key: "bundled:myfont", name: "My Font", source: "bundled", source_label: "项目内置字体" }],
      },
    ]);
  });

  it("normalizes missing invoice QR engine to zxing", () => {
    assert.equal(normalizeSettingsForm({}).invoice_qr_engine, "zxing");
    assert.equal(normalizeSettingsForm({ invoice_qr_engine: "opencv_wechat" }).invoice_qr_engine, "opencv_wechat");
    assert.equal(normalizeSettingsForm({ invoice_qr_engine: "legacy" }).invoice_qr_engine, "zxing");
  });

  it("normalizes autosave delay to the supported range", () => {
    assert.equal(normalizeSettingsForm({}).autosave_delay_seconds, 3);
    assert.equal(normalizeSettingsForm({ autosave_delay_seconds: 12 }).autosave_delay_seconds, 12);
    assert.equal(normalizeSettingsForm({ autosave_delay_seconds: 2 }).autosave_delay_seconds, 3);
    assert.equal(normalizeSettingsForm({ autosave_delay_seconds: 90 }).autosave_delay_seconds, 60);
    assert.equal(normalizeAutosaveDelaySeconds("bad", 15), 15);
  });

  it("validates autosave delay input", () => {
    assert.equal(validateAutosaveDelaySeconds("3"), "");
    assert.equal(validateAutosaveDelaySeconds("60"), "");
    assert.match(validateAutosaveDelaySeconds("2"), /3-60/);
    assert.match(validateAutosaveDelaySeconds("61"), /3-60/);
    assert.match(validateAutosaveDelaySeconds("3.5"), /整数/);
    assert.match(validateAutosaveDelaySeconds(""), /整数/);
  });

  it("includes invoice QR engine when building save payload", () => {
    const payload = buildSettingsPayload({
      department: " 财务部 ",
      employee_name: " 李四 ",
      daily_subsidy: "100.00",
      pdf_fill_font_key: "system:simsun",
      double_print_vat_special_invoices: false,
      invoice_qr_engine: "opencv_wechat",
      autosave_delay_seconds: "12",
    });

    assert.deepEqual(payload, {
      department: "财务部",
      employee_name: "李四",
      daily_subsidy: "100.00",
      pdf_fill_font_key: "system:simsun",
      double_print_vat_special_invoices: false,
      invoice_qr_engine: "opencv_wechat",
      autosave_delay_seconds: 12,
    });
  });

  it("exposes zxing and OpenCV QR engine options", () => {
    assert.deepEqual(
      INVOICE_QR_ENGINE_OPTIONS.map((option) => option.value),
      ["zxing", "opencv_wechat"],
    );
  });
});
