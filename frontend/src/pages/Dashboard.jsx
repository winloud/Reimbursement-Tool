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
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
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
  buildRangeCalendarMonths,
  buildSummaryCards,
  buildTripHeatLevels,
  buildTrendChartData,
  formatStatsAmount,
  monthValueFromDate,
} from "./dashboardUtils";

const CATEGORY_COLORS = ["#2563EB", "#16A34A", "#F59E0B", "#DC2626", "#7C3AED", "#0891B2", "#DB2777", "#64748B"];
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const TRIP_HEAT_COLORS = Array.from({ length: 10 }, (_, index) => {
  const level = index + 1;
  const alpha = 0.22 + index * 0.068;
  return {
    bg: `rgba(18, 97, 50, ${alpha.toFixed(2)})`,
    color: level >= 7 ? "#FFFFFF" : "#052E16",
    border: `rgba(18, 97, 50, ${Math.min(alpha + 0.1, 0.9).toFixed(2)})`,
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
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(null);
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

      <Grid container spacing={2.5}>
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Stack
                direction="row"
                spacing={1.25}
                alignItems="center"
                sx={{ overflowX: "auto", pb: 0.25, scrollbarWidth: "thin" }}
              >
                <Typography variant="body2" fontWeight={800} sx={{ whiteSpace: "nowrap", flex: "0 0 auto" }}>
                  月份范围
                </Typography>
                <TextField
                  size="small"
                  type="date"
                  value={monthStartDateValue(startMonth)}
                  onChange={handleStartDateChange}
                  inputProps={{ "aria-label": "开始日期" }}
                  sx={{ width: 158, flex: "0 0 auto" }}
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
                  sx={{ width: 158, flex: "0 0 auto" }}
                />

                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={activeQuickRange}
                  onChange={handleQuickRangeChange}
                  sx={{
                    flex: "0 0 auto",
                    gap: 0.75,
                    "& .MuiToggleButtonGroup-grouped": {
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: "10px !important",
                      mx: 0,
                      px: 1.1,
                      py: 0.7,
                      color: "text.secondary",
                      bgcolor: "background.paper",
                      whiteSpace: "nowrap",
                      "&.Mui-selected": {
                        bgcolor: "primary.main",
                        borderColor: "primary.main",
                        color: "primary.contrastText",
                        "&:hover": { bgcolor: "primary.dark" },
                      },
                    },
                  }}
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

      <Grid container spacing={2.5}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.key}>
            <Card sx={{ height: "100%", borderRadius: 2 }}>
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

      <Grid container spacing={2.5}>
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
                已报销费用分布
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                查看所选月份范围内已报销费用的类别占比
              </Typography>
              {categoryData.length === 0 ? (
                <EmptyPanel text="暂无已报销费用数据" />
              ) : (
                <Box sx={{ height: { xs: 190, sm: 220, lg: 255 } }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="amount"
                        nameKey="label"
                        innerRadius="48%"
                        outerRadius="78%"
                        paddingAngle={2}
                        isAnimationActive
                        animationBegin={120}
                        animationDuration={900}
                        animationEasing="ease-out"
                        activeIndex={activeCategoryIndex ?? undefined}
                        activeShape={renderActivePieSector}
                        onMouseEnter={(_, index) => setActiveCategoryIndex(index)}
                        onMouseLeave={() => setActiveCategoryIndex(null)}
                      >
                        {categoryData.map((item, index) => (
                          <Cell key={item.category} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatStatsAmount(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              )}
              {categoryLegendItems.length > 0 && (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    columnGap: 4,
                    rowGap: 0.75,
                    mt: 1,
                  }}
                >
                  {categoryLegendItems.map((item, index) => (
                    <Box key={item.category} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                          flex: "0 0 auto",
                        }}
                      />
                      <Typography variant="caption" noWrap sx={{ flex: 1 }}>
                        {item.label}
                      </Typography>
                      <Typography variant="caption" fontWeight={700}>
                        {item.amountText}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.percentText}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
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

function renderActivePieSector(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 8}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      style={{ filter: "drop-shadow(0 6px 10px rgba(15, 23, 42, 0.22))" }}
    />
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
  return (
    <CardContent>
      <Typography color="text.secondary" gutterBottom>
        {card.title}
      </Typography>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
        {card.primary}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {card.secondary || "\u00A0"}
      </Typography>
    </CardContent>
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
