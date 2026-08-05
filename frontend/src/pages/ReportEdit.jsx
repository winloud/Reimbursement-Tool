import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircularProgress } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useNavigate, useParams } from "react-router-dom";
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
  getExpenseItemAmount,
  getExpenseCategoryOptions,
  getFuelSubsidyInvoiceShortfall,
  getInvoiceUploadFeedback,
  getPaperInvoiceCount,
  getTripYearRangeLabel,
  hasPaperInvoice,
  isEmptyDraft,
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
import ReportEditView from "./ReportEditView";

const SAVE_LABELS = {
  idle: { text: "等待修改", icon: null, color: "default" },
  dirty: { text: "有未保存修改", icon: null, color: "warning" },
  saving: { text: "保存中...", icon: <CircularProgress size={14} />, color: "info" },
  saved: { text: "已保存", icon: <CheckCircleIcon fontSize="small" />, color: "success" },
  error: { text: "保存失败，请重试", icon: <ErrorOutlineIcon fontSize="small" />, color: "error" },
};

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
  const readonly = status !== "draft";

  const statusMeta = STATUS_META[status] || { label: status, chipSx: {} };
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
      ? `燃油补助发票还差 ${formatAmount(fuelSubsidyInvoiceShortfall)}；仍可预览 PDF，补足后才能修改状态或下载。`
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
    if (!id) return;
    if (!(await ensureSavedBeforeAction())) return;
    if (target === "checked" && hasFuelSubsidyInvoiceShortfall) {
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

  const handleTripDragStart = (index) => {
    setDragIndex(index);
  };

  const handleTripDrop = (index) => {
    setTrips((previous) => (dragIndex === null ? previous : moveTrip(previous, dragIndex, index)));
    setDragIndex(null);
  };

  const handleCloseInvoiceViewer = () => {
    setSelectedInvoice(null);
    setInvoiceQueue([]);
  };

  const handleSelectInvoice = (invoice) => {
    setSelectedInvoice(invoice);
  };

  const handleInvoiceUploadError = (message) => {
    setError(message);
  };

  const handleManualSubsidyDraftChange = (value) => {
    setManualSubsidyDraft(value);
    if (manualSubsidyError) setManualSubsidyError("");
  };

  const handleCustomNameChange = (value) => {
    setCustomName(value);
    if (customNameError) setCustomNameError("");
  };

  const closePaperInvoiceEditor = () => {
    setPaperInvoiceEditor(null);
  };

  const requestPaperInvoiceClear = () => {
    setPaperInvoiceClearTarget(paperInvoiceEditor);
  };

  const cancelPaperInvoiceClear = () => {
    setPaperInvoiceClearTarget(null);
  };

  const closeTicketImport = () => {
    setTicketImportOpen(false);
  };

  const closeCustomDialog = () => {
    setCustomDialogOpen(false);
  };

  const closePdfPreview = () => {
    setPdfPreviewOpen(false);
  };

  const closePdfBlocked = () => {
    setPdfBlockedOpen(false);
  };

  const clearToast = () => {
    setToast("");
  };

  const pageView = {
    loading,
    creatingDraft,
    statusMeta,
    saveMeta,
    readonly,
    error,
    uploadState,
    saveState,
    hasUnsavedChanges,
    isEdit,
    id,
    statusActions: actions,
    requestNavigation,
    saveReport,
    handleStatusAction,
    scrollToSection,
  };

  const basicInfoView = {
    form,
    handleChange,
  };

  const tripEditorView = {
    tripYearRangeLabel,
    handleOpenTicketImport,
    trips,
    dragIndex,
    invoicesForTrip,
    addTrip,
    updateTrip,
    toggleTripMarker,
    duplicateTrip,
    swapTrip,
    returnTrip,
    removeTrip,
    startTripDrag: handleTripDragStart,
    dropTrip: handleTripDrop,
  };

  const expenseEditorView = {
    expenseCategoryOptions,
    expenseItems,
    invoicesForCategory,
    updateExpenseItem,
    handleDeleteCustomCategory,
    openCustomDialog: handleOpenCustomDialog,
    paperInvoiceEditor,
    openPaperInvoiceEditor,
    updatePaperInvoiceEditor,
    savePaperInvoiceEditor,
    closePaperInvoiceEditor,
    requestPaperInvoiceClear,
  };

  const summaryPanelView = {
    summary,
    pdfBlockMessage,
    hasManualSubsidy,
    subsidyModeToggleTooltip,
    subsidyModeLabel,
    handleSubsidyModeToggle,
    openManualSubsidyDialog,
    hasFuelSubsidyInvoiceShortfall,
    hasUnconfirmedInvoices,
    unconfirmedInvoiceCount,
    fuelSubsidyInvoiceShortfall,
    visibleOtherExpenseItems,
    canAccessPdf,
    pdfBusy,
    handlePdfPreview,
    handlePdfDownload,
  };

  const invoiceFlowView = {
    selectedInvoice,
    invoiceQueue,
    handleInvoiceSkipped,
    handleInvoiceUpdated,
    handleDeleteInvoice,
    onSelectInvoice: handleSelectInvoice,
    onCloseViewer: handleCloseInvoiceViewer,
    uploadResult,
    handleUploadResultClose,
    handleUploadResultContinue,
    handleFilesUpload,
    onUploadError: handleInvoiceUploadError,
  };

  const overlayView = {
    ticketImportOpen,
    closeTicketImport,
    handleTicketsImported,
    subsidyDialogOpen,
    closeSubsidyDialog,
    manualSubsidyDraft,
    manualSubsidyError,
    onManualSubsidyDraftChange: handleManualSubsidyDraftChange,
    applyManualSubsidyTotal,
    customDialogOpen,
    closeCustomDialog,
    customName,
    customNameError,
    onCustomNameChange: handleCustomNameChange,
    handleAddCustomCategory,
    paperInvoiceClearTarget,
    cancelPaperInvoiceClear,
    confirmClearPaperInvoice,
    pdfPreviewOpen,
    closePdfPreview,
    pdfPreviewPages,
    pdfBlockedOpen,
    closePdfBlocked,
    pendingLeave,
    leaveBusy,
    resolveLeave,
    handleDeleteEmptyDraftAndLeave,
    toast,
    clearToast,
  };

  return (
    <ReportEditView
      page={pageView}
      basicInfo={basicInfoView}
      tripEditor={tripEditorView}
      expenseEditor={expenseEditorView}
      summaryPanel={summaryPanelView}
      invoiceFlow={invoiceFlowView}
      overlays={overlayView}
    />
  );
}
