import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DateRangeIcon from "@mui/icons-material/DateRange";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getStatsCalendar, getStatsCategory, getStatsSummary } from "../api/client";
import {
  buildAmountAxisMax,
  buildCategoryChartData,
  buildCategoryLegendItems,
  buildDashboardCardReportTarget,
  dashboardQuickRangeGroupSx,
  dashboardRangeDateFieldSx,
  dashboardRangeFieldsSx,
  dashboardRangeToolbarSx,
  buildRangeCalendarMonths,
  buildSummaryCards,
  buildTripHeatLevels,
  buildTrendChartData,
  formatStatsAmount,
  monthValueFromDate,
} from "./dashboardUtils";

const CATEGORY_COLORS = ["#2454A6", "#237A57", "#B66B18", "#B93B3B", "#3A668F", "#526071", "#6B5E44", "#64748B"];
const DASHBOARD_GRID_SX = { width: "100%", ml: 0 };
const SUMMARY_CARD_META = {
  total_amount: { color: "#2454A6", label: "总览" },
  reimbursed_amount: { color: "#237A57", label: "已确认" },
  pending_amount: { color: "#B66B18", label: "待处理" },
  trip_days: { color: "#3A668F", label: "负荷" },
};
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const TRIP_HEAT_START_RGB = [108, 166, 119];
const TRIP_HEAT_END_RGB = [205, 165, 93];
const interpolateTripHeatRgb = (index, total) => {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  return TRIP_HEAT_START_RGB.map((start, channelIndex) =>
    Math.round(start + (TRIP_HEAT_END_RGB[channelIndex] - start) * ratio),
  );
};
const TRIP_HEAT_COLORS = Array.from({ length: 10 }, (_, index) => {
  const [red, green, blue] = interpolateTripHeatRgb(index, 10);
  return {
    bg: `rgba(${red}, ${green}, ${blue}, 0.82)`,
    border: `rgb(${red}, ${green}, ${blue})`,
  };
});

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const shiftMonthValue = (value, months) => monthValueFromDate(addMonths(dateFromMonthValue(value, 1), months));
const dateValueFromDate = (value) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const monthLabel = (value) => value || "";
const rangeIsValid = (startMonth, endMonth) => startMonth && endMonth && startMonth <= endMonth;
const monthParts = (value) => {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
};
const monthStartDateValue = (value) => (value ? `${value}-01` : "");
const monthEndDateValue = (value, referenceDate) => {
  if (!value) return "";
  if (referenceDate && value === monthValueFromDate(referenceDate)) return dateValueFromDate(referenceDate);
  const { year, month } = monthParts(value);
  return `${value}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
};
const monthFromDateValue = (value) => (value ? value.slice(0, 7) : "");

export default function Dashboard() {
  const navigate = useNavigate();
  const today = new Date();
  const currentMonth = monthValueFromDate(today);
  const [startMonth, setStartMonth] = useState(`${today.getFullYear()}-01`);
  const [endMonth, setEndMonth] = useState(currentMonth);
  const [summary, setSummary] = useState(null);
  const [category, setCategory] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [error, setError] = useState("");

  const validRange = rangeIsValid(startMonth, endMonth);
  const rangeParams = useMemo(() => ({ startMonth, endMonth }), [endMonth, startMonth]);

  useEffect(() => {
    if (!validRange) {
      setError("开始月份不能晚于结束月份");
      setLoading(false);
      return;
    }
    let active = true;
    const loadDashboard = async () => {
      setLoading(true);
      setError("");
      try {
        const [summaryResponse, categoryResponse] = await Promise.all([
          getStatsSummary(rangeParams),
          getStatsCategory(rangeParams),
        ]);
        if (!active) return;
        setSummary(summaryResponse.data);
        setCategory(categoryResponse.data);
      } catch (err) {
        if (!active) return;
        setError(err.response?.data?.message || err.response?.data?.detail || "看板数据加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    loadDashboard();
    return () => {
      active = false;
    };
  }, [rangeParams, validRange]);

  useEffect(() => {
    if (!validRange) return;
    let active = true;
    const loadCalendar = async () => {
      setCalendarLoading(true);
      try {
        const { year, month } = monthParts(startMonth);
        const response = await getStatsCalendar({ year, month, ...rangeParams });
        if (active) setCalendar(response.data);
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.response?.data?.detail || "出差日历加载失败");
      } finally {
        if (active) setCalendarLoading(false);
      }
    };
    loadCalendar();
    return () => {
      active = false;
    };
  }, [rangeParams, startMonth, validRange]);

  const cards = useMemo(() => buildSummaryCards(summary), [summary]);
  const trendData = useMemo(() => buildTrendChartData(summary?.monthly_trend || []), [summary?.monthly_trend]);
  const amountAxisMax = useMemo(() => buildAmountAxisMax(trendData), [trendData]);
  const categoryData = useMemo(() => buildCategoryChartData(category?.items || []), [category?.items]);
  const categoryLegendItems = useMemo(() => buildCategoryLegendItems(categoryData), [categoryData]);
  const calendarMonths = useMemo(() => buildRangeCalendarMonths(calendar?.months || []), [calendar?.months]);

  const applyRange = (nextStart, nextEnd) => {
    setStartMonth(nextStart);
    setEndMonth(nextEnd);
  };

  const handleCardClick = (card) => {
    if (card.clickable === false) return;
    navigate(buildDashboardCardReportTarget({ target: card.target, startMonth, endMonth }));
  };

  const quickRanges = [
    { value: "this_year", label: "今年", icon: <CalendarTodayIcon fontSize="small" />, start: `${today.getFullYear()}-01`, end: currentMonth },
    { value: "last_year", label: "去年", icon: <EventRepeatIcon fontSize="small" />, start: `${today.getFullYear() - 1}-01`, end: `${today.getFullYear() - 1}-12` },
    { value: "last_6", label: "近 6 个月", icon: <DateRangeIcon fontSize="small" />, start: monthValueFromDate(addMonths(today, -5)), end: currentMonth },
    { value: "last_12", label: "近一年", icon: <CalendarMonthIcon fontSize="small" />, start: monthValueFromDate(addMonths(today, -11)), end: currentMonth },
    { value: "prev_year", label: "前一年", icon: <ChevronLeftIcon fontSize="small" />, action: "shift", months: -12 },
    { value: "next_year", label: "后一年", icon: <ChevronRightIcon fontSize="small" />, action: "shift", months: 12 },
    { value: "all", label: "所有", icon: <AllInclusiveIcon fontSize="small" />, start: "2023-01", end: currentMonth },
  ];
  const activeQuickRange = quickRanges.find((range) => range.start === startMonth && range.end === endMonth)?.value || "custom";
  const handleQuickRangeChange = (_, value) => {
    if (!value) return;
    const range = quickRanges.find((item) => item.value === value);
    if (!range) return;
    if (range.action === "shift") {
      applyRange(shiftMonthValue(startMonth, range.months), shiftMonthValue(endMonth, range.months));
      return;
    }
    applyRange(range.start, range.end);
  };
  const handleStartDateChange = (event) => {
    const value = monthFromDateValue(event.target.value);
    if (value) setStartMonth(value);
  };
  const handleEndDateChange = (event) => {
    const value = monthFromDateValue(event.target.value);
    if (value) setEndMonth(value);
  };

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 360 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" fontWeight={800}>
          总览看板
        </Typography>
        <Typography variant="body2" color="text.secondary">
          按月份范围查看报销进度、费用结构和出差天数
        </Typography>
      </Box>

      <Grid container spacing={2.5} sx={DASHBOARD_GRID_SX}>
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap sx={dashboardRangeToolbarSx}>
                <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap sx={dashboardRangeFieldsSx}>
                  <Typography variant="body2" fontWeight={800} sx={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>
                    月份范围
                  </Typography>
                  <TextField
                    size="small"
                    type="date"
                    value={monthStartDateValue(startMonth)}
                    onChange={handleStartDateChange}
                    inputProps={{ "aria-label": "开始日期" }}
                    sx={dashboardRangeDateFieldSx}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ flex: "0 0 auto" }}>
                    至
                  </Typography>
                  <TextField
                    size="small"
                    type="date"
                    value={monthEndDateValue(endMonth, today)}
                    onChange={handleEndDateChange}
                    inputProps={{ "aria-label": "结束日期" }}
                    sx={dashboardRangeDateFieldSx}
                  />
                </Stack>

                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={activeQuickRange}
                  onChange={handleQuickRangeChange}
                  sx={dashboardQuickRangeGroupSx}
                >
                  {quickRanges.map((range) => (
                    <ToggleButton key={range.value} value={range.value} aria-label={range.label}>
                      <Stack direction="row" spacing={0.6} alignItems="center">
                        {range.icon}
                        <Typography variant="body2" fontWeight={800} sx={{ whiteSpace: "nowrap" }}>
                          {range.label}
                        </Typography>
                      </Stack>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {error && <Alert severity="error">{error}</Alert>}

      <Grid container spacing={2.5} sx={DASHBOARD_GRID_SX}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.key}>
            <Card
              sx={{
                height: "100%",
                borderLeft: "5px solid",
                borderLeftColor: SUMMARY_CARD_META[card.key]?.color || "primary.main",
                transition: "transform 160ms ease, box-shadow 160ms ease",
                ...(card.clickable === false
                  ? {}
                  : {
                      "&:hover": {
                        transform: "translateY(-2px)",
                        boxShadow: "0 12px 24px rgba(23, 32, 42, 0.09)",
                      },
                    }),
              }}
            >
              {card.clickable === false ? (
                <SummaryCardContent card={card} />
              ) : (
                <CardActionArea onClick={() => handleCardClick(card)} sx={{ height: "100%" }}>
                  <SummaryCardContent card={card} />
                </CardActionArea>
              )}
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5} sx={DASHBOARD_GRID_SX}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ minHeight: 420, height: "100%", borderRadius: 2 }}>
            <CardContent sx={{ height: "100%" }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={800}>
                  月份范围趋势
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  金额按报销日期统计，出差天数按实际行程日期统计
                </Typography>
              </Box>
              <Box sx={{ height: 300 }}>
                {trendData.length === 0 ? (
                  <EmptyPanel text="暂无趋势数据" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" minTickGap={18} />
                      <YAxis yAxisId="amount" domain={[0, amountAxisMax]} tickFormatter={(value) => `${value}`} />
                      <YAxis yAxisId="days" orientation="right" allowDecimals={false} />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === "出差天数") return `${value} 天`;
                          return formatStatsAmount(value);
                        }}
                        labelFormatter={(label) => `月份：${label}`}
                      />
                      <Legend />
                      <Line
                        yAxisId="amount"
                        type="monotone"
                        dataKey="total_amount"
                        name="总报销金额"
                        stroke="#2563EB"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="days"
                        type="monotone"
                        dataKey="trip_days"
                        name="出差天数"
                        stroke="#16A34A"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ minHeight: 420, height: "100%", borderRadius: 2 }}>
            <CardContent sx={{ height: "100%" }}>
              <Typography variant="h6" fontWeight={800}>
                费用类别排行
              </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  按报销金额排序，优先看占用最高的费用项
                </Typography>
                {categoryData.length === 0 ? (
                  <EmptyPanel text="暂无费用数据" />
              ) : (
                <CategoryRankList items={categoryLegendItems} sourceItems={categoryData} />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5} sx={DASHBOARD_GRID_SX}>
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={800}>
                  出差负荷热力图
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  显示 {monthLabel(startMonth)} 至 {monthLabel(endMonth)} 的出差连续负荷，颜色越深代表连续出差越久
                </Typography>
              </Box>

              {calendarLoading ? (
                <Stack alignItems="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <TripLoadHeatWall months={calendarMonths} startMonth={startMonth} endMonth={endMonth} />
                  <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1}>
                    <HeatLegend />
                    <Typography variant="body2" color="text.secondary" textAlign={{ xs: "left", sm: "right" }}>
                      当前范围出差天数：{calendar?.total_days || 0} 天
                    </Typography>
                  </Stack>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

function EmptyPanel({ text }) {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ height: 250, color: "text.secondary" }}>
      <Typography variant="body2">{text}</Typography>
    </Stack>
  );
}

function SummaryCardContent({ card }) {
  const meta = SUMMARY_CARD_META[card.key] || SUMMARY_CARD_META.total_amount;
  return (
    <CardContent sx={{ height: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography color="text.secondary" fontWeight={800}>
          {card.title}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: meta.color,
            bgcolor: "rgba(36, 84, 166, 0.08)",
            borderRadius: 1,
            px: 0.75,
            py: 0.25,
            fontWeight: 900,
          }}
        >
          {meta.label}
        </Typography>
      </Stack>
      <Typography variant="h5" fontWeight={900} sx={{ mb: 1, fontFamily: '"DIN Alternate", "Roboto Mono", Consolas, monospace' }}>
        {card.primary}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {card.secondary || "\u00A0"}
      </Typography>
    </CardContent>
  );
}

function CategoryRankList({ items, sourceItems }) {
  const amountByCategory = new Map(sourceItems.map((item) => [item.category, Number(item.amount || 0)]));
  const ranked = [...items].sort((left, right) => (amountByCategory.get(right.category) || 0) - (amountByCategory.get(left.category) || 0));
  const maxAmount = ranked.reduce((max, item) => Math.max(max, amountByCategory.get(item.category) || 0), 0);

  return (
    <Stack spacing={1.3} sx={{ mt: 1 }}>
      {ranked.map((item, index) => {
        const amount = amountByCategory.get(item.category) || 0;
        const percent = maxAmount > 0 ? Math.max(6, (amount / maxAmount) * 100) : 0;
        const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
        return (
          <Box key={item.category}>
            <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
              <Typography variant="body2" fontWeight={850} noWrap>
                {item.label}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flex: "0 0 auto" }}>
                <Typography variant="body2" fontWeight={900} sx={{ fontFamily: '"DIN Alternate", "Roboto Mono", Consolas, monospace' }}>
                  {item.amountText}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.percentText}
                </Typography>
              </Stack>
            </Stack>
            <Box
              sx={{
                mt: 0.65,
                height: 8,
                borderRadius: 1,
                bgcolor: "rgba(104, 115, 131, 0.12)",
                overflow: "hidden",
              }}
            >
              <Box sx={{ width: `${percent}%`, height: "100%", borderRadius: 1, bgcolor: color }} />
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function TripLoadHeatWall({ months, startMonth, endMonth }) {
  const heatByDate = useMemo(
    () => buildTripHeatLevels(months.flatMap((month) => month.dates || [])),
    [months],
  );
  const weeks = useMemo(() => buildRangeHeatWeeks({ startMonth, endMonth, heatByDate }), [endMonth, heatByDate, startMonth]);

  return (
    <Box
      sx={{
        overflowX: "auto",
        pb: 0.5,
        scrollbarWidth: "thin",
      }}
    >
      <Box sx={{ display: "inline-grid", gridTemplateColumns: `32px repeat(${weeks.length}, 13px)`, columnGap: 0.45, rowGap: 0.45, minWidth: "100%" }}>
        <Box />
        {weeks.map((week, index) => (
          <Typography
            key={`month-${index}`}
            variant="caption"
            color="text.secondary"
            sx={{
              height: 16,
              fontSize: 9,
              lineHeight: "16px",
              whiteSpace: "nowrap",
              overflow: "visible",
              visibility: week.monthLabel ? "visible" : "hidden",
              fontWeight: week.monthLabel?.includes("年") ? 800 : 600,
            }}
          >
            {week.monthLabel || "."}
          </Typography>
        ))}

        {WEEKDAY_LABELS.map((label, dayIndex) => (
          <Typography
            key={`weekday-${label}`}
            variant="caption"
            color="text.disabled"
            sx={{ gridColumn: 1, gridRow: dayIndex + 2, fontSize: 10, lineHeight: "13px" }}
          >
            {label}
          </Typography>
        ))}

        {weeks.map((week, weekIndex) =>
          week.days.map((cell, dayIndex) => {
            const heat = cell?.active ? TRIP_HEAT_COLORS[cell.heatLevel - 1] || TRIP_HEAT_COLORS[0] : null;
            return (
              <Box
                key={`${weekIndex}-${dayIndex}`}
                title={cell?.key ? `${cell.key}${cell.active ? `，连续第 ${cell.streak} 天` : ""}` : undefined}
                sx={{
                  gridColumn: weekIndex + 2,
                  gridRow: dayIndex + 2,
                  width: 12,
                  height: 12,
                  borderRadius: 0.45,
                  bgcolor: cell ? heat?.bg || "rgba(148, 163, 184, 0.06)" : "transparent",
                  border: "1px solid",
                  borderColor: cell ? heat?.border || "rgba(148, 163, 184, 0.08)" : "transparent",
                }}
              />
            );
          }),
        )}
      </Box>
    </Box>
  );
}

function HeatLegend() {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        连续出差负荷
      </Typography>
      <Typography variant="caption" color="text.secondary">
        轻
      </Typography>
      {TRIP_HEAT_COLORS.map((color, index) => (
        <Box
          key={index}
          title={`第 ${index * 3 + 1}-${(index + 1) * 3} 天`}
          sx={{ width: 12, height: 12, borderRadius: 0.45, bgcolor: color.bg, border: "1px solid", borderColor: color.border }}
        />
      ))}
      <Typography variant="caption" color="text.secondary">
        重
      </Typography>
      <Typography variant="caption" color="text.disabled">
        每 3 天升一档
      </Typography>
    </Stack>
  );
}

function buildRangeHeatWeeks({ startMonth, endMonth, heatByDate }) {
  if (!startMonth || !endMonth) return [];
  const start = dateFromMonthValue(startMonth, 1);
  const endMonthDate = dateFromMonthValue(endMonth, 1);
  const end = new Date(endMonthDate.getFullYear(), endMonthDate.getMonth() + 1, 0);
  const cells = [];

  for (let index = 0; index < start.getDay(); index += 1) cells.push(null);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = localDateKey(cursor);
    const fatigue = heatByDate[key];
    cells.push({
      key,
      date: cursor.getDate(),
      month: cursor.getMonth() + 1,
      year: cursor.getFullYear(),
      active: Boolean(fatigue),
      heatLevel: fatigue?.level || 0,
      streak: fatigue?.streak || 0,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    const days = cells.slice(index, index + 7);
    weeks.push({ days, monthLabel: monthLabelForWeek(days, weeks.length) });
  }
  return weeks;
}

function monthLabelForWeek(days, weekIndex) {
  const firstDay = days.find(Boolean);
  const monthStartDay = days.find((day) => day?.date === 1);
  const labelDay = weekIndex === 0 ? firstDay : monthStartDay;
  if (!labelDay) return "";
  return labelDay.month === 1 || weekIndex === 0 ? `${labelDay.year}年${labelDay.month}月` : `${labelDay.month}月`;
}

function dateFromMonthValue(value, day) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
