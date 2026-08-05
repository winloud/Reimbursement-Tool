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
  Typography,
} from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Link as RouterLink } from "react-router-dom";
import {
  getSubsidyDaysLabel,
  reportFilterActionsSx,
  reportFilterCategorySx,
  reportFilterDateFieldSx,
  reportFilterKeywordSx,
  reportFilterMoreButtonSx,
  reportFilterResetButtonSx,
  reportFilterToolbarSx,
} from "./reportListUtils";
import { STATUS_META } from "./reportStatus";
import ReportStatusStepControl from "./ReportStatusStepControl";

const STATUS_TABS = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "checked", label: "已核对" },
  { value: "printed", label: "已提交" },
  { value: "reimbursed", label: "已报销" },
  { value: "trash", label: "回收站" },
];

const INVOICE_STATE_OPTIONS = [
  { value: "all", label: "全部发票" },
  { value: "has_unconfirmed", label: "有未确认发票" },
  { value: "all_confirmed", label: "全部已确认" },
  { value: "no_invoice", label: "无发票" },
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

export default function ReportListView(props) {
  const {
    status,
    selectedCount,
    isTrash,
    handleBatchRestore,
    batchLoading,
    deleting,
    batchStatusMenuActions,
    batchStatusUpdating,
    statusUpdatingId,
    batchStatusMenuAnchor,
    setBatchStatusMenuAnchor,
    batchActionMenuAnchor,
    setBatchActionMenuAnchor,
    handleOpenImport,
    handleExport,
    exporting,
    error,
    batchResult,
    handleStatusChange,
    filters,
    handleFilterChange,
    categoryOptions,
    advancedOpen,
    setAdvancedOpen,
    handleResetFilters,
    activeFilterChips,
    clearFilter,
    items,
    loading,
    tableColumnCount,
    allPageSelected,
    somePageSelected,
    handleToggleCurrentPage,
    selectedSet,
    handleToggleReport,
    navigate,
    handleSingleStatusRequest,
    handleRestoreReport,
    setPendingPurge,
    handlePreviewReport,
    handleDownloadReport,
    downloadingId,
    setPendingDelete,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    handleBatchStatusRequest,
    handleBatchDownload,
    setPendingBatchPurge,
    setPendingBatchDelete,
    handleClearSelection,
    pendingDelete,
    handleDeleteReport,
    pendingBatchDelete,
    handleConfirmBatchDelete,
    pendingPurge,
    handlePurgeReport,
    pendingBatchPurge,
    handleConfirmBatchPurge,
    previewState,
    setPreviewState,
    importOpen,
    setImportOpen,
    importLoading,
    importError,
    importResult,
    importFile,
    setImportFile,
    setImportPreview,
    setImportResult,
    setImportError,
    handlePreviewImport,
    importPreview,
    importStrategy,
    setImportStrategy,
    confirmReimbursedOverwrite,
    setConfirmReimbursedOverwrite,
    handleExecuteImport,
  } = props;

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
          {selectedCount > 0 ? (
            <>
              <Chip
                label={`已选 ${selectedCount} 张`}
                color="primary"
                variant="outlined"
                aria-live="polite"
                sx={{ height: 36, minWidth: 112, fontWeight: 700, justifyContent: "center" }}
              />
              {isTrash ? (
                <Button
                  variant="contained"
                  onClick={handleBatchRestore}
                  disabled={batchLoading || deleting}
                  sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
                >
                  批量恢复
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  endIcon={<ExpandMoreIcon />}
                  onClick={(event) => setBatchStatusMenuAnchor(event.currentTarget)}
                  disabled={
                    batchStatusMenuActions.length === 0 ||
                    batchLoading ||
                    deleting ||
                    batchStatusUpdating ||
                    statusUpdatingId !== null
                  }
                  aria-haspopup="menu"
                  aria-expanded={Boolean(batchStatusMenuAnchor)}
                  sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
                >
                  {batchStatusUpdating ? "修改中..." : "修改状态..."}
                </Button>
              )}
              <Button
                variant="outlined"
                endIcon={<ExpandMoreIcon />}
                onClick={(event) => setBatchActionMenuAnchor(event.currentTarget)}
                disabled={batchLoading || deleting || batchStatusUpdating || statusUpdatingId !== null}
                aria-haspopup="menu"
                aria-expanded={Boolean(batchActionMenuAnchor)}
                sx={{ minWidth: 0, px: 1.5, whiteSpace: "nowrap" }}
              >
                更多操作
              </Button>
            </>
          ) : (
            <>
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
            </>
          )}
        </Box>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {batchResult && <Alert severity={batchResult.severity}>{batchResult.message}</Alert>}

      <Card>
        <Tabs
          value={status}
          onChange={handleStatusChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}
        >
          {STATUS_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>

        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap sx={reportFilterToolbarSx}>
            <TextField
              size="small"
              label="关键词"
              value={filters.keyword}
              onChange={handleFilterChange("keyword")}
              placeholder="事由 / 人员 / 部门 / ID"
              sx={reportFilterKeywordSx}
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
              sx={reportFilterDateFieldSx}
            />
            <TextField
              size="small"
              label="行程结束"
              type="date"
              value={filters.tripEnd}
              onChange={handleFilterChange("tripEnd")}
              InputLabelProps={{ shrink: true }}
              sx={reportFilterDateFieldSx}
            />
            <TextField
              select
              size="small"
              label="费用类别"
              value={filters.category}
              onChange={handleFilterChange("category")}
              sx={reportFilterCategorySx}
            >
              {categoryOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" alignItems="center" useFlexGap sx={reportFilterActionsSx}>
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
                sx={reportFilterMoreButtonSx}
              >
                更多筛选
              </Button>
              <Button
                variant="text"
                onClick={handleResetFilters}
                disabled={activeFilterChips.length === 0}
                sx={reportFilterResetButtonSx}
              >
                重置
              </Button>
            </Stack>
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

        <TableContainer>
          <Table sx={{ minWidth: isTrash ? 1130 : 1050 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allPageSelected}
                    indeterminate={!allPageSelected && somePageSelected}
                    onChange={handleToggleCurrentPage}
                    disabled={items.length === 0 || loading}
                    inputProps={{ "aria-label": "选择当前页全部报销单" }}
                  />
                </TableCell>
                <TableCell>出差开始日期</TableCell>
                <TableCell>出差结束日期</TableCell>
                <TableCell>报销日期</TableCell>
                <TableCell>出差事由</TableCell>
                <TableCell align="center">补贴天数</TableCell>
                <TableCell align="right">报销总金额</TableCell>
                <TableCell align="center">发票总数</TableCell>
                <TableCell align="center">状态</TableCell>
                {isTrash && <TableCell>删除时间</TableCell>}
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={tableColumnCount} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tableColumnCount} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary">暂无数据</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((report) => {
                  const reportStatusUpdating = statusUpdatingId === report.id;
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
                          onChange={(event) => handleToggleReport(report.id, event.currentTarget)}
                          inputProps={{
                            "aria-label": `选择报销单 ${report.id}，${report.purpose || "未命名"}`,
                          }}
                        />
                      </TableCell>
                      <TableCell>{formatDate(report.trip_start_date)}</TableCell>
                      <TableCell>{formatDate(report.trip_end_date)}</TableCell>
                      <TableCell>{formatDate(report.report_date)}</TableCell>
                      <TableCell>{report.purpose || "—"}</TableCell>
                      <TableCell align="center">{getSubsidyDaysLabel(report)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: '"DIN Alternate", "Roboto Mono", Consolas, monospace', fontWeight: 800 }}>
                        {formatAmount(report.total_amount)}
                      </TableCell>
                      <TableCell align="center">{report.invoice_count ?? 0}</TableCell>
                      <TableCell align="center">
                        <ReportStatusStepControl
                          reportId={report.id}
                          status={report.status}
                          loading={reportStatusUpdating}
                          disabled={reportStatusUpdating || batchStatusUpdating}
                          onStatusChange={(target) => handleSingleStatusRequest(report, target)}
                        />
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
                                {report.status === "draft" ? "编辑" : "查看"}
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

      <Menu
        anchorEl={batchStatusMenuAnchor}
        open={Boolean(batchStatusMenuAnchor)}
        onClose={() => setBatchStatusMenuAnchor(null)}
      >
        {batchStatusMenuActions.map((action) => (
          <MenuItem
            key={action.target}
            onClick={() => handleBatchStatusRequest(action)}
            disabled={batchStatusUpdating || statusUpdatingId !== null}
            sx={{ minWidth: 128 }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: "100%" }}>
              <Typography variant="body2">{action.label}</Typography>
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  width: 10,
                  height: 10,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  bgcolor: STATUS_META[action.target]?.chipSx?.bgcolor || "action.selected",
                  border: "1px solid",
                  borderColor: STATUS_META[action.target]?.chipSx?.color || "text.secondary",
                }}
              />
            </Stack>
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={batchActionMenuAnchor}
        open={Boolean(batchActionMenuAnchor)}
        onClose={() => setBatchActionMenuAnchor(null)}
      >
        {isTrash ? (
          <MenuItem
            onClick={() => {
              setBatchActionMenuAnchor(null);
              setPendingBatchPurge(true);
            }}
            disabled={batchLoading || deleting}
            sx={{ color: "error.main" }}
          >
            彻底删除
          </MenuItem>
        ) : (
          <>
            <MenuItem
              onClick={() => {
                setBatchActionMenuAnchor(null);
                handleBatchDownload();
              }}
              disabled={batchLoading || deleting || batchStatusUpdating || statusUpdatingId !== null}
            >
              批量下载
            </MenuItem>
            <MenuItem
              onClick={() => {
                setBatchActionMenuAnchor(null);
                setPendingBatchDelete(true);
              }}
              disabled={batchLoading || deleting || batchStatusUpdating || statusUpdatingId !== null}
              sx={{ color: "error.main" }}
            >
              删除草稿
            </MenuItem>
          </>
        )}
        <MenuItem onClick={handleClearSelection} disabled={batchLoading || deleting || batchStatusUpdating}>
          清除选择
        </MenuItem>
      </Menu>

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
            将处理已勾选项中的草稿报销单；已核对、已提交和已报销报销单会自动跳过。当前已选 {selectedCount} 张。
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
