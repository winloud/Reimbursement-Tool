export const todayStr = () => new Date().toISOString().slice(0, 10);

export const emptyForm = {
  report_date: todayStr(),
  department: "",
  employee_name: "",
  purpose: "",
  daily_subsidy: "0.00",
  manual_subsidy_total: null,
  advance_date_month: "",
  advance_date_day: "",
  advance_amount: "0.00",
};

export const TRIP_CARD_ACTION_POLICY = {
  directActions: ["start", "end", "return"],
  overflowActions: ["duplicate", "swap", "delete"],
};

export const EXPENSE_CATEGORIES = [
  { value: "luggage", label: "行李费" },
  { value: "city_transport", label: "市内交通费" },
  { value: "accommodation", label: "住宿费" },
  { value: "postal", label: "邮电费" },
  { value: "no_sleeper_subsidy", label: "未乘卧铺补助" },
  { value: "toll", label: "通行费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

export const CUSTOM_CATEGORY_PREFIX = "custom:";
const CUSTOM_CATEGORY_FORBIDDEN_PATTERN = /[\/\\:*?"<>|\x00-\x1f]/;
const SUPPORTED_INVOICE_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"]);
const CLIPBOARD_EXTENSION_BY_MIME = {
  "application/pdf": ".pdf",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/x-png": ".png",
};
const FIXED_CATEGORY_LABELS = new Set([
  ...EXPENSE_CATEGORIES.map((category) => category.label),
  "市内车费",
  "不买卧铺补贴",
  "油补",
]);

export const isCustomExpenseCategory = (category) => String(category || "").startsWith(CUSTOM_CATEGORY_PREFIX);

export const getCustomExpenseName = (category) =>
  isCustomExpenseCategory(category) ? String(category).slice(CUSTOM_CATEGORY_PREFIX.length) : "";

export const getExpenseCategoryLabel = (category) => {
  const fixed = EXPENSE_CATEGORIES.find((item) => item.value === category);
  if (fixed) return fixed.label;
  if (isCustomExpenseCategory(category)) return getCustomExpenseName(category);
  return category || "";
};

export const buildCustomExpenseCategory = (name) => `${CUSTOM_CATEGORY_PREFIX}${String(name || "").trim()}`;

const getFileExtension = (filename) => {
  const normalized = String(filename || "").trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
};

export const isSupportedInvoiceFile = (file) => {
  if (!file) return false;
  const mimeType = String(file.type || "").trim().toLowerCase();
  return SUPPORTED_INVOICE_EXTENSIONS.has(getFileExtension(file.name)) || Boolean(CLIPBOARD_EXTENSION_BY_MIME[mimeType]);
};

export const getClipboardInvoiceFiles = (clipboardData) => {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item?.kind === "file" && typeof item.getAsFile === "function")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(clipboardData?.files || []);
  return candidates.filter(isSupportedInvoiceFile);
};

export const getClipboardInvoiceFilename = (file, index = 0, timestamp = Date.now()) => {
  const currentName = String(file?.name || "").trim();
  if (SUPPORTED_INVOICE_EXTENSIONS.has(getFileExtension(currentName))) return currentName;
  const extension = CLIPBOARD_EXTENSION_BY_MIME[String(file?.type || "").trim().toLowerCase()];
  return extension ? `clipboard-invoice-${timestamp}-${index + 1}${extension}` : currentName;
};

export const createInvoiceUploadIssue = (fileName, message, statusCode) => ({
  fileName: String(fileName || "").trim() || "未命名文件",
  message: String(message || "").trim() || "上传失败",
  type: Number(statusCode) === 409 ? "duplicate" : "error",
});

export const getInvoiceUploadFeedback = ({ totalFileCount = 0, successfulFileCount = 0, issues = [] } = {}) => {
  const normalizedIssues = Array.isArray(issues) ? issues.filter(Boolean) : [];
  const duplicateCount = normalizedIssues.filter((issue) => issue.type === "duplicate").length;
  const failedCount = normalizedIssues.length - duplicateCount;
  const hasIssues = normalizedIssues.length > 0;

  return {
    totalFileCount: Math.max(0, Number(totalFileCount) || 0),
    successfulFileCount: Math.max(0, Number(successfulFileCount) || 0),
    duplicateCount,
    failedCount,
    issues: normalizedIssues,
    hasIssues,
    toastMessage:
      successfulFileCount > 0 && !hasIssues
        ? totalFileCount === 1
          ? "发票已上传，请确认发票信息"
          : `已上传 ${successfulFileCount} 个文件，请逐张确认发票信息`
        : "",
  };
};

export const validateCustomExpenseName = (name, expenseItems = []) => {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 1 || trimmed.length > 20) return "自定义费用名称需为 1-20 个字符";
  if (CUSTOM_CATEGORY_FORBIDDEN_PATTERN.test(trimmed)) return '不能包含 / \\ : * ? " < > | 或控制字符';
  if (FIXED_CATEGORY_LABELS.has(trimmed)) return "不能与固定费用类别重名";
  const duplicated = expenseItems.some((item) => getCustomExpenseName(item.category) === trimmed);
  if (duplicated) return "同一报销单内不能重复添加该费用类别";
  return "";
};

export const getExpenseCategoryOptions = (expenseItems = []) => {
  const customItems = expenseItems
    .filter((item) => isCustomExpenseCategory(item.category))
    .map((item) => ({ value: item.category, label: getCustomExpenseName(item.category), custom: true }));
  const seen = new Set(EXPENSE_CATEGORIES.map((category) => category.value));
  const uniqueCustomItems = customItems.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
  return [...EXPENSE_CATEGORIES, ...uniqueCustomItems];
};

export const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const toMoney = (value) => Number(value || 0).toFixed(2);

export const normalizeTrip = (trip = {}, index = 0) => ({
  id: trip.id ?? null,
  sort_order: index + 1,
  depart_month: trip.depart_month ?? 1,
  depart_day: trip.depart_day ?? 1,
  depart_hour: trip.depart_hour ?? "",
  depart_place: trip.depart_place ?? "",
  arrive_month: trip.arrive_month ?? 1,
  arrive_day: trip.arrive_day ?? 1,
  arrive_hour: trip.arrive_hour ?? "",
  arrive_place: trip.arrive_place ?? "",
  transport: trip.transport ?? "",
  subsidy_start: Boolean(trip.subsidy_start),
  subsidy_end: Boolean(trip.subsidy_end),
  paper_invoice_amount: toMoney(trip.paper_invoice_amount),
  paper_invoice_count: trip.paper_invoice_count ?? 0,
  collapsed: trip.collapsed ?? false,
});

export const makeBlankTrip = (reportDate) => {
  const date = reportDate ? new Date(`${reportDate}T00:00:00`) : new Date();
  const month = Number.isNaN(date.getTime()) ? 1 : date.getMonth() + 1;
  const day = Number.isNaN(date.getTime()) ? 1 : date.getDate();
  return normalizeTrip(
    {
      depart_month: month,
      depart_day: day,
      arrive_month: month,
      arrive_day: day,
    },
    0,
  );
};

export const normalizeExpenseItem = (item = {}) => ({
  id: item.id ?? null,
  category: item.category,
  remark: item.remark ?? "",
  reimbursable_amount: item.reimbursable_amount ?? "",
  paper_invoice_amount: toMoney(item.paper_invoice_amount),
  paper_invoice_count: item.paper_invoice_count ?? 0,
  invoice_total: item.invoice_total ?? item.amount ?? "0.00",
  amount: item.amount ?? "0.00",
  invoice_count: item.invoice_count ?? 0,
});

const toFiniteAmount = (value) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

export const getPaperInvoiceAmount = (item = {}) => toFiniteAmount(item.paper_invoice_amount);

export const getPaperInvoiceCount = (item = {}) => {
  const count = Number(item.paper_invoice_count ?? 0);
  return Number.isInteger(count) && count > 0 ? count : 0;
};

export const hasPaperInvoice = (item = {}) => getPaperInvoiceAmount(item) > 0 || getPaperInvoiceCount(item) > 0;

export const hasExpenseItemData = (item = {}) =>
  isCustomExpenseCategory(item.category) ||
  hasPaperInvoice(item) ||
  String(item.remark ?? "").trim().length > 0 ||
  (item.reimbursable_amount !== "" && item.reimbursable_amount !== null && item.reimbursable_amount !== undefined);

export const shouldExpandExpenseItem = (item = {}, invoices = []) =>
  (Array.isArray(invoices) && invoices.length > 0) || hasExpenseItemData(item);

export const getConfirmedInvoiceTotal = (invoices = []) =>
  invoices.filter((invoice) => invoice.amount_confirmed).reduce((sum, invoice) => sum + toFiniteAmount(invoice.amount), 0);

export const getConfirmedInvoiceCount = (invoices = []) => invoices.filter((invoice) => invoice.amount_confirmed).length;

export const getExpenseItemInvoiceTotal = (item = {}, invoices) =>
  Array.isArray(invoices)
    ? getConfirmedInvoiceTotal(invoices) + getPaperInvoiceAmount(item)
    : toFiniteAmount(item.invoice_total ?? item.amount);

export const getExpenseItemAmount = (item = {}, invoices) => {
  if (item.category === "fuel_subsidy" && item.reimbursable_amount !== "" && item.reimbursable_amount !== null && item.reimbursable_amount !== undefined) {
    return toFiniteAmount(item.reimbursable_amount);
  }
  return Array.isArray(invoices) ? getExpenseItemInvoiceTotal(item, invoices) : toFiniteAmount(item.amount ?? item.invoice_total);
};

export const getFuelSubsidyInvoiceShortfall = (item = {}, invoices) => {
  if (item.category !== "fuel_subsidy" || item.reimbursable_amount === "" || item.reimbursable_amount === null || item.reimbursable_amount === undefined) {
    return 0;
  }
  return Math.max(0, toFiniteAmount(item.reimbursable_amount) - getExpenseItemInvoiceTotal(item, invoices));
};

export const validateFuelSubsidyAmount = (item = {}) => {
  if (item.category !== "fuel_subsidy" || item.reimbursable_amount === "" || item.reimbursable_amount === null || item.reimbursable_amount === undefined) {
    return "";
  }
  const reimbursableAmount = Number(item.reimbursable_amount);
  if (!Number.isFinite(reimbursableAmount)) return "请输入有效的报销金额";
  if (reimbursableAmount < 0) return "报销金额不能为负数";
  return "";
};

export const validatePaperInvoice = (item = {}) => {
  const amount = Number(item.paper_invoice_amount ?? 0);
  const count = Number(item.paper_invoice_count ?? 0);
  if (!Number.isFinite(amount) || amount < 0) return "请输入有效的纸质发票金额";
  if (!Number.isInteger(count) || count < 0) return "纸质发票张数必须是非负整数";
  if ((amount === 0) !== (count === 0)) return "纸质发票金额和张数需同时填写";
  return "";
};

export const validateManualSubsidyTotal = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "请输入人工核定补贴总额";
  const amount = Number(text);
  if (!Number.isFinite(amount)) return "请输入有效的人工核定补贴总额";
  if (amount < 0) return "人工核定补贴总额不能为负数";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "人工核定补贴总额最多保留两位小数";
  return "";
};

export const validateExpenseItems = (expenseItems = []) => {
  for (const item of expenseItems) {
    const error = validateFuelSubsidyAmount(item);
    if (error) return error;
    const paperInvoiceError = validatePaperInvoice(item);
    if (paperInvoiceError) return paperInvoiceError;
  }
  return "";
};

export const validatePurposeForStatusTransition = ({ currentStatus, targetStatus, purpose }) =>
  currentStatus === "draft" && targetStatus === "checked" && !String(purpose ?? "").trim()
    ? "出差事由不能为空，请填写后再修改状态"
    : "";

export const validateTrips = (trips = []) => {
  for (const trip of trips) {
    const paperInvoiceError = validatePaperInvoice(trip);
    if (paperInvoiceError) return paperInvoiceError;
  }
  return "";
};

const makeDate = (year, month, day) => {
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
};

const MS_PER_DAY = 86400000;

const reportDateAnchor = (reportDate) => {
  if (typeof reportDate === "number") {
    return makeDate(reportDate, 12, 31) || new Date();
  }
  if (reportDate instanceof Date && !Number.isNaN(reportDate.getTime())) {
    return makeDate(reportDate.getFullYear(), reportDate.getMonth() + 1, reportDate.getDate()) || new Date();
  }
  if (typeof reportDate === "string" && reportDate.trim()) {
    const [year, month, day] = reportDate.split("-").map(Number);
    const parsed = makeDate(year, month, day);
    if (parsed) return parsed;
  }
  const today = new Date();
  return makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate()) || today;
};

const daysBetween = (start, end) => Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);

const compareMonthDay = ([leftMonth, leftDay], [rightMonth, rightDay]) =>
  leftMonth === rightMonth ? leftDay - rightDay : leftMonth - rightMonth;

export const buildTripDateRanges = (reportDate, trips = []) => {
  const normalized = trips.map((trip, index) => normalizeTrip(trip, index));
  if (normalized.length === 0) return [];

  const anchor = reportDateAnchor(reportDate);
  let currentYear = anchor.getFullYear();
  let previousDepartMonthDay = null;

  return normalized
    .map((trip, index) => {
      const departMonth = Number(trip.depart_month);
      const departDay = Number(trip.depart_day);
      const arriveMonth = Number(trip.arrive_month);
      const arriveDay = Number(trip.arrive_day);
      const departMonthDay = [departMonth, departDay];
      let depart;

      if (index === 0) {
        depart = makeDate(currentYear, departMonth, departDay);
        if (depart && daysBetween(anchor, depart) > 180) {
          currentYear -= 1;
          depart = makeDate(currentYear, departMonth, departDay);
        }
      } else {
        if (previousDepartMonthDay && compareMonthDay(departMonthDay, previousDepartMonthDay) < 0) {
          currentYear += 1;
        }
        depart = makeDate(currentYear, departMonth, departDay);
      }

      const isCrossYearArrival = compareMonthDay([arriveMonth, arriveDay], departMonthDay) < 0;
      const arriveYear = isCrossYearArrival ? currentYear + 1 : currentYear;
      const arrive = makeDate(arriveYear, arriveMonth, arriveDay);
      previousDepartMonthDay = departMonthDay;
      if (!depart || !arrive) return null;

      const travelDays = daysBetween(depart, arrive);
      if (travelDays < 0 || (isCrossYearArrival && travelDays > 7)) return null;
      if (
        travelDays === 0 &&
        trip.depart_hour !== "" &&
        trip.depart_hour !== null &&
        trip.depart_hour !== undefined &&
        trip.arrive_hour !== "" &&
        trip.arrive_hour !== null &&
        trip.arrive_hour !== undefined &&
        Number(trip.arrive_hour) < Number(trip.depart_hour)
      ) {
        return null;
      }
      return { trip, depart, arrive };
    })
    .filter(Boolean);
};

const formatYearMonth = (value) => `${value.getFullYear()}/${value.getMonth() + 1}`;

export const getTripYearRangeLabel = (reportDate, trips = []) => {
  const ranges = buildTripDateRanges(reportDate, trips);
  if (ranges.length === 0) return "";

  const anchorYear = reportDateAnchor(reportDate).getFullYear();
  const dates = ranges.flatMap((range) => [range.depart, range.arrive]);
  const years = new Set(dates.map((item) => item.getFullYear()));
  if (years.size === 1 && years.has(anchorYear)) return "";

  const firstDate = dates.reduce((earliest, item) => (item.getTime() < earliest.getTime() ? item : earliest), dates[0]);
  const lastDate = dates.reduce((latest, item) => (item.getTime() > latest.getTime() ? item : latest), dates[0]);
  const firstMonth = formatYearMonth(firstDate);
  const lastMonth = formatYearMonth(lastDate);
  return firstMonth === lastMonth ? `行程按 ${firstMonth} 计算` : `行程按 ${firstMonth} - ${lastMonth} 计算`;
};

export const calculateSubsidyDays = (reportDate, trips) => {
  const ranges = buildTripDateRanges(reportDate, trips);
  if (ranges.length === 0) return 0;

  // 第 1 段隐含「起」、最后 1 段隐含「止」，中间叠加用户显式标记
  // （与后端 subsidy_trips_with_implicit_bounds 规则逐字对齐）
  const lastIndex = ranges.length - 1;
  const intervals = [];
  let activeStart = null;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const effectiveStart = index === 0 || range.trip.subsidy_start;
    const effectiveEnd = index === lastIndex || range.trip.subsidy_end;
    if (effectiveStart) {
      if (activeStart) return 0;
      activeStart = range.depart;
    }
    if (effectiveEnd) {
      if (!activeStart || range.arrive.getTime() < activeStart.getTime()) return 0;
      intervals.push({ start: activeStart, end: range.arrive });
      activeStart = null;
    }
  }
  if (activeStart || intervals.length === 0) return 0;

  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (!previous || interval.start.getTime() > previous.end.getTime() + MS_PER_DAY) {
      merged.push({ ...interval });
    } else if (interval.end.getTime() > previous.end.getTime()) {
      previous.end = interval.end;
    }
  }
  return merged.reduce((sum, interval) => sum + daysBetween(interval.start, interval.end) + 1, 0);
};

export const calculateSummary = ({
  reportDate,
  dailySubsidy,
  manualSubsidyTotal = null,
  advanceAmount,
  trips,
  invoices,
  expenseItems = [],
}) => {
  const subsidyDays = calculateSubsidyDays(reportDate, trips);
  const hasManualSubsidy = manualSubsidyTotal !== null && manualSubsidyTotal !== undefined;
  const subsidyTotal = hasManualSubsidy ? toFiniteAmount(manualSubsidyTotal) : subsidyDays * Number(dailySubsidy || 0);
  const transportElectronicTotal = invoices
    .filter(
      (invoice) =>
        invoice.amount_confirmed &&
        invoice.trip_id !== null &&
        invoice.trip_id !== undefined &&
        invoice.expense_category === "transport_fare",
    )
    .reduce((sum, invoice) => sum + toFiniteAmount(invoice.amount), 0);
  const transportTotal = transportElectronicTotal + trips.reduce((sum, trip) => sum + getPaperInvoiceAmount(trip), 0);
  const otherExpenseTotal =
    expenseItems.length > 0
      ? expenseItems
          .filter((item) => item.category !== "transport_fare")
          .reduce(
            (sum, item) =>
              sum + getExpenseItemAmount(item, invoices.filter((invoice) => invoice.expense_category === item.category && !invoice.trip_id)),
            0,
          )
      : invoices
          .filter(
            (invoice) =>
              invoice.amount_confirmed &&
              (invoice.trip_id === null || invoice.trip_id === undefined) &&
              invoice.expense_category !== "transport_fare",
          )
          .reduce((sum, invoice) => sum + toFiniteAmount(invoice.amount), 0);
  const invoiceTotal = transportTotal + otherExpenseTotal;
  const total = subsidyTotal + invoiceTotal;
  const advance = Number(advanceAmount || 0);
  return {
    subsidyDays,
    subsidyTotal,
    transportTotal,
    otherExpenseTotal,
    invoiceTotal,
    total,
    shortfall: Math.max(0, total - advance),
    surplus: Math.max(0, advance - total),
  };
};

const nullableText = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};

const nullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  return Number(value);
};

const buildBasePayload = (form, { includePurpose = true } = {}) => ({
  report_date: form.report_date || null,
  department: nullableText(form.department),
  employee_name: nullableText(form.employee_name),
  purpose: includePurpose ? nullableText(form.purpose) : null,
  daily_subsidy: form.daily_subsidy === "" ? "0.00" : form.daily_subsidy,
  manual_subsidy_total:
    form.manual_subsidy_total === null || form.manual_subsidy_total === undefined ? null : form.manual_subsidy_total,
  advance_date_month: nullableNumber(form.advance_date_month),
  advance_date_day: nullableNumber(form.advance_date_day),
  advance_amount: form.advance_amount === "" ? "0.00" : form.advance_amount,
});

export const buildDraftPayload = (form) => buildBasePayload(form, { includePurpose: false });

export const buildTripPayload = (trips) =>
  trips.map((trip, index) => ({
    id: trip.id || null,
    sort_order: index + 1,
    depart_month: Number(trip.depart_month || 1),
    depart_day: Number(trip.depart_day || 1),
    depart_hour: trip.depart_hour === "" ? null : Number(trip.depart_hour),
    depart_place: nullableText(trip.depart_place),
    arrive_month: Number(trip.arrive_month || 1),
    arrive_day: Number(trip.arrive_day || 1),
    arrive_hour: trip.arrive_hour === "" ? null : Number(trip.arrive_hour),
    arrive_place: nullableText(trip.arrive_place),
    transport: nullableText(trip.transport),
    subsidy_start: Boolean(trip.subsidy_start),
    subsidy_end: Boolean(trip.subsidy_end),
    paper_invoice_amount:
      trip.paper_invoice_amount === "" || trip.paper_invoice_amount === null || trip.paper_invoice_amount === undefined
        ? "0.00"
        : trip.paper_invoice_amount,
    paper_invoice_count: Number(trip.paper_invoice_count || 0),
  }));

export const buildReportPayload = ({ form, trips, expenseItems }) => ({
  ...buildBasePayload(form),
  trips: buildTripPayload(trips),
  expense_items: expenseItems.map((item) => ({
    id: item.id || null,
    category: item.category,
    remark: nullableText(item.remark),
    reimbursable_amount:
      item.category === "fuel_subsidy" && item.reimbursable_amount !== "" && item.reimbursable_amount !== null && item.reimbursable_amount !== undefined
        ? item.reimbursable_amount
        : null,
      paper_invoice_amount:
        item.paper_invoice_amount === "" || item.paper_invoice_amount === null || item.paper_invoice_amount === undefined
          ? "0.00"
          : item.paper_invoice_amount,
      paper_invoice_count: Number(item.paper_invoice_count || 0),
  })),
});

export const moveTrip = (trips, from, to) => {
  if (to < 0 || to >= trips.length || from === to) return trips.map(normalizeTrip);
  const next = [...trips];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next.map(normalizeTrip);
};

export const cloneTripAfter = (trips, index) => {
  const source = trips[index];
  if (!source) return trips.map(normalizeTrip);
  // 复制为新一段并追加到末尾（避免插在源行程后面、打乱后续行程顺序）；
  // 若末尾前一段是「止」，则自动接为新一次出差的「起」。
  return appendTripWithAutoStart(trips, { ...source, id: null, paper_invoice_amount: "0.00", paper_invoice_count: 0 });
};

export const swapTripEndpoints = (trip) => ({
  ...trip,
  depart_month: trip.arrive_month,
  depart_day: trip.arrive_day,
  depart_hour: trip.arrive_hour,
  depart_place: trip.arrive_place,
  arrive_month: trip.depart_month,
  arrive_day: trip.depart_day,
  arrive_hour: trip.depart_hour,
  arrive_place: trip.depart_place,
});

export const makeReturnTripAfter = (trips, index) => {
  const source = trips[index];
  if (!source) return trips.map(normalizeTrip);
  // 返程 = 一次出差结束，自动标「止」收尾（不继承源段的「起」）。
  // 之后若再「添加行程」，新段会因前一段是「止」而自动标「起」，形成新一次出差。
  const returned = normalizeTrip(
    { ...swapTripEndpoints(source), id: null, subsidy_start: false, subsidy_end: true, paper_invoice_amount: "0.00", paper_invoice_count: 0 },
    index + 1,
  );
  const next = [...trips];
  next.splice(index + 1, 0, returned);
  return next.map(normalizeTrip);
};

// 「添加行程」用：新增的末段若紧接在一段「止」之后，则它是新一次出差的「起」。
export const appendTripWithAutoStart = (trips, blankTrip) => {
  const prevLast = trips[trips.length - 1];
  const startsNewTrip = Boolean(prevLast && prevLast.subsidy_end);
  const nextTrip = normalizeTrip({ ...blankTrip, subsidy_start: startsNewTrip, subsidy_end: false }, trips.length);
  return [...trips, nextTrip].map(normalizeTrip);
};

const textChanged = (current, initial) => String(current ?? "").trim() !== String(initial ?? "").trim();
const moneyChanged = (current, initial) => Number(current || 0) !== Number(initial || 0);

export const isEmptyDraft = ({ form, defaults, trips, invoices, expenseItems = [] }) => {
  if (trips.length > 0 || invoices.length > 0) return false;
  if (expenseItems.some(hasExpenseItemData)) return false;
  const hasCurrentManualSubsidy = form.manual_subsidy_total !== null && form.manual_subsidy_total !== undefined;
  const hadDefaultManualSubsidy = defaults.manual_subsidy_total !== null && defaults.manual_subsidy_total !== undefined;
  if (hasCurrentManualSubsidy || hadDefaultManualSubsidy) return false;
  if (textChanged(form.purpose, "")) return false;
  if (textChanged(form.report_date, defaults.report_date)) return false;
  if (textChanged(form.department, defaults.department)) return false;
  if (textChanged(form.employee_name, defaults.employee_name)) return false;
  if (moneyChanged(form.daily_subsidy, defaults.daily_subsidy)) return false;
  if (form.advance_date_month || form.advance_date_day) return false;
  if (moneyChanged(form.advance_amount, "0.00")) return false;
  return true;
};
