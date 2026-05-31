import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import InvoiceViewer from "../components/InvoiceViewer";
import {
  createReport,
  deleteInvoice,
  getReport,
  getSettings,
  updateReport,
  updateReportStatus,
  uploadInvoice,
} from "../api/client";

const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  printed: { label: "已打印", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

const STATUS_ACTIONS = {
  draft: [{ target: "printed", label: "标记为已打印", color: "primary" }],
  printed: [
    { target: "reimbursed", label: "标记为已报销", color: "success" },
    { target: "draft", label: "退回草稿", color: "inherit" },
  ],
  reimbursed: [],
};

const EXPENSE_CATEGORIES = [
  { value: "luggage", label: "行李费" },
  { value: "city_transport", label: "市内交通费" },
  { value: "accommodation", label: "住宿费" },
  { value: "postal", label: "邮电费" },
  { value: "no_sleeper_subsidy", label: "未乘卧铺补助" },
  { value: "toll", label: "过路费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  report_date: todayStr(),
  department: "",
  employee_name: "",
  purpose: "",
  daily_subsidy: "0.00",
  advance_date_month: "",
  advance_date_day: "",
  advance_amount: "0.00",
};

const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const toMoney = (value) => Number(value || 0).toFixed(2);

const normalizeTrip = (trip, index) => ({
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
});

const makeBlankTrip = (reportDate) => {
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

const normalizeExpenseItem = (item) => ({
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

const calculateSubsidyDays = (reportDate, trips) => {
  const year = reportDate ? new Date(`${reportDate}T00:00:00`).getFullYear() : new Date().getFullYear();
  const ranges = trips
    .map((trip) => {
      const departMonth = Number(trip.depart_month);
      const departDay = Number(trip.depart_day);
      const arriveMonth = Number(trip.arrive_month);
      const arriveDay = Number(trip.arrive_day);
      const arriveYear =
        arriveMonth < departMonth || (arriveMonth === departMonth && arriveDay < departDay) ? year + 1 : year;
      const depart = makeDate(year, departMonth, departDay);
      const arrive = makeDate(arriveYear, arriveMonth, arriveDay);
      return depart && arrive ? { depart, arrive } : null;
    })
    .filter(Boolean);

  if (ranges.length === 0) return 0;
  const earliest = Math.min(...ranges.map((range) => range.depart.getTime()));
  const latest = Math.max(...ranges.map((range) => range.arrive.getTime()));
  return Math.max(0, Math.floor((latest - earliest) / 86400000) + 1);
};

export default function ReportEdit() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("draft");
  const [trips, setTrips] = useState([]);
  const [expenseItems, setExpenseItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const readonly = status === "reimbursed";

  const loadForEdit = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        const res = await getReport(id);
        if (res.success) {
          const r = res.data;
          setForm({
            report_date: r.report_date || todayStr(),
            department: r.department || "",
            employee_name: r.employee_name || "",
            purpose: r.purpose || "",
            daily_subsidy: toMoney(r.daily_subsidy),
            advance_date_month: r.advance_date_month || "",
            advance_date_day: r.advance_date_day || "",
            advance_amount: toMoney(r.advance_amount),
          });
          setStatus(r.status);
          setTrips([...(r.trips || [])].sort((a, b) => a.sort_order - b.sort_order).map(normalizeTrip));
          setExpenseItems((r.expense_items || []).map(normalizeExpenseItem));
          setInvoices(r.invoices || []);
        } else {
          setError(res.message || "加载报销单失败");
        }
      } catch (err) {
        setError(err.response?.data?.message || err.message || "加载报销单失败");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [id],
  );

  const loadDefaults = useCallback(async () => {
    try {
      const res = await getSettings();
      if (res.success && res.data) {
        setForm((prev) => ({
          ...prev,
          department: res.data.department || "",
          employee_name: res.data.employee_name || "",
          daily_subsidy: toMoney(res.data.daily_subsidy),
        }));
      }
    } catch {
      // 设置读取失败不阻塞新增，使用空默认值
    }
  }, []);

  useEffect(() => {
    if (isEdit) {
      loadForEdit();
    } else {
      setTrips([]);
      setExpenseItems([]);
      setInvoices([]);
      loadDefaults();
    }
  }, [isEdit, loadForEdit, loadDefaults]);

  const summary = useMemo(() => {
    const subsidyDays = calculateSubsidyDays(form.report_date, trips);
    const subsidyTotal = subsidyDays * Number(form.daily_subsidy || 0);
    const invoiceTotal = invoices
      .filter((invoice) => invoice.amount_confirmed)
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const total = subsidyTotal + invoiceTotal;
    const advance = Number(form.advance_amount || 0);
    return {
      subsidyDays,
      subsidyTotal,
      invoiceTotal,
      total,
      shortfall: Math.max(0, total - advance),
      surplus: Math.max(0, advance - total),
    };
  }, [form.advance_amount, form.daily_subsidy, form.report_date, invoices, trips]);

  const statusMeta = STATUS_META[status] || { label: status, color: "default" };
  const actions = STATUS_ACTIONS[status] || [];

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const buildTripPayload = () =>
    trips.map((trip, index) => ({
      id: trip.id || null,
      sort_order: index + 1,
      depart_month: Number(trip.depart_month || 1),
      depart_day: Number(trip.depart_day || 1),
      depart_hour: trip.depart_hour === "" ? null : Number(trip.depart_hour),
      depart_place: trip.depart_place?.trim() || null,
      arrive_month: Number(trip.arrive_month || 1),
      arrive_day: Number(trip.arrive_day || 1),
      arrive_hour: trip.arrive_hour === "" ? null : Number(trip.arrive_hour),
      arrive_place: trip.arrive_place?.trim() || null,
      transport: trip.transport?.trim() || null,
    }));

  const buildPayload = () => ({
    report_date: form.report_date || null,
    department: form.department.trim() || null,
    employee_name: form.employee_name.trim() || null,
    purpose: form.purpose.trim() || null,
    daily_subsidy: form.daily_subsidy === "" ? "0.00" : form.daily_subsidy,
    advance_date_month: form.advance_date_month === "" ? null : Number(form.advance_date_month),
    advance_date_day: form.advance_date_day === "" ? null : Number(form.advance_date_day),
    advance_amount: form.advance_amount === "" ? "0.00" : form.advance_amount,
    ...(isEdit
      ? {
          trips: buildTripPayload(),
          expense_items: expenseItems.map((item) => ({
            id: item.id || null,
            category: item.category,
            remark: item.remark?.trim() || null,
          })),
        }
      : {}),
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (isEdit) {
        const res = await updateReport(id, payload);
        if (res.success) {
          setToast("已保存");
          await loadForEdit({ quiet: true });
        } else {
          setError(res.message || "保存失败");
        }
      } else {
        const res = await createReport(payload);
        if (res.success) {
          navigate(`/reports/${res.data.id}/edit`, { replace: true });
          setToast("草稿已创建");
        } else {
          setError(res.message || "创建失败");
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusAction = async (target) => {
    setSaving(true);
    setError("");
    try {
      const res = await updateReportStatus(id, target);
      if (res.success) {
        setStatus(res.data.status);
        setToast("状态已更新");
      } else {
        setError(res.message || "状态更新失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "状态更新失败");
    } finally {
      setSaving(false);
    }
  };

  const updateTrip = (index, field, value) => {
    setTrips((prev) => prev.map((trip, i) => (i === index ? { ...trip, [field]: value } : trip)));
  };

  const addTrip = () => {
    setTrips((prev) => [...prev, normalizeTrip(makeBlankTrip(form.report_date), prev.length)]);
  };

  const removeTrip = (index) => {
    setTrips((prev) => prev.filter((_trip, i) => i !== index).map(normalizeTrip));
  };

  const moveTrip = (from, to) => {
    if (to < 0 || to >= trips.length || from === to) return;
    setTrips((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map(normalizeTrip);
    });
  };

  const updateExpenseItem = (category, value) => {
    setExpenseItems((prev) => prev.map((item) => (item.category === category ? { ...item, remark: value } : item)));
  };

  const invoicesForTrip = (tripId) => invoices.filter((invoice) => invoice.trip_id === tripId);
  const invoicesForCategory = (category) =>
    invoices.filter((invoice) => invoice.expense_category === category && !invoice.trip_id);

  const handleUpload = async ({ event, expenseCategory, tripId = null, key }) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(key);
    setError("");
    try {
      const res = await uploadInvoice({ reportId: id, tripId, expenseCategory, file });
      if (res.success) {
        setToast(res.data.amount_confirmed ? "发票已上传并识别金额" : "发票已上传，请确认金额");
        await loadForEdit({ quiet: true });
      } else {
        setError(res.message || "上传失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "上传失败");
    } finally {
      setUploading("");
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    setSaving(true);
    setError("");
    try {
      const res = await deleteInvoice(invoiceId);
      if (res.success) {
        setToast("发票已删除");
        await loadForEdit({ quiet: true });
      } else {
        setError(res.message || "删除发票失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "删除发票失败");
    } finally {
      setSaving(false);
    }
  };

  const renderInvoiceList = (items) => (
    <Stack spacing={1}>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          暂无发票
        </Typography>
      ) : (
        items.map((invoice) => (
          <Stack
            key={invoice.id}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{ px: 1.25, py: 1, border: 1, borderColor: "divider", borderRadius: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={600}>
                  {formatAmount(invoice.amount)}
                </Typography>
                <Chip size="small" label={invoice.file_type.toUpperCase()} />
                <Chip
                  size="small"
                  color={invoice.amount_confirmed ? "success" : "warning"}
                  label={invoice.amount_confirmed ? "已确认" : "待确认"}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {invoice.invoice_no || "无发票号码"}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5}>
              <Tooltip title="查看发票">
                <IconButton size="small" onClick={() => setSelectedInvoice(invoice)}>
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除发票">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={readonly || saving}
                    onClick={() => handleDeleteInvoice(invoice.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        ))
      )}
    </Stack>
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
        <div>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h5" fontWeight={700}>
              {isEdit ? "编辑报销单" : "新增报销单"}
            </Typography>
            {isEdit && <Chip size="small" color={statusMeta.color} label={statusMeta.label} />}
          </Stack>
          <Typography color="text.secondary">录入出差基本信息、行程、发票与预借金额。</Typography>
        </div>
        <Button component={RouterLink} to="/reports" variant="outlined">
          返回列表
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {readonly && <Alert severity="info">已报销状态为只读，不可修改。</Alert>}

      <Grid container spacing={3} alignItems="flex-start">
        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      label="报销日期"
                      type="date"
                      value={form.report_date}
                      onChange={handleChange("report_date")}
                      InputLabelProps={{ shrink: true }}
                      disabled={readonly}
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField fullWidth label="部门" value={form.department} onChange={handleChange("department")} disabled={readonly} />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField fullWidth label="出差人" value={form.employee_name} onChange={handleChange("employee_name")} disabled={readonly} />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      label="途中补贴日标准"
                      type="number"
                      value={form.daily_subsidy}
                      onChange={handleChange("daily_subsidy")}
                      disabled={readonly}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                        inputProps: { min: 0, step: "0.01" },
                      }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="出差事由"
                      value={form.purpose}
                      onChange={handleChange("purpose")}
                      disabled={readonly}
                      multiline
                      minRows={2}
                    />
                  </Grid>
                </Grid>

                <Divider sx={{ my: 3 }} />

                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <Button variant="contained" onClick={handleSave} disabled={saving || readonly}>
                    {isEdit ? "保存" : "保存草稿"}
                  </Button>
                  {isEdit &&
                    actions.map((action) => (
                      <Button
                        key={action.target}
                        variant="outlined"
                        color={action.color === "inherit" ? "inherit" : action.color}
                        onClick={() => handleStatusAction(action.target)}
                        disabled={saving}
                      >
                        {action.label}
                      </Button>
                    ))}
                </Stack>
              </CardContent>
            </Card>

            {isEdit && (
              <>
                <Stack spacing={1.5}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="h6" fontWeight={700}>
                      行程
                    </Typography>
                    <Button startIcon={<AddIcon />} variant="outlined" onClick={addTrip} disabled={readonly}>
                      新增行程
                    </Button>
                  </Stack>

                  {trips.length === 0 ? (
                    <Alert severity="info">暂无行程。</Alert>
                  ) : (
                    trips.map((trip, index) => {
                      const tripInvoices = trip.id ? invoicesForTrip(trip.id) : [];
                      const uploadKey = `trip-${index}`;
                      return (
                        <Card
                          key={trip.id || `new-${index}`}
                          draggable={!readonly}
                          onDragStart={() => setDragIndex(index)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (dragIndex !== null) moveTrip(dragIndex, index);
                            setDragIndex(null);
                          }}
                        >
                          <CardContent>
                            <Stack spacing={2}>
                              <Stack direction="row" alignItems="center" justifyContent="space-between">
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <DragIndicatorIcon color="disabled" />
                                  <Typography fontWeight={700}>行程 {index + 1}</Typography>
                                </Stack>
                                <Stack direction="row" spacing={0.5}>
                                  <Tooltip title="上移">
                                    <span>
                                      <IconButton size="small" disabled={readonly || index === 0} onClick={() => moveTrip(index, index - 1)}>
                                        <KeyboardArrowUpIcon />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                  <Tooltip title="下移">
                                    <span>
                                      <IconButton
                                        size="small"
                                        disabled={readonly || index === trips.length - 1}
                                        onClick={() => moveTrip(index, index + 1)}
                                      >
                                        <KeyboardArrowDownIcon />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                  <Tooltip title="删除行程">
                                    <span>
                                      <IconButton size="small" color="error" disabled={readonly} onClick={() => removeTrip(index)}>
                                        <DeleteIcon />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                </Stack>
                              </Stack>

                              <Grid container spacing={2}>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="出发月"
                                    type="number"
                                    value={trip.depart_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="出发日"
                                    type="number"
                                    value={trip.depart_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="出发时"
                                    type="number"
                                    value={trip.depart_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="出发地"
                                    value={trip.depart_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_place", event.target.value)}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="到达月"
                                    type="number"
                                    value={trip.arrive_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="到达日"
                                    type="number"
                                    value={trip.arrive_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="到达时"
                                    type="number"
                                    value={trip.arrive_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                  <TextField
                                    fullWidth
                                    label="到达地"
                                    value={trip.arrive_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_place", event.target.value)}
                                  />
                                </Grid>
                                <Grid item xs={12}>
                                  <TextField
                                    fullWidth
                                    label="交通工具"
                                    value={trip.transport}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "transport", event.target.value)}
                                  />
                                </Grid>
                              </Grid>

                              <Stack spacing={1}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between">
                                  <Typography variant="subtitle2">车船费发票</Typography>
                                  <Button
                                    component="label"
                                    size="small"
                                    startIcon={<CloudUploadIcon />}
                                    disabled={readonly || !trip.id || uploading === uploadKey}
                                  >
                                    上传
                                    <input
                                      hidden
                                      type="file"
                                      accept=".xml,.pdf,.ofd,image/*"
                                      onChange={(event) =>
                                        handleUpload({
                                          event,
                                          expenseCategory: "transport_fare",
                                          tripId: trip.id,
                                          key: uploadKey,
                                        })
                                      }
                                    />
                                  </Button>
                                </Stack>
                                {renderInvoiceList(tripInvoices)}
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </Stack>

                <Stack spacing={1.5}>
                  <Typography variant="h6" fontWeight={700}>
                    其他费用
                  </Typography>
                  {EXPENSE_CATEGORIES.map((category) => {
                    const item = expenseItems.find((expenseItem) => expenseItem.category === category.value) || {
                      category: category.value,
                      remark: "",
                    };
                    const uploadKey = `expense-${category.value}`;
                    return (
                      <Card key={category.value}>
                        <CardContent>
                          <Stack spacing={2}>
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              alignItems={{ xs: "stretch", sm: "center" }}
                              justifyContent="space-between"
                              spacing={1.5}
                            >
                              <Box>
                                <Typography fontWeight={700}>{category.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {formatAmount(item.amount)} / {item.invoice_count || 0} 张
                                </Typography>
                              </Box>
                              <Button component="label" startIcon={<CloudUploadIcon />} disabled={readonly || uploading === uploadKey}>
                                上传
                                <input
                                  hidden
                                  type="file"
                                  accept=".xml,.pdf,.ofd,image/*"
                                  onChange={(event) =>
                                    handleUpload({
                                      event,
                                      expenseCategory: category.value,
                                      key: uploadKey,
                                    })
                                  }
                                />
                              </Button>
                            </Stack>
                            <TextField
                              fullWidth
                              label="备注"
                              value={item.remark || ""}
                              disabled={readonly}
                              onChange={(event) => updateExpenseItem(category.value, event.target.value)}
                            />
                            {renderInvoiceList(invoicesForCategory(category.value))}
                          </Stack>
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>
              </>
            )}
          </Stack>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ position: { md: "sticky" }, top: 16 }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={700}>
                  费用汇总
                </Typography>
                <Grid container spacing={1.5}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      label="预借月"
                      type="number"
                      value={form.advance_date_month}
                      disabled={readonly}
                      onChange={handleChange("advance_date_month")}
                      inputProps={{ min: 1, max: 12 }}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      label="预借日"
                      type="number"
                      value={form.advance_date_day}
                      disabled={readonly}
                      onChange={handleChange("advance_date_day")}
                      inputProps={{ min: 1, max: 31 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="预借金额"
                      type="number"
                      value={form.advance_amount}
                      disabled={readonly}
                      onChange={handleChange("advance_amount")}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                        inputProps: { min: 0, step: "0.01" },
                      }}
                    />
                  </Grid>
                </Grid>

                <Divider />

                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">补贴天数</Typography>
                    <Typography fontWeight={700}>{summary.subsidyDays} 天</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">途中补贴</Typography>
                    <Typography fontWeight={700}>{formatAmount(summary.subsidyTotal)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">已确认发票</Typography>
                    <Typography fontWeight={700}>{formatAmount(summary.invoiceTotal)}</Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={700}>报销总金额</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.total)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">应补</Typography>
                    <Typography fontWeight={700}>{formatAmount(summary.shortfall)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">应退</Typography>
                    <Typography fontWeight={700}>{formatAmount(summary.surplus)}</Typography>
                  </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <InvoiceViewer
        invoice={selectedInvoice}
        open={Boolean(selectedInvoice)}
        onClose={() => setSelectedInvoice(null)}
        onUpdated={() => loadForEdit({ quiet: true })}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2500}
        onClose={() => setToast("")}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
