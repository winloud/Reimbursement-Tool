import { useState, useMemo } from "react";

// ============================================================
// DESIGN TOKENS & THEME
// ============================================================
const LIGHT = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F2F5",
  border: "#E4E7ED",
  borderLight: "#F0F2F5",
  text: "#1A1D23",
  textSecondary: "#5C6370",
  textMuted: "#9DA5B4",
  accent: "#1A56DB",
  accentLight: "#EBF0FF",
  accentHover: "#1447C0",
  success: "#0B9E5C",
  successLight: "#E6F7F0",
  warning: "#D97706",
  warningLight: "#FEF3C7",
  danger: "#DC2626",
  dangerLight: "#FEE2E2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  shadowLg: "0 12px 32px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06)",
};

const DARK = {
  bg: "#0F1117",
  surface: "#1A1D23",
  surfaceAlt: "#22262F",
  border: "#2C3040",
  borderLight: "#252933",
  text: "#F0F2F5",
  textSecondary: "#9DA5B4",
  textMuted: "#5C6370",
  accent: "#4B7BF5",
  accentLight: "#1A2444",
  accentHover: "#6B97FF",
  success: "#10B981",
  successLight: "#0A2E20",
  warning: "#F59E0B",
  warningLight: "#2D2000",
  danger: "#EF4444",
  dangerLight: "#2D0A0A",
  shadow: "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
  shadowMd: "0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)",
  shadowLg: "0 12px 32px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.4)",
};

// ============================================================
// MOCK DATA
// ============================================================
const MOCK_REPORTS = [
  { id: 1, purpose: "北京项目前期勘察", departDate: "2025-03-10", days: 4, total: 3280.50, status: "reimbursed", department: "工程部", employee: "张伟" },
  { id: 2, purpose: "上海客户验收", departDate: "2025-04-18", days: 3, total: 2156.00, status: "printed", department: "工程部", employee: "张伟" },
  { id: 3, purpose: "成都技术交流会议", departDate: "2025-05-06", days: 5, total: 4520.80, status: "draft", department: "工程部", employee: "张伟" },
  { id: 4, purpose: "广州供应商审核", departDate: "2025-05-20", days: 2, total: 1890.00, status: "draft", department: "工程部", employee: "张伟" },
];

const EXPENSE_CATEGORIES = [
  { key: "luggage", label: "行李费" },
  { key: "city_transport", label: "市内车费" },
  { key: "accommodation", label: "住宿费" },
  { key: "postal", label: "邮电费" },
  { key: "no_sleeper", label: "不买卧铺补贴" },
  { key: "toll", label: "过路费" },
  { key: "fuel", label: "油补" },
];

const STATUS_CONFIG = {
  draft: { label: "草稿", color: "#9DA5B4", bg: "surfaceAlt" },
  printed: { label: "已打印", color: "#D97706", bgKey: "warningLight" },
  reimbursed: { label: "已报销", color: "#0B9E5C", bgKey: "successLight" },
};

const PRESET_TRANSPORTS = ["飞机", "高铁/动车", "网约车", "自驾"];

const formatCurrency = (amount, digits = 0) => `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const parseDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

// ============================================================
// ICONS (inline SVG)
// ============================================================
const Icon = ({ name, size = 16, color = "currentColor" }) => {
  const icons = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    sun: <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    chevronRight: <polyline points="9 18 15 12 9 6"/>,
    chevronLeft: <polyline points="15 18 9 12 15 6"/>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    trendUp: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></>,
    plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ============================================================
// BASE COMPONENTS
// ============================================================
const Card = ({ children, style, t }) => (
  <div style={{
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    boxShadow: t.shadow,
    ...style
  }}>
    {children}
  </div>
);

const Badge = ({ status, t }) => {
  const cfg = STATUS_CONFIG[status];
  const bgMap = { draft: t.surfaceAlt, printed: t.warningLight, reimbursed: t.successLight };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: bgMap[status], color: cfg.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, display: "inline-block" }} />
      {cfg.label}
    </span>
  );
};

const Btn = ({ children, variant = "primary", onClick, style, t, icon, size = "md" }) => {
  const [hover, setHover] = useState(false);
  const pad = size === "sm" ? "6px 14px" : size === "lg" ? "12px 24px" : "9px 18px";
  const fs = size === "sm" ? 13 : size === "lg" ? 15 : 14;

  const styles = {
    primary: { bg: hover ? t.accentHover : t.accent, color: "#fff", border: "none" },
    secondary: { bg: hover ? t.surfaceAlt : t.surface, color: t.text, border: `1px solid ${t.border}` },
    ghost: { bg: hover ? t.surfaceAlt : "transparent", color: t.textSecondary, border: "none" },
    danger: { bg: hover ? "#b91c1c" : t.dangerLight, color: t.danger, border: "none" },
  };
  const s = styles[variant];
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: pad, borderRadius: 8, fontSize: fs, fontWeight: 500,
        cursor: "pointer", transition: "all 0.15s",
        background: s.bg, color: s.color, border: s.border,
        fontFamily: "inherit",
        ...style
      }}>
      {icon && <Icon name={icon} size={14} color="currentColor" />}
      {children}
    </button>
  );
};

const StatCard = ({ label, value, sub, icon, color, t }) => (
  <Card t={t} style={{ padding: "20px 24px", flex: 1, minWidth: 180 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 13, color: t.textSecondary, marginBottom: 8, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: t.text, letterSpacing: "-0.5px", lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6 }}>{sub}</div>}
      </div>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={color} />
      </div>
    </div>
  </Card>
);

// ============================================================
// MINI CHART (pure CSS bar chart)
// ============================================================
const MiniBarChart = ({ data, t }) => {
  const [hoverIndex, setHoverIndex] = useState(null);
  const max = Math.max(...data.map(d => d.val), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 116, padding: "8px 4px 0" }}>
      {data.map((d, i) => {
        const active = hoverIndex === i || d.active;
        return (
          <div key={i}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, position: "relative", cursor: "pointer" }}>
            <div style={{
              position: "absolute", top: -4, transform: active ? "translateY(-2px)" : "translateY(4px)",
              opacity: hoverIndex === i ? 1 : 0, pointerEvents: "none", transition: "all 0.18s",
              background: t.text, color: t.surface, borderRadius: 6, padding: "4px 7px", fontSize: 11,
              whiteSpace: "nowrap", boxShadow: t.shadowMd, zIndex: 2
            }}>{formatCurrency(d.val)}</div>
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", paddingTop: 22 }}>
              <div style={{
                width: "100%", borderRadius: "5px 5px 0 0",
                background: active ? t.accent : t.surfaceAlt,
                height: `${(d.val / max) * 68}px`, minHeight: 5,
                transform: active ? "translateY(-4px) scaleX(1.06)" : "translateY(0) scaleX(1)",
                boxShadow: active ? `0 8px 18px ${t.accent}44` : "none",
                transition: "height 0.3s, transform 0.18s, background 0.18s, box-shadow 0.18s"
              }} />
            </div>
            <div style={{ fontSize: 11, color: active ? t.accent : t.textMuted, fontWeight: active ? 700 : 500 }}>{d.label}</div>
            <div style={{ fontSize: 10, color: t.textMuted }}>{formatCurrency(d.val)}</div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================
// DONUT CHART (SVG)
// ============================================================
const DonutChart = ({ data, t }) => {
  const [hoverIndex, setHoverIndex] = useState(null);
  const size = 128, cx = 64, cy = 64, r = 44, stroke = 16;
  const circ = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.val, 0);
  let offset = 0;
  const COLORS = [t.accent, t.success, t.warning, "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={size} height={size}>
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {data.map((d, i) => {
            const pct = total > 0 ? d.val / total : 0;
            const dash = pct * circ;
            const gap = circ - dash;
            const active = hoverIndex === i;
            const seg = (
              <circle key={i} cx={cx} cy={cy} r={active ? r + 2 : r}
                fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={active ? stroke + 2 : stroke}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset * circ}
                opacity={hoverIndex === null || active ? 1 : 0.35}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                style={{ transition: "all 0.2s", cursor: "pointer" }}
              />
            );
            offset += pct;
            return seg;
          })}
        </g>
        <circle cx={cx} cy={cy} r={r - stroke / 2 - 2} fill={t.surface} />
        <text x={cx} y={cy - 5} textAnchor="middle" fill={t.text} fontSize="13" fontWeight="700">{hoverIndex !== null ? formatCurrency(data[hoverIndex].val) : formatCurrency(total)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill={t.textMuted} fontSize="10">{hoverIndex !== null ? data[hoverIndex].label : "合计"}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 126 }}>
        {data.map((d, i) => {
          const active = hoverIndex === i;
          return (
            <div key={i}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              style={{
                display: "grid", gridTemplateColumns: "10px 1fr auto", alignItems: "center", gap: 8,
                fontSize: 12, padding: "4px 6px", borderRadius: 7, cursor: "pointer",
                background: active ? t.surfaceAlt : "transparent",
                transform: active ? "translateX(3px)" : "none",
                transition: "all 0.15s"
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <span style={{ color: active ? t.text : t.textSecondary, fontWeight: active ? 700 : 400 }}>{d.label}</span>
              <span style={{ color: t.text, fontWeight: 700 }}>{formatCurrency(d.val)} · {d.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================
// CALENDAR VIEW
// ============================================================
const CalendarView = ({ t, reports }) => {
  const [selectedYear, setSelectedYear] = useState(2025);
  const [selectedMonth, setSelectedMonth] = useState(5);
  const days = ["一","二","三","四","五","六","日"];
  const yearOptions = Array.from(new Set(reports.map(r => parseDate(r.departDate).getFullYear()))).sort((a, b) => b - a);

  const { tripDays, summary } = useMemo(() => {
    const keys = new Set();
    const reportIds = new Set();
    let total = 0;
    reports.forEach(report => {
      const start = parseDate(report.departDate);
      let touchesSelectedMonth = false;
      for (let i = 0; i < report.days; i += 1) {
        const current = addDays(start, i);
        if (current.getFullYear() === selectedYear && current.getMonth() + 1 === selectedMonth) {
          keys.add(dateKey(current));
          touchesSelectedMonth = true;
        }
      }
      if (touchesSelectedMonth) {
        reportIds.add(report.id);
        total += report.total;
      }
    });
    return { tripDays: keys, summary: { trips: reportIds.size, days: keys.size, total } };
  }, [reports, selectedYear, selectedMonth]);

  const datesInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay();
  const leadingBlanks = (firstDay + 6) % 7;
  const dates = Array.from({length: datesInMonth}, (_, i) => i + 1);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{
          flex: 1, padding: "7px 8px", borderRadius: 7, border: `1px solid ${t.border}`,
          background: t.surface, color: t.text, fontFamily: "inherit", fontSize: 12, outline: "none"
        }}>
          {yearOptions.map(year => <option key={year} value={year}>{year}年</option>)}
        </select>
        <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))} style={{
          flex: 1, padding: "7px 8px", borderRadius: 7, border: `1px solid ${t.border}`,
          background: t.surface, color: t.text, fontFamily: "inherit", fontSize: 12, outline: "none"
        }}>
          {Array.from({length: 12}, (_, i) => i + 1).map(month => <option key={month} value={month}>{month}月</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
        {[
          { label: "出差次数", val: `${summary.trips} 次` },
          { label: "出差天数", val: `${summary.days} 天` },
          { label: "报销金额", val: formatCurrency(summary.total) },
        ].map(item => (
          <div key={item.label} style={{ background: t.surfaceAlt, borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: t.textMuted, marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{item.val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {days.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, color: t.textMuted, padding: "4px 0", fontWeight: 600 }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {Array.from({length: leadingBlanks}, (_, i) => <div key={`blank-${i}`} />)}
        {dates.map(d => {
          const key = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isTripDay = tripDays.has(key);
          return (
            <div key={d} title={isTripDay ? "出差日" : ""} style={{
              textAlign: "center", fontSize: 12, padding: "5px 0", borderRadius: 6,
              background: isTripDay ? t.accentLight : "transparent",
              color: isTripDay ? t.accent : t.text,
              fontWeight: isTripDay ? 700 : 400,
              cursor: "default",
              transition: "all 0.15s"
            }}>{d}</div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================
// PAGE: DASHBOARD
// ============================================================
const DashboardPage = ({ t, onNavigate }) => {
  const monthData = useMemo(() => {
    const base = new Date(2025, 5, 1);
    return Array.from({length: 6}, (_, idx) => {
      const date = new Date(base.getFullYear(), base.getMonth() - 5 + idx, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const val = MOCK_REPORTS
        .filter(r => {
          const d = parseDate(r.departDate);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        })
        .reduce((sum, r) => sum + r.total, 0);
      return { label: `${month}月`, val, active: month === 5 };
    });
  }, []);
  const totalCategoryAmount = 4200 + 3300 + 2200 + 1300;
  const catData = [
    { label: "交通费", val: 4200 },
    { label: "住宿费", val: 3300 },
    { label: "补贴", val: 2200 },
    { label: "其他", val: 1300 },
  ].map(item => ({ ...item, pct: Math.round(item.val / totalCategoryAmount * 100) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Stats Row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="本月报销金额" value="¥6,046" sub="共 2 笔报销单" icon="receipt" color={t.accent} t={t} />
        <StatCard label="今年报销金额" value="¥11,847" sub="共 4 笔报销单" icon="trendUp" color={t.success} t={t} />
        <StatCard label="本月出差天数" value="9 天" sub="2 次出差" icon="plane" color={t.warning} t={t} />
        <StatCard label="今年出差天数" value="14 天" sub="累计 4 次出差" icon="calendar" color="#8B5CF6" t={t} />
      </div>

      {/* Charts Row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Bar Chart */}
        <Card t={t} style={{ flex: 1.5, minWidth: 280, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>月度报销趋势</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>近 6 个月报销金额</div>
          </div>
          <MiniBarChart data={monthData} t={t} />
        </Card>

        {/* Donut Chart */}
        <Card t={t} style={{ flex: 1, minWidth: 260, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>费用类别分布</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>今年累计</div>
          </div>
          <DonutChart data={catData} t={t} />
        </Card>

        {/* Calendar */}
        <Card t={t} style={{ flex: 1, minWidth: 240, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>出差日历</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>选择年份、月份查看汇总 · 蓝色为出差日</div>
          </div>
          <CalendarView t={t} reports={MOCK_REPORTS} />
        </Card>
      </div>

      {/* Recent Reports */}
      <Card t={t}>
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>最近报销单</div>
          <Btn variant="ghost" t={t} size="sm" onClick={() => onNavigate("list")}>查看全部 →</Btn>
        </div>
        <div>
          {MOCK_REPORTS.slice(0, 3).map((r, i) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", padding: "14px 24px",
              borderBottom: i < 2 ? `1px solid ${t.borderLight}` : "none",
              gap: 16
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: t.accentLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="receipt" size={16} color={t.accent} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{r.purpose}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{r.departDate} · {r.days}天</div>
              </div>
              <Badge status={r.status} t={t} />
              <div style={{ fontSize: 15, fontWeight: 700, color: t.text, minWidth: 80, textAlign: "right" }}>¥{r.total.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ============================================================
// PAGE: REPORT LIST
// ============================================================
const ReportListPage = ({ t, onNavigate, onEdit }) => {
  const [filter, setFilter] = useState("all");
  const [hoverRow, setHoverRow] = useState(null);

  const tabs = [
    { key: "all", label: "全部", count: MOCK_REPORTS.length },
    { key: "draft", label: "草稿", count: MOCK_REPORTS.filter(r=>r.status==="draft").length },
    { key: "printed", label: "已打印", count: MOCK_REPORTS.filter(r=>r.status==="printed").length },
    { key: "reimbursed", label: "已报销", count: MOCK_REPORTS.filter(r=>r.status==="reimbursed").length },
  ];

  const filtered = filter === "all" ? MOCK_REPORTS : MOCK_REPORTS.filter(r => r.status === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>报销单管理</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: t.textMuted }}>共 {MOCK_REPORTS.length} 条记录，按出发日期排序</p>
        </div>
        <Btn icon="plus" t={t} onClick={() => onNavigate("new")}>新增报销单</Btn>
      </div>

      <Card t={t}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${t.border}`, padding: "0 24px" }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              style={{
                padding: "14px 16px 12px", fontSize: 14, cursor: "pointer",
                background: "none", border: "none", fontFamily: "inherit",
                color: filter === tab.key ? t.accent : t.textSecondary,
                borderBottom: filter === tab.key ? `2px solid ${t.accent}` : "2px solid transparent",
                fontWeight: filter === tab.key ? 600 : 400,
                display: "flex", alignItems: "center", gap: 6,
                transition: "color 0.15s"
              }}>
              {tab.label}
              <span style={{
                background: filter === tab.key ? t.accentLight : t.surfaceAlt,
                color: filter === tab.key ? t.accent : t.textMuted,
                padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 600
              }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "160px 1fr 80px 120px 120px 140px",
            padding: "10px 24px", background: t.surfaceAlt,
            fontSize: 12, fontWeight: 600, color: t.textMuted, gap: 16
          }}>
            <span>出发日期</span>
            <span>出差事由</span>
            <span>天数</span>
            <span>报销总金额</span>
            <span>状态</span>
            <span style={{ textAlign: "right" }}>操作</span>
          </div>

          {filtered.map((r, i) => (
            <div key={r.id}
              onMouseEnter={() => setHoverRow(r.id)}
              onMouseLeave={() => setHoverRow(null)}
              style={{
                display: "grid", gridTemplateColumns: "160px 1fr 80px 120px 120px 140px",
                padding: "16px 24px", gap: 16, alignItems: "center",
                borderBottom: i < filtered.length - 1 ? `1px solid ${t.borderLight}` : "none",
                background: hoverRow === r.id ? t.surfaceAlt : "transparent",
                transition: "background 0.15s"
              }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>{r.departDate}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{r.purpose}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{r.department} · {r.employee}</div>
              </div>
              <span style={{ fontSize: 13, color: t.textSecondary }}>{r.days} 天</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>¥{r.total.toFixed(2)}</span>
              <Badge status={r.status} t={t} />
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                {r.status !== "reimbursed" && (
                  <Btn variant="ghost" t={t} size="sm" icon="edit" onClick={() => onEdit(r)}>编辑</Btn>
                )}
                <Btn variant="ghost" t={t} size="sm" icon="download">PDF</Btn>
                {r.status === "draft" && (
                  <Btn variant="ghost" t={t} size="sm" icon="trash" style={{ color: t.danger }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ============================================================
// PAGE: NEW / EDIT REPORT (single-page V1.1 form)
// ============================================================
const TripCard = ({ trip, index, t, onRemove }) => {
  const [transport, setTransport] = useState(PRESET_TRANSPORTS.includes(trip?.transport) ? trip.transport : "自定义");
  const [customTransport, setCustomTransport] = useState(PRESET_TRANSPORTS.includes(trip?.transport) ? "" : (trip?.transport || ""));
  const requiredMark = <span style={{ color: t.danger, marginLeft: 2 }}>*</span>;
  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: 7, fontSize: 13,
    border: `1px solid ${t.border}`, background: t.surface, color: t.text,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box"
  };
  const timeFields = [
    { placeholder: "月", required: true },
    { placeholder: "日", required: true },
    { placeholder: "时（选填）", required: false },
  ];

  return (
    <Card t={t} style={{ padding: 20, marginBottom: 12, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: t.accentLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: t.accent }}>{index + 1}</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>行程 {index + 1}</span>
          <span style={{ fontSize: 11, color: t.textMuted }}>月、日必填；时可不填</span>
        </div>
        <button onClick={() => onRemove(index)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, padding: 4 }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, fontWeight: 500 }}>出发{requiredMark}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {timeFields.map((field, i) => (
              <input key={field.placeholder} required={field.required} placeholder={field.placeholder} style={inputStyle} defaultValue={trip?.depart?.[i] || ""} />
            ))}
          </div>
          <input placeholder="出发地点（手动输入）" style={{ ...inputStyle, marginTop: 6 }} defaultValue={trip?.departPlace || ""} />
        </div>
        <div style={{ color: t.textMuted, paddingBottom: 28 }}>
          <Icon name="chevronRight" size={20} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, fontWeight: 500 }}>到达{requiredMark}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {timeFields.map((field, i) => (
              <input key={field.placeholder} required={field.required} placeholder={field.placeholder} style={inputStyle} defaultValue={trip?.arrive?.[i] || ""} />
            ))}
          </div>
          <input placeholder="到达地点（手动输入）" style={{ ...inputStyle, marginTop: 6 }} defaultValue={trip?.arrivePlace || ""} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, fontWeight: 500 }}>交通工具</div>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={transport} onChange={(e) => setTransport(e.target.value)} style={inputStyle}>
              {PRESET_TRANSPORTS.map(item => <option key={item} value={item}>{item}</option>)}
              <option value="自定义">自定义</option>
            </select>
            {transport === "自定义" && (
              <input placeholder="输入其他交通工具" value={customTransport} onChange={(e) => setCustomTransport(e.target.value)} style={inputStyle} />
            )}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: t.textMuted }}>可从预设选择，也可自定义扩展。</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6, fontWeight: 500 }}>车船费发票</div>
          <div style={{
            border: `1.5px dashed ${t.border}`, borderRadius: 7, padding: "7px 12px",
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            background: t.surfaceAlt, fontSize: 13, color: t.textSecondary
          }}>
            <Icon name="upload" size={13} color={t.accent} />
            <span>上传发票</span>
            <span style={{ marginLeft: "auto", color: t.textMuted, fontSize: 12 }}>0张 ¥0.00</span>
          </div>
        </div>
      </div>
    </Card>
  );
};

const ExpenseItemCard = ({ item, t }) => (
  <div style={{
    display: "flex", alignItems: "center", padding: "12px 16px",
    border: `1px solid ${t.border}`, borderRadius: 9, marginBottom: 8,
    background: t.surface, gap: 12
  }}>
    <div style={{ width: 80, fontSize: 13, fontWeight: 500, color: t.text }}>{item.label}</div>
    <div style={{ flex: 1, fontSize: 12, color: t.textMuted }}>
      {item.count > 0 ? `${item.count} 张发票 · ¥${item.amount.toFixed(2)}` : "暂无发票"}
    </div>
    <div style={{
      border: `1.5px dashed ${t.border}`, borderRadius: 7, padding: "6px 14px",
      display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
      background: t.surfaceAlt, fontSize: 13, color: t.accent, flexShrink: 0
    }}>
      <Icon name="upload" size={12} color={t.accent} />
      上传发票
    </div>
  </div>
);

const NewReportPage = ({ t, onBack }) => {
  const [trips, setTrips] = useState([
    { depart: ["5","20","08"], departPlace: "深圳", arrive: ["5","20","11"], arrivePlace: "成都", transport: "高铁/动车" },
    { depart: ["5","22",""], departPlace: "成都", arrive: ["5","22","17"], arrivePlace: "深圳", transport: "飞机" },
  ]);

  const expenseItems = [
    { key: "luggage", label: "行李费", count: 0, amount: 0 },
    { key: "city_transport", label: "市内车费", count: 2, amount: 186.00 },
    { key: "accommodation", label: "住宿费", count: 2, amount: 980.00 },
    { key: "postal", label: "邮电费", count: 0, amount: 0 },
    { key: "no_sleeper", label: "不买卧铺补贴", count: 0, amount: 0 },
    { key: "toll", label: "过路费", count: 0, amount: 0 },
    { key: "fuel", label: "油补", count: 0, amount: 0 },
  ];

  const totalAmount = 186 + 980 + 1200 + 3 * 80;
  const advance = 1000;
  const shortfall = Math.max(0, totalAmount - advance);
  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
    border: `1px solid ${t.border}`, background: t.surface, color: t.text,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box"
  };
  const summaryRows = [
    { label: "车船费", val: "¥1,200.00", sub: "行程发票 3 张" },
    { label: "市内车费", val: "¥186.00", sub: "2 张发票" },
    { label: "住宿费", val: "¥980.00", sub: "2 张发票" },
    { label: "途中补贴", val: "¥240.00", sub: "3天 × ¥80/天" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: t.textSecondary, padding: 4, display: "flex" }}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>新增报销单</h2>
            <span style={{ padding: "2px 8px", borderRadius: 999, background: t.accentLight, color: t.accent, fontSize: 11, fontWeight: 700 }}>V1.1 单页录入</span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: t.textMuted }}>基本信息、行程和发票在一页完成；报销日期将在生成 PDF 时自动取当天日期。</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <Card t={t} style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: t.text }}>基本信息</h3>
                <div style={{ marginTop: 6, fontSize: 12, color: t.textMuted }}>报销日期不用填写，生成 PDF 时自动写入当前日期。</div>
              </div>
              <div style={{ padding: "7px 10px", borderRadius: 8, background: t.successLight, color: t.success, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                PDF 日期：自动生成
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                { label: "出差事由", val: "成都技术交流会议", type: "text" },
                { label: "部门", val: "工程部", type: "text" },
                { label: "出差人", val: "张伟", type: "text" },
                ].map(f => (
                  <div key={f.label}>
                    <label style={{ fontSize: 13, fontWeight: 500, color: t.textSecondary, display: "block", marginBottom: 6 }}>{f.label}</label>
                    <input type={f.type} defaultValue={f.val} style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
                      border: `1px solid ${t.border}`, background: t.surface, color: t.text,
                      fontFamily: "inherit", outline: "none", boxSizing: "border-box"
                    }} />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: t.textSecondary, display: "block", marginBottom: 6 }}>途中补贴（元/天）</label>
                  <input type="number" defaultValue="80" style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
                    border: `1px solid ${t.border}`, background: t.surface, color: t.text,
                    fontFamily: "inherit", outline: "none", boxSizing: "border-box"
                  }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: t.textSecondary, display: "block", marginBottom: 6 }}>预支旅费（元）</label>
                  <input type="number" defaultValue="1000" style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 14,
                    border: `1px solid ${t.border}`, background: t.surface, color: t.text,
                    fontFamily: "inherit", outline: "none", boxSizing: "border-box"
                  }} />
                </div>
              </div>
            </Card>

          <Card t={t} style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: t.text }}>行程列表</h3>
                <div style={{ marginTop: 4, fontSize: 12, color: t.textMuted }}>出发/到达的月、日为必填；小时可以留空。</div>
              </div>
              <Btn variant="secondary" t={t} size="sm" icon="plus" onClick={() => setTrips([...trips, { transport: PRESET_TRANSPORTS[0] }])}>添加行程</Btn>
            </div>
            {trips.map((trip, i) => (
              <TripCard key={i} trip={trip} index={i} t={t} onRemove={(idx) => setTrips(trips.filter((_, j) => j !== idx))} />
            ))}
          </Card>

          <Card t={t} style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: t.text }}>其他费用发票</h3>
            {expenseItems.map(item => <ExpenseItemCard key={item.key} item={item} t={t} />)}
          </Card>

          <Card t={t} style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 600, color: t.text }}>费用确认</h3>
              {summaryRows.map((row, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", padding: "12px 0",
                  borderBottom: `1px solid ${i < summaryRows.length - 1 ? t.borderLight : t.border}`
                }}>
                  <div>
                    <div style={{ fontSize: 14, color: t.text }}>{row.label}</div>
                    <div style={{ fontSize: 12, color: t.textMuted }}>{row.sub}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{row.val}</div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 0", marginTop: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>报销总金额</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.accent }}>¥{totalAmount.toFixed(2)}</div>
              </div>
              <div style={{ marginTop: 16, padding: 16, background: t.surfaceAlt, borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: t.textSecondary }}>预支旅费</span>
                  <span style={{ fontSize: 13, color: t.text }}>¥{advance.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.success }}>补领不足</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.success }}>¥{shortfall.toFixed(2)}</span>
                </div>
              </div>
          </Card>
        </div>

        {/* Summary sidebar */}
        <div style={{ width: 240, flexShrink: 0, flexGrow: 1, maxWidth: 280 }}>
          <Card t={t} style={{ padding: 20, position: "sticky", top: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 14 }}>费用汇总</div>
            {summaryRows.map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: t.textSecondary }}>{row.label}</span>
                <span style={{ color: t.text, fontWeight: 500 }}>{row.val}</span>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: t.textSecondary }}>预支旅费</span>
                <span style={{ fontSize: 13, color: t.text }}>¥{advance.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>合计</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: t.accent }}>¥{totalAmount.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.success }}>补领不足</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.success }}>¥{shortfall.toFixed(2)}</span>
              </div>
            </div>
            <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: t.accentLight, color: t.accent, fontSize: 12, lineHeight: 1.5 }}>
              点击“生成 PDF”时自动写入当天报销日期。
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom actions */}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4 }}>
        <Btn variant="secondary" t={t} onClick={onBack}>取消</Btn>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="secondary" t={t}>保存草稿</Btn>
          <Btn t={t} icon="download">生成 PDF</Btn>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// SIDEBAR NAV
// ============================================================
const Sidebar = ({ current, onNavigate, t, dark, onToggleDark }) => {
  const navItems = [
    { key: "dashboard", icon: "dashboard", label: "总览看板" },
    { key: "list", icon: "list", label: "报销单管理" },
  ];
  return (
    <div style={{
      width: 220, flexShrink: 0, height: "100vh", position: "sticky", top: 0,
      background: t.surface, borderRight: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: t.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="receipt" size={16} color="#fff" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>报销管理</div>
              <span style={{ padding: "1px 6px", borderRadius: 999, background: t.accentLight, color: t.accent, fontSize: 10, fontWeight: 800 }}>V1.1</span>
            </div>
            <div style={{ fontSize: 11, color: t.textMuted }}>出差旅费报销工具</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 12px" }}>
        {navItems.map(item => {
          const active = current === item.key || (current === "new" && item.key === "list");
          return (
            <button key={item.key} onClick={() => onNavigate(item.key)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                background: active ? t.accentLight : "transparent",
                color: active ? t.accent : t.textSecondary,
                border: "none", cursor: "pointer", fontSize: 14,
                fontWeight: active ? 600 : 400, fontFamily: "inherit",
                transition: "all 0.15s", textAlign: "left"
              }}>
              <Icon name={item.icon} size={16} color={active ? t.accent : t.textSecondary} />
              {item.label}
            </button>
          );
        })}

        <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 12, paddingTop: 12 }}>
          <button onClick={() => onNavigate("new")}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8,
              background: t.accent, color: "#fff",
              border: "none", cursor: "pointer", fontSize: 14,
              fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s"
            }}>
            <Icon name="plus" size={16} color="#fff" />
            新增报销单
          </button>
        </div>
      </nav>

      {/* Bottom */}
      <div style={{ padding: "16px 12px", borderTop: `1px solid ${t.border}` }}>
        <button onClick={onToggleDark} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", borderRadius: 8, background: t.surfaceAlt,
          border: "none", cursor: "pointer", fontSize: 13, color: t.textSecondary,
          fontFamily: "inherit"
        }}>
          <Icon name={dark ? "sun" : "moon"} size={15} color={t.textSecondary} />
          {dark ? "切换浅色模式" : "切换深色模式"}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// APP ROOT
// ============================================================
export default function App() {
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState("dashboard");
  const t = dark ? DARK : LIGHT;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: t.bg, fontFamily: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif" }}>
      <Sidebar current={page} onNavigate={setPage} t={t} dark={dark} onToggleDark={() => setDark(!dark)} />
      <main style={{ flex: 1, padding: "32px 36px", overflowY: "auto", minHeight: "100vh" }}>
        {page === "dashboard" && <DashboardPage t={t} onNavigate={setPage} />}
        {page === "list" && <ReportListPage t={t} onNavigate={setPage} onEdit={() => setPage("new")} />}
        {page === "new" && <NewReportPage t={t} onBack={() => setPage("list")} />}
      </main>
    </div>
  );
}
