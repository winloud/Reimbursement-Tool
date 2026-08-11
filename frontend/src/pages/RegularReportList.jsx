import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import RestoreIcon from "@mui/icons-material/Restore";
import SearchIcon from "@mui/icons-material/Search";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";

import {
  batchDeleteReports,
  batchPurgeReports,
  batchRestoreReports,
  batchUpdateReportStatus,
  deleteReport,
  downloadDataExport,
  getReportPdfPreview,
  getReports,
  getStatsSummary,
  getTrashReports,
  prepareReportBatchPdfDownload,
  prepareReportPdfDownload,
  purgeReport,
  restoreReport,
  updateReportStatus,
} from "../api/client";
import { saveBlobDownload, triggerBrowserDownload } from "../utils/browserDownload";
import ReportStatusStepControl from "./ReportStatusStepControl";
import { getBatchReportStatusActions, STATUS_META } from "./reportStatus";
import {
  buildRegularSummaryCards,
  DEFAULT_REGULAR_FILTERS,
  formatRegularAmount,
  getRegularModeLabel,
  REGULAR_REPORT_MODES,
  REGULAR_STATUS_TABS,
  regularItemSummary,
} from "./regularReportUtils";

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return error.response?.data?.message || error.message || fallback;
};

const listItemNames = (report) => {
  if (report.regular_item_summary) return report.regular_item_summary;
  if (report.project_summary) return report.project_summary;
  return regularItemSummary(report.regular_items || []);
};

const reportDocumentCount = (report) =>
  Number(report.document_count ?? report.regular_document_count ?? report.invoice_count ?? 0);

function SummaryCards({ cards, loading, unavailable = false }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: { xs: 1, sm: 1.5 } }}>
      {cards.map((card) => (
        <Card sx={{ height: "100%", minWidth: 0 }} key={card.key}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
            <Typography variant="caption" color="text.secondary" fontWeight={800}>
              {card.title}
            </Typography>
            <Typography variant="h6" fontWeight={900} sx={{ mt: 0.5, whiteSpace: "nowrap", fontSize: { xs: "1.05rem", sm: "1.25rem" } }}>
              {loading || unavailable ? "—" : card.value}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

function ReportActions({ report, isTrash, busy, onOpen, onPreview, onDownload, onDelete, onRestore, onPurge }) {
  if (isTrash) {
    return (
      <Stack direction="row" spacing={0.25} justifyContent="flex-end">
        <Tooltip title="恢复">
          <IconButton size="small" disabled={busy} onClick={() => onRestore(report)} aria-label={`恢复报销单 ${report.id}`}>
            <RestoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="彻底删除">
          <IconButton size="small" color="error" disabled={busy} onClick={() => onPurge(report)} aria-label={`彻底删除报销单 ${report.id}`}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={0.15} justifyContent="flex-end">
      <Tooltip title={report.status === "draft" ? "编辑" : "查看"}>
        <IconButton size="small" onClick={() => onOpen(report)} aria-label={`打开报销单 ${report.id}`}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="预览 PDF">
        <IconButton size="small" onClick={() => onPreview(report)} aria-label={`预览报销单 ${report.id}`}>
          <VisibilityIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="下载 PDF">
        <IconButton size="small" disabled={busy} onClick={() => onDownload(report)} aria-label={`下载报销单 ${report.id}`}>
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {report.status === "draft" && (
        <Tooltip title="放入回收站">
          <IconButton size="small" color="error" disabled={busy} onClick={() => onDelete(report)} aria-label={`删除报销单 ${report.id}`}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

export default function RegularReportList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_REGULAR_FILTERS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [batchMenuAnchor, setBatchMenuAnchor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [preview, setPreview] = useState({ open: false, report: null, pages: [], loading: false, error: "" });
  const isTrash = status === "trash";

  const queryFilters = useMemo(
    () => ({
      reportStart: filters.reportStart,
      reportEnd: filters.reportEnd,
      keyword: filters.keyword,
      amountMin: filters.amountMin,
      amountMax: filters.amountMax,
    }),
    [filters.amountMax, filters.amountMin, filters.keyword, filters.reportEnd, filters.reportStart],
  );
  const regularMode = filters.regularMode === "all" ? undefined : filters.regularMode;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const options = {
        page: page + 1,
        pageSize,
        reportType: "regular",
        regularMode,
        filters: queryFilters,
      };
      const response = isTrash
        ? await getTrashReports(options)
        : await getReports({ ...options, status });
      if (!response.success) throw new Error(response.message || "加载常规报销单失败");
      setItems(response.data?.items || []);
      setTotal(Number(response.data?.total || 0));
    } catch (fetchError) {
      setError(errorMessage(fetchError, "加载常规报销单失败"));
    } finally {
      setLoading(false);
    }
  }, [isTrash, page, pageSize, queryFilters, regularMode, status]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const response = await getStatsSummary({
        reportType: "regular",
        regularMode,
        reportStart: filters.reportStart || undefined,
        reportEnd: filters.reportEnd || undefined,
      });
      if (!response.success) throw new Error(response.message || "加载常规报销汇总失败");
      setSummary(response.data);
    } catch (summaryFetchError) {
      setSummary(null);
      setSummaryError(errorMessage(summaryFetchError, "加载常规报销汇总失败"));
    } finally {
      setSummaryLoading(false);
    }
  }, [filters.reportEnd, filters.reportStart, regularMode]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    setSelectedIds([]);
  }, [filters, page, pageSize, status]);

  const summaryCards = useMemo(() => buildRegularSummaryCards(summary), [summary]);
  const selectedReports = items.filter((report) => selectedIds.includes(report.id));
  const batchStatusActions = getBatchReportStatusActions(selectedReports);
  const pageIds = items.map((report) => report.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const partlySelected = pageIds.some((id) => selectedIds.includes(id));

  const setFilter = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(0);
  };

  const toggleReport = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const togglePage = (checked) => {
    setSelectedIds((current) => checked
      ? [...new Set([...current, ...pageIds])]
      : current.filter((id) => !pageIds.includes(id)));
  };

  const refreshAfterAction = async (message) => {
    setSelectedIds([]);
    setNotice(message);
    await Promise.all([fetchReports(), fetchSummary()]);
  };

  const handleStatusUpdate = async (report, target) => {
    setStatusUpdatingId(report.id);
    setError("");
    try {
      const response = await updateReportStatus(report.id, target);
      if (!response.success) throw new Error(response.message || "状态修改失败");
      await refreshAfterAction("状态已更新");
    } catch (actionError) {
      setError(errorMessage(actionError, "状态修改失败"));
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleBatchStatus = async (target) => {
    if (selectedIds.length === 0) return;
    setBatchMenuAnchor(null);
    setBusy(true);
    setError("");
    try {
      const response = await batchUpdateReportStatus(selectedIds, target);
      if (!response.success) throw new Error(response.message || "批量修改状态失败");
      await refreshAfterAction(`已更新 ${response.data?.updated_count || 0} 张报销单`);
    } catch (actionError) {
      setError(errorMessage(actionError, "批量修改状态失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const response = await deleteReport(deleteTarget.id);
      if (!response.success) throw new Error(response.message || "删除失败");
      setDeleteTarget(null);
      await refreshAfterAction("报销单已放入回收站");
    } catch (actionError) {
      setError(errorMessage(actionError, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      const response = await purgeReport(purgeTarget.id);
      if (!response.success) throw new Error(response.message || "彻底删除失败");
      setPurgeTarget(null);
      await refreshAfterAction("报销单已彻底删除");
    } catch (actionError) {
      setError(errorMessage(actionError, "彻底删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (report) => {
    setBusy(true);
    try {
      const response = await restoreReport(report.id);
      if (!response.success) throw new Error(response.message || "恢复失败");
      await refreshAfterAction("报销单已恢复");
    } catch (actionError) {
      setError(errorMessage(actionError, "恢复失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleBatchDeleteAction = async (action) => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const response = action === "restore"
        ? await batchRestoreReports(selectedIds)
        : action === "purge"
          ? await batchPurgeReports(selectedIds)
          : await batchDeleteReports(selectedIds);
      if (!response.success) throw new Error(response.message || "批量操作失败");
      await refreshAfterAction("批量操作已完成");
    } catch (actionError) {
      setError(errorMessage(actionError, "批量操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async (report) => {
    setPreview({ open: true, report, pages: [], loading: true, error: "" });
    try {
      const response = await getReportPdfPreview(report.id);
      if (!response.success) throw new Error(response.message || "预览失败");
      setPreview({ open: true, report, pages: response.data?.pages || [], loading: false, error: "" });
    } catch (previewError) {
      setPreview({ open: true, report, pages: [], loading: false, error: errorMessage(previewError, "预览失败") });
    }
  };

  const handleDownload = async (report) => {
    setBusy(true);
    try {
      const result = await prepareReportPdfDownload(report.id);
      if (!result.success || !result.data?.download_url) {
        throw new Error(result.message || "生成下载链接失败");
      }
      triggerBrowserDownload(result.data.download_url);
    } catch (downloadError) {
      setError(errorMessage(downloadError, "下载失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleBatchDownload = async () => {
    setBusy(true);
    try {
      const result = await prepareReportBatchPdfDownload(selectedIds);
      if (!result.success || !result.data?.download_url) {
        throw new Error(result.message || "生成批量下载链接失败");
      }
      triggerBrowserDownload(result.data.download_url);
    } catch (downloadError) {
      setError(errorMessage(downloadError, "批量下载失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (isTrash) return;
    setExporting(true);
    setError("");
    try {
      const result = await downloadDataExport({
        status,
        reportType: "regular",
        regularMode,
        filters: queryFilters,
      });
      saveBlobDownload({
        blob: result.blob,
        filename: result.filename || "regular-expense-data.zip",
      });
    } catch (exportError) {
      setError(errorMessage(exportError, "导出失败"));
    } finally {
      setExporting(false);
    }
  };

  const openReport = (report) => navigate(`/regular-reports/${report.id}/edit`);

  const actionProps = {
    isTrash,
    busy,
    onOpen: openReport,
    onPreview: handlePreview,
    onDownload: handleDownload,
    onDelete: setDeleteTarget,
    onRestore: handleRestore,
    onPurge: setPurgeTarget,
  };

  return (
    <Stack spacing={{ xs: 2, md: 3 }}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
        <Box>
          <Typography variant="h5" fontWeight={850}>常规报销单</Typography>
          <Typography variant="body2" color="text.secondary">管理无票和有票常规报销，出差数据不会显示在此处。</Typography>
        </Box>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => navigate("/reports?import_data=1")}>
            导入数据包
          </Button>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} disabled={exporting || isTrash} onClick={handleExport}>
            {exporting ? "导出中..." : "导出当前筛选"}
          </Button>
          <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={() => navigate("/regular-reports/new?mode=no_invoice")}>
            新建无票报销
          </Button>
          <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/regular-reports/new?mode=invoice")}>
            新建有票报销
          </Button>
        </Stack>
      </Stack>

      <SummaryCards cards={summaryCards} loading={summaryLoading} unavailable={Boolean(summaryError)} />
      {summaryError && (
        <Alert severity="warning" onClose={() => setSummaryError("")}>
          汇总数据加载失败：{summaryError}
        </Alert>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 1.5, md: 2 }, "&:last-child": { pb: { xs: 1.5, md: 2 } } }}>
          <Stack spacing={1.5}>
            <Tabs
              value={status}
              onChange={(_event, value) => { setStatus(value); setPage(0); }}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="报销单状态"
            >
              {REGULAR_STATUS_TABS.map((tab) => <Tab key={tab.value} value={tab.value} label={tab.label} />)}
            </Tabs>
            <Divider />
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
              <TextField
                size="small"
                label="关键词"
                value={filters.keyword}
                onChange={setFilter("keyword")}
                placeholder="报销人或项目名称"
                InputProps={{ startAdornment: <SearchIcon color="action" fontSize="small" sx={{ mr: 0.75 }} /> }}
                sx={{ flex: "1 1 220px" }}
              />
              <TextField size="small" label="报销开始" type="date" value={filters.reportStart} onChange={setFilter("reportStart")} InputLabelProps={{ shrink: true }} sx={{ flex: "1 1 150px" }} />
              <TextField size="small" label="报销结束" type="date" value={filters.reportEnd} onChange={setFilter("reportEnd")} InputLabelProps={{ shrink: true }} sx={{ flex: "1 1 150px" }} />
              <TextField size="small" select label="模式" value={filters.regularMode} onChange={setFilter("regularMode")} sx={{ flex: "1 1 140px" }}>
                <MenuItem value="all">全部模式</MenuItem>
                {REGULAR_REPORT_MODES.map((mode) => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
              </TextField>
              <TextField size="small" label="金额下限" type="number" value={filters.amountMin} onChange={setFilter("amountMin")} sx={{ flex: "1 1 120px" }} />
              <TextField size="small" label="金额上限" type="number" value={filters.amountMax} onChange={setFilter("amountMax")} sx={{ flex: "1 1 120px" }} />
              <Button variant="text" onClick={() => { setFilters(DEFAULT_REGULAR_FILTERS); setPage(0); }}>重置筛选</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice("")}>{notice}</Alert>}

      {selectedIds.length > 0 && (
        <Card>
          <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} alignItems="center">
              <Chip color="primary" variant="outlined" label={`已选 ${selectedIds.length} 张`} />
              {isTrash ? (
                <Button size="small" variant="contained" disabled={busy} onClick={() => handleBatchDeleteAction("restore")}>批量恢复</Button>
              ) : (
                <>
                  <Button size="small" variant="outlined" endIcon={<ExpandMoreIcon />} disabled={busy} onClick={(event) => setBatchMenuAnchor(event.currentTarget)}>修改状态</Button>
                  <Button size="small" variant="outlined" disabled={busy} onClick={handleBatchDownload}>批量下载</Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => handleBatchDeleteAction("delete")}>放入回收站</Button>
                </>
              )}
              {isTrash && <Button size="small" color="error" disabled={busy} onClick={() => handleBatchDeleteAction("purge")}>彻底删除</Button>}
              <Button size="small" onClick={() => setSelectedIds([])}>取消选择</Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Menu anchorEl={batchMenuAnchor} open={Boolean(batchMenuAnchor)} onClose={() => setBatchMenuAnchor(null)}>
        {batchStatusActions.map((action) => (
          <MenuItem key={action.target} onClick={() => handleBatchStatus(action.target)}>{action.label}</MenuItem>
        ))}
      </Menu>

      <Card>
        {loading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 260 }}><CircularProgress /></Stack>
        ) : items.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 240, px: 2, textAlign: "center" }}>
            <Typography fontWeight={800}>没有符合条件的常规报销单</Typography>
            <Typography variant="body2" color="text.secondary">可以调整筛选条件，或新建一张报销单。</Typography>
          </Stack>
        ) : (
          <>
            <Box sx={{ display: { xs: "none", md: "block" } }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox"><Checkbox checked={allSelected} indeterminate={!allSelected && partlySelected} onChange={(event) => togglePage(event.target.checked)} inputProps={{ "aria-label": "选择当前页" }} /></TableCell>
                      <TableCell>报销日期</TableCell>
                      <TableCell>报销人</TableCell>
                      <TableCell>模式</TableCell>
                      <TableCell sx={{ minWidth: 180 }}>项目摘要</TableCell>
                      <TableCell align="right">总金额</TableCell>
                      <TableCell align="center">单据数</TableCell>
                      <TableCell align="center">状态</TableCell>
                      <TableCell align="right" sx={{ minWidth: 160 }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((report) => (
                      <TableRow key={report.id} hover selected={selectedIds.includes(report.id)}>
                        <TableCell padding="checkbox"><Checkbox checked={selectedIds.includes(report.id)} onChange={() => toggleReport(report.id)} inputProps={{ "aria-label": `选择报销单 ${report.id}` }} /></TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{report.report_date || "—"}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap", fontWeight: 700 }}>{report.employee_name || "—"}</TableCell>
                        <TableCell><Chip size="small" variant="outlined" label={getRegularModeLabel(report.regular_mode)} /></TableCell>
                        <TableCell><Tooltip title={listItemNames(report)}><Typography variant="body2" noWrap sx={{ maxWidth: 260 }}>{listItemNames(report)}</Typography></Tooltip></TableCell>
                        <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: "nowrap" }}>{formatRegularAmount(report.total_amount)}</TableCell>
                        <TableCell align="center">{reportDocumentCount(report)}</TableCell>
                        <TableCell align="center">
                          {isTrash ? <Chip size="small" label={STATUS_META[report.status]?.label || report.status} sx={STATUS_META[report.status]?.chipSx} /> : (
                            <ReportStatusStepControl reportId={report.id} status={report.status} loading={statusUpdatingId === report.id} disabled={busy || statusUpdatingId !== null} onStatusChange={(target) => handleStatusUpdate(report, target)} />
                          )}
                        </TableCell>
                        <TableCell align="right"><ReportActions report={report} {...actionProps} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            <Stack spacing={1} sx={{ display: { xs: "flex", md: "none" }, p: 1 }}>
              {items.map((report) => (
                <Card key={report.id} variant="outlined" sx={{ bgcolor: selectedIds.includes(report.id) ? "primary.50" : "background.paper" }}>
                  <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
                    <Stack spacing={1}>
                      <Stack direction="row" alignItems="flex-start" spacing={1}>
                        <Checkbox
                          size="small"
                          checked={selectedIds.includes(report.id)}
                          onChange={() => toggleReport(report.id)}
                          inputProps={{ "aria-label": `选择报销单 ${report.id}` }}
                          sx={{ p: 0.25 }}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" justifyContent="space-between" spacing={1}>
                            <Typography fontWeight={800} noWrap>{report.employee_name || "未填写报销人"}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{report.report_date || "—"}</Typography>
                          </Stack>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>{listItemNames(report)}</Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Chip size="small" variant="outlined" label={getRegularModeLabel(report.regular_mode)} />
                          <Typography variant="caption" color="text.secondary">{reportDocumentCount(report)} 张</Typography>
                        </Stack>
                        <Typography fontWeight={900}>{formatRegularAmount(report.total_amount)}</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        {isTrash ? <Chip size="small" label={STATUS_META[report.status]?.label || report.status} sx={STATUS_META[report.status]?.chipSx} /> : (
                          <ReportStatusStepControl reportId={report.id} status={report.status} loading={statusUpdatingId === report.id} disabled={busy || statusUpdatingId !== null} onStatusChange={(target) => handleStatusUpdate(report, target)} />
                        )}
                        <ReportActions report={report} {...actionProps} />
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50]}
          onPageChange={(_event, nextPage) => setPage(nextPage)}
          onRowsPerPageChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}
          labelRowsPerPage="每页"
        />
      </Card>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !busy && setDeleteTarget(null)}>
        <DialogTitle>将常规报销单放入回收站？</DialogTitle>
        <DialogContent><DialogContentText>仅草稿可以删除，之后可从回收站恢复。</DialogContentText></DialogContent>
        <DialogActions><Button disabled={busy} onClick={() => setDeleteTarget(null)}>取消</Button><Button color="error" variant="contained" disabled={busy} onClick={handleDelete}>确认删除</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(purgeTarget)} onClose={() => !busy && setPurgeTarget(null)}>
        <DialogTitle>彻底删除常规报销单？</DialogTitle>
        <DialogContent><DialogContentText>这会永久删除报销单及其发票、凭据文件，无法恢复。</DialogContentText></DialogContent>
        <DialogActions><Button disabled={busy} onClick={() => setPurgeTarget(null)}>取消</Button><Button color="error" variant="contained" disabled={busy} onClick={handlePurge}>彻底删除</Button></DialogActions>
      </Dialog>

      <Dialog open={preview.open} onClose={() => !preview.loading && setPreview((current) => ({ ...current, open: false }))} maxWidth="md" fullWidth>
        <DialogTitle>预览常规报销单 #{preview.report?.id || ""}</DialogTitle>
        <DialogContent dividers>
          {preview.loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : preview.error ? <Alert severity="error">{preview.error}</Alert> : (
            <Stack spacing={2}>{preview.pages.map((item) => <Box component="img" key={item.page} src={item.image_url} alt={`报销单第 ${item.page} 页`} sx={{ width: "100%", border: 1, borderColor: "divider" }} />)}</Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setPreview((current) => ({ ...current, open: false }))}>关闭</Button><Button variant="contained" startIcon={<DownloadIcon />} disabled={!preview.report || busy} onClick={() => handleDownload(preview.report)}>下载</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}
