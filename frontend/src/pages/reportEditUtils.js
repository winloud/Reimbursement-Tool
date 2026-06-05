export const todayStr = () => new Date().toISOString().slice(0, 10);

export const emptyForm = {
  report_date: todayStr(),
  department: "",
  employee_name: "",
  purpose: "",
  daily_subsidy: "0.00",
  advance_date_month: "",
  advance_date_day: "",
  advance_amount: "0.00",
};

export const EXPENSE_CATEGORIES = [
  { value: "luggage", label: "行李费" },
  { value: "city_transport", label: "市内交通费" },
  { value: "accommodation", label: "住宿费" },
  { value: "postal", label: "邮电费" },
  { value: "no_sleeper_subsidy", label: "未乘卧铺补助" },
  { value: "toll", label: "过路费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

export const CUSTOM_CATEGORY_PREFIX = "custom:";
const CUSTOM_CATEGORY_FORBIDDEN_PATTERN = /[\/\\:*?"<>|\x00-\x1f]/;
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

export const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  printed: { label: "已打印", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

export const STATUS_ACTIONS = {
  draft: [{ target: "printed", label: "标记为已打印", color: "primary" }],
  printed: [
    { target: "reimbursed", label: "标记为已报销", color: "success" },
    { target: "draft", label: "退回草稿", color: "inherit" },
  ],
  reimbursed: [],
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
  collapsed: trip.collapsed ?? false,
});

export const applyDefaultSubsidyMarkers = (trips = []) => {
  const normalized = trips.map((trip, index) => normalizeTrip(trip, index));
  if (normalized.length === 0 || normalized.some((trip) => trip.subsidy_start || trip.subsidy_end)) {
    return normalized;
  }

  const homePlace = String(normalized[0].depart_place || "").trim();
  let openInterval = false;
  const next = normalized.map((trip) => ({ ...trip, subsidy_start: false, subsidy_end: false }));
  next.forEach((trip, index) => {
    const departPlace = String(trip.depart_place || "").trim();
    const arrivePlace = String(trip.arrive_place || "").trim();
    const shouldStart = index === 0 || (!openInterval && homePlace && departPlace === homePlace);
    if (shouldStart) {
      trip.subsidy_start = true;
      openInterval = true;
    }
    if (openInterval && homePlace && arrivePlace === homePlace) {
      trip.subsidy_end = true;
      openInterval = false;
    }
  });
  if (openInterval) {
    next[next.length - 1].subsidy_end = true;
  }
  return next;
};

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
  amount: item.amount ?? "0.00",
  invoice_count: item.invoice_count ?? 0,
});

const makeDate = (year, month, day) => {
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
};

export const calculateSubsidyDays = (reportDate, trips) => {
  const year = reportDate ? new Date(`${reportDate}T00:00:00`).getFullYear() : new Date().getFullYear();
  const markedTrips = trips.some((trip) => trip.subsidy_start || trip.subsidy_end)
    ? trips.map((trip, index) => normalizeTrip(trip, index))
    : applyDefaultSubsidyMarkers(trips);
  const ranges = markedTrips
    .map((trip) => {
      const departMonth = Number(trip.depart_month);
      const departDay = Number(trip.depart_day);
      const arriveMonth = Number(trip.arrive_month);
      const arriveDay = Number(trip.arrive_day);
      const arriveYear =
        arriveMonth < departMonth || (arriveMonth === departMonth && arriveDay < departDay) ? year + 1 : year;
      const depart = makeDate(year, departMonth, departDay);
      const arrive = makeDate(arriveYear, arriveMonth, arriveDay);
      if (!depart || !arrive) return null;
      const travelDays = Math.floor((arrive.getTime() - depart.getTime()) / 86400000);
      if (travelDays < 0 || travelDays > 7) return null;
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
      return depart && arrive ? { trip, depart, arrive } : null;
    })
    .filter(Boolean);

  if (ranges.length === 0) return 0;
  const intervals = [];
  let activeStart = null;
  for (const range of ranges) {
    if (range.trip.subsidy_start) {
      if (activeStart) return 0;
      activeStart = range.depart;
    }
    if (range.trip.subsidy_end) {
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
    if (!previous || interval.start.getTime() > previous.end.getTime() + 86400000) {
      merged.push({ ...interval });
    } else if (interval.end.getTime() > previous.end.getTime()) {
      previous.end = interval.end;
    }
  }
  return merged.reduce((sum, interval) => sum + Math.floor((interval.end - interval.start) / 86400000) + 1, 0);
};

export const calculateSummary = ({ reportDate, dailySubsidy, advanceAmount, trips, invoices }) => {
  const subsidyDays = calculateSubsidyDays(reportDate, trips);
  const subsidyTotal = subsidyDays * Number(dailySubsidy || 0);
  const invoiceTotal = invoices
    .filter((invoice) => invoice.amount_confirmed)
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const total = subsidyTotal + invoiceTotal;
  const advance = Number(advanceAmount || 0);
  return {
    subsidyDays,
    subsidyTotal,
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
  }));

export const buildReportPayload = ({ form, trips, expenseItems }) => ({
  ...buildBasePayload(form),
  trips: buildTripPayload(trips),
  expense_items: expenseItems.map((item) => ({
    id: item.id || null,
    category: item.category,
    remark: nullableText(item.remark),
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
  const cloned = normalizeTrip({ ...source, id: null }, index + 1);
  const next = [...trips];
  next.splice(index + 1, 0, cloned);
  return next.map(normalizeTrip);
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
  const returned = normalizeTrip({ ...swapTripEndpoints(source), id: null }, index + 1);
  const next = [...trips];
  next.splice(index + 1, 0, returned);
  return next.map(normalizeTrip);
};

const textChanged = (current, initial) => String(current ?? "").trim() !== String(initial ?? "").trim();
const moneyChanged = (current, initial) => Number(current || 0) !== Number(initial || 0);

export const isEmptyDraft = ({ form, defaults, trips, invoices }) => {
  if (trips.length > 0 || invoices.length > 0) return false;
  if (textChanged(form.purpose, "")) return false;
  if (textChanged(form.report_date, defaults.report_date)) return false;
  if (textChanged(form.department, defaults.department)) return false;
  if (textChanged(form.employee_name, defaults.employee_name)) return false;
  if (moneyChanged(form.daily_subsidy, defaults.daily_subsidy)) return false;
  if (form.advance_date_month || form.advance_date_day) return false;
  if (moneyChanged(form.advance_amount, "0.00")) return false;
  return true;
};
