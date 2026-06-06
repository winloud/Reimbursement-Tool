export const formatStatsAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const buildSummaryCards = (summary = {}) => {
  const safeSummary = summary || {};
  const month = safeSummary.current_month || {};
  const year = safeSummary.current_year || {};
  const monthCount = Number(month.pending_count || 0) + Number(month.reimbursed_count || 0);
  const yearCount = Number(year.pending_count || 0) + Number(year.reimbursed_count || 0);
  return [
    {
      key: "month_amount",
      title: "本月金额",
      primary: `已报销 ${formatStatsAmount(month.reimbursed_amount)}`,
      secondary: `待报销 ${formatStatsAmount(month.pending_amount)} · 共 ${monthCount} 单`,
    },
    {
      key: "year_amount",
      title: "今年金额",
      primary: `已报销 ${formatStatsAmount(year.reimbursed_amount)}`,
      secondary: `待报销 ${formatStatsAmount(year.pending_amount)} · 共 ${yearCount} 单`,
    },
    {
      key: "month_days",
      title: "本月出差天数",
      primary: `${Number(month.trip_days || 0)} 天`,
      secondary: "",
    },
    {
      key: "year_days",
      title: "今年出差天数",
      primary: `${Number(year.trip_days || 0)} 天`,
      secondary: "",
    },
  ];
};

export const buildCategoryChartData = (items = []) =>
  items.map((item) => ({
    ...item,
    amount: Number(item.amount || 0),
  }));

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

export const buildMonthCalendarWeeks = (year, month, dateValues = []) => {
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
      return { date: day, active: activeDays.has(day) };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
};
