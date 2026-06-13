import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSettingsPayload, groupFontsBySource, INVOICE_QR_ENGINE_OPTIONS, normalizeSettingsForm } from "./settingsPageUtils.js";

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

  it("includes invoice QR engine when building save payload", () => {
    const payload = buildSettingsPayload({
      department: " 财务部 ",
      employee_name: " 李四 ",
      daily_subsidy: "100.00",
      pdf_fill_font_key: "system:simsun",
      double_print_vat_special_invoices: false,
      invoice_qr_engine: "opencv_wechat",
    });

    assert.deepEqual(payload, {
      department: "财务部",
      employee_name: "李四",
      daily_subsidy: "100.00",
      pdf_fill_font_key: "system:simsun",
      double_print_vat_special_invoices: false,
      invoice_qr_engine: "opencv_wechat",
    });
  });

  it("exposes zxing and OpenCV QR engine options", () => {
    assert.deepEqual(
      INVOICE_QR_ENGINE_OPTIONS.map((option) => option.value),
      ["zxing", "opencv_wechat"],
    );
  });
});
