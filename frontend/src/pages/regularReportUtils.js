import { formatAmount, getInvoicePageTotal } from "./reportEditUtils.js";

export const REGULAR_REPORT_MODES = [
  { value: "no_invoice", label: "无票报销" },
  { value: "invoice", label: "有票报销" },
];

export const REGULAR_STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "checked", label: "已核对" },
  { value: "printed", label: "已提交" },
  { value: "reimbursed", label: "已报销" },
  { value: "trash", label: "回收站" },
];

export const DEFAULT_REGULAR_FILTERS = {
  reportStart: "",
  reportEnd: "",
  keyword: "",
  amountMin: "",
  amountMax: "",
  regularMode: "all",
};

let regularItemSequence = 0;

const nextClientKey = () => {
  regularItemSequence += 1;
  return `regular-item-${Date.now()}-${regularItemSequence}`;
};

export const regularToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const getRegularModeLabel = (mode) =>
  REGULAR_REPORT_MODES.find((option) => option.value === mode)?.label || "常规报销";

export const isRegularMode = (mode) => REGULAR_REPORT_MODES.some((option) => option.value === mode);

export const toRegularMoney = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
};

// 与差旅报销单共用同一金额格式，保证两类填报页显示一致。
export const formatRegularAmount = formatAmount;

export const makeBlankRegularItem = ({ occurredOn = "" } = {}) => ({
  id: null,
  clientKey: nextClientKey(),
  sort_order: 1,
  occurred_on: occurredOn,
  description: "",
  amount: "0.00",
  document_count: 0,
  remark: "",
});

export const normalizeRegularItem = (item, index = 0) => ({
  id: item?.id ?? null,
  clientKey: item?.clientKey || (item?.id ? `regular-item-id-${item.id}` : nextClientKey()),
  sort_order: Number(item?.sort_order || index + 1),
  occurred_on: item?.occurred_on || "",
  description: item?.description || "",
  amount: toRegularMoney(item?.amount),
  document_count: Math.max(0, Number(item?.document_count || 0)),
  remark: item?.remark || "",
});

export const sortAndNormalizeRegularItems = (items = []) =>
  [...items]
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    .map(normalizeRegularItem);

export const moveRegularItem = (items, fromIndex, toIndex) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((item, index) => ({ ...item, sort_order: index + 1 }));
};

export const filesForRegularItem = (files = [], regularItemId) =>
  files.filter((file) => Number(file.regular_item_id) === Number(regularItemId));

export const getRegularItemDerived = ({ item, mode, invoices = [], attachments = [] }) => {
  if (!item?.id) {
    return {
      amount: mode === "no_invoice" ? Number(item?.amount || 0) : 0,
      documentCount: 0,
      invoices: [],
      attachments: [],
    };
  }
  const itemInvoices = filesForRegularItem(invoices, item.id);
  const itemAttachments = filesForRegularItem(attachments, item.id);
  if (mode === "invoice") {
    return {
      amount: itemInvoices
        .filter((invoice) => invoice.amount_confirmed)
        .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
      documentCount: getInvoicePageTotal(itemInvoices),
      invoices: itemInvoices,
      attachments: [],
    };
  }
  return {
    amount: Number(item.amount || 0),
    documentCount: itemAttachments.reduce(
      (sum, attachment) => sum + Math.max(1, Number(attachment.page_count || 1)),
      0,
    ),
    invoices: [],
    attachments: itemAttachments,
  };
};

export const calculateRegularSummary = ({ mode, items = [], invoices = [], attachments = [] }) =>
  items.reduce(
    (summary, item) => {
      const derived = getRegularItemDerived({ item, mode, invoices, attachments });
      return {
        totalAmount: summary.totalAmount + derived.amount,
        documentCount: summary.documentCount + derived.documentCount,
      };
    },
    { totalAmount: 0, documentCount: 0 },
  );

export const buildRegularReportPayload = ({ form, mode, items = [], invoices = [], attachments = [] }) => ({
  report_type: "regular",
  regular_mode: mode,
  report_date: form.report_date || null,
  employee_name: form.employee_name || null,
  regular_items: items.map((item, index) => {
    return {
      id: item.id || null,
      sort_order: index + 1,
      occurred_on: item.occurred_on || null,
      description: item.description || null,
      ...(mode === "no_invoice" ? { amount: toRegularMoney(item.amount) } : {}),
      remark: item.remark || null,
    };
  }),
});

export const isRegularDraftEmpty = ({ form, defaults, items = [], invoices = [], attachments = [] }) => {
  const headerUnchanged =
    (form.report_date || "") === (defaults.report_date || "") &&
    (form.employee_name || "") === (defaults.employee_name || "");
  return headerUnchanged && items.length === 0 && invoices.length === 0 && attachments.length === 0;
};

export const validateRegularReport = ({ form, mode, items = [], invoices = [] }) => {
  if (!String(form.employee_name || "").trim()) return "请填写报销人";
  if (items.length === 0) return "请至少添加一个报销项目";

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const ordinal = index + 1;
    if (!item.occurred_on) return `第 ${ordinal} 个项目缺少发生日期`;
    if (!String(item.description || "").trim()) return `第 ${ordinal} 个项目缺少项目名称`;
    if (mode === "no_invoice" && !(Number(item.amount) > 0)) {
      return `第 ${ordinal} 个项目金额必须大于 0`;
    }
    if (mode === "invoice") {
      const itemInvoices = item.id ? filesForRegularItem(invoices, item.id) : [];
      if (itemInvoices.length === 0) return `第 ${ordinal} 个项目至少需要上传一张发票`;
      if (itemInvoices.some((invoice) => !invoice.amount_confirmed)) {
        return `第 ${ordinal} 个项目仍有未确认发票`;
      }
    }
  }
  return "";
};

// 汇总卡的 PDF 门槛：先看未确认发票，再看必填信息；预览只受未确认发票限制。
// 返回结构与 getTripPdfGate 保持一致，两页共用同一段消费代码。
export const getRegularPdfGate = ({ form, mode, items = [], invoices = [] }) => {
  const base = {
    previewDisabled: false,
    downloadDisabled: false,
    previewBlockedLabel: "确认后预览",
    downloadBlockedLabel: "确认后下载",
  };
  const unconfirmedCount =
    mode === "invoice" ? invoices.filter((invoice) => !invoice.amount_confirmed).length : 0;
  if (unconfirmedCount > 0) {
    return {
      ...base,
      severity: "warning",
      previewBlocked: true,
      downloadBlocked: true,
      unconfirmedCount,
      dialogTitle: "存在未确认发票",
      message: `${unconfirmedCount} 张发票待确认，确认后才能预览或下载 PDF。`,
    };
  }
  const validationError = validateRegularReport({ form, mode, items, invoices });
  if (validationError) {
    return {
      ...base,
      severity: "info",
      previewBlocked: false,
      downloadBlocked: true,
      downloadBlockedLabel: "完善后下载",
      unconfirmedCount: 0,
      dialogTitle: "报销信息尚未完整",
      message: `${validationError}；补全后才能下载 PDF，仍可先预览。`,
    };
  }
  return {
    ...base,
    severity: "info",
    previewBlocked: false,
    downloadBlocked: false,
    unconfirmedCount: 0,
    dialogTitle: "",
    message: "信息完整，可生成 PDF。",
  };
};

export const runAfterRegularReportSaved = async ({ ensureSaved, action }) => {
  const saved = await ensureSaved();
  if (!saved?.ok || !saved?.reportId) return false;
  await action(saved);
  return true;
};

export const buildRegularSummaryCards = (summary = {}) => {
  const period = summary?.selected_period || summary?.current_year || {};
  const pendingCount = Number(period.pending_count || 0);
  const totalCount =
    Number(period.total_count || period.report_count || 0) ||
    pendingCount + Number(period.reimbursed_count || 0);
  return [
    { key: "total_amount", title: "总报销金额", value: formatRegularAmount(period.total_amount || 0) },
    { key: "report_count", title: "报销单数", value: `${totalCount} 单` },
    { key: "pending_amount", title: "待报销金额", value: formatRegularAmount(period.pending_amount || 0) },
    { key: "pending_count", title: "待处理数", value: `${pendingCount} 单` },
  ];
};

export const regularItemSummary = (items = []) => {
  const names = items.map((item) => String(item.description || "").trim()).filter(Boolean);
  if (names.length === 0) return "尚未填写项目";
  if (names.length <= 2) return names.join("、");
  return `${names.slice(0, 2).join("、")} 等 ${names.length} 项`;
};
