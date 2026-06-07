import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Card, CardContent, Chip, CircularProgress, Grid, Stack, Typography } from "@mui/material";
import { getStatsCalendar } from "../api/client";

const SAMPLE_DATES = [
  "2025-01-05",
  "2025-01-06",
  "2025-01-07",
  "2025-01-08",
  "2025-01-09",
  "2025-01-10",
  "2025-01-11",
  "2025-01-12",
  "2025-01-13",
  "2025-03-02",
  "2025-03-03",
  "2025-03-04",
  "2025-03-05",
  "2025-03-06",
  "2025-03-07",
  "2025-03-08",
  "2025-04-06",
  "2025-04-07",
  "2025-04-08",
  "2025-04-09",
  "2025-04-10",
  "2025-04-11",
  "2025-04-12",
  "2025-04-13",
  "2025-04-14",
  "2025-04-15",
  "2025-04-16",
  "2025-04-17",
  "2025-04-18",
  "2025-04-19",
  "2025-04-20",
  "2025-04-21",
  "2025-04-22",
  "2025-05-04",
  "2025-05-05",
  "2025-05-06",
  "2025-05-07",
  "2025-05-08",
  "2025-05-09",
  "2025-05-10",
  "2025-05-11",
  "2025-05-12",
];

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const HEAT = ["#DDF4E4", "#B7E4C7", "#8FD6AA", "#62C287", "#34A466", "#1E7A49", "#B7791F", "#C05621", "#C2410C", "#991B1B"];

const keyFromDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const nextKey = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return keyFromDate(new Date(year, month - 1, day + 1));
};

const addDays = (key, count) => {
  const [year, month, day] = key.split("-").map(Number);
  return keyFromDate(new Date(year, month - 1, day + count));
};

const monthStart = (key) => {
  const [year, month] = key.split("-").map(Number);
  return keyFromDate(new Date(year, month - 1, 1));
};

const levelForDuration = (days) => Math.max(0, Math.min(9, Math.ceil(days / 3) - 1));
const colorForDuration = (days) => HEAT[levelForDuration(days)];

function groupSegments(dateValues) {
  const dates = [...new Set(dateValues)].sort();
  const segments = [];
  let current = null;

  dates.forEach((key) => {
    if (!current || key !== nextKey(current.end)) {
      current = { start: key, end: key, days: 1, dates: [key] };
      segments.push(current);
      return;
    }
    current.end = key;
    current.days += 1;
    current.dates.push(key);
  });

  return segments;
}

function buildYearDays(year, dateValues) {
  const active = new Set(dateValues);
  const segments = groupSegments(dateValues);
  const fatigueByDate = {};
  segments.forEach((segment) => {
    segment.dates.forEach((key, index) => {
      fatigueByDate[key] = {
        streak: index + 1,
        color: HEAT[levelForDuration(index + 1)],
      };
    });
  });

  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);
  const days = [];
  for (let cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    const key = keyFromDate(cursor);
    days.push({
      key,
      day: cursor.getDate(),
      month: cursor.getMonth() + 1,
      weekday: cursor.getDay(),
      active: active.has(key),
      fatigue: fatigueByDate[key],
    });
  }
  return days;
}

function splitSegmentByMonth(segment) {
  const pieces = [];
  let start = segment.start;

  while (start <= segment.end) {
    const [year, month] = start.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const pieceEnd = end < segment.end ? end : segment.end;
    const startDay = Number(start.split("-")[2]);
    const endDay = Number(pieceEnd.split("-")[2]);
    pieces.push({
      month,
      startDay,
      endDay,
      days: endDay - startDay + 1,
      segmentDays: segment.days,
    });
    start = addDays(pieceEnd, 1);
  }

  return pieces;
}

export default function CalendarDesignDemos() {
  const [dates, setDates] = useState(SAMPLE_DATES);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("样例数据");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await getStatsCalendar({ year: 2025, month: 1, startMonth: "2025-01", endMonth: "2025-12" });
        const apiDates = (response.data?.months || []).flatMap((month) => month.dates || []);
        if (active && apiDates.length > 0) {
          setDates([...new Set(apiDates.map((item) => item.slice(0, 10)))].sort());
          setSource("当前 2025 数据");
        }
      } catch {
        if (active) setSource("样例数据");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const segments = useMemo(() => groupSegments(dates), [dates]);
  const yearDays = useMemo(() => buildYearDays(2025, dates), [dates]);
  const totalDays = dates.length;
  const maxSegment = segments.reduce((max, item) => Math.max(max, item.days), 0);

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
          出差日历方案 Demo
        </Typography>
        <Typography variant="body2" color="text.secondary">
          目标从“标日期”转向“表达出差负荷”：连续越久，颜色越重，疲劳感越明显。数据来源：{source}
        </Typography>
      </Box>

      <Alert severity="info">
        这里是方案草图，不是最终 UI。你可以挑一个方向，或者说哪几个局部好，我再合并成正式版。
      </Alert>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={6}>
          <DemoCard title="方案 A：疲劳带状时间线" subtitle="把连续出差看成一段负荷条，长度和颜色共同表达辛苦程度。">
            <FatigueTimeline segments={segments} />
          </DemoCard>
        </Grid>

        <Grid item xs={12} lg={6}>
          <DemoCard title="方案 B：年度负荷热力墙" subtitle="接近 GitHub 热力图，但颜色由连续出差第几天决定，而不是次数。">
            <YearHeatWall days={yearDays} />
          </DemoCard>
        </Grid>

        <Grid item xs={12} lg={7}>
          <DemoCard title="方案 C：月份负荷泳道" subtitle="每个月一条水平泳道，连续出差会跨日期形成条带，适合看年度节奏。">
            <MonthSwimlanes segments={segments} />
          </DemoCard>
        </Grid>

        <Grid item xs={12} lg={5}>
          <DemoCard title="方案 D：疲劳摘要卡" subtitle="弱化日历细节，突出总天数、最长连续出差和高负荷区间。">
            <FatigueSummary segments={segments} totalDays={totalDays} maxSegment={maxSegment} />
          </DemoCard>
        </Grid>
      </Grid>
    </Stack>
  );
}

function DemoCard({ title, subtitle, children }) {
  return (
    <Card sx={{ height: "100%", borderRadius: 2 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={800}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {subtitle}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function FatigueTimeline({ segments }) {
  return (
    <Stack spacing={1.1}>
      {segments.map((segment, index) => (
        <Box key={`${segment.start}-${segment.end}`}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {segment.start} 至 {segment.end}
            </Typography>
            <Chip size="small" label={`${segment.days} 天`} sx={{ height: 22, bgcolor: colorForDuration(segment.days), color: segment.days >= 18 ? "#fff" : "#103D25" }} />
          </Stack>
          <Box sx={{ height: 18, borderRadius: 1, bgcolor: "rgba(15, 23, 42, 0.06)", overflow: "hidden" }}>
            <Box
              sx={{
                width: `${Math.min(100, Math.max(10, segment.days * 4.5))}%`,
                height: "100%",
                borderRadius: 1,
                bgcolor: colorForDuration(segment.days),
                opacity: 0.72 + Math.min(index, 3) * 0.05,
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function YearHeatWall({ days }) {
  const padded = [...Array.from({ length: new Date(2025, 0, 1).getDay() }, () => null), ...days];
  const weeks = [];
  for (let index = 0; index < padded.length; index += 7) weeks.push(padded.slice(index, index + 7));
  return (
    <Stack spacing={1}>
      <Box sx={{ display: "grid", gridTemplateColumns: "24px repeat(53, minmax(8px, 1fr))", gap: 0.35, overflowX: "auto", pb: 0.5 }}>
        {WEEKDAY_LABELS.map((label) => (
          <Typography key={label} variant="caption" color="text.disabled" sx={{ gridColumn: 1, fontSize: 9, lineHeight: "11px" }}>
            {label}
          </Typography>
        ))}
        {weeks.map((week, weekIndex) => (
          <Stack key={weekIndex} spacing={0.35} sx={{ gridColumn: weekIndex + 2, gridRow: "1 / span 7" }}>
            {Array.from({ length: 7 }, (_, dayIndex) => {
              const day = week[dayIndex] || null;
              return (
                <Box
                  key={`${weekIndex}-${dayIndex}`}
                  title={day?.active ? `${day.key} 连续第 ${day.fatigue?.streak} 天` : day?.key}
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: 0.35,
                    bgcolor: day?.active ? day.fatigue.color : "rgba(148, 163, 184, 0.13)",
                    opacity: day?.active ? 0.88 : 1,
                  }}
                />
              );
            })}
          </Stack>
        ))}
      </Box>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography variant="caption" color="text.secondary">
          轻
        </Typography>
        {HEAT.map((color, index) => (
          <Box key={color} sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, opacity: 0.45 + index * 0.045 }} />
        ))}
        <Typography variant="caption" color="text.secondary">
          重
        </Typography>
      </Stack>
    </Stack>
  );
}

function MonthSwimlanes({ segments }) {
  const pieces = segments.flatMap(splitSegmentByMonth);
  return (
    <Stack spacing={0.7}>
      {MONTH_LABELS.map((label, index) => {
        const month = index + 1;
        const daysInMonth = new Date(2025, month, 0).getDate();
        const monthPieces = pieces.filter((piece) => piece.month === month);
        return (
          <Stack key={label} direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary" sx={{ width: 28 }}>
              {label}
            </Typography>
            <Box sx={{ position: "relative", flex: 1, height: 18, borderRadius: 1, bgcolor: "rgba(148, 163, 184, 0.11)" }}>
              {monthPieces.map((piece) => (
                <Box
                  key={`${month}-${piece.startDay}-${piece.endDay}`}
                  sx={{
                    position: "absolute",
                    left: `${((piece.startDay - 1) / daysInMonth) * 100}%`,
                    width: `${(piece.days / daysInMonth) * 100}%`,
                    top: 3,
                    bottom: 3,
                    borderRadius: 1,
                    bgcolor: colorForDuration(piece.segmentDays),
                    opacity: 0.82,
                  }}
                />
              ))}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

function FatigueSummary({ segments, totalDays, maxSegment }) {
  const hardSegments = segments.filter((segment) => segment.days >= 10);
  return (
    <Stack spacing={2}>
      <Grid container spacing={1.5}>
        <Grid item xs={4}>
          <MetricBlock label="全年出差" value={`${totalDays}`} suffix="天" />
        </Grid>
        <Grid item xs={4}>
          <MetricBlock label="最长连续" value={`${maxSegment}`} suffix="天" />
        </Grid>
        <Grid item xs={4}>
          <MetricBlock label="高负荷段" value={`${hardSegments.length}`} suffix="段" />
        </Grid>
      </Grid>
      <Stack spacing={1}>
        {segments.slice(0, 5).map((segment) => (
          <Stack key={`${segment.start}-${segment.end}`} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: colorForDuration(segment.days) }} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {segment.start} 至 {segment.end}
            </Typography>
            <Typography variant="body2" fontWeight={800}>
              {segment.days} 天
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function MetricBlock({ label, value, suffix }) {
  return (
    <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "rgba(15, 23, 42, 0.04)" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={900}>
        {value}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.4 }}>
          {suffix}
        </Typography>
      </Typography>
    </Box>
  );
}
