export const formatStatsAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const buildSummaryCards = (summary = {}) => {
  const safeSummary = summary || {};
  const period = safeSummary.selected_period || safeSummary.current_year || {};
  const totalAmount = Number(period.total_amount ?? 0);
  const pendingAmount = Number(period.pending_amount ?? 0);
  const reimbursedAmount = Number(period.reimbursed_amount ?? 0);
  const totalCount =
    Number(period.total_count ?? 0) ||
    Number(period.pending_count || 0) + Number(period.reimbursed_count || 0);
  return [
    {
      key: "total_amount",
      title: "总报销金额",
      primary: formatStatsAmount(totalAmount || pendingAmount + reimbursedAmount),
      secondary: `共 ${totalCount} 单 · 点击查看明细`,
      target: "total",
    },
    {
      key: "reimbursed_amount",
      title: "已报销金额",
      primary: formatStatsAmount(reimbursedAmount),
      secondary: `${Number(period.reimbursed_count || 0)} 单 · 点击查看明细`,
      target: "reimbursed",
    },
    {
      key: "pending_amount",
      title: "待报销金额",
      primary: formatStatsAmount(pendingAmount),
      secondary: `${Number(period.pending_count || 0)} 单 · 点击查看明细`,
      target: "pending",
    },
    {
      key: "trip_days",
      title: "出差天数",
      primary: `${Number(period.trip_days || 0)} 天`,
      secondary: "按实际行程日期统计",
      target: "trip_days",
      clickable: false,
    },
  ];
};

export const monthValueFromDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const monthRangeToDates = (startMonth, endMonth) => {
  const [startYear, start] = startMonth.split("-").map(Number);
  const [endYear, end] = endMonth.split("-").map(Number);
  const endDate = new Date(endYear, end, 0);
  return {
    startDate: `${startYear}-${String(start).padStart(2, "0")}-01`,
    endDate: `${endYear}-${String(end).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`,
  };
};

export const buildDashboardCardReportTarget = ({ target, startMonth, endMonth }) => {
  const { startDate, endDate } = monthRangeToDates(startMonth, endMonth);
  const params = new URLSearchParams();
  params.set("page", "1");
  if (target === "reimbursed") {
    params.set("status", "reimbursed");
    params.set("report_start", startDate);
    params.set("report_end", endDate);
  } else if (target === "pending") {
    params.set("status", "printed");
    params.set("report_start", startDate);
    params.set("report_end", endDate);
  } else if (target === "trip_days") {
    params.set("statuses", "printed,reimbursed");
    params.set("trip_start", startDate);
    params.set("trip_end", endDate);
  } else {
    params.set("statuses", "printed,reimbursed");
    params.set("report_start", startDate);
    params.set("report_end", endDate);
  }
  return `/reports?${params.toString()}`;
};

export const buildCategoryChartData = (items = []) =>
  items.map((item) => ({
    ...item,
    amount: Number(item.amount || 0),
  }));

export const buildTrendChartData = (items = []) =>
  items.map((item) => ({
    ...item,
    pending_amount: Number(item.pending_amount || 0),
    reimbursed_amount: Number(item.reimbursed_amount || 0),
    total_amount: Number(item.total_amount || 0),
    trip_days: Number(item.trip_days || 0),
  }));

export const buildAmountAxisMax = (items = []) => {
  const maxAmount = items.reduce((max, item) => Math.max(max, Number(item.total_amount || 0)), 0);
  if (maxAmount <= 0) return 1000;
  const padded = maxAmount * 1.15;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(padded)) - 1);
  return Math.ceil(padded / magnitude) * magnitude;
};

export const buildCategoryLegendItems = (items = []) => {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return items.map((item) => {
    const amount = Number(item.amount || 0);
    return {
      category: item.category,
      label: item.label,
      amountText: formatStatsAmount(amount),
      percentText: total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : "0.0%",
    };
  });
};

export const dateKey = (value) => {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return "";
};

export const buildYearCalendarMonths = (year, dateValues = []) => {
  const activeByMonth = new Map(Array.from({ length: 12 }, (_, index) => [index + 1, []]));
  dateValues.forEach((value) => {
    const key = dateKey(value);
    const [dateYear, month, day] = key.split("-").map(Number);
    if (dateYear === year && activeByMonth.has(month)) {
      activeByMonth.get(month).push(day);
    }
  });
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      month,
      label: `${month}月`,
      activeDates: [...new Set(activeByMonth.get(month))].sort((a, b) => a - b),
    };
  });
};

export const buildRangeCalendarMonths = (items = []) =>
  items.map((item, index) => {
    const [year, month] = item.month.split("-").map(Number);
    return {
      month: item.month,
      year,
      monthNumber: month,
      label: `${year}年${month}月`,
      showYear: index === 0 || month === 1,
      activeDates: (item.dates || [])
        .map(dateKey)
        .map((key) => Number(key.split("-")[2]))
        .filter(Boolean)
        .sort((a, b) => a - b),
      days: Number(item.days || 0),
      dates: item.dates || [],
    };
  });

const nextDateKey = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(year, month - 1, day + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
};

export const tripHeatLevelFromStreak = (streak) => {
  return Math.max(1, Math.min(10, Math.ceil(Number(streak || 1) / 3)));
};

export const buildTripHeatLevels = (dateValues = []) => {
  const dates = [...new Set(dateValues.map(dateKey).filter(Boolean))].sort();
  const heatByDate = {};
  let previous = "";
  let streak = 0;

  dates.forEach((key) => {
    streak = previous && key === nextDateKey(previous) ? streak + 1 : 1;
    heatByDate[key] = {
      streak,
      level: tripHeatLevelFromStreak(streak),
    };
    previous = key;
  });

  return heatByDate;
};

export const buildMonthCalendarWeeks = (year, month, dateValues = [], heatByDate = {}) => {
  const activeDays = new Set(
    dateValues
      .map(dateKey)
      .map((key) => key.split("-").map(Number))
      .filter(([dateYear, dateMonth]) => dateYear === year && dateMonth === month)
      .map(([, , day]) => day),
  );
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const active = activeDays.has(day);
      return {
        date: day,
        active,
        heatLevel: active ? heatByDate[key]?.level || 1 : 0,
        streak: active ? heatByDate[key]?.streak || 1 : 0,
      };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
};
