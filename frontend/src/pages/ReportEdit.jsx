import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate, useParams } from "react-router-dom";
import InvoiceViewer from "../components/InvoiceViewer";
import { useNavigationGuard } from "../navigationGuard";
import {
  createReport,
  deleteInvoice,
  deleteReport,
  getReport,
  getSettings,
  updateReport,
  updateReportStatus,
  uploadInvoice,
} from "../api/client";
import {
  STATUS_ACTIONS,
  STATUS_META,
  buildCustomExpenseCategory,
  buildDraftPayload,
  buildReportPayload,
  calculateSummary,
  cloneTripAfter,
  emptyForm,
  formatAmount,
  getExpenseCategoryOptions,
  isEmptyDraft,
  isCustomExpenseCategory,
  makeBlankTrip,
  makeReturnTripAfter,
  moveTrip,
  normalizeExpenseItem,
  normalizeTrip,
  swapTripEndpoints,
  toMoney,
  todayStr,
  validateCustomExpenseName,
} from "./reportEditUtils";

const SAVE_LABELS = {
  idle: { text: "等待修改", icon: null, color: "default" },
  saving: { text: "保存中...", icon: <CircularProgress size={14} />, color: "info" },
  saved: { text: "已自动保存", icon: <CheckCircleIcon fontSize="small" />, color: "success" },
  error: { text: "保存失败，请重试", icon: <ErrorOutlineIcon fontSize="small" />, color: "error" },
};

const TRANSPORT_OPTIONS = ["飞机", "高铁/动车", "网约车", "自驾"];
const CONTENT_MAX_WIDTH = 1440;
const SECTION_GAP = { xs: 2, md: 2.5 };
const FIELD_GAP = { xs: 1.5, md: 2 };

const pageContentSx = {
  width: "100%",
  maxWidth: CONTENT_MAX_WIDTH,
  mx: "auto",
  pb: 4,
};

const sectionCardContentSx = {
  p: { xs: 2, md: 2.5 },
  "&:last-child": {
    pb: { xs: 2, md: 2.5 },
  },
};

const workCardSx = {
  height: "100%",
  border: 1,
  borderColor: "divider",
  borderRadius: 2,
  boxShadow: "none",
};

const mainLayoutSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1fr) 360px" },
  gap: { xs: 2, md: 2.5, xl: 3 },
  alignItems: "start",
};

const repeatedCardGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
  gap: SECTION_GAP,
  alignItems: "stretch",
};

const tripFieldGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
  gap: FIELD_GAP,
  alignItems: "start",
};

const tripTime = (month, day, hour) => `${month}/${day}${hour === "" || hour === null ? "" : ` ${hour}时`}`;

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

function InvoiceDropzone({ disabled, uploading, onFiles, hint = "拖放发票到这里，或点击上传" }) {
  const handleDrop = (event) => {
    event.preventDefault();
    if (disabled) return;
    onFiles(event.dataTransfer.files);
  };

  return (
    <Box
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      sx={{
        border: 1,
        borderStyle: "dashed",
        borderColor: disabled ? "divider" : "primary.light",
        borderRadius: 1,
        bgcolor: disabled ? "action.hover" : "primary.50",
        px: 1.5,
        py: 1.25,
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {hint}
        </Typography>
        <Button component="label" size="small" startIcon={<CloudUploadIcon />} disabled={disabled || uploading}>
          上传
          <input
            hidden
            multiple
            type="file"
            accept=".pdf,image/*"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </Button>
      </Stack>
    </Box>
  );
}

export default function ReportEdit() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { registerGuard, requestNavigation } = useNavigationGuard();

  const [form, setForm] = useState(emptyForm);
  const [defaults, setDefaults] = useState(emptyForm);
  const [status, setStatus] = useState("draft");
  const [trips, setTrips] = useState([]);
  const [expenseItems, setExpenseItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceQueue, setInvoiceQueue] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [uploadState, setUploadState] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pendingLeave, setPendingLeave] = useState(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customNameError, setCustomNameError] = useState("");

  const creatingRef = useRef(false);
  const loadedRef = useRef(false);
  const lastSavedPayloadRef = useRef("");
  const leaveResolverRef = useRef(null);
  const readonly = status === "reimbursed";

  const statusMeta = STATUS_META[status] || { label: status, color: "default" };
  const actions = STATUS_ACTIONS[status] || [];
  const saveMeta = SAVE_LABELS[saveState] || SAVE_LABELS.idle;

  const loadForEdit = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        const res = await getReport(id);
        if (!res.success) {
          setError(res.message || "加载报销单失败");
          return;
        }
        const report = res.data;
        const nextForm = {
          report_date: report.report_date || todayStr(),
          department: report.department || "",
          employee_name: report.employee_name || "",
          purpose: report.purpose || "",
          daily_subsidy: toMoney(report.daily_subsidy),
          advance_date_month: report.advance_date_month || "",
          advance_date_day: report.advance_date_day || "",
          advance_amount: toMoney(report.advance_amount),
        };
        const nextTrips = [...(report.trips || [])].sort((a, b) => a.sort_order - b.sort_order).map(normalizeTrip);
        const nextItems = (report.expense_items || []).map(normalizeExpenseItem);
        const nextInvoices = report.invoices || [];
        const nextDefaults = {
          ...nextForm,
          purpose: "",
          advance_date_month: "",
          advance_date_day: "",
          advance_amount: "0.00",
        };

        setForm(nextForm);
        setDefaults(nextDefaults);
        setStatus(report.status);
        setTrips(nextTrips);
        setExpenseItems(nextItems);
        setInvoices(nextInvoices);
        lastSavedPayloadRef.current = JSON.stringify(
          buildReportPayload({ form: nextForm, trips: nextTrips, expenseItems: nextItems }),
        );
        loadedRef.current = true;
        setSaveState("saved");
      } catch (err) {
        setError(err.response?.data?.message || err.message || "加载报销单失败");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [id],
  );

  const createDraft = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreatingDraft(true);
    setLoading(true);
    setError("");
    try {
      const settingsRes = await getSettings();
      const settings = settingsRes.success && settingsRes.data ? settingsRes.data : {};
      const draftForm = {
        ...emptyForm,
        report_date: todayStr(),
        department: settings.department || "",
        employee_name: settings.employee_name || "",
        daily_subsidy: toMoney(settings.daily_subsidy),
      };
      const res = await createReport(buildDraftPayload(draftForm));
      if (!res.success) {
        setError(res.message || "创建草稿失败");
        return;
      }
      navigate(`/reports/${res.data.id}/edit`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || "创建草稿失败");
    } finally {
      setCreatingDraft(false);
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (isEdit) {
      loadForEdit();
    } else {
      createDraft();
    }
  }, [isEdit, loadForEdit, createDraft]);

  const summary = useMemo(
    () =>
      calculateSummary({
        reportDate: form.report_date,
        dailySubsidy: form.daily_subsidy,
        advanceAmount: form.advance_amount,
        trips,
        invoices,
      }),
    [form.advance_amount, form.daily_subsidy, form.report_date, invoices, trips],
  );
  const expenseCategoryOptions = useMemo(() => getExpenseCategoryOptions(expenseItems), [expenseItems]);

  const emptyDraft = useMemo(
    () => status === "draft" && isEmptyDraft({ form, defaults, trips, invoices }),
    [defaults, form, invoices, status, trips],
  );

  const resolveLeave = useCallback((allowed) => {
    leaveResolverRef.current?.(allowed);
    leaveResolverRef.current = null;
    setPendingLeave(null);
  }, []);

  useEffect(() => {
    if (!isEdit) return undefined;
    return registerGuard(async (to) => {
      if (!emptyDraft) return true;
      setPendingLeave({ to });
      return new Promise((resolve) => {
        leaveResolverRef.current = resolve;
      });
    });
  }, [emptyDraft, isEdit, registerGuard]);

  useEffect(() => {
    if (!isEdit || readonly || loading || !loadedRef.current) return undefined;
    const payload = buildReportPayload({ form, trips, expenseItems });
    const payloadKey = JSON.stringify(payload);
    if (payloadKey === lastSavedPayloadRef.current) return undefined;

    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const res = await updateReport(id, payload);
        if (!res.success) {
          setError(res.message || "自动保存失败");
          setSaveState("error");
          return;
        }
        lastSavedPayloadRef.current = payloadKey;
        setSaveState("saved");
        if (payload.trips.some((trip) => !trip.id)) {
          await loadForEdit({ quiet: true });
        }
      } catch (err) {
        setError(err.response?.data?.message || err.message || "自动保存失败");
        setSaveState("error");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [expenseItems, form, id, isEdit, loadForEdit, loading, readonly, trips]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
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

  const duplicateTrip = (index) => {
    setTrips((prev) => cloneTripAfter(prev, index));
  };

  const returnTrip = (index) => {
    setTrips((prev) => makeReturnTripAfter(prev, index));
  };

  const swapTrip = (index) => {
    setTrips((prev) => prev.map((trip, i) => (i === index ? swapTripEndpoints(trip) : trip)));
  };

  const toggleTripCollapsed = (index) => {
    setTrips((prev) => prev.map((trip, i) => (i === index ? { ...trip, collapsed: !trip.collapsed } : trip)));
  };

  const invoicesForTrip = (tripId) => invoices.filter((invoice) => invoice.trip_id === tripId);
  const invoicesForCategory = (category) =>
    invoices.filter((invoice) => invoice.expense_category === category && !invoice.trip_id);

  const handleStatusAction = async (target) => {
    setSaveState("saving");
    setError("");
    try {
      const res = await updateReportStatus(id, target);
      if (res.success) {
        setStatus(res.data.status);
        setToast("状态已更新");
        setSaveState("saved");
      } else {
        setError(res.message || "状态更新失败");
        setSaveState("error");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "状态更新失败");
      setSaveState("error");
    }
  };

  const handleFilesUpload = async ({ files, expenseCategory, tripId = null, key }) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly || !id) return;

    const uploaded = [];
    setError("");
    setUploadState({ key, current: 0, total: fileList.length, name: fileList[0].name });
    try {
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        setUploadState({ key, current: index + 1, total: fileList.length, name: file.name });
        const res = await uploadInvoice({ reportId: id, tripId, expenseCategory, file });
        if (!res.success) {
          throw new Error(res.message || `${file.name} 上传失败`);
        }
        uploaded.push(res.data);
      }
      await loadForEdit({ quiet: true });
      if (uploaded.length > 0) {
        setInvoiceQueue(uploaded);
        setSelectedInvoice(uploaded[0]);
        setToast(fileList.length > 1 ? "批量上传完成，请逐张确认金额" : "发票已上传，请确认金额");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "上传失败"));
    } finally {
      setUploadState(null);
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    setSaveState("saving");
    setError("");
    try {
      const res = await deleteInvoice(invoiceId);
      if (res.success) {
        setToast("发票已删除");
        await loadForEdit({ quiet: true });
      } else {
        setError(res.message || "删除发票失败");
        setSaveState("error");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "删除发票失败");
      setSaveState("error");
    }
  };

  const handleOpenCustomDialog = () => {
    setCustomName("");
    setCustomNameError("");
    setCustomDialogOpen(true);
  };

  const handleAddCustomCategory = () => {
    const validationError = validateCustomExpenseName(customName, expenseItems);
    if (validationError) {
      setCustomNameError(validationError);
      return;
    }
    const category = buildCustomExpenseCategory(customName);
    setExpenseItems((prev) => [
      ...prev,
      {
        id: null,
        category,
        remark: "",
        amount: "0.00",
        invoice_count: 0,
      },
    ]);
    setCustomDialogOpen(false);
    setToast("自定义费用类别已添加");
  };

  const handleDeleteCustomCategory = (category) => {
    const categoryInvoices = invoicesForCategory(category);
    if (categoryInvoices.length > 0) {
      setError("该自定义费用类别已有发票，请先删除发票后再删除类别");
      return;
    }
    setExpenseItems((prev) => prev.filter((item) => item.category !== category));
    setToast("自定义费用类别已删除");
  };

  const handleInvoiceUpdated = async () => {
    await loadForEdit({ quiet: true });
    setInvoiceQueue((prev) => {
      const next = prev.slice(1);
      setSelectedInvoice(next[0] || null);
      return next;
    });
  };

  const handleDeleteEmptyDraftAndLeave = async () => {
    setLeaveBusy(true);
    setError("");
    try {
      const res = await deleteReport(id);
      if (!res.success) {
        setError(res.message || "删除空草稿失败");
        resolveLeave(false);
        return;
      }
      resolveLeave(true);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "删除空草稿失败");
      resolveLeave(false);
    } finally {
      setLeaveBusy(false);
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
          <Paper
            key={invoice.id}
            variant="outlined"
            sx={{ px: 1.25, py: 1, borderRadius: 1, bgcolor: "background.paper" }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={700}>
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
                    <IconButton size="small" color="error" disabled={readonly} onClick={() => handleDeleteInvoice(invoice.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">{creatingDraft ? "正在创建草稿..." : "正在加载报销单..."}</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Stack spacing={SECTION_GAP} sx={pageContentSx}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" fontWeight={800}>
              报销单录入
            </Typography>
            <Chip size="small" color={statusMeta.color} label={statusMeta.label} />
            <Chip size="small" color={saveMeta.color} icon={saveMeta.icon} label={saveMeta.text} />
          </Stack>
          <Typography color="text.secondary">基本信息、行程、发票和预支信息在一页完成。</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button startIcon={<ArrowBackIcon />} variant="outlined" onClick={() => requestNavigation("/reports")}>
            返回列表
          </Button>
          {actions.map((action) => (
            <Button
              key={action.target}
              variant="outlined"
              color={action.color === "inherit" ? "inherit" : action.color}
              onClick={() => handleStatusAction(action.target)}
              disabled={saveState === "saving"}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {readonly && <Alert severity="info">已报销状态为只读，不可修改。</Alert>}
      {uploadState && (
        <Alert severity="info">
          <Stack spacing={1}>
            <Typography variant="body2">
              正在上传 {uploadState.current}/{uploadState.total}：{uploadState.name}
            </Typography>
            <LinearProgress />
          </Stack>
        </Alert>
      )}

      <Box sx={mainLayoutSx}>
        <Box sx={{ minWidth: 0 }}>
          <Stack spacing={SECTION_GAP}>
              <Card sx={workCardSx}>
                <CardContent sx={sectionCardContentSx}>
                  <Stack spacing={2}>
                      <Typography variant="h6" fontWeight={800}>
                        基本信息
                      </Typography>
                      <Grid container spacing={FIELD_GAP}>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="报销日期"
                            type="date"
                            value={form.report_date}
                            onChange={handleChange("report_date")}
                            InputLabelProps={{ shrink: true }}
                            disabled={readonly}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField fullWidth size="small" label="部门" value={form.department} onChange={handleChange("department")} disabled={readonly} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="出差人"
                            value={form.employee_name}
                            onChange={handleChange("employee_name")}
                            disabled={readonly}
                          />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            fullWidth
                            size="small"
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
                            size="small"
                            label="出差事由"
                            value={form.purpose}
                            onChange={handleChange("purpose")}
                            disabled={readonly}
                            multiline
                            minRows={2}
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <Divider />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="预支月"
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
                            size="small"
                            label="预支日"
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
                            size="small"
                            label="预支金额"
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
                  </Stack>
                </CardContent>
              </Card>

            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    行程列表
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    复制、返程和排序都会自动保存。
                  </Typography>
                </Box>
                <Button startIcon={<AddIcon />} variant="outlined" onClick={addTrip} disabled={readonly}>
                  添加行程
                </Button>
              </Stack>

              {trips.length === 0 ? (
                <Alert severity="info">暂无行程，添加第一段行程后即可上传车船费发票。</Alert>
              ) : (
                <Box sx={repeatedCardGridSx}>
                  {trips.map((trip, index) => {
                    const tripInvoices = trip.id ? invoicesForTrip(trip.id) : [];
                    const uploadKey = `trip-${index}`;
                    const confirmedAmount = tripInvoices
                      .filter((invoice) => invoice.amount_confirmed)
                      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
                    const uploading = uploadState?.key === uploadKey;
                    const uploadDisabled = readonly || !trip.id || saveState === "saving";
                    const summaryText = `${tripTime(trip.depart_month, trip.depart_day, trip.depart_hour)} ${
                      trip.depart_place || "出发地"
                    } -> ${tripTime(trip.arrive_month, trip.arrive_day, trip.arrive_hour)} ${
                      trip.arrive_place || "到达地"
                    } · ${trip.transport || "交通工具"} · 发票 ${tripInvoices.length} 张 ${formatAmount(confirmedAmount)}`;

                    return (
                      <Box key={trip.id || `new-${index}`} sx={{ minWidth: 0 }}>
                        <Card
                          draggable={!readonly}
                          onDragStart={() => setDragIndex(index)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (dragIndex !== null) {
                              setTrips((prev) => moveTrip(prev, dragIndex, index));
                            }
                            setDragIndex(null);
                          }}
                          sx={{
                            ...workCardSx,
                            border: dragIndex === index ? 2 : 1,
                            borderColor: dragIndex === index ? "primary.main" : "divider",
                          }}
                        >
                      <CardContent sx={sectionCardContentSx}>
                        <Stack spacing={2}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                              <DragIndicatorIcon color="disabled" />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography fontWeight={800}>行程 {index + 1}</Typography>
                                <Typography variant="body2" color="text.secondary" noWrap>
                                  {summaryText}
                                </Typography>
                              </Box>
                            </Stack>
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title={trip.collapsed ? "展开" : "折叠"}>
                                <IconButton size="small" onClick={() => toggleTripCollapsed(index)}>
                                  {trip.collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="复制行程">
                                <span>
                                  <IconButton size="small" disabled={readonly} onClick={() => duplicateTrip(index)}>
                                    <ContentCopyIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="交换出发/到达">
                                <span>
                                  <IconButton size="small" disabled={readonly} onClick={() => swapTrip(index)}>
                                    <SwapHorizIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="生成返程">
                                <span>
                                  <IconButton size="small" disabled={readonly} onClick={() => returnTrip(index)}>
                                    <KeyboardReturnIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="删除行程">
                                <span>
                                  <IconButton size="small" color="error" disabled={readonly} onClick={() => removeTrip(index)}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          </Stack>

                          {!trip.collapsed && (
                            <>
                              <Box sx={tripFieldGridSx}>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="出发月"
                                    type="number"
                                    value={trip.depart_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="出发日"
                                    type="number"
                                    value={trip.depart_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="出发时"
                                    type="number"
                                    value={trip.depart_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="出发地"
                                    value={trip.depart_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_place", event.target.value)}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="到达月"
                                    type="number"
                                    value={trip.arrive_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="到达日"
                                    type="number"
                                    value={trip.arrive_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="到达时"
                                    type="number"
                                    value={trip.arrive_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                </Box>
                                <Box>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="到达地"
                                    value={trip.arrive_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_place", event.target.value)}
                                  />
                                </Box>
                                <Box sx={{ gridColumn: "1 / -1" }}>
                                  <Autocomplete
                                    freeSolo
                                    clearOnBlur={false}
                                    options={TRANSPORT_OPTIONS}
                                    value={trip.transport || ""}
                                    inputValue={trip.transport || ""}
                                    disabled={readonly}
                                    onChange={(_event, value) => updateTrip(index, "transport", value || "")}
                                    onInputChange={(_event, value) => updateTrip(index, "transport", value)}
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        fullWidth
                                        size="small"
                                        label="交通工具"
                                      />
                                    )}
                                  />
                                </Box>
                              </Box>
                              <Stack spacing={1}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography variant="subtitle2" fontWeight={800}>
                                    车船费发票
                                  </Typography>
                                  {!trip.id && (
                                    <Typography variant="caption" color="text.secondary">
                                      行程自动保存后可上传
                                    </Typography>
                                  )}
                                </Stack>
                                <InvoiceDropzone
                                  disabled={uploadDisabled}
                                  uploading={uploading}
                                  onFiles={(files) =>
                                    handleFilesUpload({
                                      files,
                                      expenseCategory: "transport_fare",
                                      tripId: trip.id,
                                      key: uploadKey,
                                    })
                                  }
                                />
                                {renderInvoiceList(tripInvoices)}
                              </Stack>
                            </>
                          )}
                        </Stack>
                      </CardContent>
                        </Card>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Stack>

            <Stack spacing={1.5}>
              <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1}>
                <Typography variant="h6" fontWeight={800}>
                  其他费用发票
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={readonly}
                  onClick={handleOpenCustomDialog}
                >
                  添加自定义费用
                </Button>
              </Stack>
              <Box sx={repeatedCardGridSx}>
                {expenseCategoryOptions.map((category) => {
                  const item = expenseItems.find((expenseItem) => expenseItem.category === category.value) || {
                    category: category.value,
                    remark: "",
                    amount: "0.00",
                    invoice_count: 0,
                  };
                  const uploadKey = `expense-${category.value}`;
                  const uploading = uploadState?.key === uploadKey;
                  return (
                    <Box key={category.value} sx={{ minWidth: 0 }}>
                      <Card sx={workCardSx}>
                        <CardContent sx={sectionCardContentSx}>
                          <Stack spacing={1.5}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography fontWeight={800}>{category.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {formatAmount(item.amount)} / {item.invoice_count || 0} 张
                                </Typography>
                              </Box>
                              {isCustomExpenseCategory(category.value) && (
                                <Tooltip title="删除自定义费用">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      disabled={readonly}
                                      onClick={() => handleDeleteCustomCategory(category.value)}
                                    >
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                            </Stack>
                            <InvoiceDropzone
                              disabled={readonly || saveState === "saving"}
                              uploading={uploading}
                              onFiles={(files) =>
                                handleFilesUpload({
                                  files,
                                  expenseCategory: category.value,
                                  key: uploadKey,
                                })
                              }
                            />
                            {renderInvoiceList(invoicesForCategory(category.value))}
                          </Stack>
                        </CardContent>
                      </Card>
                    </Box>
                  );
                })}
              </Box>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Card sx={{ ...workCardSx, position: { xl: "sticky" }, top: 24 }}>
            <CardContent sx={sectionCardContentSx}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    费用汇总
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    未确认金额不计入报销总额。
                  </Typography>
                </Box>

                <Divider />

                <Stack spacing={1.1}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">补贴天数</Typography>
                    <Typography fontWeight={800}>{summary.subsidyDays} 天</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">途中补贴</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.subsidyTotal)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">已确认发票</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.invoiceTotal)}</Typography>
                  </Stack>
                </Stack>

                <Divider />

                <Stack spacing={0.8}>
                  {expenseCategoryOptions.map((category) => {
                    const item = expenseItems.find((expenseItem) => expenseItem.category === category.value);
                    return (
                      <Stack key={category.value} direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {category.label}
                        </Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {formatAmount(item?.amount || 0)}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>

                <Divider />

                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography fontWeight={800}>报销总金额</Typography>
                    <Typography variant="h5" fontWeight={900} color="primary.main">
                      {formatAmount(summary.total)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">补领不足</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.shortfall)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">归还多余</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.surplus)}</Typography>
                  </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Box>

      <InvoiceViewer
        invoice={selectedInvoice}
        open={Boolean(selectedInvoice)}
        readonly={readonly}
        onClose={() => {
          setSelectedInvoice(null);
          setInvoiceQueue([]);
        }}
        onUpdated={handleInvoiceUpdated}
      />

      <Dialog open={customDialogOpen} onClose={() => setCustomDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>添加自定义费用</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <DialogContentText>
              自定义费用类别仅保存在当前报销单内。
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              label="费用名称"
              value={customName}
              error={Boolean(customNameError)}
              helperText={customNameError || "1-20 个字符，不能与固定费用类别重名"}
              onChange={(event) => {
                setCustomName(event.target.value);
                if (customNameError) {
                  setCustomNameError("");
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleAddCustomCategory();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleAddCustomCategory}>
            添加
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingLeave)} onClose={() => !leaveBusy && resolveLeave(false)}>
        <DialogTitle>空草稿尚未填写</DialogTitle>
        <DialogContent>
          <DialogContentText>
            当前草稿还没有出差事由、行程或发票。可以删除这个空草稿后离开，也可以保留它稍后继续填写。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => resolveLeave(false)} disabled={leaveBusy}>
            取消
          </Button>
          <Button onClick={() => resolveLeave(true)} disabled={leaveBusy}>
            保留草稿并离开
          </Button>
          <Button onClick={handleDeleteEmptyDraftAndLeave} color="error" disabled={leaveBusy}>
            {leaveBusy ? "删除中..." : "删除空草稿并离开"}
          </Button>
        </DialogActions>
      </Dialog>

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
