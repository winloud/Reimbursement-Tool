import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  batchDeleteReports,
  batchPurgeReports,
  batchRestoreReports,
  batchUpdateReportStatus,
  deleteReport,
  prepareDataExport,
  executeDataImport,
  getReportFilterOptions,
  getReportPdfPreview,
  getReports,
  getTrashReports,
  previewDataImport,
  prepareReportBatchPdfDownload,
  prepareReportPdfDownload,
  purgeReport,
  restoreReport,
  updateReportStatus,
} from "../api/client";
import { DEFAULT_REPORT_FILTERS } from "../api/reportFilters";
import { triggerBrowserDownload } from "../utils/browserDownload";
import {
  formatBatchPdfFailureMessage,
  isReportStatusVisible,
  isTrashStatus,
  toggleCurrentPageSelection,
  toggleReportSelection,
} from "./reportListUtils";
import {
  getBatchReportStatusActions,
  getReportStatusLabel,
  STATUS_META,
} from "./reportStatus";
import ReportListView from "./ReportListView";

const INVOICE_STATE_OPTIONS = [
  { value: "all", label: "全部发票" },
  { value: "has_unconfirmed", label: "有未确认发票" },
  { value: "all_confirmed", label: "全部已确认" },
  { value: "no_invoice", label: "无发票" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "全部类别" },
  { value: "transport_fare", label: "车船费" },
  { value: "luggage", label: "行李费" },
  { value: "city_transport", label: "市内交通费" },
  { value: "accommodation", label: "住宿费" },
  { value: "postal", label: "邮电费" },
  { value: "no_sleeper_subsidy", label: "未乘卧铺补助" },
  { value: "toll", label: "通行费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

const HAS_ATTACHMENT_OPTIONS = [
  { value: "all", label: "附件不限" },
  { value: "yes", label: "有附件" },
  { value: "no", label: "无附件" },
];

const errorMessage = (err, fallback) => {
  const data = err.response?.data;
  if (data?.detail?.failures?.length) {
    return formatBatchPdfFailureMessage(data.detail.failures);
  }
  if (typeof data?.detail === "string") {
    return data.detail;
  }
  return data?.message || err.message || fallback;
};

const reportListStateFromSearch = (search) => {
  const params = new URLSearchParams(search);
  return {
    status: params.get("status") || "all",
    page: Math.max(0, Number(params.get("page") || 1) - 1),
    filters: {
      ...DEFAULT_REPORT_FILTERS,
      reportStart: params.get("report_start") || DEFAULT_REPORT_FILTERS.reportStart,
      reportEnd: params.get("report_end") || DEFAULT_REPORT_FILTERS.reportEnd,
      tripStart: params.get("trip_start") || DEFAULT_REPORT_FILTERS.tripStart,
      tripEnd: params.get("trip_end") || DEFAULT_REPORT_FILTERS.tripEnd,
      statuses: params.get("statuses") || DEFAULT_REPORT_FILTERS.statuses,
    },
  };
};

export default function ReportList() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialState = reportListStateFromSearch(location.search);
  const [status, setStatus] = useState(initialState.status);
  const [filters, setFilters] = useState(initialState.filters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState(CATEGORY_OPTIONS);
  const [page, setPage] = useState(initialState.page);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [batchResult, setBatchResult] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [pendingPurge, setPendingPurge] = useState(null);
  const [pendingBatchPurge, setPendingBatchPurge] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [previewState, setPreviewState] = useState({
    open: false,
    report: null,
    pages: [],
    loading: false,
    error: "",
  });
  const [downloadingId, setDownloadingId] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [batchStatusMenuAnchor, setBatchStatusMenuAnchor] = useState(null);
  const [batchActionMenuAnchor, setBatchActionMenuAnchor] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importStrategy, setImportStrategy] = useState("import_as_new");
  const [confirmReimbursedOverwrite, setConfirmReimbursedOverwrite] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const selectionFocusRef = useRef(null);
  const isTrash = isTrashStatus(status);
  const tableColumnCount = isTrash ? 11 : 10;

  useEffect(() => {
    const nextState = reportListStateFromSearch(location.search);
    setStatus(nextState.status);
    setFilters(nextState.filters);
    setPage(nextState.page);
  }, [location.search]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res =
        status === "trash"
          ? await getTrashReports({ page: page + 1, pageSize, reportType: "travel", filters })
          : await getReports({ page: page + 1, pageSize, status, reportType: "travel", filters });
      if (res.success) {
        setItems(res.data.items);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, status]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    setSelectedIds([]);
  }, [filters, page, pageSize, status]);

  useEffect(() => {
    selectionFocusRef.current?.focus();
    selectionFocusRef.current = null;
  }, [selectedIds]);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setBatchStatusMenuAnchor(null);
      setBatchActionMenuAnchor(null);
    }
  }, [selectedIds.length]);

  useEffect(() => {
    let ignore = false;
    const fetchOptions = async () => {
      try {
        const res = await getReportFilterOptions({ reportType: "travel" });
        if (!ignore && res.success) {
          setCategoryOptions([{ value: "", label: "全部类别" }, ...(res.data.categories || [])]);
        }
      } catch {
        // 固定类别兜底即可，筛选列表加载失败不影响报销单列表使用。
      }
    };
    fetchOptions();
    return () => {
      ignore = true;
    };
  }, []);

  const handleStatusChange = (_event, value) => {
    setStatus(value);
    setFilters((current) => ({ ...current, statuses: DEFAULT_REPORT_FILTERS.statuses }));
    setPage(0);
  };

  const handleFilterChange = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(0);
  };

  const handleResetFilters = () => {
    setFilters({ ...DEFAULT_REPORT_FILTERS });
    setPage(0);
  };

  const clearFilter = (key) => {
    setFilters((current) => ({ ...current, [key]: DEFAULT_REPORT_FILTERS[key] }));
    setPage(0);
  };

  const categoryLabel = (value) => categoryOptions.find((option) => option.value === value)?.label || value;
  const invoiceStateLabel = (value) => INVOICE_STATE_OPTIONS.find((option) => option.value === value)?.label || value;
  const attachmentLabel = (value) => HAS_ATTACHMENT_OPTIONS.find((option) => option.value === value)?.label || value;
  const activeFilterChips = [
    filters.statuses && { key: "statuses", label: "状态：待报销 + 已报销" },
    filters.reportStart && { key: "reportStart", label: `报销开始：${filters.reportStart}` },
    filters.reportEnd && { key: "reportEnd", label: `报销结束：${filters.reportEnd}` },
    filters.keyword && { key: "keyword", label: `关键词：${filters.keyword}` },
    filters.tripStart && { key: "tripStart", label: `开始：${filters.tripStart}` },
    filters.tripEnd && { key: "tripEnd", label: `结束：${filters.tripEnd}` },
    filters.category && { key: "category", label: `类别：${categoryLabel(filters.category)}` },
    filters.amountMin && { key: "amountMin", label: `金额下限：${filters.amountMin}` },
    filters.amountMax && { key: "amountMax", label: `金额上限：${filters.amountMax}` },
    filters.invoiceState !== "all" && { key: "invoiceState", label: `发票：${invoiceStateLabel(filters.invoiceState)}` },
    filters.hasAttachment !== "all" && { key: "hasAttachment", label: attachmentLabel(filters.hasAttachment) },
    filters.subsidyDaysMin && { key: "subsidyDaysMin", label: `天数下限：${filters.subsidyDaysMin}` },
    filters.subsidyDaysMax && { key: "subsidyDaysMax", label: `天数上限：${filters.subsidyDaysMax}` },
  ].filter(Boolean);

  const selectedSet = new Set(selectedIds);
  const pageIds = items.map((item) => item.id);
  const selectedCount = selectedIds.length;
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
  const somePageSelected = pageIds.some((id) => selectedSet.has(id));
  const selectedReports = items.filter((item) => selectedSet.has(item.id));
  const batchStatusMenuActions = getBatchReportStatusActions(selectedReports);
  const handleToggleReport = (reportId, focusTarget) => {
    selectionFocusRef.current = focusTarget;
    setSelectedIds((current) => toggleReportSelection(current, reportId));
  };

  const handleToggleCurrentPage = (event) => {
    selectionFocusRef.current = event.currentTarget;
    setSelectedIds((current) => toggleCurrentPageSelection(current, pageIds, event.target.checked));
  };

  const handleDeleteReport = async (action) => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = action === "purge" ? await purgeReport(pendingDelete.id) : await deleteReport(pendingDelete.id);
      if (res.success) {
        setPendingDelete(null);
        setSelectedIds((current) => current.filter((id) => id !== pendingDelete.id));
        setBatchResult({
          severity: "success",
          message: action === "purge" ? "报销单已彻底删除" : "报销单已放入回收站",
        });
        await fetchReports();
      } else {
        setError(res.message || "删除失败");
      }
    } catch (err) {
      setError(errorMessage(err, "删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDataExport = async (reportIds) => {
    setExporting(true);
    setError("");
    setBatchResult(null);
    try {
      const result = await prepareDataExport({ status, reportType: "travel", filters, reportIds });
      if (!result.success || !result.data?.download_url) {
        throw new Error(result.message || "生成下载链接失败");
      }
      triggerBrowserDownload(result.data.download_url);
      if (reportIds?.length) {
        setBatchResult({
          severity: "success",
          message: `已生成 ${reportIds.length} 张报销单的数据包，请在下载窗口选择保存位置。`,
        });
      }
    } catch (err) {
      setError(errorMessage(err, "导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => handleDataExport();
  const handleExportSelected = () => handleDataExport(selectedIds);

  const handlePreviewReport = async (report) => {
    setPreviewState({ open: true, report, pages: [], loading: true, error: "" });
    try {
      const res = await getReportPdfPreview(report.id);
      if (res.success) {
        setPreviewState({ open: true, report, pages: res.data.pages || [], loading: false, error: "" });
      } else {
        setPreviewState({ open: true, report, pages: [], loading: false, error: res.message || "预览失败" });
      }
    } catch (err) {
      setPreviewState({ open: true, report, pages: [], loading: false, error: errorMessage(err, "预览失败") });
    }
  };

  const handleDownloadReport = async (report) => {
    setDownloadingId(report.id);
    setError("");
    setBatchResult(null);
    try {
      const res = await prepareReportPdfDownload(report.id);
      if (!res.success || !res.data?.download_url) {
        throw new Error(res.message || "生成下载链接失败");
      }
      triggerBrowserDownload(res.data.download_url);
    } catch (err) {
      setError(errorMessage(err, "下载失败"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) return;
    setBatchLoading(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await prepareReportBatchPdfDownload(selectedIds);
      if (!res.success || !res.data?.download_url) {
        throw new Error(res.message || "生成批量下载链接失败");
      }
      triggerBrowserDownload(res.data.download_url);
      setBatchResult({
        severity: "success",
        message: `已生成 ${selectedIds.length} 张报销单 PDF，请在下载窗口选择保存位置。`,
      });
    } catch (err) {
      setError(errorMessage(err, "批量下载失败"));
    } finally {
      setBatchLoading(false);
    }
  };

  const handleSingleStatusUpdate = async (report, target) => {
    if (!report || !target) return;
    setStatusUpdatingId(report.id);
    setError("");
    setBatchResult(null);
    try {
      const res = await updateReportStatus(report.id, target);
      if (res.success) {
        const updatedReport = { ...report, ...res.data, status: res.data?.status || target };
        const remainsVisible = isReportStatusVisible(
          { tab: status, statuses: filters.statuses },
          updatedReport.status,
        );
        if (remainsVisible) {
          setItems((current) => current.map((item) => (item.id === report.id ? { ...item, ...updatedReport } : item)));
        } else {
          setItems((current) => current.filter((item) => item.id !== report.id));
          setTotal((current) => Math.max(0, current - 1));
        }
        setSelectedIds((current) => current.filter((id) => id !== report.id));
      } else {
        setError(res.message || "修改状态失败");
      }
    } catch (err) {
      setError(errorMessage(err, "修改状态失败"));
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleSingleStatusRequest = (report, target) => handleSingleStatusUpdate(report, target);

  const handleBatchStatusUpdate = async (target, reportIds = selectedIds) => {
    if (reportIds.length === 0 || !target) return;
    setBatchStatusUpdating(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await batchUpdateReportStatus(reportIds, target);
      if (res.success) {
        const skippedText = res.data.skipped_count
          ? `，跳过 ${res.data.skipped_count} 张：${res.data.skipped
              .map((item) => `${item.report_id} ${item.reason}`)
              .join("；")}`
          : "";
        setBatchResult({
          severity: res.data.skipped_count ? "warning" : "success",
          message: `已将 ${res.data.updated_count} 张报销单改为${getReportStatusLabel(target)}${skippedText}`,
        });
        setSelectedIds([]);
        await fetchReports();
      } else {
        setError(res.message || "批量修改状态失败");
      }
    } catch (err) {
      setError(errorMessage(err, "批量修改状态失败"));
    } finally {
      setBatchStatusUpdating(false);
    }
  };

  const handleBatchStatusRequest = (action) => {
    if (!action) return;
    setBatchStatusMenuAnchor(null);
    handleBatchStatusUpdate(action.target);
  };

  const handleClearSelection = () => {
    setBatchStatusMenuAnchor(null);
    setBatchActionMenuAnchor(null);
    setSelectedIds([]);
  };

  const handleConfirmBatchDelete = async (action) => {
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = action === "purge" ? await batchPurgeReports(selectedIds) : await batchDeleteReports(selectedIds);
      if (res.success) {
        const skippedText = res.data.skipped_count
          ? `，跳过 ${res.data.skipped_count} 张：${res.data.skipped
              .map((item) => `${item.report_id} ${item.reason}`)
              .join("；")}`
          : "";
        const handledCount = action === "purge" ? res.data.purged_count : res.data.deleted_count;
        setBatchResult({
          severity: res.data.skipped_count ? "warning" : "success",
          message:
            action === "purge"
              ? `已彻底删除 ${handledCount} 张草稿${skippedText}`
              : `已放入回收站 ${handledCount} 张草稿${skippedText}`,
        });
        setPendingBatchDelete(false);
        setSelectedIds([]);
        await fetchReports();
      } else {
        setError(res.message || "批量删除失败");
      }
    } catch (err) {
      setError(errorMessage(err, "批量删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  const handleBatchRestore = async () => {
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await batchRestoreReports(selectedIds);
      if (res.success) {
        const skippedText = res.data.skipped_count
          ? `，跳过 ${res.data.skipped_count} 张：${res.data.skipped
              .map((item) => `${item.report_id} ${item.reason}`)
              .join("；")}`
          : "";
        setBatchResult({
          severity: res.data.skipped_count ? "warning" : "success",
          message: `已恢复 ${res.data.restored_count} 张草稿${skippedText}`,
        });
        setSelectedIds([]);
        await fetchReports();
      } else {
        setError(res.message || "批量恢复失败");
      }
    } catch (err) {
      setError(errorMessage(err, "批量恢复失败"));
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmBatchPurge = async () => {
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await batchPurgeReports(selectedIds);
      if (res.success) {
        const skippedText = res.data.skipped_count
          ? `，跳过 ${res.data.skipped_count} 张：${res.data.skipped
              .map((item) => `${item.report_id} ${item.reason}`)
              .join("；")}`
          : "";
        setBatchResult({
          severity: res.data.skipped_count ? "warning" : "success",
          message: `已彻底删除 ${res.data.purged_count} 张草稿${skippedText}`,
        });
        setPendingBatchPurge(false);
        setSelectedIds([]);
        await fetchReports();
      } else {
        setError(res.message || "批量彻底删除失败");
      }
    } catch (err) {
      setError(errorMessage(err, "批量彻底删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  const handlePurgeReport = async () => {
    if (!pendingPurge) return;
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await purgeReport(pendingPurge.id);
      if (res.success) {
        setPendingPurge(null);
        setSelectedIds((current) => current.filter((id) => id !== pendingPurge.id));
        setBatchResult({ severity: "success", message: "报销单已彻底删除" });
        await fetchReports();
      } else {
        setError(res.message || "彻底删除失败");
      }
    } catch (err) {
      setError(errorMessage(err, "彻底删除失败"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreReport = async (report) => {
    setDeleting(true);
    setError("");
    setBatchResult(null);
    try {
      const res = await restoreReport(report.id);
      if (res.success) {
        setSelectedIds((current) => current.filter((id) => id !== report.id));
        setBatchResult({ severity: "success", message: "报销单已恢复" });
        await fetchReports();
      } else {
        setError(res.message || "恢复失败");
      }
    } catch (err) {
      setError(errorMessage(err, "恢复失败"));
    } finally {
      setDeleting(false);
    }
  };

  const resetImportDialog = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportStrategy("import_as_new");
    setConfirmReimbursedOverwrite(false);
    setImportError("");
    setImportResult(null);
  };

  const handleOpenImport = () => {
    resetImportDialog();
    setImportOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("import_data") !== "1") return;
    handleOpenImport();
    params.delete("import_data");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const handlePreviewImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportError("");
    setImportResult(null);
    try {
      const res = await previewDataImport(importFile);
      if (res.success) {
        setImportPreview(res.data);
      } else {
        setImportError(res.message || "导入预览失败");
      }
    } catch (err) {
      setImportError(err.response?.data?.message || err.message || "导入预览失败");
    } finally {
      setImportLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!importPreview) return;
    setImportLoading(true);
    setImportError("");
    try {
      const res = await executeDataImport({
        preview_id: importPreview.preview_id,
        strategy: importStrategy,
        confirm_reimbursed_overwrite: confirmReimbursedOverwrite,
      });
      if (res.success) {
        setImportResult(res.data);
        await fetchReports();
      } else {
        setImportError(res.message || "导入失败");
      }
    } catch (err) {
      setImportError(err.response?.data?.message || err.message || "导入失败");
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <ReportListView
      status={status}
      selectedCount={selectedCount}
      isTrash={isTrash}
      handleBatchRestore={handleBatchRestore}
      batchLoading={batchLoading}
      deleting={deleting}
      batchStatusMenuActions={batchStatusMenuActions}
      batchStatusUpdating={batchStatusUpdating}
      statusUpdatingId={statusUpdatingId}
      batchStatusMenuAnchor={batchStatusMenuAnchor}
      setBatchStatusMenuAnchor={setBatchStatusMenuAnchor}
      batchActionMenuAnchor={batchActionMenuAnchor}
      setBatchActionMenuAnchor={setBatchActionMenuAnchor}
      handleOpenImport={handleOpenImport}
      handleExport={handleExport}
      handleExportSelected={handleExportSelected}
      exporting={exporting}
      error={error}
      batchResult={batchResult}
      handleStatusChange={handleStatusChange}
      filters={filters}
      handleFilterChange={handleFilterChange}
      categoryOptions={categoryOptions}
      advancedOpen={advancedOpen}
      setAdvancedOpen={setAdvancedOpen}
      handleResetFilters={handleResetFilters}
      activeFilterChips={activeFilterChips}
      clearFilter={clearFilter}
      items={items}
      loading={loading}
      tableColumnCount={tableColumnCount}
      allPageSelected={allPageSelected}
      somePageSelected={somePageSelected}
      handleToggleCurrentPage={handleToggleCurrentPage}
      selectedSet={selectedSet}
      handleToggleReport={handleToggleReport}
      navigate={navigate}
      handleSingleStatusRequest={handleSingleStatusRequest}
      handleRestoreReport={handleRestoreReport}
      setPendingPurge={setPendingPurge}
      handlePreviewReport={handlePreviewReport}
      handleDownloadReport={handleDownloadReport}
      downloadingId={downloadingId}
      setPendingDelete={setPendingDelete}
      total={total}
      page={page}
      setPage={setPage}
      pageSize={pageSize}
      setPageSize={setPageSize}
      handleBatchStatusRequest={handleBatchStatusRequest}
      handleBatchDownload={handleBatchDownload}
      setPendingBatchPurge={setPendingBatchPurge}
      setPendingBatchDelete={setPendingBatchDelete}
      handleClearSelection={handleClearSelection}
      pendingDelete={pendingDelete}
      handleDeleteReport={handleDeleteReport}
      pendingBatchDelete={pendingBatchDelete}
      handleConfirmBatchDelete={handleConfirmBatchDelete}
      pendingPurge={pendingPurge}
      handlePurgeReport={handlePurgeReport}
      pendingBatchPurge={pendingBatchPurge}
      handleConfirmBatchPurge={handleConfirmBatchPurge}
      previewState={previewState}
      setPreviewState={setPreviewState}
      importOpen={importOpen}
      setImportOpen={setImportOpen}
      importLoading={importLoading}
      importError={importError}
      importResult={importResult}
      importFile={importFile}
      setImportFile={setImportFile}
      setImportPreview={setImportPreview}
      setImportResult={setImportResult}
      setImportError={setImportError}
      handlePreviewImport={handlePreviewImport}
      importPreview={importPreview}
      importStrategy={importStrategy}
      setImportStrategy={setImportStrategy}
      confirmReimbursedOverwrite={confirmReimbursedOverwrite}
      setConfirmReimbursedOverwrite={setConfirmReimbursedOverwrite}
      handleExecuteImport={handleExecuteImport}
    />
  );
}
