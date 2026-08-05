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
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import DownloadIcon from "@mui/icons-material/Download";
import SaveIcon from "@mui/icons-material/Save";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import VisibilityIcon from "@mui/icons-material/Visibility";
import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import TicketImportDialog from "../components/TicketImportDialog";
import InvoiceDropzone from "../features/report-edit/InvoiceDropzone";
import PaperInvoiceEntry from "../features/report-edit/PaperInvoiceEntry";
import {
  formatAmount,
  getConfirmedInvoiceCount,
  getConfirmedInvoiceTotal,
  getExpenseItemAmount,
  getExpenseItemInvoiceTotal,
  getFuelSubsidyInvoiceShortfall,
  getPaperInvoiceCount,
  hasPaperInvoice,
  isCustomExpenseCategory,
  validateFuelSubsidyAmount,
} from "./reportEditUtils";

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

function InvoiceList({ items, readonly, onSelect, onDelete }) {
  return (
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
                        <IconButton size="small" aria-label="查看发票" onClick={() => onSelect(invoice)}>
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
                            onClick={() => onDelete(invoice.id)}
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
}

export default function ReportEditView({
  page,
  basicInfo,
  tripEditor,
  expenseEditor,
  summaryPanel,
  invoiceFlow,
  overlays,
}) {
  const {
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
  } = page;
  const { form, handleChange } = basicInfo;
  const {
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
    startTripDrag,
    dropTrip,
  } = tripEditor;
  const {
    expenseCategoryOptions,
    expenseItems,
    invoicesForCategory,
    updateExpenseItem,
    handleDeleteCustomCategory,
    openCustomDialog,
    paperInvoiceEditor,
    openPaperInvoiceEditor,
    updatePaperInvoiceEditor,
    savePaperInvoiceEditor,
    closePaperInvoiceEditor,
    requestPaperInvoiceClear,
  } = expenseEditor;
  const {
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
  } = summaryPanel;
  const {
    selectedInvoice,
    invoiceQueue,
    handleInvoiceSkipped,
    handleInvoiceUpdated,
    handleDeleteInvoice,
    onSelectInvoice,
    onCloseViewer,
    uploadResult,
    handleUploadResultClose,
    handleUploadResultContinue,
    handleFilesUpload,
    onUploadError,
  } = invoiceFlow;
  const {
    ticketImportOpen,
    closeTicketImport,
    handleTicketsImported,
    subsidyDialogOpen,
    closeSubsidyDialog,
    manualSubsidyDraft,
    manualSubsidyError,
    onManualSubsidyDraftChange,
    applyManualSubsidyTotal,
    customDialogOpen,
    closeCustomDialog,
    customName,
    customNameError,
    onCustomNameChange,
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
  } = overlays;

  const renderInvoiceList = (items) => (
    <InvoiceList
      items={items}
      readonly={readonly}
      onSelect={onSelectInvoice}
      onDelete={handleDeleteInvoice}
    />
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
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" fontWeight={800}>
              报销单录入
            </Typography>
            <Chip size="small" sx={statusMeta.chipSx} label={statusMeta.label} />
            <Chip size="small" color={saveMeta.color} icon={saveMeta.icon} label={saveMeta.text} />
          </Stack>
          <Typography color="text.secondary">基本信息、行程、发票和预支信息在一页完成。</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ "& > .MuiButton-root": { whiteSpace: "nowrap" } }}>
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
              disabled={!isEdit || !id || loading || saveState === "saving"}
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
      {readonly && <Alert severity="info">已核对、已提交和已报销状态为只读，不可修改报销单内容、发票和车票。</Alert>}
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
                          onDragStart={() => startTripDrag(index)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => dropTrip(index)}
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
                                  onPasteError={onUploadError}
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
                                      onCancel={closePaperInvoiceEditor}
                                      onClear={requestPaperInvoiceClear}
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
                  onClick={openCustomDialog}
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
                                    ? `发票金额不足 ${formatAmount(fuelShortfall)}；仍可预览 PDF，补足后才能修改状态或下载。`
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
                              onPasteError={onUploadError}
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
                                  onCancel={closePaperInvoiceEditor}
                                  onClear={requestPaperInvoiceClear}
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
        onClose={onCloseViewer}
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
        onClose={closeTicketImport}
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
            onChange={(event) => onManualSubsidyDraftChange(event.target.value)}
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

      <Dialog open={customDialogOpen} onClose={closeCustomDialog} fullWidth maxWidth="xs">
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
              onChange={(event) => onCustomNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleAddCustomCategory();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCustomDialog}>取消</Button>
          <Button variant="contained" onClick={handleAddCustomCategory}>
            添加
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(paperInvoiceClearTarget)} onClose={cancelPaperInvoiceClear} fullWidth maxWidth="xs">
        <DialogTitle>清空纸质发票？</DialogTitle>
        <DialogContent>
          <DialogContentText>将清除当前卡片登记的纸质发票金额和张数，不影响已上传的电子发票。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelPaperInvoiceClear}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmClearPaperInvoice}>
            清空
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pdfPreviewOpen} onClose={closePdfPreview} fullWidth maxWidth="lg">
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
          <Button onClick={closePdfPreview}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pdfBlockedOpen} onClose={closePdfBlocked} fullWidth maxWidth="xs">
        <DialogTitle>{hasUnconfirmedInvoices ? "存在未确认发票" : "燃油补助发票金额不足"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {hasUnconfirmedInvoices
              ? `当前报销单有 ${unconfirmedInvoiceCount} 张发票待确认，请先逐张确认发票信息后再预览或下载 PDF。`
              : `燃油补助发票还差 ${formatAmount(fuelSubsidyInvoiceShortfall)}。仍可预览 PDF，补充足额发票后才能修改状态或下载。`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePdfBlocked}>知道了</Button>
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
        onClose={clearToast}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
