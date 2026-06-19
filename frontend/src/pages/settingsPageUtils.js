const SOURCE_ORDER = ["system", "bundled"];
const SOURCE_LABELS = {
  system: "系统字体",
  bundled: "项目内置字体",
};

export const INVOICE_QR_ENGINE_OPTIONS = [
  { value: "zxing", label: "zxing-cpp（默认，小体积）" },
  { value: "opencv_wechat", label: "OpenCV WeChatQRCode（可选兼容模式）" },
];

const VALID_INVOICE_QR_ENGINES = new Set(INVOICE_QR_ENGINE_OPTIONS.map((option) => option.value));
export const AUTOSAVE_DELAY_MIN_SECONDS = 3;
export const AUTOSAVE_DELAY_MAX_SECONDS = 60;
export const DEFAULT_AUTOSAVE_DELAY_SECONDS = 3;

export const toMoney = (value) => Number(value || 0).toFixed(2);

export const groupFontsBySource = (fonts = []) => {
  const buckets = new Map();
  fonts.forEach((font) => {
    const source = SOURCE_ORDER.includes(font.source) ? font.source : "bundled";
    if (!buckets.has(source)) {
      buckets.set(source, {
        source,
        label: font.source_label || SOURCE_LABELS[source],
        fonts: [],
      });
    }
    buckets.get(source).fonts.push(font);
  });
  return SOURCE_ORDER.filter((source) => buckets.has(source)).map((source) => buckets.get(source));
};

export const normalizeInvoiceQrEngine = (value) => (VALID_INVOICE_QR_ENGINES.has(value) ? value : "zxing");

export const parseAutosaveDelaySeconds = (value, fallback = DEFAULT_AUTOSAVE_DELAY_SECONDS) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  return Number(raw);
};

export const normalizeAutosaveDelaySeconds = (value, fallback = DEFAULT_AUTOSAVE_DELAY_SECONDS) => {
  const parsed = parseAutosaveDelaySeconds(value, Number.NaN);
  const fallbackParsed = parseAutosaveDelaySeconds(fallback);
  if (!Number.isFinite(parsed)) {
    return Math.min(AUTOSAVE_DELAY_MAX_SECONDS, Math.max(AUTOSAVE_DELAY_MIN_SECONDS, fallbackParsed));
  }
  return Math.min(AUTOSAVE_DELAY_MAX_SECONDS, Math.max(AUTOSAVE_DELAY_MIN_SECONDS, parsed));
};

export const validateAutosaveDelaySeconds = (value) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    return "自动保存延时必须是 3-60 秒的整数";
  }
  const parsed = Number(raw);
  if (parsed < AUTOSAVE_DELAY_MIN_SECONDS || parsed > AUTOSAVE_DELAY_MAX_SECONDS) {
    return "自动保存延时必须在 3-60 秒之间";
  }
  return "";
};

export const normalizeSettingsForm = (settings = {}, fallback = {}) => ({
  department: settings.department || "",
  employee_name: settings.employee_name || "",
  daily_subsidy: toMoney(settings.daily_subsidy),
  pdf_fill_font_key: settings.pdf_fill_font_key || fallback.pdf_fill_font_key || "system:simsun",
  double_print_vat_special_invoices:
    settings.double_print_vat_special_invoices ?? fallback.double_print_vat_special_invoices ?? true,
  invoice_qr_engine: normalizeInvoiceQrEngine(settings.invoice_qr_engine ?? fallback.invoice_qr_engine),
  autosave_delay_seconds: normalizeAutosaveDelaySeconds(
    settings.autosave_delay_seconds,
    fallback.autosave_delay_seconds,
  ),
});

export const buildSettingsPayload = (form) => ({
  department: form.department.trim() || null,
  employee_name: form.employee_name.trim() || null,
  daily_subsidy: form.daily_subsidy || "0.00",
  pdf_fill_font_key: form.pdf_fill_font_key,
  double_print_vat_special_invoices: form.double_print_vat_special_invoices,
  invoice_qr_engine: normalizeInvoiceQrEngine(form.invoice_qr_engine),
  autosave_delay_seconds: parseAutosaveDelaySeconds(form.autosave_delay_seconds),
});
