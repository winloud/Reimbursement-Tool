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
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from "@mui/icons-material/Save";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate, useParams } from "react-router-dom";
import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import TicketImportDialog from "../components/TicketImportDialog";
import InvoiceDropzone from "../features/report-edit/InvoiceDropzone";
import PaperInvoiceEntry from "../features/report-edit/PaperInvoiceEntry";
import { useNavigationGuard } from "../navigationGuard";
import {
  createReport,
  deleteInvoice,
  deleteReport,
  downloadReportPdf,
  getReport,
  getReportPdfPreview,
  getSettings,
  updateReport,
  updateReportStatus,
  uploadInvoice,
} from "../api/client";
import {
  buildCustomExpenseCategory,
  buildDraftPayload,
  buildReportPayload,
  calculateSummary,
  cloneTripAfter,
  createInvoiceUploadIssue,
  emptyForm,
  formatAmount,
  getConfirmedInvoiceCount,
  getConfirmedInvoiceTotal,
  getExpenseItemAmount,
  getExpenseItemInvoiceTotal,
  getExpenseCategoryOptions,
  getFuelSubsidyInvoiceShortfall,
  getInvoiceUploadFeedback,
  getPaperInvoiceCount,
  getTripYearRangeLabel,
  hasPaperInvoice,
  isEmptyDraft,
  isCustomExpenseCategory,
  makeBlankTrip,
  makeReturnTripAfter,
  moveTrip,
  appendTripWithAutoStart,
  normalizeExpenseItem,
  normalizeTrip,
  swapTripEndpoints,
  toMoney,
  todayStr,
  validateExpenseItems,
  validateFuelSubsidyAmount,
  validateManualSubsidyTotal,
  validatePaperInvoice,
  validateTrips,
  validateCustomExpenseName,
} from "./reportEditUtils";
import { canAccessReportPdf, STATUS_ACTIONS, STATUS_META } from "./reportStatus";
import {
  DEFAULT_AUTOSAVE_DELAY_SECONDS,
  normalizeAutosaveDelaySeconds,
} from "./settingsPageUtils";

const SAVE_LABELS = {
  idle: { text: "等待修改", icon: null, color: "default" },
  dirty: { text: "有未保存修改", icon: null, color: "warning" },
  saving: { text: "保存中...", icon: <CircularProgress size={14} />, color: "info" },
  saved: { text: "已保存", icon: <CheckCircleIcon fontSize="small" />, color: "success" },
  error: { text: "保存失败，请重试", icon: <ErrorOutlineIcon fontSize="small" />, color: "error" },
};

const TRANSPORT_OPTIONS = ["飞机", "高铁/动车", "网约车", "自驾"];
const SECTION_GAP = { xs: 2, md: 2.5 };
const FIELD_GAP = { xs: 1.5, md: 2 };

const pageContentSx = {
  width: "100%",
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
  gridTemplateColumns: "repeat(3, minmax(calc(2ch + 34px), 1fr))",
  gap: { xs: 1, md: 1.25 },
  alignItems: "start",
};

const tripNumberFieldSx = {
  width: "100%",
  minWidth: 0,
};

const tripPlaceFieldSx = {
  gridColumn: "1 / -1",
  width: "100%",
  minWidth: 0,
};

const basicInfoGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(12, minmax(0, 1fr))" },
  gap: FIELD_GAP,
  alignItems: "start",
};

const editSectionNavSx = {
  position: { lg: "sticky" },
  top: { lg: 12 },
  zIndex: 2,
  border: 1,
  borderColor: "divider",
  bgcolor: "rgba(255, 255, 255, 0.92)",
  backdropFilter: "blur(10px)",
};

const sectionAnchorSx = {
  scrollMarginTop: 24,
};

const subsidyModeSwitchSx = {
  width: 40,
  height: 22,
  p: 0,
  "& .MuiSwitch-switchBase": {
    p: "3px",
    color: "common.white",
    "&.Mui-disabled": { color: "common.white" },
  },
  "& .MuiSwitch-switchBase.Mui-checked": {
    color: "common.white",
    transform: "translateX(18px)",
  },
  "& .MuiSwitch-thumb": {
    width: 16,
    height: 16,
    boxShadow: "0 1px 3px rgba(23, 32, 42, 0.28)",
  },
  "& .MuiSwitch-track": {
    borderRadius: 11,
    bgcolor: "primary.light",
    opacity: 1,
  },
  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
    bgcolor: "warning.main",
    opacity: 1,
  },
  "& .MuiSwitch-switchBase.Mui-disabled + .MuiSwitch-track": {
    opacity: 0.45,
  },
};

const tripSegmentGridSx = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: FIELD_GAP,
};

const tripSegmentPanelSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "#F8FAFC",
  p: { xs: 1.25, md: 1.5 },
};

const EDIT_SECTIONS = [
  { id: "basic-info-section", label: "基本信息" },
  { id: "trip-list-section", label: "行程" },
  { id: "expense-section", label: "其他费用" },
  { id: "summary-section", label: "汇总" },
];

const tripTime = (month, day, hour) => `${month}/${day}${hour === "" || hour === null ? "" : ` ${hour}时`}`;

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

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
  const [uploadResult, setUploadResult] = useState(null);
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
  const [paperInvoiceEditor, setPaperInvoiceEditor] = useState(null);
  const [paperInvoiceClearTarget, setPaperInvoiceClearTarget] = useState(null);
  const [subsidyDialogOpen, setSubsidyDialogOpen] = useState(false);
  const [manualSubsidyDraft, setManualSubsidyDraft] = useState("");
  const [manualSubsidyError, setManualSubsidyError] = useState("");
  const [pdfBusy, setPdfBusy] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewPages, setPdfPreviewPages] = useState([]);
  const [pdfBlockedOpen, setPdfBlockedOpen] = useState(false);
  const [ticketImportOpen, setTicketImportOpen] = useState(false);
  const [autosaveDelaySeconds, setAutosaveDelaySeconds] = useState(DEFAULT_AUTOSAVE_DELAY_SECONDS);

  const creatingRef = useRef(false);
  const loadedRef = useRef(false);
  const autosaveRequestRef = useRef(0);
  const lastSavedPayloadRef = useRef("");
  const leaveResolverRef = useRef(null);
  const readonly = status === "reimbursed";

  const statusMeta = STATUS_META[status] || { label: status, color: "default" };
  const actions = STATUS_ACTIONS[status] || [];
  const saveMeta = SAVE_LABELS[saveState] || SAVE_LABELS.idle;
  const currentPayload = useMemo(
    () => buildReportPayload({ form, trips, expenseItems }),
    [expenseItems, form, trips],
  );
  const currentPayloadKey = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);
  const hasUnsavedChanges = isEdit && loadedRef.current && currentPayloadKey !== lastSavedPayloadRef.current;
  const expenseItemsError = useMemo(() => validateExpenseItems(expenseItems) || validateTrips(trips), [expenseItems, trips]);

  const loadForEdit = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        const settingsPromise = getSettings().catch(() => null);
        const [res, settingsRes] = await Promise.all([getReport(id), settingsPromise]);
        if (!res.success) {
          setError(res.message || "加载报销单失败");
          return;
        }
        if (settingsRes?.success && settingsRes.data) {
          setAutosaveDelaySeconds(normalizeAutosaveDelaySeconds(settingsRes.data.autosave_delay_seconds));
        }
        const report = res.data;
        const nextForm = {
          report_date: report.report_date || todayStr(),
          department: report.department || "",
          employee_name: report.employee_name || "",
          purpose: report.purpose || "",
          daily_subsidy: toMoney(report.daily_subsidy),
          manual_subsidy_total:
            report.manual_subsidy_total === null || report.manual_subsidy_total === undefined
              ? null
              : toMoney(report.manual_subsidy_total),
          advance_date_month: report.advance_date_month || "",
          advance_date_day: report.advance_date_day || "",
          advance_amount: toMoney(report.advance_amount),
        };
        const nextTrips = [...(report.trips || [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(normalizeTrip);
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
        return report;
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
      setAutosaveDelaySeconds(normalizeAutosaveDelaySeconds(settings.autosave_delay_seconds));
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
        manualSubsidyTotal: form.manual_subsidy_total,
        advanceAmount: form.advance_amount,
        trips,
        invoices,
        expenseItems,
      }),
    [expenseItems, form.advance_amount, form.daily_subsidy, form.manual_subsidy_total, form.report_date, invoices, trips],
  );
  const hasManualSubsidy = form.manual_subsidy_total !== null && form.manual_subsidy_total !== undefined;
  const subsidyModeLabel = hasManualSubsidy ? "人工核定" : "自动计算";
  const subsidyModeToggleTooltip = readonly
    ? subsidyModeLabel
    : hasManualSubsidy
      ? "切换为自动计算"
      : "切换为人工核定";
  const automaticSubsidyTotal = summary.subsidyDays * Number(form.daily_subsidy || 0);
  const expenseCategoryOptions = useMemo(() => getExpenseCategoryOptions(expenseItems), [expenseItems]);
  const visibleOtherExpenseItems = useMemo(
    () =>
      expenseCategoryOptions
        .map((category) => {
          const item = expenseItems.find((expenseItem) => expenseItem.category === category.value);
          const categoryInvoices = invoices.filter((invoice) => invoice.expense_category === category.value && !invoice.trip_id);
          return { category, item, amount: getExpenseItemAmount(item || {}, categoryInvoices) };
        })
        .filter(({ amount }) => amount > 0),
    [expenseCategoryOptions, expenseItems, invoices],
  );
  const tripYearRangeLabel = useMemo(() => getTripYearRangeLabel(form.report_date, trips), [form.report_date, trips]);
  const hasUnconfirmedInvoices = useMemo(
    () => invoices.some((invoice) => !invoice.amount_confirmed),
    [invoices],
  );
  const unconfirmedInvoiceCount = useMemo(
    () => invoices.filter((invoice) => !invoice.amount_confirmed).length,
    [invoices],
  );
  const fuelSubsidyInvoiceShortfall = useMemo(() => {
    const fuelItem = expenseItems.find((item) => item.category === "fuel_subsidy");
    const fuelInvoices = invoices.filter((invoice) => invoice.expense_category === "fuel_subsidy" && !invoice.trip_id);
    return getFuelSubsidyInvoiceShortfall(fuelItem, fuelInvoices);
  }, [expenseItems, invoices]);
  const hasFuelSubsidyInvoiceShortfall = fuelSubsidyInvoiceShortfall > 0;
  const canAccessPdf = canAccessReportPdf(status);
  const confirmedInvoiceCount = useMemo(
    () =>
      invoices.filter((invoice) => invoice.amount_confirmed).length +
      trips.reduce((sum, trip) => sum + getPaperInvoiceCount(trip), 0) +
      expenseItems.reduce((sum, item) => sum + getPaperInvoiceCount(item), 0),
    [expenseItems, invoices, trips],
  );
  const pdfBlockMessage = hasUnconfirmedInvoices
    ? `${unconfirmedInvoiceCount} 张发票待确认，确认后才能预览或下载 PDF。`
    : hasFuelSubsidyInvoiceShortfall
      ? `燃油补助发票还差 ${formatAmount(fuelSubsidyInvoiceShortfall)}；可以保存和预览，补足后才能下载或标记为已提交。`
    : confirmedInvoiceCount > 0
      ? "发票已确认，可生成 PDF。"
      : "暂无已确认发票，可先录入行程和费用。";

  const emptyDraft = useMemo(
    () => status === "draft" && isEmptyDraft({ form, defaults, trips, invoices, expenseItems }),
    [defaults, expenseItems, form, invoices, status, trips],
  );

  const resolveLeave = useCallback((allowed) => {
    leaveResolverRef.current?.(allowed);
    leaveResolverRef.current = null;
    setPendingLeave(null);
  }, []);

  const saveReport = useCallback(
    async ({ quiet = false, force = false } = {}) => {
      if (!isEdit || readonly || loading || !loadedRef.current) return true;
      const payloadKey = currentPayloadKey;
      if (!force && payloadKey === lastSavedPayloadRef.current) {
        setSaveState("saved");
        return true;
      }
      const validationError = expenseItemsError;
      if (validationError) {
        setSaveState("error");
        if (!quiet) setError(validationError);
        setToast(validationError);
        return false;
      }
      autosaveRequestRef.current += 1;
      const requestId = autosaveRequestRef.current;
      setSaveState("saving");
      if (!quiet) setError("");
      try {
        const res = await updateReport(id, currentPayload);
        if (autosaveRequestRef.current !== requestId) return false;
        if (!res.success) {
          const message = res.message || "保存失败";
          setSaveState("error");
          if (!quiet) setError(message);
          setToast(message);
          return false;
        }
        if (res.data?.status) setStatus(res.data.status);
        lastSavedPayloadRef.current = payloadKey;
        setError("");
        setSaveState("saved");
        if (currentPayload.trips.some((trip) => !trip.id)) {
          await loadForEdit({ quiet: true });
        } else if (!quiet) {
          setToast("已保存");
        }
        return true;
      } catch (err) {
        if (autosaveRequestRef.current !== requestId) return false;
        const message = getApiErrorMessage(err, "保存失败");
        setSaveState("error");
        if (!quiet) setError(message);
        setToast(message);
        return false;
      }
    },
    [currentPayload, currentPayloadKey, expenseItemsError, id, isEdit, loadForEdit, loading, readonly],
  );

  const ensureSavedBeforeAction = useCallback(
    async () => saveReport({ quiet: true }),
    [saveReport],
  );

  useEffect(() => {
    if (!isEdit) return undefined;
    return registerGuard(async (to) => {
      if (!emptyDraft) {
        return ensureSavedBeforeAction();
      }
      setPendingLeave({ to });
      return new Promise((resolve) => {
        leaveResolverRef.current = resolve;
      });
    });
  }, [emptyDraft, ensureSavedBeforeAction, isEdit, registerGuard]);

  useEffect(() => {
    if (!isEdit || readonly || loading || !loadedRef.current) return undefined;
    if (currentPayloadKey === lastSavedPayloadRef.current) {
      autosaveRequestRef.current += 1;
      setSaveState("saved");
      return undefined;
    }
    if (expenseItemsError) {
      autosaveRequestRef.current += 1;
      setSaveState("error");
      return undefined;
    }
    const requestId = autosaveRequestRef.current + 1;
    autosaveRequestRef.current = requestId;
    let cancelled = false;
    const isCurrentAutosave = () => !cancelled && autosaveRequestRef.current === requestId;

    setSaveState("dirty");
    const timer = window.setTimeout(async () => {
      if (!isCurrentAutosave()) return;
      try {
        setSaveState("saving");
        const res = await updateReport(id, currentPayload);
        if (!isCurrentAutosave()) return;
        if (!res.success) {
          setToast(res.message || "自动保存失败");
          setSaveState("error");
          return;
        }
        if (res.data?.status) setStatus(res.data.status);
        lastSavedPayloadRef.current = currentPayloadKey;
        setError("");
        setSaveState("saved");
        if (currentPayload.trips.some((trip) => !trip.id)) {
          await loadForEdit({ quiet: true });
        }
      } catch (err) {
        if (!isCurrentAutosave()) return;
        setToast(getApiErrorMessage(err, "自动保存失败"));
        setSaveState("error");
      }
    }, autosaveDelaySeconds * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autosaveDelaySeconds, currentPayload, currentPayloadKey, expenseItemsError, isEdit, loadForEdit, loading, readonly]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const closeSubsidyDialog = () => {
    setSubsidyDialogOpen(false);
    setManualSubsidyError("");
  };

  const openManualSubsidyDialog = () => {
    setManualSubsidyDraft(toMoney(form.manual_subsidy_total));
    setManualSubsidyError("");
    setSubsidyDialogOpen(true);
  };

  const handleSubsidyModeToggle = (manual) => {
    setForm((prev) => ({
      ...prev,
      manual_subsidy_total: manual ? toMoney(automaticSubsidyTotal) : null,
    }));
  };

  const applyManualSubsidyTotal = () => {
    const validationError = validateManualSubsidyTotal(manualSubsidyDraft);
    if (validationError) {
      setManualSubsidyError(validationError);
      return;
    }
    setForm((prev) => ({ ...prev, manual_subsidy_total: toMoney(manualSubsidyDraft) }));
    closeSubsidyDialog();
  };

  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updateTrip = (index, field, value) => {
    setTrips((prev) => prev.map((trip, i) => (i === index ? { ...trip, [field]: value } : trip)));
  };

  const addTrip = () => {
    setTrips((prev) => appendTripWithAutoStart(prev, makeBlankTrip(form.report_date)));
  };

  const handleOpenTicketImport = async () => {
    if (readonly || !id) return;
    if (!(await ensureSavedBeforeAction())) return;
    setTicketImportOpen(true);
  };

  const handleTicketsImported = async (result) => {
    const report = await loadForEdit({ quiet: true });
    const importedIds = new Set((result?.invoice_ids || []).map(Number));
    const importedInvoices = (report?.invoices || []).filter((invoice) => importedIds.has(Number(invoice.id)));
    if (importedInvoices.length > 0) {
      setInvoiceQueue(importedInvoices);
      setSelectedInvoice(importedInvoices[0]);
    }
    const tripCount = result?.trip_ids?.length || 0;
    const invoiceCount = result?.invoice_ids?.length || 0;
    setToast(`已导入 ${tripCount} 段行程、${invoiceCount} 张车票，请逐张确认金额`);
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

  const toggleTripMarker = (index, field) => {
    setTrips((prev) => prev.map((trip, i) => (i === index ? { ...trip, [field]: !trip[field] } : trip)));
  };

  const invoicesForTrip = (tripId) => invoices.filter((invoice) => invoice.trip_id === tripId);
  const invoicesForCategory = (category) =>
    invoices.filter((invoice) => invoice.expense_category === category && !invoice.trip_id);

  const updateExpenseItem = (category, patch) => {
    setExpenseItems((prev) =>
      prev.map((item) => (item.category === category ? { ...item, ...patch } : item)),
    );
  };

  const openPaperInvoiceEditor = (target, value) => {
    if (readonly) return;
    setPaperInvoiceEditor({
      ...target,
      paper_invoice_amount: toMoney(value.paper_invoice_amount),
      paper_invoice_count: value.paper_invoice_count ?? 0,
    });
  };

  const updatePaperInvoiceEditor = (field, value) => {
    setPaperInvoiceEditor((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const savePaperInvoiceEditor = () => {
    if (!paperInvoiceEditor) return;
    const validationError = validatePaperInvoice(paperInvoiceEditor);
    if (validationError) {
      setError(validationError);
      setToast(validationError);
      return;
    }
    const patch = {
      paper_invoice_amount: toMoney(paperInvoiceEditor.paper_invoice_amount),
      paper_invoice_count: Number(paperInvoiceEditor.paper_invoice_count || 0),
    };
    if (paperInvoiceEditor.kind === "trip") {
      updateTrip(paperInvoiceEditor.index, "paper_invoice_amount", patch.paper_invoice_amount);
      updateTrip(paperInvoiceEditor.index, "paper_invoice_count", patch.paper_invoice_count);
    } else {
      updateExpenseItem(paperInvoiceEditor.category, patch);
    }
    setPaperInvoiceEditor(null);
    setError("");
    setToast("纸质发票已录入，正在自动保存");
  };

  const confirmClearPaperInvoice = () => {
    if (!paperInvoiceClearTarget) return;
    const patch = { paper_invoice_amount: "0.00", paper_invoice_count: 0 };
    if (paperInvoiceClearTarget.kind === "trip") {
      updateTrip(paperInvoiceClearTarget.index, "paper_invoice_amount", patch.paper_invoice_amount);
      updateTrip(paperInvoiceClearTarget.index, "paper_invoice_count", patch.paper_invoice_count);
    } else {
      updateExpenseItem(paperInvoiceClearTarget.category, patch);
    }
    setPaperInvoiceEditor(null);
    setPaperInvoiceClearTarget(null);
    setToast("纸质发票已清空，正在自动保存");
  };

  const handleStatusAction = async (target) => {
    if (!(await ensureSavedBeforeAction())) return;
    if (target === "printed" && hasFuelSubsidyInvoiceShortfall) {
      setPdfBlockedOpen(true);
      return;
    }
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

  const handlePdfPreview = async () => {
    if (hasUnconfirmedInvoices) {
      setPdfBlockedOpen(true);
      return;
    }
    if (!(await ensureSavedBeforeAction())) return;
    setPdfBusy("preview");
    setError("");
    try {
      const res = await getReportPdfPreview(id);
      if (!res.success) {
        setError(res.message || "生成 PDF 预览失败");
        return;
      }
      setPdfPreviewPages(res.data?.pages || []);
      await loadForEdit({ quiet: true });
      setPdfPreviewOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "生成 PDF 预览失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const handlePdfDownload = async () => {
    if (hasUnconfirmedInvoices || hasFuelSubsidyInvoiceShortfall) {
      setPdfBlockedOpen(true);
      return;
    }
    if (!(await ensureSavedBeforeAction())) return;
    setPdfBusy("download");
    setError("");
    try {
      const { blob, filename } = await downloadReportPdf(id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      await loadForEdit({ quiet: true });
      setToast("PDF 已生成并开始下载");
    } catch (err) {
      setError(getApiErrorMessage(err, "下载 PDF 失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const handleFilesUpload = async ({ files, expenseCategory, tripId = null, key }) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly || !id) return;
    if (!(await ensureSavedBeforeAction())) return;

    const uploaded = [];
    const issues = [];
    let successfulFileCount = 0;
    setError("");
    setUploadState({ key, current: 0, total: fileList.length, name: fileList[0].name });
    try {
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        setUploadState({ key, current: index + 1, total: fileList.length, name: file.name });
        try {
          const res = await uploadInvoice({ reportId: id, tripId, expenseCategory, file });
          if (!res.success) {
            throw new Error(res.message || "上传失败");
          }
          const uploadedItems = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
          if (uploadedItems.length === 0) {
            throw new Error("服务器未返回发票信息");
          }
          uploaded.push(...uploadedItems);
          successfulFileCount += 1;
        } catch (err) {
          issues.push(
            createInvoiceUploadIssue(
              file.name,
              getApiErrorMessage(err, "上传失败"),
              err.response?.status,
            ),
          );
        }
      }

      const feedback = getInvoiceUploadFeedback({
        totalFileCount: fileList.length,
        successfulFileCount,
        issues,
      });

      let confirmationQueue = uploaded;
      if (uploaded.length > 0) {
        const report = await loadForEdit({ quiet: true });
        const refreshedById = new Map((report?.invoices || []).map((invoice) => [Number(invoice.id), invoice]));
        const refreshedUploaded = uploaded.map((invoice) => refreshedById.get(Number(invoice.id))).filter(Boolean);
        confirmationQueue = refreshedUploaded.length === uploaded.length ? refreshedUploaded : uploaded;
      }

      if (feedback.hasIssues) {
        setInvoiceQueue([]);
        setSelectedInvoice(null);
        setUploadResult({ ...feedback, uploadedInvoices: confirmationQueue });
      } else if (confirmationQueue.length > 0) {
        setInvoiceQueue(confirmationQueue);
        setSelectedInvoice(confirmationQueue[0]);
        setToast(feedback.toastMessage);
      }
    } finally {
      setUploadState(null);
    }
  };

  const handleUploadResultClose = () => {
    setUploadResult(null);
  };

  const handleUploadResultContinue = () => {
    const confirmationQueue = uploadResult?.uploadedInvoices || [];
    setUploadResult(null);
    setInvoiceQueue(confirmationQueue);
    setSelectedInvoice(confirmationQueue[0] || null);
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
        reimbursable_amount: "",
        paper_invoice_amount: "0.00",
        paper_invoice_count: 0,
        invoice_total: "0.00",
        amount: "0.00",
        invoice_count: 0,
      },
    ]);
    setCustomDialogOpen(false);
    setToast("自定义费用类别已添加");
  };

  const handleDeleteCustomCategory = (category) => {
    const categoryInvoices = invoicesForCategory(category);
    const item = expenseItems.find((expenseItem) => expenseItem.category === category);
    if (categoryInvoices.length > 0 || hasPaperInvoice(item)) {
      setError("该自定义费用类别已有发票，请先清空纸质发票或删除上传发票后再删除类别");
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

  const handleInvoiceSkipped = () => {
    setInvoiceQueue((prev) => {
      const next = prev.length > 0 ? prev.slice(1) : [];
      setSelectedInvoice(next[0] || null);
      setToast(next.length > 0 ? "已跳过当前发票，请确认下一张" : "已跳过当前发票");
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
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="caption" fontWeight={800} color="text.secondary">
          已上传发票
        </Typography>
        <Box
          sx={{
            px: 0.625,
            py: 0,
            borderRadius: 999,
            bgcolor: "#EEF1F4",
            color: "text.secondary",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1.5,
            whiteSpace: "nowrap",
          }}
        >
          {items.length} 张
        </Box>
        <Divider sx={{ flex: 1 }} />
      </Stack>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.25 }}>
          暂无发票
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 0.5,
            alignItems: "stretch",
          }}
        >
          {items.map((invoice) => {
            const invoiceNumber = invoice.invoice_no || "无发票号码";
            const confirmationLabel = invoice.amount_confirmed ? "已确认" : "待确认";

            return (
              <Paper
                key={invoice.id}
                variant="outlined"
                sx={{
                  minWidth: 0,
                  px: 0.75,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: "#F8FAFC",
                  borderColor: "divider",
                  borderLeft: 3,
                  borderLeftColor: invoice.amount_confirmed ? "success.main" : "warning.main",
                }}
              >
                <Stack spacing={0.125} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
                    <Tooltip title={formatAmount(invoice.amount)}>
                      <Typography
                        variant="body2"
                        fontWeight={800}
                        noWrap
                        sx={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.2, minWidth: 0, maxWidth: "100%" }}
                      >
                        {formatAmount(invoice.amount)}
                      </Typography>
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.2 }}>
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {invoice.file_type.toUpperCase()}
                      </Box>
                      <Box component="span" color="text.disabled" aria-hidden="true" sx={{ mx: 0.375 }}>
                        ·
                      </Box>
                      <Box component="span" color={invoice.amount_confirmed ? "success.dark" : "warning.dark"} sx={{ fontWeight: 700 }}>
                        {confirmationLabel}
                      </Box>
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.25} alignItems="center" sx={{ minWidth: 0 }}>
                    <Tooltip title={invoiceNumber}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                        {invoiceNumber}
                      </Typography>
                    </Tooltip>
                    <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }}>
                      <Tooltip title="查看发票">
                        <IconButton size="small" aria-label="查看发票" onClick={() => setSelectedInvoice(invoice)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除发票">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            aria-label="删除发票"
                            disabled={readonly}
                            onClick={() => handleDeleteInvoice(invoice.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Box>
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
          <Button
            startIcon={saveState === "saving" ? <CircularProgress size={16} /> : <SaveIcon />}
            variant="contained"
            onClick={() => saveReport({ quiet: false, force: true })}
            disabled={readonly || saveState === "saving" || (!hasUnsavedChanges && saveState === "saved")}
          >
            手动保存
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

      {error && (
        <Alert severity="error" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {error}
        </Alert>
      )}
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

      <Card sx={editSectionNavSx}>
        <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EDIT_SECTIONS.map((section) => (
              <Button key={section.id} size="small" variant="text" onClick={() => scrollToSection(section.id)}>
                {section.label}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Box sx={mainLayoutSx}>
        <Box sx={{ minWidth: 0 }}>
          <Stack spacing={SECTION_GAP}>
              <Card id="basic-info-section" sx={{ ...workCardSx, ...sectionAnchorSx }}>
                <CardContent sx={sectionCardContentSx}>
                  <Stack spacing={2}>
                      <Typography variant="h6" fontWeight={800}>
                        基本信息
                      </Typography>
                      <Box sx={basicInfoGridSx}>
                        <Box sx={{ gridColumn: { sm: "span 6" } }}>
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
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 6" } }}>
                          <TextField fullWidth size="small" label="部门" value={form.department} onChange={handleChange("department")} disabled={readonly} />
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 6" } }}>
                          <TextField
                            fullWidth
                            size="small"
                            label="出差人"
                            value={form.employee_name}
                            onChange={handleChange("employee_name")}
                            disabled={readonly}
                          />
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 6" } }}>
                          <TextField
                            fullWidth
                            size="small"
                            label="途中补贴日标准"
                            type="number"
                            value={form.daily_subsidy}
                            onChange={handleChange("daily_subsidy")}
                            disabled={readonly}
                            helperText={
                              hasManualSubsidy
                                ? "当前使用人工核定总额，修改行程或日标准不会改变补贴总额。"
                                : undefined
                            }
                            InputProps={{
                              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                              inputProps: { min: 0, step: "0.01" },
                            }}
                          />
                        </Box>
                        <Box sx={{ gridColumn: { xs: "1 / -1", sm: "span 12" } }}>
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
                        </Box>
                        <Box sx={{ gridColumn: { xs: "1 / -1", sm: "span 12" } }}>
                          <Divider />
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 4" } }}>
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
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 4" } }}>
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
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 4" } }}>
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
                        </Box>
                      </Box>
                  </Stack>
                </CardContent>
              </Card>

            <Stack id="trip-list-section" spacing={1.5} sx={sectionAnchorSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                    <Typography variant="h6" fontWeight={800}>
                      行程列表
                    </Typography>
                    {tripYearRangeLabel && <Chip size="small" color="info" variant="outlined" label={tripYearRangeLabel} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    复制、返程和排序都会自动保存。
                  </Typography>
                </Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button variant="contained" onClick={handleOpenTicketImport} disabled={readonly || saveState === "saving"}>
                    从车票导入
                  </Button>
                  <Button startIcon={<AddIcon />} variant="outlined" onClick={addTrip} disabled={readonly}>
                    手动添加
                  </Button>
                </Stack>
              </Stack>

              {trips.length === 0 ? (
                <Alert severity="info">暂无行程。可以批量导入铁路电子客票自动生成，也可以手动添加第一段行程。</Alert>
              ) : (
                <Box sx={repeatedCardGridSx}>
                  {trips.map((trip, index) => {
                    const tripInvoices = trip.id ? invoicesForTrip(trip.id) : [];
                    const uploadKey = `trip-${index}`;
                    const paperInvoiceKey = `trip:${trip.id || index}`;
                    const paperInvoiceCount = getPaperInvoiceCount(trip);
                    const confirmedElectronicCount = getConfirmedInvoiceCount(tripInvoices);
                    const confirmedAmount = getConfirmedInvoiceTotal(tripInvoices) + Number(trip.paper_invoice_amount || 0);
                    const uploading = uploadState?.key === uploadKey;
                    const uploadDisabled = readonly || !trip.id || saveState === "saving";
                    const isFirstTrip = index === 0;
                    const isLastTrip = index === trips.length - 1;
                    const effectiveStart = isFirstTrip || trip.subsidy_start;
                    const effectiveEnd = isLastTrip || trip.subsidy_end;
                    const markerPrefix = effectiveStart ? "起 " : "";
                    const markerSuffix = effectiveEnd ? " 止" : "";
                    const unconfirmedTripInvoices = tripInvoices.filter((invoice) => !invoice.amount_confirmed).length;
                    const tripInvoiceLabel =
                      tripInvoices.length === 0 && paperInvoiceCount === 0
                        ? "无发票"
                        : unconfirmedTripInvoices > 0
                          ? `${unconfirmedTripInvoices} 张待确认`
                          : `${confirmedElectronicCount + paperInvoiceCount} 张已确认`;
                    const tripInvoiceColor =
                      tripInvoices.length === 0 && paperInvoiceCount === 0 ? "default" : unconfirmedTripInvoices > 0 ? "warning" : "success";
                    const tripTitle = `${trip.depart_place || "出发地"} -> ${trip.arrive_place || "到达地"}`;
                    const summaryText = `${markerPrefix}${tripTime(trip.depart_month, trip.depart_day, trip.depart_hour)} ${
                      trip.depart_place || "出发地"
                    } -> ${tripTime(trip.arrive_month, trip.arrive_day, trip.arrive_hour)} ${
                      trip.arrive_place || "到达地"
                    }${markerSuffix} · ${trip.transport || "交通工具"} · 发票 ${confirmedElectronicCount + paperInvoiceCount} 张 ${formatAmount(confirmedAmount)}`;

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
                                <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
                                  <Typography fontWeight={900}>{tripTitle}</Typography>
                                  <Chip size="small" color={tripInvoiceColor} label={tripInvoiceLabel} />
                                </Stack>
                                <Typography variant="body2" color="text.secondary" noWrap>
                                  {summaryText}
                                </Typography>
                              </Box>
                            </Stack>
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <Tooltip title={isFirstTrip ? "出差开始（默认，自动）" : "标记这段为一次出差的开始"}>
                                <span>
                                  <Button
                                    size="small"
                                    variant={effectiveStart ? "contained" : "outlined"}
                                    disabled={readonly || isFirstTrip}
                                    onClick={() => toggleTripMarker(index, "subsidy_start")}
                                    sx={{ minWidth: 32, px: 0.75 }}
                                  >
                                    起
                                  </Button>
                                </span>
                              </Tooltip>
                              <Tooltip title={isLastTrip ? "出差结束（默认，自动）" : "标记这段为一次出差的结束"}>
                                <span>
                                  <Button
                                    size="small"
                                    variant={effectiveEnd ? "contained" : "outlined"}
                                    disabled={readonly || isLastTrip}
                                    onClick={() => toggleTripMarker(index, "subsidy_end")}
                                    sx={{ minWidth: 32, px: 0.75 }}
                                  >
                                    止
                                  </Button>
                                </span>
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

                          <Box sx={tripSegmentGridSx}>
                            <Box sx={tripSegmentPanelSx}>
                              <Stack spacing={1.25}>
                                <Typography variant="subtitle2" fontWeight={900}>
                                  出发
                                </Typography>
                                <Box sx={tripFieldGridSx}>
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="月"
                                    type="number"
                                    value={trip.depart_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="日"
                                    type="number"
                                    value={trip.depart_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="时"
                                    type="number"
                                    value={trip.depart_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripPlaceFieldSx}
                                    label="地点"
                                    value={trip.depart_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "depart_place", event.target.value)}
                                  />
                                </Box>
                              </Stack>
                            </Box>
                            <Box sx={tripSegmentPanelSx}>
                              <Stack spacing={1.25}>
                                <Typography variant="subtitle2" fontWeight={900}>
                                  到达
                                </Typography>
                                <Box sx={tripFieldGridSx}>
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="月"
                                    type="number"
                                    value={trip.arrive_month}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_month", event.target.value)}
                                    inputProps={{ min: 1, max: 12 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="日"
                                    type="number"
                                    value={trip.arrive_day}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_day", event.target.value)}
                                    inputProps={{ min: 1, max: 31 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripNumberFieldSx}
                                    label="时"
                                    type="number"
                                    value={trip.arrive_hour}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_hour", event.target.value)}
                                    inputProps={{ min: 0, max: 23 }}
                                  />
                                  <TextField
                                    size="small"
                                    sx={tripPlaceFieldSx}
                                    label="地点"
                                    value={trip.arrive_place}
                                    disabled={readonly}
                                    onChange={(event) => updateTrip(index, "arrive_place", event.target.value)}
                                  />
                                </Box>
                              </Stack>
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
                                  onPasteError={setError}
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
                                {(!readonly || hasPaperInvoice(trip)) && (
                                  <Box sx={{ mt: 0.25, pt: 0.75, borderTop: "1px solid", borderColor: "rgba(148, 163, 184, 0.28)" }}>
                                    <PaperInvoiceEntry
                                      value={trip}
                                      editor={paperInvoiceEditor?.key === paperInvoiceKey ? paperInvoiceEditor : null}
                                      disabled={readonly}
                                      onOpen={() => openPaperInvoiceEditor({ key: paperInvoiceKey, kind: "trip", index }, trip)}
                                      onChange={updatePaperInvoiceEditor}
                                      onSave={savePaperInvoiceEditor}
                                      onCancel={() => setPaperInvoiceEditor(null)}
                                      onClear={() => setPaperInvoiceClearTarget(paperInvoiceEditor)}
                                    />
                                  </Box>
                                )}
                              </Stack>
                        </Stack>
                      </CardContent>
                        </Card>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Stack>

            <Stack id="expense-section" spacing={1.5} sx={sectionAnchorSx}>
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
                    reimbursable_amount: "",
                    paper_invoice_amount: "0.00",
                    paper_invoice_count: 0,
                    invoice_total: "0.00",
                    amount: "0.00",
                    invoice_count: 0,
                  };
                  const uploadKey = `expense-${category.value}`;
                  const paperInvoiceKey = `expense:${category.value}`;
                  const uploading = uploadState?.key === uploadKey;
                  const isFuelSubsidy = category.value === "fuel_subsidy";
                  const categoryInvoices = invoicesForCategory(category.value);
                  const invoiceTotal = getExpenseItemInvoiceTotal(item, categoryInvoices);
                  const invoiceCount = getConfirmedInvoiceCount(categoryInvoices) + getPaperInvoiceCount(item);
                  const fuelAmountError = validateFuelSubsidyAmount(item);
                  const fuelShortfall = getFuelSubsidyInvoiceShortfall(item, categoryInvoices);
                  return (
                    <Box key={category.value} sx={{ minWidth: 0 }}>
                      <Card sx={workCardSx}>
                        <CardContent sx={sectionCardContentSx}>
                          <Stack spacing={1.5}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography fontWeight={800}>{category.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  报销 {formatAmount(getExpenseItemAmount(item, categoryInvoices))} / 发票 {formatAmount(invoiceTotal)} / {invoiceCount} 张
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
                            {isFuelSubsidy && (
                              <TextField
                                fullWidth
                                size="small"
                                label="燃油补助报销金额"
                                type="number"
                                value={item.reimbursable_amount ?? ""}
                                disabled={readonly}
                                error={Boolean(fuelAmountError)}
                                helperText={
                                  fuelAmountError ||
                                  (fuelShortfall > 0
                                    ? `发票金额不足 ${formatAmount(fuelShortfall)}；可保存和预览，补足后才能打印。`
                                    : "留空则按已确认发票合计报销")
                                }
                                onChange={(event) =>
                                  updateExpenseItem(category.value, { reimbursable_amount: event.target.value })
                                }
                                InputProps={{
                                  startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                                  inputProps: { min: 0, step: "0.01" },
                                }}
                              />
                            )}
                            <InvoiceDropzone
                              disabled={readonly || saveState === "saving"}
                              uploading={uploading}
                              onPasteError={setError}
                              onFiles={(files) =>
                                handleFilesUpload({
                                  files,
                                  expenseCategory: category.value,
                                  key: uploadKey,
                                })
                              }
                            />
                            {renderInvoiceList(categoryInvoices)}
                            {(!readonly || hasPaperInvoice(item)) && (
                              <Box sx={{ mt: 0.25, pt: 0.75, borderTop: "1px solid", borderColor: "rgba(148, 163, 184, 0.28)" }}>
                                <PaperInvoiceEntry
                                  value={item}
                                  editor={paperInvoiceEditor?.key === paperInvoiceKey ? paperInvoiceEditor : null}
                                  disabled={readonly}
                                  onOpen={() => openPaperInvoiceEditor({ key: paperInvoiceKey, kind: "expense", category: category.value }, item)}
                                  onChange={updatePaperInvoiceEditor}
                                  onSave={savePaperInvoiceEditor}
                                  onCancel={() => setPaperInvoiceEditor(null)}
                                  onClear={() => setPaperInvoiceClearTarget(paperInvoiceEditor)}
                                />
                              </Box>
                            )}
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
          <Card id="summary-section" sx={{ ...workCardSx, ...sectionAnchorSx, position: { xl: "sticky" }, top: 24 }}>
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

                <Alert severity={hasUnconfirmedInvoices || hasFuelSubsidyInvoiceShortfall ? "warning" : "info"} sx={{ py: 0.75 }}>
                  {pdfBlockMessage}
                </Alert>

                <Divider />

                <Stack spacing={1.1}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800}>车船费</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.transportTotal)}</Typography>
                  </Stack>
                </Stack>

                <Divider />

                <Stack spacing={1.1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, flex: "1 1 auto" }}>
                      <Typography fontWeight={800} sx={{ flexShrink: 0 }}>
                        途中补贴
                      </Typography>
                      <Tooltip title={subsidyModeToggleTooltip} arrow>
                        <Box component="span" sx={{ display: "inline-flex", minWidth: 0 }}>
                          <FormControlLabel
                            disabled={readonly}
                            control={
                              <Switch
                                checked={hasManualSubsidy}
                                onChange={(_event, checked) => handleSubsidyModeToggle(checked)}
                                size="small"
                                inputProps={{
                                  "aria-label": `途中补贴计算方式：${subsidyModeLabel}`,
                                }}
                                sx={subsidyModeSwitchSx}
                              />
                            }
                            label={subsidyModeLabel}
                            sx={{
                              m: 0,
                              gap: 0.75,
                              minWidth: 0,
                              cursor: readonly ? "default" : "pointer",
                              "& .MuiFormControlLabel-label": {
                                color: hasManualSubsidy ? "warning.dark" : "primary.main",
                                fontSize: 12,
                                fontWeight: 800,
                                lineHeight: 1,
                                whiteSpace: "nowrap",
                              },
                              "& .MuiFormControlLabel-label.Mui-disabled": {
                                color: "text.disabled",
                              },
                            }}
                          />
                        </Box>
                      </Tooltip>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flex: "0 0 auto" }}>
                      <Typography fontWeight={800}>{formatAmount(summary.subsidyTotal)}</Typography>
                      {hasManualSubsidy && !readonly && (
                        <Tooltip title="编辑人工核定金额" arrow>
                          <IconButton
                            size="small"
                            color="primary"
                            aria-label="编辑人工核定金额"
                            onClick={openManualSubsidyDialog}
                            sx={{ p: 0.5, borderRadius: 0.75 }}
                          >
                            <EditIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </Stack>
                  {hasManualSubsidy ? (
                    <Typography variant="caption" color="text.secondary">
                      最终总额不随行程或日标准变化
                    </Typography>
                  ) : (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">补贴天数</Typography>
                      <Typography fontWeight={800}>{summary.subsidyDays} 天</Typography>
                    </Stack>
                  )}
                </Stack>

                <Divider />

                <Stack spacing={0.8}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800}>其他费用</Typography>
                    <Typography fontWeight={800}>{formatAmount(summary.otherExpenseTotal)}</Typography>
                  </Stack>
                  {visibleOtherExpenseItems.map(({ category, amount }) => (
                    <Stack key={category.value} direction="row" justifyContent="space-between" spacing={1}>
                      <Typography variant="body2" color="text.secondary">
                        {category.label}
                      </Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {formatAmount(amount)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>

                <Divider />

                <Stack spacing={1.25}>
                  <Typography fontWeight={800}>汇总</Typography>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography color="text.secondary">报销总金额</Typography>
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

                <Divider />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={pdfBusy === "preview" ? <CircularProgress size={16} /> : <VisibilityIcon />}
                    onClick={handlePdfPreview}
                    disabled={!canAccessPdf || pdfBusy === "download"}
                    sx={hasUnconfirmedInvoices ? { color: "text.disabled", borderColor: "divider" } : undefined}
                  >
                    {pdfBusy === "preview" ? "生成中" : hasUnconfirmedInvoices ? "待确认后预览" : "预览"}
                  </Button>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={pdfBusy === "download" ? <CircularProgress size={16} /> : <DownloadIcon />}
                    onClick={handlePdfDownload}
                    disabled={!canAccessPdf || pdfBusy === "preview" || hasFuelSubsidyInvoiceShortfall}
                    sx={hasUnconfirmedInvoices || hasFuelSubsidyInvoiceShortfall ? { bgcolor: "action.disabledBackground", color: "text.disabled" } : undefined}
                  >
                    {pdfBusy === "download" ? "生成中" : hasUnconfirmedInvoices ? "待确认后下载" : "下载"}
                  </Button>
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
        onSkip={invoiceQueue.length > 0 ? handleInvoiceSkipped : undefined}
        onUpdated={handleInvoiceUpdated}
      />

      <InvoiceUploadResultDialog
        result={uploadResult}
        onClose={handleUploadResultClose}
        onContinue={handleUploadResultContinue}
      />

      <TicketImportDialog
        open={ticketImportOpen}
        reportId={id}
        onClose={() => setTicketImportOpen(false)}
        onImported={handleTicketsImported}
      />

      <Dialog open={subsidyDialogOpen} onClose={closeSubsidyDialog} fullWidth maxWidth="xs">
        <DialogTitle>编辑人工核定金额</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="人工核定补贴总额"
            type="number"
            value={manualSubsidyDraft}
            error={Boolean(manualSubsidyError)}
            helperText={manualSubsidyError || "保存后作为最终总额，不再按补贴天数计算。"}
            onChange={(event) => {
              setManualSubsidyDraft(event.target.value);
              if (manualSubsidyError) setManualSubsidyError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyManualSubsidyTotal();
            }}
            InputProps={{
              startAdornment: <InputAdornment position="start">¥</InputAdornment>,
              inputProps: { min: 0, step: "0.01" },
            }}
            sx={{ mt: 1.5 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSubsidyDialog}>取消</Button>
          <Button variant="contained" onClick={applyManualSubsidyTotal}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

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

      <Dialog open={Boolean(paperInvoiceClearTarget)} onClose={() => setPaperInvoiceClearTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>清空纸质发票？</DialogTitle>
        <DialogContent>
          <DialogContentText>将清除当前卡片登记的纸质发票金额和张数，不影响已上传的电子发票。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaperInvoiceClearTarget(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmClearPaperInvoice}>
            清空
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pdfPreviewOpen} onClose={() => setPdfPreviewOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>PDF 预览</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {pdfPreviewPages.map((page) => (
              <Paper key={page.page} variant="outlined" sx={{ p: 1, bgcolor: "grey.50" }}>
                <Typography variant="caption" color="text.secondary">
                  第 {page.page} 页
                </Typography>
                <Box
                  component="img"
                  src={page.image_url}
                  alt={`PDF 预览第 ${page.page} 页`}
                  sx={{ display: "block", width: "100%", mt: 1, borderRadius: 1 }}
                />
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPdfPreviewOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pdfBlockedOpen} onClose={() => setPdfBlockedOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{hasUnconfirmedInvoices ? "存在未确认发票" : "燃油补助发票金额不足"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {hasUnconfirmedInvoices
              ? `当前报销单有 ${unconfirmedInvoiceCount} 张发票待确认，请先逐张确认发票信息后再预览或下载 PDF。`
              : `燃油补助发票还差 ${formatAmount(fuelSubsidyInvoiceShortfall)}。可以保存和预览，补充足额发票后才能下载或标记为已提交。`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPdfBlockedOpen(false)}>知道了</Button>
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
