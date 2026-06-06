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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  deleteReport,
  downloadDataExport,
  executeDataImport,
  getReportFilterOptions,
  getReports,
  previewDataImport,
} from "../api/client";
import { DEFAULT_REPORT_FILTERS } from "../api/reportFilters";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "printed", label: "已打印" },
  { value: "reimbursed", label: "已报销" },
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

export default function ReportList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_REPORT_FILTERS }));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState(CATEGORY_OPTIONS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importStrategy, setImportStrategy] = useState("import_as_new");
  const [confirmReimbursedOverwrite, setConfirmReimbursedOverwrite] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getReports({ page: page + 1, pageSize, status, filters });
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

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      const res = await deleteReport(pendingDelete.id);
      if (res.success) {
        setPendingDelete(null);
        await fetchReports();
      } else {
        setError(res.message || "删除失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const { blob, filename } = await downloadDataExport({ status, filters });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "expense-data.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "导出失败");
    } finally {
      setExporting(false);
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
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <div>
          <Typography variant="h5" fontWeight={700}>
            报销单管理
          </Typography>
          <Typography color="text.secondary">管理出差报销单，支持新增、编辑、删除与多条件筛选。</Typography>
        </div>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={handleOpenImport}>
            导入数据包
          </Button>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={handleExport} disabled={exporting}>
            {exporting ? "导出中..." : "导出当前筛选"}
          </Button>
          <Button component={RouterLink} to="/reports/new" variant="contained">
            新增报销单
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

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

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>报销日期</TableCell>
                <TableCell>出差事由</TableCell>
                <TableCell align="center">补贴天数</TableCell>
                <TableCell align="right">报销总金额</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">暂无数据</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((report) => {
                  const meta = STATUS_META[report.status] || { label: report.status, color: "default" };
                  return (
                    <TableRow key={report.id} hover>
                      <TableCell>{formatDate(report.report_date)}</TableCell>
                      <TableCell>{report.purpose || "—"}</TableCell>
                      <TableCell align="center">{report.subsidy_days ?? 0}</TableCell>
                      <TableCell align="right">{formatAmount(report.total_amount)}</TableCell>
                      <TableCell align="center">
                        <Chip size="small" color={meta.color} label={meta.label} />
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
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
            确定要删除报销单「{pendingDelete?.purpose || "未命名"}」吗？此操作将软删除该报销单。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={deleting}>
            取消
          </Button>
          <Button onClick={handleConfirmDelete} color="error" disabled={deleting}>
            {deleting ? "删除中..." : "确认删除"}
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
