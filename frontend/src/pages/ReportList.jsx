import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import {
  batchDeleteReports,
  batchPurgeReports,
  batchRestoreReports,
  deleteReport,
  downloadDataExport,
  downloadReportBatchPdf,
  downloadReportPdf,
  executeDataImport,
  getReportFilterOptions,
  getReportPdfPreview,
  getReports,
  getTrashReports,
  previewDataImport,
  purgeReport,
  restoreReport,
} from "../api/client";
import { DEFAULT_REPORT_FILTERS } from "../api/reportFilters";
import {
  formatBatchPdfFailureMessage,
  isTrashStatus,
  toggleCurrentPageSelection,
  toggleReportSelection,
} from "./reportListUtils";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "printed", label: "已打印" },
  { value: "reimbursed", label: "已报销" },
  { value: "trash", label: "回收站" },
];

const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  printed: { label: "已打印", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

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
  { value: "toll", label: "过路费" },
  { value: "fuel_subsidy", label: "燃油补助" },
];

const HAS_ATTACHMENT_OPTIONS = [
  { value: "all", label: "附件不限" },
  { value: "yes", label: "有附件" },
  { value: "no", label: "无附件" },
];

const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value) => value || "—";

const formatDateTime = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
};

const DELETE_WARNING_TEXT =
  "彻底删除会永久删除报销单、行程、费用项、发票记录和发票附件，无法恢复。放入回收站后可在回收站恢复或彻底删除。";

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

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
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importStrategy, setImportStrategy] = useState("import_as_new");
  const [confirmReimbursedOverwrite, setConfirmReimbursedOverwrite] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const isTrash = isTrashStatus(status);

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
          ? await getTrashReports({ page: page + 1, pageSize, filters })
          : await getReports({ page: page + 1, pageSize, status, filters });
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
    let ignore = false;
    const fetchOptions = async () => {
      try {
        const res = await getReportFilterOptions();
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

  const handleToggleReport = (reportId) => {
    setSelectedIds((current) => toggleReportSelection(current, reportId));
  };

  const handleToggleCurrentPage = (event) => {
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

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const { blob, filename } = await downloadDataExport({ status, filters });
      saveBlob(blob, filename || "expense-data.zip");
    } catch (err) {
      setError(errorMessage(err, "导出失败"));
    } finally {
      setExporting(false);
    }
  };

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
      const { blob, filename } = await downloadReportPdf(report.id);
      saveBlob(blob, filename || "expense-report.pdf");
      await fetchReports();
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
      const { blob, filename } = await downloadReportBatchPdf(selectedIds);
      saveBlob(blob, filename || "expense-reports.zip");
      setBatchResult({ severity: "success", message: `已下载 ${selectedIds.length} 张报销单 PDF。` });
      setSelectedIds([]);
      await fetchReports();
    } catch (err) {
      setError(errorMessage(err, "批量下载失败"));
    } finally {
      setBatchLoading(false);
    }
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
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", lg: "center" }}
        spacing={2}
      >
        <div>
          <Typography variant="h5" fontWeight={700}>
            报销单管理
          </Typography>
          <Typography color="text.secondary">管理出差报销单，支持新增、编辑、删除与多条件筛选。</Typography>
        </div>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))", lg: "auto auto auto" },
            gap: 1,
            alignItems: "center",
            width: { xs: "100%", lg: "auto" },
          }}
        >
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={handleOpenImport}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
          >
            导入数据包
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={handleExport}
            disabled={exporting || isTrash}
            sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
          >
            {exporting ? "导出中..." : "导出当前筛选"}
          </Button>
          <Button
            component={RouterLink}
            to="/reports/new"
            variant="contained"
            sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
          >
            新增报销单
          </Button>
        </Box>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {batchResult && <Alert severity={batchResult.severity}>{batchResult.message}</Alert>}

      <Card>
        <Tabs value={status} onChange={handleStatusChange} sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}>
          {STATUS_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>

        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} alignItems={{ xs: "stretch", lg: "center" }}>
            <TextField
              size="small"
              label="关键词"
              value={filters.keyword}
              onChange={handleFilterChange("keyword")}
              placeholder="事由 / 人员 / 部门 / ID"
              sx={{ minWidth: { lg: 260 }, flex: 1.4 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              size="small"
              label="行程开始"
              type="date"
              value={filters.tripStart}
              onChange={handleFilterChange("tripStart")}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { lg: 158 } }}
            />
            <TextField
              size="small"
              label="行程结束"
              type="date"
              value={filters.tripEnd}
              onChange={handleFilterChange("tripEnd")}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: { lg: 158 } }}
            />
            <TextField
              select
              size="small"
              label="费用类别"
              value={filters.category}
              onChange={handleFilterChange("category")}
              sx={{ minWidth: { lg: 170 } }}
            >
              {categoryOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant={advancedOpen ? "contained" : "outlined"}
              startIcon={<TuneIcon />}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 160ms ease",
                  }}
                />
              }
              onClick={() => setAdvancedOpen((open) => !open)}
              sx={{ minHeight: 40, whiteSpace: "nowrap" }}
            >
              更多筛选
            </Button>
            <Button variant="text" onClick={handleResetFilters} disabled={activeFilterChips.length === 0}>
              重置
            </Button>
          </Stack>

          <Collapse in={advancedOpen} timeout="auto" unmountOnExit>
            <Box
              sx={{
                mt: 1.5,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 1.5,
              }}
            >
              <TextField
                size="small"
                label="报销开始"
                type="date"
                value={filters.reportStart}
                onChange={handleFilterChange("reportStart")}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                label="报销结束"
                type="date"
                value={filters.reportEnd}
                onChange={handleFilterChange("reportEnd")}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                label="金额下限"
                type="number"
                value={filters.amountMin}
                onChange={handleFilterChange("amountMin")}
                inputProps={{ min: 0, step: "0.01" }}
              />
              <TextField
                size="small"
                label="金额上限"
                type="number"
                value={filters.amountMax}
                onChange={handleFilterChange("amountMax")}
                inputProps={{ min: 0, step: "0.01" }}
              />
              <TextField
                select
                size="small"
                label="发票状态"
                value={filters.invoiceState}
                onChange={handleFilterChange("invoiceState")}
              >
                {INVOICE_STATE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="附件"
                value={filters.hasAttachment}
                onChange={handleFilterChange("hasAttachment")}
              >
                {HAS_ATTACHMENT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="天数下限"
                type="number"
                value={filters.subsidyDaysMin}
                onChange={handleFilterChange("subsidyDaysMin")}
                inputProps={{ min: 0, step: 1 }}
              />
              <TextField
                size="small"
                label="天数上限"
                type="number"
                value={filters.subsidyDaysMax}
                onChange={handleFilterChange("subsidyDaysMax")}
                inputProps={{ min: 0, step: 1 }}
              />
            </Box>
          </Collapse>

          {activeFilterChips.length > 0 && (
            <Stack direction="row" flexWrap="wrap" sx={{ gap: 1, mt: 1.5 }}>
              {activeFilterChips.map((chip) => (
                <Chip key={chip.key} size="small" label={chip.label} onDelete={() => clearFilter(chip.key)} />
              ))}
            </Stack>
          )}
        </Box>

        {selectedCount > 0 && (
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: "action.hover",
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              已选 {selectedCount} 张报销单
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ gap: 1 }}>
              {isTrash ? (
                <>
                  <Button size="small" variant="contained" onClick={handleBatchRestore} disabled={batchLoading || deleting}>
                    批量恢复
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => setPendingBatchPurge(true)}
                    disabled={batchLoading || deleting}
                  >
                    彻底删除
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<FileDownloadIcon />}
                    onClick={handleBatchDownload}
                    disabled={batchLoading || deleting}
                  >
                    {batchLoading ? "下载中..." : "批量下载"}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => setPendingBatchDelete(true)}
                    disabled={batchLoading || deleting}
                  >
                    删除草稿
                  </Button>
                </>
              )}
              <Button size="small" variant="text" onClick={() => setSelectedIds([])} disabled={batchLoading || deleting}>
                清除选择
              </Button>
            </Stack>
          </Box>
        )}

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allPageSelected}
                    indeterminate={!allPageSelected && somePageSelected}
                    onChange={handleToggleCurrentPage}
                    disabled={items.length === 0 || loading}
                  />
                </TableCell>
                <TableCell>报销日期</TableCell>
                <TableCell>出差事由</TableCell>
                <TableCell align="center">补贴天数</TableCell>
                <TableCell align="right">报销总金额</TableCell>
                <TableCell align="center">状态</TableCell>
                {isTrash && <TableCell>删除时间</TableCell>}
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isTrash ? 8 : 7} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isTrash ? 8 : 7} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">暂无数据</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((report) => {
                  const meta = STATUS_META[report.status] || { label: report.status, color: "default" };
                  return (
                    <TableRow
                      key={report.id}
                      hover
                      selected={selectedSet.has(report.id)}
                      onClick={() => {
                        if (!isTrash) navigate(`/reports/${report.id}/edit`);
                      }}
                      sx={!isTrash ? { cursor: "pointer" } : undefined}
                    >
                      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          size="small"
                          checked={selectedSet.has(report.id)}
                          onChange={() => handleToggleReport(report.id)}
                        />
                      </TableCell>
                      <TableCell>{formatDate(report.report_date)}</TableCell>
                      <TableCell>{report.purpose || "—"}</TableCell>
                      <TableCell align="center">{report.subsidy_days ?? 0}</TableCell>
                      <TableCell align="right">{formatAmount(report.total_amount)}</TableCell>
                      <TableCell align="center">
                        <Chip size="small" color={meta.color} label={meta.label} />
                      </TableCell>
                      {isTrash && <TableCell>{formatDateTime(report.deleted_at)}</TableCell>}
                      <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, justifyContent: "flex-end" }}>
                          {isTrash ? (
                            <>
                              <Button size="small" onClick={() => handleRestoreReport(report)} disabled={deleting}>
                                恢复
                              </Button>
                              <Button size="small" color="error" onClick={() => setPendingPurge(report)} disabled={deleting}>
                                彻底删除
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="small" startIcon={<VisibilityIcon />} onClick={() => handlePreviewReport(report)}>
                                预览
                              </Button>
                              <Button
                                size="small"
                                startIcon={<FileDownloadIcon />}
                                onClick={() => handleDownloadReport(report)}
                                disabled={downloadingId === report.id}
                              >
                                {downloadingId === report.id ? "下载中" : "下载"}
                              </Button>
                              <Button size="small" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                                编辑
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                disabled={report.status !== "draft"}
                                onClick={() => setPendingDelete(report)}
                              >
                                删除
                              </Button>
                            </>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_event, newPage) => setPage(newPage)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(event) => {
            setPageSize(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 20, 50]}
          labelRowsPerPage="每页行数"
        />
      </Card>

      <Dialog open={Boolean(pendingDelete)} onClose={() => !deleting && setPendingDelete(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            报销单「{pendingDelete?.purpose || "未命名"}」可以彻底删除，或先放入回收站。
            {DELETE_WARNING_TEXT}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={() => handleDeleteReport("purge")} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "彻底删除"}
          </Button>
          <Button onClick={() => handleDeleteReport("trash")} variant="contained" disabled={deleting}>
            放入回收站
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pendingBatchDelete} onClose={() => !deleting && setPendingBatchDelete(false)}>
        <DialogTitle>删除草稿</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将处理已勾选项中的草稿报销单；已打印和已报销报销单会自动跳过。当前已选 {selectedCount} 张。
            {DELETE_WARNING_TEXT}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingBatchDelete(false)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={() => handleConfirmBatchDelete("purge")} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "彻底删除"}
          </Button>
          <Button onClick={() => handleConfirmBatchDelete("trash")} variant="contained" disabled={deleting}>
            放入回收站
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingPurge)} onClose={() => !deleting && setPendingPurge(null)}>
        <DialogTitle>彻底删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要彻底删除报销单「{pendingPurge?.purpose || "未命名"}」吗？此操作会永久删除报销单、行程、费用项、发票记录和发票附件，无法恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingPurge(null)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={handlePurgeReport} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "彻底删除"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pendingBatchPurge} onClose={() => !deleting && setPendingBatchPurge(false)}>
        <DialogTitle>彻底删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要彻底删除已勾选的 {selectedCount} 张回收站报销单吗？此操作会永久删除报销单、行程、费用项、发票记录和发票附件，无法恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingBatchPurge(false)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={handleConfirmBatchPurge} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "彻底删除"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={previewState.open}
        onClose={() => !previewState.loading && setPreviewState((current) => ({ ...current, open: false }))}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>预览报销单：{previewState.report?.purpose || `#${previewState.report?.id || ""}`}</DialogTitle>
        <DialogContent dividers>
          {previewState.loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : previewState.error ? (
            <Alert severity="error">{previewState.error}</Alert>
          ) : (
            <Stack spacing={2}>
              {previewState.pages.map((page) => (
                <Box
                  key={page.page}
                  component="img"
                  src={page.image_url}
                  alt={`报销单第 ${page.page} 页`}
                  sx={{
                    width: "100%",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "background.paper",
                  }}
                />
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewState((current) => ({ ...current, open: false }))} disabled={previewState.loading}>
            关闭
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            onClick={() => previewState.report && handleDownloadReport(previewState.report)}
            disabled={previewState.loading || !previewState.report || downloadingId === previewState.report.id}
          >
            下载
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={() => !importLoading && setImportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>导入报销数据包</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {importError && <Alert severity="error">{importError}</Alert>}
            {importResult && (
              <Alert severity="success">
                导入完成：新增 {importResult.reports_created} 单，覆盖 {importResult.reports_overwritten} 单，跳过{" "}
                {importResult.reports_skipped} 单；备份位置：{importResult.backup_path}
              </Alert>
            )}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
              <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
                选择 ZIP
                <input
                  hidden
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => {
                    setImportFile(event.target.files?.[0] || null);
                    setImportPreview(null);
                    setImportResult(null);
                    setImportError("");
                  }}
                />
              </Button>
              <Typography color="text.secondary">{importFile ? importFile.name : "未选择文件"}</Typography>
              <Button onClick={handlePreviewImport} disabled={!importFile || importLoading} variant="contained">
                {importLoading && !importPreview ? "预览中..." : "生成预览"}
              </Button>
            </Stack>

            {importPreview && (
              <Stack spacing={2}>
                <Alert severity={importPreview.requires_reimbursed_confirm ? "warning" : "info"}>
                  共 {importPreview.summary.reports_total} 张报销单，预计新增 {importPreview.summary.reports_new} 张，冲突{" "}
                  {importPreview.summary.reports_conflict} 张；发票 {importPreview.summary.invoices_total} 张，附件{" "}
                  {importPreview.summary.attachments_total} 个。
                </Alert>

                {importPreview.conflicts.length > 0 && (
                  <Box sx={{ maxHeight: 220, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>类型</TableCell>
                          <TableCell>来源 UID</TableCell>
                          <TableCell>本地 ID</TableCell>
                          <TableCell>原因</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importPreview.conflicts.map((conflict, index) => (
                          <TableRow key={`${conflict.item_type}-${conflict.source_uid}-${index}`}>
                            <TableCell>{conflict.item_type === "report" ? "报销单" : "发票"}</TableCell>
                            <TableCell>{conflict.source_uid}</TableCell>
                            <TableCell>{conflict.local_id || "—"}</TableCell>
                            <TableCell>{conflict.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}

                <TextField
                  select
                  size="small"
                  label="冲突处理"
                  value={importStrategy}
                  onChange={(event) => {
                    setImportStrategy(event.target.value);
                    setConfirmReimbursedOverwrite(false);
                  }}
                >
                  <MenuItem value="import_as_new">新增记录</MenuItem>
                  <MenuItem value="overwrite">覆盖匹配记录</MenuItem>
                  <MenuItem value="skip">跳过冲突记录</MenuItem>
                </TextField>

                {importStrategy === "overwrite" && importPreview.requires_reimbursed_confirm && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={confirmReimbursedOverwrite}
                        onChange={(event) => setConfirmReimbursedOverwrite(event.target.checked)}
                      />
                    }
                    label="我确认要覆盖已报销记录"
                  />
                )}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} disabled={importLoading}>
            关闭
          </Button>
          <Button
            onClick={handleExecuteImport}
            disabled={
              !importPreview ||
              importLoading ||
              (importStrategy === "overwrite" && importPreview.requires_reimbursed_confirm && !confirmReimbursedOverwrite)
            }
            variant="contained"
          >
            {importLoading && importPreview ? "导入中..." : "执行导入"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
