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
  IconButton,
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
  Tooltip,
  Typography,
} from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RestoreIcon from "@mui/icons-material/Restore";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  getReportRowInteractionPolicy,
  getSubsidyDaysLabel,
  reportFilterActionsSx,
  reportFilterCategorySx,
  reportFilterDateFieldSx,
  reportFilterKeywordSx,
  reportFilterMoreButtonSx,
  reportFilterResetButtonSx,
  reportFilterToolbarSx,
  reportTableActionCellSx,
  reportTableDateCellSx,
  reportTableHeadSx,
  reportTableNoWrapCellSx,
  reportTablePrimaryActionsSx,
  reportTableTrashActionCellSx,
} from "./reportListUtils";
import {
  copyImportConflictUid,
  getImportConflictViewModel,
  importConflictAtomicTextSx,
  importConflictLocalIdCellSx,
  importConflictMobileCardSx,
  importConflictMobileListSx,
  importConflictReasonCellSx,
  importConflictReasonTextSx,
  importConflictTableContainerSx,
  importConflictTableSx,
  importConflictTypeCellSx,
  importConflictUidCellSx,
  importConflictUidTextSx,
} from "./importConflictTableUtils";
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
    handleExportSelected,
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

  const rowInteractionPolicy = getReportRowInteractionPolicy(isTrash);

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
            出差报销单
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
            <TableHead sx={reportTableHeadSx}>
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
                <TableCell sx={reportTableDateCellSx}>出差开始日期</TableCell>
                <TableCell sx={reportTableDateCellSx}>出差结束日期</TableCell>
                <TableCell sx={reportTableDateCellSx}>报销日期</TableCell>
                <TableCell>出差事由</TableCell>
                <TableCell align="center">补贴天数</TableCell>
                <TableCell align="right">报销总金额</TableCell>
                <TableCell align="center">发票总数</TableCell>
                <TableCell align="center">状态</TableCell>
                {isTrash && <TableCell>删除时间</TableCell>}
                <TableCell align="right" sx={isTrash ? reportTableTrashActionCellSx : reportTableActionCellSx}>操作</TableCell>
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
                      <TableCell sx={reportTableDateCellSx}>{formatDate(report.trip_start_date)}</TableCell>
                      <TableCell sx={reportTableDateCellSx}>{formatDate(report.trip_end_date)}</TableCell>
                      <TableCell sx={reportTableDateCellSx}>{formatDate(report.report_date)}</TableCell>
                      <TableCell sx={{ minWidth: 144, maxWidth: 260 }}>
                        <Typography variant="body2" noWrap title={report.purpose || undefined}>
                          {report.purpose || "—"}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={reportTableNoWrapCellSx}>{getSubsidyDaysLabel(report)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          ...reportTableNoWrapCellSx,
                          fontFamily: '"DIN Alternate", "Roboto Mono", Consolas, monospace',
                          fontWeight: 800,
                        }}
                      >
                        {formatAmount(report.total_amount)}
                      </TableCell>
                      <TableCell align="center" sx={reportTableNoWrapCellSx}>{report.invoice_count ?? 0}</TableCell>
                      <TableCell align="center" sx={reportTableNoWrapCellSx}>
                        {rowInteractionPolicy.statusMutable ? (
                          <ReportStatusStepControl
                            reportId={report.id}
                            status={report.status}
                            loading={reportStatusUpdating}
                            disabled={reportStatusUpdating || batchStatusUpdating}
                            onStatusChange={(target) => handleSingleStatusRequest(report, target)}
                          />
                        ) : (
                          <Chip
                            size="small"
                            label={STATUS_META[report.status]?.label || report.status}
                            sx={STATUS_META[report.status]?.chipSx}
                            aria-label={`报销单 ${report.id} 状态：${STATUS_META[report.status]?.label || report.status}（回收站，只读）`}
                          />
                        )}
                      </TableCell>
                      {isTrash && <TableCell sx={reportTableNoWrapCellSx}>{formatDateTime(report.deleted_at)}</TableCell>}
                      <TableCell
                        align="right"
                        sx={isTrash ? reportTableTrashActionCellSx : reportTableActionCellSx}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Box sx={reportTablePrimaryActionsSx}>
                          {rowInteractionPolicy.primaryActions.includes("restore") ? (
                            <>
                              <Tooltip title="恢复">
                                <IconButton
                                  size="small"
                                  disabled={deleting}
                                  onClick={() => handleRestoreReport(report)}
                                  aria-label={`恢复报销单 ${report.id}`}
                                >
                                  <RestoreIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="彻底删除">
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={deleting}
                                  onClick={() => setPendingPurge(report)}
                                  aria-label={`彻底删除报销单 ${report.id}`}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          ) : (
                            <>
                              <Tooltip title={report.status === "draft" ? "编辑" : "查看"}>
                                <IconButton
                                  size="small"
                                  onClick={() => navigate(`/reports/${report.id}/edit`)}
                                  aria-label={`打开报销单 ${report.id}`}
                                >
                                  <EditOutlinedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="预览 PDF">
                                <IconButton
                                  size="small"
                                  onClick={() => handlePreviewReport(report)}
                                  aria-label={`预览报销单 ${report.id}`}
                                >
                                  <VisibilityIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="下载 PDF">
                                <IconButton
                                  size="small"
                                  onClick={() => handleDownloadReport(report)}
                                  disabled={downloadingId === report.id}
                                  aria-label={`下载报销单 ${report.id}`}
                                >
                                  <DownloadIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              {report.status === "draft" && (
                                <Tooltip title="放入回收站">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    disabled={deleting}
                                    onClick={() => setPendingDelete(report)}
                                    aria-label={`删除报销单 ${report.id}`}
                                  >
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
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
                handleExportSelected();
              }}
              disabled={exporting || batchLoading || deleting || batchStatusUpdating || statusUpdatingId !== null}
            >
              导出已选数据
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
              <Typography color="text.secondary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {importFile ? importFile.name : "未选择文件"}
              </Typography>
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
                  <>
                    <Stack component="ul" spacing={1} aria-label="导入冲突明细" sx={importConflictMobileListSx}>
                      {importPreview.conflicts.map((conflict, index) => {
                        const row = getImportConflictViewModel(conflict);
                        return (
                          <Box
                            component="li"
                            key={`${conflict.item_type}-${conflict.source_uid}-${index}-mobile`}
                            sx={importConflictMobileCardSx}
                          >
                            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                              <Typography variant="subtitle2" sx={importConflictAtomicTextSx}>
                                {row.typeLabel}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={importConflictAtomicTextSx}>
                                本地 ID：
                                <Box component="span" sx={{ fontFamily: '"Roboto Mono", Consolas, monospace' }}>
                                  {row.localId}
                                </Box>
                              </Typography>
                            </Stack>

                            <Typography component="div" variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                              来源 UID
                            </Typography>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                              <Tooltip title={row.sourceUid} placement="top-start">
                                <Typography
                                  variant="body2"
                                  noWrap
                                  tabIndex={0}
                                  aria-label={`来源 UID：${row.sourceUid}`}
                                  sx={importConflictUidTextSx}
                                >
                                  {row.sourceUid}
                                </Typography>
                              </Tooltip>
                              <Tooltip title="复制来源 UID">
                                <IconButton
                                  size="small"
                                  aria-label={`复制来源 UID：${row.sourceUid}`}
                                  onClick={() => void copyImportConflictUid(row.sourceUid)}
                                >
                                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            </Stack>

                            <Typography component="div" variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
                              原因
                            </Typography>
                            <Tooltip title={row.reason} placement="top-start">
                              <Typography
                                variant="body2"
                                tabIndex={0}
                                aria-label={`冲突原因：${row.reason}`}
                                sx={importConflictReasonTextSx}
                              >
                                {row.reason}
                              </Typography>
                            </Tooltip>
                          </Box>
                        );
                      })}
                    </Stack>

                    <TableContainer sx={importConflictTableContainerSx}>
                      <Table stickyHeader size="small" aria-label="导入冲突明细" sx={importConflictTableSx}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={importConflictTypeCellSx}>类型</TableCell>
                            <TableCell sx={importConflictUidCellSx}>来源 UID</TableCell>
                            <TableCell sx={importConflictLocalIdCellSx}>本地 ID</TableCell>
                            <TableCell sx={importConflictReasonCellSx}>原因</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {importPreview.conflicts.map((conflict, index) => {
                            const row = getImportConflictViewModel(conflict);
                            return (
                              <TableRow key={`${conflict.item_type}-${conflict.source_uid}-${index}`}>
                                <TableCell sx={importConflictTypeCellSx}>{row.typeLabel}</TableCell>
                                <TableCell sx={importConflictUidCellSx}>
                                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                                    <Tooltip title={row.sourceUid} placement="top-start">
                                      <Typography
                                        variant="body2"
                                        noWrap
                                        tabIndex={0}
                                        aria-label={`来源 UID：${row.sourceUid}`}
                                        sx={importConflictUidTextSx}
                                      >
                                        {row.sourceUid}
                                      </Typography>
                                    </Tooltip>
                                    <Tooltip title="复制来源 UID">
                                      <IconButton
                                        size="small"
                                        aria-label={`复制来源 UID：${row.sourceUid}`}
                                        onClick={() => void copyImportConflictUid(row.sourceUid)}
                                      >
                                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </Stack>
                                </TableCell>
                                <TableCell sx={importConflictLocalIdCellSx}>
                                  <Typography component="span" variant="body2" sx={{ fontFamily: '"Roboto Mono", Consolas, monospace' }}>
                                    {row.localId}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={importConflictReasonCellSx}>
                                  <Tooltip title={row.reason} placement="top-start">
                                    <Typography
                                      variant="body2"
                                      tabIndex={0}
                                      aria-label={`冲突原因：${row.reason}`}
                                      sx={importConflictReasonTextSx}
                                    >
                                      {row.reason}
                                    </Typography>
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
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
