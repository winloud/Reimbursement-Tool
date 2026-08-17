import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNavigationGuard } from "../navigationGuard";
import { getApiErrorMessage } from "../features/report-edit-shared/apiError";
import { getSaveStateMeta } from "../features/report-edit-shared/saveStateMeta";
import {
  createReport,
  deleteReportAttachment,
  deleteInvoice,
  getReport,
  getReportPdfPreview,
  getSettings,
  prepareReportPdfDownload,
  updateReport,
  updateReportStatus,
  uploadReportAttachment,
  uploadInvoice,
} from "../api/client";
import { triggerBrowserDownload } from "../utils/browserDownload";
import {
  EXPENSE_CATEGORIES,
  buildCustomExpenseCategory,
  buildReportPayload,
  calculateSummary,
  cloneTripAfter,
  createInvoiceUploadIssue,
  emptyForm,
  getExpenseItemAmount,
  getExpenseCategoryOptions,
  getFuelSubsidyInvoiceShortfall,
  getInvoiceUploadFeedback,
  getPaperInvoiceCount,
  getTripPdfGate,
  getSubsidySpans,
  getTripYearRangeLabel,
  getVisibleExpenseCategories,
  hasPaperInvoice,
  hydrateTripDates,
  isCustomExpenseCategory,
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
  validatePurposeForStatusTransition,
  validateTrips,
  validateCustomExpenseName,
} from "./reportEditUtils";
import { canAccessReportPdf, STATUS_ACTIONS, STATUS_META } from "./reportStatus";
import {
  DEFAULT_AUTOSAVE_DELAY_SECONDS,
  normalizeAutosaveDelaySeconds,
} from "./settingsPageUtils";
import ReportEditView from "./ReportEditView";

export default function ReportEdit() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { registerGuard, requestNavigation } = useNavigationGuard();

  const [form, setForm] = useState(emptyForm);
  const [defaults, setDefaults] = useState(emptyForm);
  const [status, setStatus] = useState("draft");
  const [trips, setTrips] = useState([]);
  const [expenseItems, setExpenseItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [attachments, setAttachments] = useState([]);
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
  const [activeReportId, setActiveReportId] = useState(routeId || null);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customNameError, setCustomNameError] = useState("");
  // 本次会话手动添加、但还没填任何内容的费用类别。自动保存会用后端结果覆盖 expenseItems，
  // 这个集合不受影响，所以刚添加的空行不会被保存冲掉。
  const [pinnedExpenseCategories, setPinnedExpenseCategories] = useState(() => new Set());
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

  const loadedRef = useRef(false);
  const reportIdRef = useRef(routeId || null);
  const createRequestRef = useRef(null);
  const skipRouteLoadRef = useRef(null);
  const autosaveRequestRef = useRef(0);
  const lastSavedPayloadRef = useRef("");
  const readonly = status !== "draft";

  const statusMeta = STATUS_META[status] || { label: status, chipSx: {} };
  const actions = STATUS_ACTIONS[status] || [];
  const saveMeta = getSaveStateMeta(saveState);
  const currentPayload = useMemo(
    () => buildReportPayload({ form, trips, expenseItems }),
    [expenseItems, form, trips],
  );
  const currentPayloadKey = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);
  const hasUnsavedChanges = loadedRef.current && currentPayloadKey !== lastSavedPayloadRef.current;
  const expenseItemsError = useMemo(() => validateExpenseItems(expenseItems) || validateTrips(trips), [expenseItems, trips]);

  const loadForEdit = useCallback(
    async ({ quiet = false, reportId = reportIdRef.current } = {}) => {
      if (!reportId) return null;
      if (!quiet) setLoading(true);
      setError("");
      try {
        const settingsPromise = getSettings().catch(() => null);
        const [res, settingsRes] = await Promise.all([getReport(reportId), settingsPromise]);
        if (!res.success) {
          setError(res.message || "加载报销单失败");
          return;
        }
        if (settingsRes?.success && settingsRes.data) {
          setAutosaveDelaySeconds(normalizeAutosaveDelaySeconds(settingsRes.data.autosave_delay_seconds));
        }
        const report = res.data;
        if (report.report_type !== "travel") {
          if (report.report_type === "regular") {
            navigate(`/regular-reports/${report.id}/edit`, { replace: true });
            return null;
          }
          throw new Error("该记录不是出差报销单");
        }
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
        const nextTrips = hydrateTripDates(
          nextForm.report_date,
          [...(report.trips || [])].sort((a, b) => a.sort_order - b.sort_order),
        );
        const nextItems = (report.expense_items || []).map(normalizeExpenseItem);
        const nextInvoices = report.invoices || [];
        const nextAttachments = report.attachments || [];
        const nextDefaults = {
          ...nextForm,
          purpose: "",
          advance_date_month: "",
          advance_date_day: "",
          advance_amount: "0.00",
        };

        setForm(nextForm);
        setDefaults(nextDefaults);
        reportIdRef.current = String(report.id);
        setActiveReportId(String(report.id));
        setStatus(report.status);
        setTrips(nextTrips);
        setExpenseItems(nextItems);
        setInvoices(nextInvoices);
        setAttachments(nextAttachments);
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
    [navigate],
  );

  const initializeNewReport = useCallback(async () => {
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
      reportIdRef.current = null;
      setActiveReportId(null);
      setForm(draftForm);
      setDefaults(draftForm);
      setStatus("draft");
      setTrips([]);
      setExpenseItems([]);
      setInvoices([]);
      setAttachments([]);
      lastSavedPayloadRef.current = JSON.stringify(
        buildReportPayload({ form: draftForm, trips: [], expenseItems: [] }),
      );
      loadedRef.current = true;
      setSaveState("pristine");
    } catch (err) {
      setError(getApiErrorMessage(err, "初始化报销单失败"));
    } finally {
      setCreatingDraft(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    autosaveRequestRef.current += 1;
    if (routeId) {
      reportIdRef.current = String(routeId);
      setActiveReportId(String(routeId));
      if (skipRouteLoadRef.current === String(routeId)) {
        skipRouteLoadRef.current = null;
        return;
      }
      loadedRef.current = false;
      loadForEdit({ reportId: routeId });
      return;
    }
    loadedRef.current = false;
    initializeNewReport();
  }, [initializeNewReport, loadForEdit, routeId]);

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
  // 后端为 7 个固定类别自动建空行，这里只按有无业务数据/发票决定显示，PDF 仍打印固定 7 行。
  const visibleExpenseCategories = useMemo(
    () =>
      getVisibleExpenseCategories({
        categories: expenseCategoryOptions,
        expenseItems,
        getInvoices: (category) =>
          invoices.filter((invoice) => invoice.expense_category === category && !invoice.trip_id),
        pinnedCategories: pinnedExpenseCategories,
      }),
    [expenseCategoryOptions, expenseItems, invoices, pinnedExpenseCategories],
  );
  const addableExpenseCategories = useMemo(() => {
    const visible = new Set(visibleExpenseCategories.map((category) => category.value));
    return EXPENSE_CATEGORIES.filter((category) => !visible.has(category.value));
  }, [visibleExpenseCategories]);
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
  const subsidySpans = useMemo(() => getSubsidySpans(form.report_date, trips), [form.report_date, trips]);
  const hasTripMarkerIssue = useMemo(() => subsidySpans.some((span) => span.issue), [subsidySpans]);
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
  const emptyDraft = useMemo(
    () => status === "draft" && isEmptyDraft({ form, defaults, trips, invoices, expenseItems, attachments }),
    [attachments, defaults, expenseItems, form, invoices, status, trips],
  );

  const pdfGate = useMemo(
    () =>
      getTripPdfGate({
        unconfirmedCount: unconfirmedInvoiceCount,
        fuelSubsidyShortfall: fuelSubsidyInvoiceShortfall,
        hasTripMarkerIssue,
        confirmedInvoiceCount,
        canAccessPdf,
        canCreateOutput: Boolean(activeReportId) || !emptyDraft,
      }),
    [
      activeReportId,
      canAccessPdf,
      confirmedInvoiceCount,
      emptyDraft,
      fuelSubsidyInvoiceShortfall,
      hasTripMarkerIssue,
      unconfirmedInvoiceCount,
    ],
  );

  const saveReport = useCallback(
    async ({ quiet = false, force = false, allowEmptyCreate = false } = {}) => {
      const existingReportId = reportIdRef.current;
      if (readonly) return { ok: true, reportId: existingReportId };
      if (loading || !loadedRef.current) return { ok: false, reportId: existingReportId };
      if (!existingReportId && emptyDraft && !allowEmptyCreate) {
        setSaveState("pristine");
        return { ok: true, reportId: null };
      }
      const payloadKey = currentPayloadKey;
      if (existingReportId && !force && payloadKey === lastSavedPayloadRef.current) {
        setSaveState("saved");
        return { ok: true, reportId: existingReportId };
      }
      const validationError = expenseItemsError;
      if (validationError) {
        setSaveState("error");
        if (!quiet) setError(validationError);
        setToast(validationError);
        return { ok: false, reportId: existingReportId };
      }
      setSaveState("saving");
      if (!quiet) setError("");

      if (!existingReportId) {
        let createRequest = createRequestRef.current;
        if (!createRequest) {
          createRequest = {
            promise: createReport(currentPayload),
            formSnapshot: form,
            payloadKey,
            navigationApplied: false,
          };
          createRequestRef.current = createRequest;
        }
        try {
          const res = await createRequest.promise;
          if (!res.success || !res.data?.id) {
            const message = res.message || "创建报销单失败";
            setSaveState("error");
            if (!quiet) setError(message);
            setToast(message);
            return { ok: false, reportId: null };
          }
          const createdReportId = String(res.data.id);
          reportIdRef.current = createdReportId;
          setActiveReportId(createdReportId);
          if (!createRequest.navigationApplied) {
            createRequest.navigationApplied = true;
            skipRouteLoadRef.current = createdReportId;
            navigate(`/reports/${createdReportId}/edit`, { replace: true });
          }

          let savedReport = res.data;
          let savedForm = createRequest.formSnapshot;
          if (payloadKey !== createRequest.payloadKey) {
            const updateRes = await updateReport(createdReportId, currentPayload);
            if (!updateRes.success) {
              const message = updateRes.message || "保存失败";
              setSaveState("error");
              if (!quiet) setError(message);
              setToast(message);
              return { ok: false, reportId: createdReportId };
            }
            savedReport = updateRes.data;
            savedForm = form;
          }

          const nextTrips = hydrateTripDates(
            savedForm.report_date,
            [...(savedReport.trips || [])].sort((a, b) => a.sort_order - b.sort_order),
          );
          const nextItems = (savedReport.expense_items || []).map(normalizeExpenseItem);
          setStatus(savedReport.status || "draft");
          setTrips(nextTrips);
          setExpenseItems(nextItems);
          setInvoices(savedReport.invoices || []);
          setAttachments(savedReport.attachments || []);
          lastSavedPayloadRef.current = JSON.stringify(
            buildReportPayload({
              form: savedForm,
              trips: nextTrips,
              expenseItems: nextItems,
            }),
          );
          loadedRef.current = true;
          setError("");
          setSaveState("saved");
          if (!quiet) setToast("已保存");
          return { ok: true, reportId: createdReportId };
        } catch (err) {
          const savedReportId = reportIdRef.current;
          const message = getApiErrorMessage(err, savedReportId ? "保存失败" : "创建报销单失败");
          setSaveState("error");
          if (!quiet) setError(message);
          setToast(message);
          return { ok: false, reportId: savedReportId };
        } finally {
          if (createRequestRef.current === createRequest) createRequestRef.current = null;
        }
      }

      autosaveRequestRef.current += 1;
      const requestId = autosaveRequestRef.current;
      try {
        const res = await updateReport(existingReportId, currentPayload);
        if (autosaveRequestRef.current !== requestId) {
          return { ok: false, reportId: existingReportId };
        }
        if (!res.success) {
          const message = res.message || "保存失败";
          setSaveState("error");
          if (!quiet) setError(message);
          setToast(message);
          return { ok: false, reportId: existingReportId };
        }
        if (res.data?.status) setStatus(res.data.status);
        lastSavedPayloadRef.current = payloadKey;
        setError("");
        setSaveState("saved");
        if (currentPayload.trips.some((trip) => !trip.id)) {
          await loadForEdit({ quiet: true, reportId: existingReportId });
        } else if (!quiet) {
          setToast("已保存");
        }
        return { ok: true, reportId: existingReportId };
      } catch (err) {
        if (autosaveRequestRef.current !== requestId) {
          return { ok: false, reportId: existingReportId };
        }
        const message = getApiErrorMessage(err, "保存失败");
        setSaveState("error");
        if (!quiet) setError(message);
        setToast(message);
        return { ok: false, reportId: existingReportId };
      }
    },
    [currentPayload, currentPayloadKey, emptyDraft, expenseItemsError, form, loadForEdit, loading, navigate, readonly],
  );

  const ensureSavedBeforeAction = useCallback(
    async (options = {}) => saveReport({ quiet: true, ...options }),
    [saveReport],
  );

  const ensureReportIdForAction = useCallback(async () => {
    const result = await ensureSavedBeforeAction({ allowEmptyCreate: true });
    return result.ok ? result.reportId : null;
  }, [ensureSavedBeforeAction]);

  useEffect(() => {
    return registerGuard(async () => {
      if (!reportIdRef.current && emptyDraft) return true;
      const result = await ensureSavedBeforeAction();
      return result.ok;
    });
  }, [emptyDraft, ensureSavedBeforeAction, registerGuard]);

  useEffect(() => {
    if (readonly || loading || !loadedRef.current) return undefined;
    if (!reportIdRef.current && emptyDraft) {
      autosaveRequestRef.current += 1;
      setSaveState("pristine");
      return undefined;
    }
    if (currentPayloadKey === lastSavedPayloadRef.current) {
      autosaveRequestRef.current += 1;
      setSaveState(reportIdRef.current ? "saved" : "pristine");
      return undefined;
    }
    if (expenseItemsError) {
      autosaveRequestRef.current += 1;
      setSaveState("error");
      return undefined;
    }
    let cancelled = false;

    setSaveState("dirty");
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      await saveReport({ quiet: true });
    }, autosaveDelaySeconds * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autosaveDelaySeconds, currentPayloadKey, emptyDraft, expenseItemsError, loading, readonly, saveReport]);

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
    setTrips((prev) =>
      prev.map((trip, i) => {
        if (i !== index) return trip;
        const next = { ...trip, [field]: value };
        // 改日期时顺带刷新派生的月/日，摘要和补贴天数才跟着走。
        return field === "depart_date" || field === "arrive_date" ? normalizeTrip(next, i) : next;
      }),
    );
  };

  const addTrip = () => {
    setTrips((prev) => appendTripWithAutoStart(prev, makeBlankTrip(form.report_date)));
  };

  // 衔接提示中的快捷插入：把前后地点与日期带入新段，避免用户再抄一遍边界值。
  const insertTripAt = (index) => {
    if (readonly) return;
    setTrips((prev) => {
      const previous = prev[index - 1];
      const current = prev[index];
      if (!previous || !current) return prev;
      const inserted = normalizeTrip(
        {
          depart_date: previous.arrive_date,
          depart_hour: previous.arrive_hour,
          depart_place: previous.arrive_place,
          arrive_date: current.depart_date,
          arrive_hour: current.depart_hour,
          arrive_place: current.depart_place,
          transport: "",
          subsidy_start: false,
          subsidy_end: false,
          paper_invoice_amount: "0.00",
          paper_invoice_count: 0,
        },
        index,
      );
      const next = [...prev];
      next.splice(index, 0, inserted);
      return next.map(normalizeTrip);
    });
  };

  const handleOpenTicketImport = () => {
    if (readonly) return;
    setTicketImportOpen(true);
  };

  const handleTicketsImported = async (result) => {
    const report = await loadForEdit({ quiet: true, reportId: reportIdRef.current });
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

  const invoicesForTrip = useCallback(
    (tripId) => invoices.filter((invoice) => invoice.trip_id === tripId),
    [invoices],
  );
  const invoicesForCategory = useCallback(
    (category) => invoices.filter((invoice) => invoice.expense_category === category && !invoice.trip_id),
    [invoices],
  );

  const updateExpenseItem = (category, patch) => {
    setExpenseItems((prev) => {
      const existingItem = prev.find((item) => item.category === category);
      if (!existingItem) return [...prev, normalizeExpenseItem({ category, ...patch })];
      return prev.map((item) => (item.category === category ? { ...item, ...patch } : item));
    });
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
    const saved = await ensureSavedBeforeAction();
    if (!saved.ok) return;
    const purposeError = validatePurposeForStatusTransition({
      currentStatus: status,
      targetStatus: target,
      purpose: form.purpose,
    });
    if (purposeError) {
      setError(purposeError);
      setToast(purposeError);
      scrollToSection("basic-info-section");
      return;
    }
    if (target === "checked" && hasFuelSubsidyInvoiceShortfall) {
      setPdfBlockedOpen(true);
      return;
    }
    if (!saved.reportId) return;
    setSaveState("saving");
    setError("");
    try {
      const res = await updateReportStatus(saved.reportId, target);
      if (res.success) {
        setStatus(res.data.status);
        if (res.data.report_date) {
          setForm((current) => ({ ...current, report_date: res.data.report_date }));
          setDefaults((current) => ({ ...current, report_date: res.data.report_date }));
        }
        setToast("状态已更新");
        setSaveState("saved");
      } else {
        setError(res.message || "状态更新失败");
        setSaveState("error");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "状态更新失败"));
      setSaveState("error");
    }
  };

  const handlePdfPreview = async () => {
    if (pdfGate.previewBlocked) {
      setPdfBlockedOpen(true);
      return;
    }
    const saved = await ensureSavedBeforeAction();
    if (!saved.ok || !saved.reportId) return;
    setPdfBusy("preview");
    setError("");
    try {
      const res = await getReportPdfPreview(saved.reportId);
      if (!res.success) {
        setError(res.message || "生成 PDF 预览失败");
        return;
      }
      setPdfPreviewPages(res.data?.pages || []);
      await loadForEdit({ quiet: true, reportId: saved.reportId });
      setPdfPreviewOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "生成 PDF 预览失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const handlePdfDownload = async () => {
    if (pdfGate.downloadBlocked) {
      setPdfBlockedOpen(true);
      return;
    }
    const saved = await ensureSavedBeforeAction();
    if (!saved.ok || !saved.reportId) return;
    setPdfBusy("download");
    setError("");
    try {
      const res = await prepareReportPdfDownload(saved.reportId);
      if (!res.success || !res.data?.download_url) {
        throw new Error(res.message || "生成下载链接失败");
      }
      triggerBrowserDownload(res.data.download_url);
      await loadForEdit({ quiet: true, reportId: saved.reportId });
      setToast("PDF 已生成，请在下载窗口选择保存位置");
    } catch (err) {
      setError(getApiErrorMessage(err, "下载 PDF 失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const handleFilesUpload = async ({ files, expenseCategory, tripId = null, key }) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly) return;
    const saved = await ensureSavedBeforeAction({ allowEmptyCreate: true });
    if (!saved.ok || !saved.reportId) return;

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
          const res = await uploadInvoice({ reportId: saved.reportId, tripId, expenseCategory, file });
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
        const report = await loadForEdit({ quiet: true, reportId: saved.reportId });
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

  const handleAttachmentFilesUpload = async (files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly) return;
    const saved = await ensureSavedBeforeAction({ allowEmptyCreate: true });
    if (!saved.ok || !saved.reportId) return;

    let successfulFileCount = 0;
    const issues = [];
    setError("");
    setUploadState({ key: "report-attachments", current: 0, total: fileList.length, name: fileList[0].name });
    try {
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        setUploadState({ key: "report-attachments", current: index + 1, total: fileList.length, name: file.name });
        try {
          const res = await uploadReportAttachment({ reportId: saved.reportId, file });
          if (!res.success) throw new Error(res.message || "附件上传失败");
          successfulFileCount += 1;
        } catch (err) {
          issues.push(`${file.name || "未命名文件"}：${getApiErrorMessage(err, "附件上传失败")}`);
        }
      }

      if (successfulFileCount > 0) {
        await loadForEdit({ quiet: true, reportId: saved.reportId });
      }
      if (issues.length > 0) {
        setError(`部分附件未上传：\n${issues.join("\n")}`);
      }
      if (successfulFileCount > 0) {
        setToast(
          issues.length > 0
            ? `已上传 ${successfulFileCount} 个附件，${issues.length} 个失败`
            : `已上传 ${successfulFileCount} 个附件`,
        );
      }
    } finally {
      setUploadState(null);
    }
  };

  const handleDeleteReportAttachment = async (attachmentId) => {
    setError("");
    try {
      const res = await deleteReportAttachment(attachmentId);
      if (!res.success) throw new Error(res.message || "删除附件失败");
      setToast("附件已删除");
      await loadForEdit({ quiet: true });
    } catch (err) {
      setError(getApiErrorMessage(err, "删除附件失败"));
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

  const unpinExpenseCategory = (category) => {
    setPinnedExpenseCategories((prev) => {
      if (!prev.has(category)) return prev;
      const next = new Set(prev);
      next.delete(category);
      return next;
    });
  };

  const handleAddExpenseCategory = (category) => {
    setPinnedExpenseCategories((prev) => (prev.has(category) ? prev : new Set(prev).add(category)));
  };

  // 移除一行：自定义类别真删；固定类别只清空业务字段并移出手动添加集合，
  // 后端的空行留着，PDF 仍打印固定 7 行。
  const handleRemoveExpenseCategory = (category) => {
    if (isCustomExpenseCategory(category)) {
      handleDeleteCustomCategory(category);
      return;
    }
    updateExpenseItem(category, {
      remark: "",
      reimbursable_amount: "",
      paper_invoice_amount: "0.00",
      paper_invoice_count: 0,
    });
    unpinExpenseCategory(category);
    setToast("已移除该费用");
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

  const handleTripDragStart = (index) => {
    setDragIndex(index);
  };

  const handleTripDrop = (index) => {
    setTrips((previous) => (dragIndex === null ? previous : moveTrip(previous, dragIndex, index)));
    setDragIndex(null);
  };

  const handleTripDragEnd = () => setDragIndex(null);

  const handleMoveTrip = (fromIndex, toIndex) => {
    setTrips((previous) => moveTrip(previous, fromIndex, toIndex));
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
    id: activeReportId,
    canSaveReport: activeReportId ? hasUnsavedChanges : !emptyDraft,
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
    insertTripAt,
    updateTrip,
    toggleTripMarker,
    duplicateTrip,
    swapTrip,
    returnTrip,
    removeTrip,
    startTripDrag: handleTripDragStart,
    dropTrip: handleTripDrop,
    endTripDrag: handleTripDragEnd,
    moveTripByIndex: handleMoveTrip,
  };

  const expenseEditorView = {
    visibleExpenseCategories,
    addableExpenseCategories,
    pinnedExpenseCategories,
    expenseItems,
    invoicesForCategory,
    updateExpenseItem,
    addExpenseCategory: handleAddExpenseCategory,
    removeExpenseCategory: handleRemoveExpenseCategory,
    openCustomDialog: handleOpenCustomDialog,
    paperInvoiceEditor,
    openPaperInvoiceEditor,
    updatePaperInvoiceEditor,
    savePaperInvoiceEditor,
    closePaperInvoiceEditor,
    requestPaperInvoiceClear,
  };

  const reportAttachmentView = {
    attachments,
    uploading: uploadState?.key === "report-attachments",
    handleFilesUpload: handleAttachmentFilesUpload,
    handleDelete: handleDeleteReportAttachment,
    onUploadError: handleInvoiceUploadError,
  };

  const summaryPanelView = {
    summary,
    hasTripMarkerIssue,
    pdfGate,
    hasManualSubsidy,
    subsidyModeToggleTooltip,
    subsidyModeLabel,
    handleSubsidyModeToggle,
    openManualSubsidyDialog,
    visibleOtherExpenseItems,
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
    ensureReportIdForAction,
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
    toast,
    clearToast,
  };

  return (
    <ReportEditView
      page={pageView}
      basicInfo={basicInfoView}
      tripEditor={tripEditorView}
      expenseEditor={expenseEditorView}
      reportAttachments={reportAttachmentView}
      summaryPanel={summaryPanelView}
      invoiceFlow={invoiceFlowView}
      overlays={overlayView}
    />
  );
}
