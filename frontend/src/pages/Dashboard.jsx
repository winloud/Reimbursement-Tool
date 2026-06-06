import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
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
  buildCategoryChartData,
  buildCategoryLegendItems,
  buildMonthCalendarWeeks,
  buildSummaryCards,
  buildYearCalendarMonths,
  formatStatsAmount,
} from "./dashboardUtils";

const CATEGORY_COLORS = ["#2563EB", "#16A34A", "#F59E0B", "#DC2626", "#7C3AED", "#0891B2", "#DB2777", "#64748B"];
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export default function Dashboard() {
  const today = new Date();
  const [summary, setSummary] = useState(null);
  const [category, setCategory] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [monthDialogOpen, setMonthDialogOpen] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadDashboard = async () => {
      setLoading(true);
      setError("");
      try {
        const [summaryResponse, categoryResponse] = await Promise.all([getStatsSummary(), getStatsCategory()]);
        if (!active) return;
        setSummary(summaryResponse.data);
        setCategory(categoryResponse.data);
      } catch (err) {
        if (!active) return;
        setError(err.response?.data?.message || "看板数据加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadCalendar = async () => {
      setCalendarLoading(true);
      try {
        const response = await getStatsCalendar({ year: selectedYear, month: selectedMonth });
        if (active) setCalendar(response.data);
      } catch (err) {
        if (active) setError(err.response?.data?.message || "出差日历加载失败");
      } finally {
        if (active) setCalendarLoading(false);
      }
    };
    loadCalendar();
    return () => {
      active = false;
    };
  }, [selectedYear, selectedMonth]);

  const cards = useMemo(() => buildSummaryCards(summary), [summary]);
  const trendData = summary?.monthly_trend || [];
  const categoryData = useMemo(() => buildCategoryChartData(category?.items || []), [category?.items]);
  const categoryLegendItems = useMemo(() => buildCategoryLegendItems(categoryData), [categoryData]);
  const yearDates = calendar?.year_dates || [];
  const yearMonths = useMemo(() => buildYearCalendarMonths(selectedYear, yearDates), [selectedYear, yearDates]);
  const yearOptions = useMemo(() => {
    const baseYear = today.getFullYear();
    return Array.from(new Set([selectedYear, ...Array.from({ length: 11 }, (_, index) => baseYear - 5 + index)])).sort(
      (a, b) => a - b,
    );
  }, [selectedYear, today]);
  const selectedMonthWeeks = useMemo(
    () => buildMonthCalendarWeeks(selectedYear, selectedMonth, calendar?.month_dates || []),
    [calendar?.month_dates, selectedMonth, selectedYear],
  );

  const openMonthDetail = (month) => {
    setSelectedMonth(month);
    setMonthDialogOpen(true);
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
          快速查看报销进度、出差天数和年度出差分布
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Grid container spacing={2.5}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.key}>
            <Card sx={{ height: "100%", borderRadius: 2 }}>
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
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ minHeight: 420, height: "100%", borderRadius: 2 }}>
            <CardContent sx={{ height: "100%" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    近 6 个月趋势
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    按月对比已报销金额和出差天数
                  </Typography>
                </Box>
              </Stack>
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="amount" tickFormatter={(value) => `${value}`} />
                    <YAxis yAxisId="days" orientation="right" allowDecimals={false} />
                    <Tooltip formatter={(value, name) => (name === "已报销金额" ? formatStatsAmount(value) : `${value} 天`)} />
                    <Legend />
                    <Line
                      yAxisId="amount"
                      type="monotone"
                      dataKey="reimbursed_amount"
                      name="已报销金额"
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
                查看已报销费用的类别占比
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
                    <Box
                      key={item.category}
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.75,
                        minWidth: 0,
                      }}
                    >
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
              <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="space-between"
                spacing={2}
                sx={{ mb: 2 }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    出差日历
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    全年总览，点击月份查看明细
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <IconButton size="small" onClick={() => setSelectedYear((value) => value - 1)} aria-label="上一年">
                    <ChevronLeftIcon fontSize="small" />
                  </IconButton>
                  <Select
                    size="small"
                    value={selectedYear}
                    onChange={(event) => setSelectedYear(Number(event.target.value))}
                    sx={{ minWidth: 108 }}
                  >
                    {yearOptions.map((year) => (
                      <MenuItem key={year} value={year}>
                        {year} 年
                      </MenuItem>
                    ))}
                  </Select>
                  <IconButton size="small" onClick={() => setSelectedYear((value) => value + 1)} aria-label="下一年">
                    <ChevronRightIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>

              {calendarLoading ? (
                <Stack alignItems="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <YearCalendar months={yearMonths} selectedMonth={selectedMonth} onSelectMonth={openMonthDetail} />
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    {selectedYear} 年全年出差天数：{calendar?.total_days || 0} 天
                  </Typography>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={monthDialogOpen} onClose={() => setMonthDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>{selectedYear} 年 {selectedMonth} 月出差明细</DialogTitle>
        <DialogContent>
          <MonthCalendar year={selectedYear} month={selectedMonth} weeks={selectedMonthWeeks} compact />
        </DialogContent>
      </Dialog>
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

function YearCalendar({ months, selectedMonth, onSelectMonth }) {
  return (
    <Grid container spacing={1.25}>
      {months.map((month) => (
        <Grid item xs={6} sm={4} md={3} key={month.month}>
          <Button
            fullWidth
            variant={selectedMonth === month.month ? "contained" : "outlined"}
            onClick={() => onSelectMonth(month.month)}
            sx={{ display: "block", textAlign: "left", p: 1.25, minHeight: 88 }}
          >
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" fontWeight={800}>
                  {month.label}
                </Typography>
                <Typography variant="caption">{month.activeDates.length} 天</Typography>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: 0.4,
                }}
              >
                {Array.from({ length: 31 }, (_, index) => {
                  const day = index + 1;
                  const active = month.activeDates.includes(day);
                  return (
                    <Box
                      key={day}
                      sx={{
                        height: 5,
                        borderRadius: 0.5,
                        bgcolor: active ? "currentColor" : "action.disabledBackground",
                        opacity: active ? 0.9 : 0.55,
                      }}
                    />
                  );
                })}
              </Box>
            </Stack>
          </Button>
        </Grid>
      ))}
    </Grid>
  );
}

function MonthCalendar({ year, month, weeks }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        p: 2,
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>
        {year} 年 {month} 月
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.75, mb: 1 }}>
        {WEEKDAY_LABELS.map((label) => (
          <Typography key={label} variant="caption" color="text.secondary" textAlign="center">
            {label}
          </Typography>
        ))}
      </Box>
      <Stack spacing={0.75}>
        {weeks.map((week, weekIndex) => (
          <Box key={weekIndex} sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.75 }}>
            {week.map((day, dayIndex) => (
              <Box
                key={`${weekIndex}-${dayIndex}`}
                sx={{
                  aspectRatio: "1 / 1",
                  borderRadius: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: day?.active ? "primary.main" : "background.default",
                  color: day?.active ? "primary.contrastText" : "text.primary",
                  border: day ? 1 : 0,
                  borderColor: "divider",
                  fontWeight: day?.active ? 800 : 500,
                }}
              >
                {day?.date || ""}
              </Box>
            ))}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
