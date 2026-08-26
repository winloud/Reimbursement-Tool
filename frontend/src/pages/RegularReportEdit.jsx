import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Stack } from "@mui/material";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  createReport,
  deleteInvoice,
  deleteReportAttachment,
  getReport,
  getReportPdfPreview,
  getSettings,
  prepareReportPdfDownload,
  updateReport,
  updateReportStatus,
  uploadInvoice,
  uploadReportAttachment,
} from "../api/client";
import { useNavigationGuard } from "../navigationGuard";
import { getApiErrorMessage } from "../features/report-edit-shared/apiError";
import { getSaveStateMeta } from "../features/report-edit-shared/saveStateMeta";
import { triggerBrowserDownload } from "../utils/browserDownload";
import {
  createInvoiceUploadIssue,
  getInvoiceUploadFeedback,
} from "./reportEditUtils";
import { STATUS_ACTIONS, STATUS_META } from "./reportStatus";
import {
  DEFAULT_AUTOSAVE_DELAY_SECONDS,
  normalizeAutosaveDelaySeconds,
} from "./settingsPageUtils";
import RegularReportEditView from "./RegularReportEditView";
import {
  buildRegularReportPayload,
  calculateRegularSummary,
  getRegularPdfGate,
  isRegularDraftEmpty,
  isRegularMode,
  makeBlankRegularItem,
  moveRegularItem,
  regularToday,
  runAfterRegularReportSaved,
  sortAndNormalizeRegularItems,
  validateRegularReport,
} from "./regularReportUtils";

export default function RegularReportEdit() {
  const { id: routeId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { registerGuard, requestNavigation } = useNavigationGuard();
  const requestedMode = searchParams.get("mode") || "";

  const [mode, setMode] = useState(isRegularMode(requestedMode) ? requestedMode : "no_invoice");
  const [form, setForm] = useState({ report_date: "", employee_name: "" });
  const [defaults, setDefaults] = useState({ report_date: "", employee_name: "" });
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [status, setStatus] = useState("draft");
  const [activeReportId, setActiveReportId] = useState(routeId || null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [uploadState, setUploadState] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceQueue, setInvoiceQueue] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [pdfBusy, setPdfBusy] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPages, setPreviewPages] = useState([]);
  const [pdfBlockedOpen, setPdfBlockedOpen] = useState(false);
  const [autosaveDelaySeconds, setAutosaveDelaySeconds] = useState(DEFAULT_AUTOSAVE_DELAY_SECONDS);

  const loadedRef = useRef(false);
  const reportIdRef = useRef(routeId || null);
  const lastSavedPayloadRef = useRef("");
  const latestPayloadKeyRef = useRef("");
  const createRequestRef = useRef(null);
  const skipRouteLoadRef = useRef(null);
  const autosaveRequestRef = useRef(0);
  const latestPayloadRef = useRef(null);
  const regularItemClientKeysRef = useRef(new Map());
  const readonly = status !== "draft";

  const currentPayload = useMemo(
    () => buildRegularReportPayload({ form, mode, items, invoices, attachments }),
    [attachments, form, invoices, items, mode],
  );
  const currentPayloadKey = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);
  latestPayloadRef.current = currentPayload;
  latestPayloadKeyRef.current = currentPayloadKey;
  const emptyDraft = useMemo(
    () => status === "draft" && isRegularDraftEmpty({ form, defaults, items, invoices, attachments }),
    [attachments, defaults, form, invoices, items, status],
  );
  const summary = useMemo(
    () => calculateRegularSummary({ mode, items, invoices, attachments }),
    [attachments, invoices, items, mode],
  );
  const pdfGate = useMemo(
    () => getRegularPdfGate({ form, mode, items, invoices }),
    [form, invoices, items, mode],
  );
  const hasUnsavedChanges = loadedRef.current && currentPayloadKey !== lastSavedPayloadRef.current;

  const applyReport = useCallback((report, { markSaved = true, previousItems = [] } = {}) => {
    const nextMode = report.regular_mode;
    if (report.report_type !== "regular" || !isRegularMode(nextMode)) {
      throw new Error("该记录不是常规报销单");
    }
    const nextForm = {
      report_date: report.report_date || "",
      employee_name: report.employee_name || "",
    };
    const previousById = new Map(
      previousItems
        .filter((item) => item?.id && item?.clientKey)
        .map((item) => [String(item.id), item.clientKey]),
    );
    const previousBySortOrder = new Map(
      previousItems
        .filter((item) => item?.clientKey)
        .map((item) => [Number(item.sort_order), item.clientKey]),
    );
    const nextItems = sortAndNormalizeRegularItems(report.regular_items || []).map((item, index) => {
      const stableClientKey =
        (item.id && regularItemClientKeysRef.current.get(String(item.id))) ||
        (item.id && previousById.get(String(item.id))) ||
        previousBySortOrder.get(Number(item.sort_order || index + 1)) ||
        previousItems[index]?.clientKey ||
        item.clientKey;
      if (item.id && stableClientKey) {
        regularItemClientKeysRef.current.set(String(item.id), stableClientKey);
      }
      return stableClientKey === item.clientKey ? item : { ...item, clientKey: stableClientKey };
    });
    setMode(nextMode);
    setForm(nextForm);
    setDefaults((current) => loadedRef.current ? current : nextForm);
    setItems(nextItems);
    setInvoices(report.invoices || []);
    setAttachments(report.attachments || []);
    setStatus(report.status || "draft");
    setError("");
    reportIdRef.current = String(report.id);
    setActiveReportId(String(report.id));
    if (markSaved) {
      const savedKey = JSON.stringify(buildRegularReportPayload({
        form: nextForm,
        mode: nextMode,
        items: nextItems,
        invoices: report.invoices || [],
        attachments: report.attachments || [],
      }));
      lastSavedPayloadRef.current = savedKey;
      latestPayloadKeyRef.current = savedKey;
      setSaveState("saved");
    }
    loadedRef.current = true;
    return report;
  }, []);

  const loadForEdit = useCallback(async ({ quiet = false, reportId = reportIdRef.current } = {}) => {
    if (!reportId) return null;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [response, settingsResponse] = await Promise.all([
        getReport(reportId),
        getSettings().catch(() => null),
      ]);
      if (!response.success) throw new Error(response.message || "加载常规报销单失败");
      if (settingsResponse?.success) {
        setAutosaveDelaySeconds(normalizeAutosaveDelaySeconds(settingsResponse.data?.autosave_delay_seconds));
      }
      return applyReport(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "加载常规报销单失败"));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyReport]);

  const initializeNew = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!isRegularMode(requestedMode)) {
      loadedRef.current = false;
      setError("无效的常规报销模式，请从常规报销单列表重新选择无票或有票模式。");
      setLoading(false);
      return;
    }
    try {
      const settingsResponse = await getSettings().catch(() => null);
      const settings = settingsResponse?.success ? settingsResponse.data || {} : {};
      const nextForm = { report_date: "", employee_name: settings.employee_name || "" };
      setMode(requestedMode);
      setForm(nextForm);
      setDefaults(nextForm);
      setItems([]);
      setInvoices([]);
      setAttachments([]);
      setStatus("draft");
      setActiveReportId(null);
      reportIdRef.current = null;
      setAutosaveDelaySeconds(normalizeAutosaveDelaySeconds(settings.autosave_delay_seconds));
      const initialKey = JSON.stringify(buildRegularReportPayload({ form: nextForm, mode: requestedMode, items: [] }));
      lastSavedPayloadRef.current = initialKey;
      latestPayloadKeyRef.current = initialKey;
      loadedRef.current = true;
      setSaveState("pristine");
    } finally {
      setLoading(false);
    }
  }, [requestedMode]);

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
    initializeNew();
  }, [initializeNew, loadForEdit, routeId]);

  const saveReport = useCallback(async ({ quiet = false, allowEmptyCreate = false, force = false } = {}) => {
    const existingReportId = reportIdRef.current;
    if (readonly) return { ok: true, reportId: existingReportId };
    if (!loadedRef.current || loading) return { ok: false, reportId: existingReportId };
    if (!existingReportId && emptyDraft && !allowEmptyCreate) {
      setSaveState("pristine");
      return { ok: true, reportId: null };
    }
    const payload = currentPayload;
    const payloadKey = currentPayloadKey;
    if (existingReportId && !force && payloadKey === lastSavedPayloadRef.current) {
      setSaveState("saved");
      return { ok: true, reportId: existingReportId };
    }
    setSaveState("saving");
    if (!quiet) setError("");

    if (!existingReportId) {
      let request = createRequestRef.current;
      if (!request) {
        request = { promise: createReport(payload), payloadKey };
        createRequestRef.current = request;
      }
      try {
        const response = await request.promise;
        if (!response.success || !response.data?.id) throw new Error(response.message || "创建常规报销单失败");
        const createdId = String(response.data.id);
        reportIdRef.current = createdId;
        setActiveReportId(createdId);
        skipRouteLoadRef.current = createdId;
        navigate(`/regular-reports/${createdId}/edit`, { replace: true });
        let savedReport = response.data;
        let savedPayloadKey = request.payloadKey;
        if (latestPayloadKeyRef.current !== request.payloadKey) {
          const latestPayload = latestPayloadRef.current;
          savedPayloadKey = JSON.stringify(latestPayload);
          const updateResponse = await updateReport(createdId, latestPayload);
          if (!updateResponse.success) throw new Error(updateResponse.message || "保存常规报销单失败");
          savedReport = updateResponse.data;
        }
        if (latestPayloadKeyRef.current === savedPayloadKey) {
          applyReport(savedReport, { previousItems: items });
          if (!quiet) setToast("已保存");
        } else {
          lastSavedPayloadRef.current = savedPayloadKey;
          loadedRef.current = true;
          setSaveState("dirty");
        }
        return { ok: true, reportId: createdId, report: savedReport };
      } catch (saveError) {
        const message = getApiErrorMessage(saveError, "创建常规报销单失败");
        setError(message);
        setSaveState("error");
        return { ok: false, reportId: reportIdRef.current };
      } finally {
        if (createRequestRef.current === request) createRequestRef.current = null;
      }
    }

    autosaveRequestRef.current += 1;
    const requestId = autosaveRequestRef.current;
    try {
      const response = await updateReport(existingReportId, payload);
      if (requestId !== autosaveRequestRef.current) return { ok: false, reportId: existingReportId };
      if (!response.success) throw new Error(response.message || "保存常规报销单失败");
      lastSavedPayloadRef.current = payloadKey;
      if (latestPayloadKeyRef.current === payloadKey) {
        applyReport(response.data, { previousItems: items });
      } else {
        setSaveState("dirty");
      }
      if (!quiet) setToast("已保存");
      return { ok: true, reportId: existingReportId, report: response.data };
    } catch (saveError) {
      if (requestId !== autosaveRequestRef.current) return { ok: false, reportId: existingReportId };
      const message = getApiErrorMessage(saveError, "保存常规报销单失败");
      setError(message);
      setSaveState("error");
      return { ok: false, reportId: existingReportId };
    }
  }, [applyReport, currentPayload, currentPayloadKey, emptyDraft, items, loading, navigate, readonly]);

  const ensureSaved = useCallback((options = {}) => saveReport({ quiet: true, ...options }), [saveReport]);

  useEffect(() => registerGuard(async () => {
    if (!reportIdRef.current && emptyDraft) return true;
    const result = await ensureSaved();
    return result.ok;
  }), [emptyDraft, ensureSaved, registerGuard]);

  useEffect(() => {
    if (readonly || loading || !loadedRef.current) return undefined;
    if (!reportIdRef.current && emptyDraft) {
      setSaveState("pristine");
      return undefined;
    }
    if (currentPayloadKey === lastSavedPayloadRef.current) {
      setSaveState(reportIdRef.current ? "saved" : "pristine");
      return undefined;
    }
    setSaveState("dirty");
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!cancelled) await saveReport({ quiet: true });
    }, autosaveDelaySeconds * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autosaveDelaySeconds, currentPayloadKey, emptyDraft, loading, readonly, saveReport]);

  const handleAddItem = () => {
    setError("");
    setItems((current) => [
      ...current,
      { ...makeBlankRegularItem({ occurredOn: regularToday() }), sort_order: current.length + 1 },
    ]);
  };

  const handleUpdateItem = (index, field, value) => {
    setError("");
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const handleMoveItem = (fromIndex, toIndex) => setItems((current) => moveRegularItem(current, fromIndex, toIndex));

  const handleItemDragStart = (index) => setDragIndex(index);

  const handleItemDrop = (index) => {
    setItems((current) => (dragIndex === null ? current : moveRegularItem(current, dragIndex, index)));
    setDragIndex(null);
  };

  const handleItemDragEnd = () => setDragIndex(null);

  const handleDeleteItem = (item) => {
    setItems((current) => current.filter((candidate) => candidate.clientKey !== item.clientKey).map((candidate, index) => ({ ...candidate, sort_order: index + 1 })));
    if (item.id) {
      const belongsToRemovedItem = (file) => Number(file.regular_item_id) === Number(item.id);
      setInvoices((current) => current.filter((invoice) => !belongsToRemovedItem(invoice)));
      setAttachments((current) => current.filter((attachment) => !belongsToRemovedItem(attachment)));
      setInvoiceQueue((current) => current.filter((invoice) => !belongsToRemovedItem(invoice)));
      setSelectedInvoice((current) => (current && belongsToRemovedItem(current) ? null : current));
    }
    setError("");
    setToast(item.id ? "项目及关联文件已删除，正在自动保存" : "项目已删除，正在自动保存");
  };

  const refreshInvoiceQueue = (uploaded, report) => {
    const byId = new Map((report?.invoices || []).map((invoice) => [Number(invoice.id), invoice]));
    const refreshed = uploaded.map((invoice) => byId.get(Number(invoice.id)) || invoice);
    return refreshed;
  };

  const resolveSavedRegularItemId = (report, item) => {
    if (item?.id) return Number(item.id);
    const savedItems = report?.regular_items || [];
    const itemIndex = items.findIndex((candidate) => candidate.clientKey === item?.clientKey);
    const savedItem =
      savedItems.find((candidate) => Number(candidate.sort_order) === Number(item?.sort_order)) ||
      savedItems[itemIndex];
    return savedItem?.id ? Number(savedItem.id) : null;
  };

  const handleInvoiceFiles = async (item, files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly || !item) return;
    const saved = await ensureSaved({ allowEmptyCreate: true });
    if (!saved.ok || !saved.reportId) return;
    let regularItemId = resolveSavedRegularItemId(saved.report, item);
    if (!regularItemId) {
      const refreshed = await loadForEdit({ quiet: true, reportId: saved.reportId });
      regularItemId = resolveSavedRegularItemId(refreshed, item);
    }
    if (!regularItemId) {
      setError("报销项目尚未保存完成，请稍后重试上传");
      return;
    }
    const uploaded = [];
    const issues = [];
    let successfulFileCount = 0;
    setError("");
    setUploadState({ kind: "invoice", regularItemId, current: 0, total: fileList.length, name: fileList[0].name });
    try {
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        setUploadState({ kind: "invoice", regularItemId, current: index + 1, total: fileList.length, name: file.name });
        try {
          const response = await uploadInvoice({ reportId: saved.reportId, regularItemId, file });
          if (!response.success) throw new Error(response.message || "发票上传失败");
          const uploadedItems = Array.isArray(response.data) ? response.data : [response.data].filter(Boolean);
          if (uploadedItems.length === 0) throw new Error("服务器未返回发票信息");
          uploaded.push(...uploadedItems);
          successfulFileCount += 1;
        } catch (uploadError) {
          issues.push(createInvoiceUploadIssue(file.name, getApiErrorMessage(uploadError, "上传失败"), uploadError.response?.status));
        }
      }
      const feedback = getInvoiceUploadFeedback({ totalFileCount: fileList.length, successfulFileCount, issues });
      let queue = uploaded;
      if (uploaded.length > 0) {
        const report = await loadForEdit({ quiet: true, reportId: saved.reportId });
        queue = refreshInvoiceQueue(uploaded, report);
      }
      if (feedback.hasIssues) {
        setUploadResult({ ...feedback, uploadedInvoices: queue });
        setInvoiceQueue([]);
        setSelectedInvoice(null);
      } else if (queue.length > 0) {
        setInvoiceQueue(queue);
        setSelectedInvoice(queue[0]);
        setToast(feedback.toastMessage);
      }
    } finally {
      setUploadState(null);
    }
  };

  const handleEvidenceFiles = async (item, files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0 || readonly || !item) return;
    const saved = await ensureSaved({ allowEmptyCreate: true });
    if (!saved.ok || !saved.reportId) return;
    let regularItemId = resolveSavedRegularItemId(saved.report, item);
    if (!regularItemId) {
      const refreshed = await loadForEdit({ quiet: true, reportId: saved.reportId });
      regularItemId = resolveSavedRegularItemId(refreshed, item);
    }
    if (!regularItemId) {
      setError("报销项目尚未保存完成，请稍后重试上传");
      return;
    }
    let uploadedCount = 0;
    const issues = [];
    setError("");
    setUploadState({ kind: "evidence", regularItemId, current: 0, total: fileList.length, name: fileList[0].name });
    try {
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        setUploadState({ kind: "evidence", regularItemId, current: index + 1, total: fileList.length, name: file.name });
        try {
          const response = await uploadReportAttachment({ reportId: saved.reportId, regularItemId, file });
          if (!response.success) throw new Error(response.message || "凭据上传失败");
          uploadedCount += 1;
        } catch (uploadError) {
          issues.push(`${file.name || "未命名文件"}：${getApiErrorMessage(uploadError, "上传失败")}`);
        }
      }
      if (uploadedCount > 0) await loadForEdit({ quiet: true, reportId: saved.reportId });
      if (issues.length > 0) setError(`部分凭据未上传：\n${issues.join("\n")}`);
      if (uploadedCount > 0) setToast(`已上传 ${uploadedCount} 个报销凭据`);
    } finally {
      setUploadState(null);
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    setError("");
    try {
      const deleted = await runAfterRegularReportSaved({
        ensureSaved,
        action: async (saved) => {
          const response = await deleteInvoice(invoiceId);
          if (!response.success) throw new Error(response.message || "删除发票失败");
          await loadForEdit({ quiet: true, reportId: saved.reportId });
        },
      });
      if (!deleted) return;
      setToast("发票已删除");
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "删除发票失败"));
    }
  };

  const handleDeleteEvidence = async (attachmentId) => {
    setError("");
    try {
      const deleted = await runAfterRegularReportSaved({
        ensureSaved,
        action: async (saved) => {
          const response = await deleteReportAttachment(attachmentId);
          if (!response.success) throw new Error(response.message || "删除凭据失败");
          await loadForEdit({ quiet: true, reportId: saved.reportId });
        },
      });
      if (!deleted) return;
      setToast("凭据已删除");
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "删除凭据失败"));
    }
  };

  const handleInvoiceUpdated = async () => {
    const refreshed = await runAfterRegularReportSaved({
      ensureSaved,
      action: (saved) => loadForEdit({ quiet: true, reportId: saved.reportId }),
    });
    if (!refreshed) return false;
    setInvoiceQueue((current) => {
      const next = current.slice(1);
      setSelectedInvoice(next[0] || null);
      return next;
    });
    return true;
  };

  const handleInvoiceSkipped = () => {
    setInvoiceQueue((current) => {
      const next = current.slice(1);
      setSelectedInvoice(next[0] || null);
      return next;
    });
  };

  const handleStatusAction = async (target) => {
    const saved = await ensureSaved();
    if (!saved.ok || !saved.reportId) return;
    if (status === "draft" && target !== "draft") {
      const validationError = validateRegularReport({ form, mode, items, invoices });
      if (validationError) {
        setError(validationError);
        setToast(validationError);
        return;
      }
    }
    setError("");
    setSaveState("saving");
    try {
      const response = await updateReportStatus(saved.reportId, target);
      if (!response.success) throw new Error(response.message || "状态更新失败");
      const nextReportDate = response.data?.report_date || "";
      const nextForm = { ...form, report_date: nextReportDate };
      const nextPayload = buildRegularReportPayload({
        form: nextForm,
        mode,
        items,
        invoices,
        attachments,
      });
      const nextPayloadKey = JSON.stringify(nextPayload);
      setStatus(response.data?.status || target);
      setForm((current) => ({ ...current, report_date: nextReportDate }));
      setDefaults((current) => ({ ...current, report_date: nextReportDate }));
      lastSavedPayloadRef.current = nextPayloadKey;
      latestPayloadRef.current = nextPayload;
      latestPayloadKeyRef.current = nextPayloadKey;
      setSaveState("saved");
      setToast("状态已更新");
    } catch (statusError) {
      setError(getApiErrorMessage(statusError, "状态更新失败"));
      setSaveState("error");
    }
  };

  const handlePreview = async () => {
    if (pdfGate.previewBlocked) {
      setPdfBlockedOpen(true);
      return;
    }
    const saved = await ensureSaved({ allowEmptyCreate: true });
    if (!saved.ok || !saved.reportId) return;
    setPdfBusy("preview");
    setError("");
    try {
      const response = await getReportPdfPreview(saved.reportId);
      if (!response.success) throw new Error(response.message || "生成 PDF 预览失败");
      setPreviewPages(response.data?.pages || []);
      setPreviewOpen(true);
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, "生成 PDF 预览失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const handleDownload = async () => {
    if (pdfGate.downloadBlocked) {
      setPdfBlockedOpen(true);
      return;
    }
    const saved = await ensureSaved();
    if (!saved.ok || !saved.reportId) return;
    setPdfBusy("download");
    setError("");
    try {
      const result = await prepareReportPdfDownload(saved.reportId);
      if (!result.success || !result.data?.download_url) {
        throw new Error(result.message || "生成下载链接失败");
      }
      triggerBrowserDownload(result.data.download_url);
      setToast("PDF 已生成，请在下载窗口选择保存位置");
    } catch (downloadError) {
      setError(getApiErrorMessage(downloadError, "下载 PDF 失败"));
    } finally {
      setPdfBusy("");
    }
  };

  const pageView = {
    loading,
    error,
    readonly,
    statusMeta: STATUS_META[status] || { label: status, chipSx: {} },
    saveMeta: getSaveStateMeta(saveState),
    saveState,
    reportId: activeReportId,
    mode,
    statusActions: STATUS_ACTIONS[status] || [],
    pdfBusy,
    pdfGate,
    canSave: activeReportId ? hasUnsavedChanges : !emptyDraft,
    onBack: () => requestNavigation("/regular-reports"),
    onSave: () => saveReport({ quiet: false, force: true }),
    onStatusAction: handleStatusAction,
    onPreview: handlePreview,
    onDownload: handleDownload,
  };
  const headerView = {
    form,
    onChange: (field, value) => {
      setError("");
      setForm((current) => ({ ...current, [field]: value }));
    },
  };
  const editorView = {
    items,
    invoices,
    attachments,
    summary,
    uploadState,
    dragIndex,
    onAdd: handleAddItem,
    onUpdate: handleUpdateItem,
    onMove: handleMoveItem,
    onDragStart: handleItemDragStart,
    onDrop: handleItemDrop,
    onDragEnd: handleItemDragEnd,
    onDelete: handleDeleteItem,
    onInvoiceFiles: handleInvoiceFiles,
    onEvidenceFiles: handleEvidenceFiles,
    onDeleteInvoice: handleDeleteInvoice,
    onDeleteEvidence: handleDeleteEvidence,
    onUploadError: setError,
  };
  const invoiceFlowView = {
    selectedInvoice,
    invoiceQueue,
    uploadResult,
    onSelectInvoice: setSelectedInvoice,
    onCloseViewer: () => { setSelectedInvoice(null); setInvoiceQueue([]); },
    onInvoiceUpdated: handleInvoiceUpdated,
    onInvoiceSkipped: handleInvoiceSkipped,
    onUploadResultClose: () => setUploadResult(null),
    onUploadResultContinue: () => {
      const queue = uploadResult?.uploadedInvoices || [];
      setUploadResult(null);
      setInvoiceQueue(queue);
      setSelectedInvoice(queue[0] || null);
    },
  };
  const overlayView = {
    previewOpen,
    previewPages,
    onClosePreview: () => setPreviewOpen(false),
    pdfBlockedOpen,
    onClosePdfBlocked: () => setPdfBlockedOpen(false),
    toast,
    onCloseToast: () => setToast(""),
  };

  if (!routeId && !isRegularMode(requestedMode)) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Alert severity="error">无效的常规报销模式，请从列表重新选择“无票报销”或“有票报销”。</Alert>
        <Button variant="contained" onClick={() => requestNavigation("/regular-reports")} sx={{ alignSelf: "flex-start" }}>
          返回常规报销单
        </Button>
      </Stack>
    );
  }

  return <RegularReportEditView page={pageView} header={headerView} editor={editorView} invoiceFlow={invoiceFlowView} overlays={overlayView} />;
}
