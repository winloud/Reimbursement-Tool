import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useState } from "react";
import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import TicketImportDialog from "../components/TicketImportDialog";
import PaperInvoiceEntry from "../features/report-edit/PaperInvoiceEntry";
import ExpenseCategoryList from "../features/report-edit/ExpenseCategoryList";
import ReportAttachmentSection from "../features/report-edit/ReportAttachmentSection";
import CardOrderControls, { DragHandle } from "../features/report-edit-shared/CardOrderControls";
import EditPageHeader from "../features/report-edit-shared/EditPageHeader";
import EditPageLoading from "../features/report-edit-shared/EditPageLoading";
import EditPageNotices from "../features/report-edit-shared/EditPageNotices";
import FileDropSlot from "../features/report-edit-shared/FileDropSlot";
import InvoiceCardList from "../features/report-edit-shared/InvoiceCardList";
import PdfActionButtons from "../features/report-edit-shared/PdfActionButtons";
import PdfBlockedDialog from "../features/report-edit-shared/PdfBlockedDialog";
import PdfPreviewDialog from "../features/report-edit-shared/PdfPreviewDialog";
import SectionHeader from "../features/report-edit-shared/SectionHeader";
import {
  FIELD_GAP,
  SECTION_GAP,
  accordionCardSx,
  cardSubSectionDividerSx,
  draggingCardSx,
  editMainLayoutSx,
  pageContentSx,
  sectionAnchorSx,
  sectionCardContentSx,
  subtlePanelSx,
  summarySidebarSx,
  workCardSx,
} from "../features/report-edit-shared/editPageStyles";
import {
  TRIP_CARD_ACTION_POLICY,
  formatAmount,
  getConfirmedInvoiceCount,
  getConfirmedInvoiceTotal,
  getPaperInvoiceCount,
  hasPaperInvoice,
} from "./reportEditUtils";

const TRIP_OVERFLOW_ACTION_META = {
  duplicate: { label: "复制行程", Icon: ContentCopyIcon },
  swap: { label: "交换出发/到达", Icon: SwapHorizIcon },
  delete: { label: "删除行程", Icon: DeleteIcon, destructive: true },
};

const TRANSPORT_OPTIONS = ["飞机", "高铁/动车", "网约车", "自驾"];

const tripCardTitleSx = {
  minWidth: 0,
};

const tripCardMetaRowSx = {
  minWidth: 0,
  flexWrap: "nowrap",
  mt: 0.25,
};

const tripCardInvoiceChipSx = {
  flex: "0 0 auto",
};

const tripCardSummarySx = {
  minWidth: 0,
  flex: "1 1 auto",
};

const tripCardActionsSx = {
  flex: "0 0 auto",
  flexWrap: "nowrap",
  alignSelf: { xs: "flex-end", sm: "auto" },
};

// 出发/到达各压成一行：段标签 + 日历日期 + 手填「时」+ 地点。
// 日期列下限要容得下 "2026/07/25" 加日历图标，否则原生 date 输入会直接截断末位。
const tripFieldGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "auto minmax(0, 1fr) calc(3ch + 34px)",
    sm: "auto minmax(158px, 0.9fr) calc(3ch + 34px) minmax(0, 1.1fr)",
  },
  gap: { xs: 1, md: 1.25 },
  alignItems: "center",
};

const tripSegmentLabelSx = {
  whiteSpace: "nowrap",
  color: "text.secondary",
};

const tripDateFieldSx = {
  width: "100%",
  minWidth: 0,
};

const tripNumberFieldSx = {
  width: "100%",
  minWidth: 0,
};

const tripPlaceFieldSx = {
  gridColumn: { xs: "1 / -1", sm: "auto" },
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

// 单列后主列约 1050-1330px：xl 把出发、到达、交通工具排成一行，lg 及以下回退两行。
const tripSegmentGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "1fr",
    md: "repeat(2, minmax(0, 1fr))",
    xl: "minmax(0, 1fr) minmax(0, 1fr) minmax(150px, 180px)",
  },
  gap: FIELD_GAP,
  alignItems: "start",
};

const tripTransportFieldSx = {
  gridColumn: { xs: "1 / -1", xl: "auto" },
  alignSelf: "center",
};

const tripSegmentPanelSx = {
  ...subtlePanelSx,
  p: { xs: 1, md: 1.25 },
};

const EDIT_SECTIONS = [
  { id: "basic-info-section", label: "基本信息" },
  { id: "trip-list-section", label: "行程" },
  { id: "expense-section", label: "其他费用" },
  { id: "summary-section", label: "汇总", hideOnXl: true },
];

const tripTime = (month, day, hour) => `${month}/${day}${hour === "" || hour === null ? "" : ` ${hour}时`}`;

export default function ReportEditView({
  page,
  basicInfo,
  tripEditor,
  expenseEditor,
  reportAttachments,
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
    id,
    canSaveReport,
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
    endTripDrag,
    moveTripByIndex,
  } = tripEditor;
  const {
    visibleExpenseCategories,
    addableExpenseCategories,
    pinnedExpenseCategories,
    expenseItems,
    invoicesForCategory,
    updateExpenseItem,
    addExpenseCategory,
    removeExpenseCategory,
    openCustomDialog,
    paperInvoiceEditor,
    openPaperInvoiceEditor,
    updatePaperInvoiceEditor,
    savePaperInvoiceEditor,
    closePaperInvoiceEditor,
    requestPaperInvoiceClear,
  } = expenseEditor;
  const {
    attachments,
    uploading: attachmentUploading,
    handleFilesUpload: handleAttachmentFilesUpload,
    handleDelete: handleDeleteReportAttachment,
    onUploadError: onAttachmentUploadError,
  } = reportAttachments;
  const {
    summary,
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
    ensureReportIdForAction,
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
    toast,
    clearToast,
  } = overlays;

  const [tripActionMenu, setTripActionMenu] = useState({ anchorEl: null, index: null });
  const closeTripActionMenu = () => setTripActionMenu({ anchorEl: null, index: null });
  const handleTripOverflowAction = (actionId) => {
    const tripIndex = tripActionMenu.index;
    closeTripActionMenu();
    if (tripIndex === null) return;
    if (actionId === "duplicate") duplicateTrip(tripIndex);
    if (actionId === "swap") swapTrip(tripIndex);
    if (actionId === "delete") removeTrip(tripIndex);
  };

  const [expenseMenuAnchor, setExpenseMenuAnchor] = useState(null);
  const closeExpenseMenu = () => setExpenseMenuAnchor(null);
  const handleAddExpenseCategory = (category) => {
    closeExpenseMenu();
    addExpenseCategory(category);
  };
  const handleOpenCustomExpense = () => {
    closeExpenseMenu();
    openCustomDialog();
  };

  const renderInvoiceList = (items, uploadSlot) => (
    <InvoiceCardList
      invoices={items}
      readonly={readonly}
      uploadSlot={uploadSlot}
      onSelect={onSelectInvoice}
      onDelete={handleDeleteInvoice}
    />
  );
  const hasAdvanceInfo = Boolean(
    form.advance_date_month || form.advance_date_day || Number(form.advance_amount || 0),
  );
  const advanceSummary = hasAdvanceInfo
    ? `${form.advance_date_month || "-"} 月 ${form.advance_date_day || "-"} 日 · ${formatAmount(form.advance_amount)}`
    : "无预支";

  if (loading) {
    return <EditPageLoading message={creatingDraft ? "正在准备报销单..." : "正在加载报销单..."} />;
  }

  return (
    <Stack spacing={SECTION_GAP} sx={pageContentSx}>
      <EditPageHeader
        title={id ? `出差报销单 #${id}` : "新建出差报销单"}
        subtitle="基本信息、行程、发票和预支信息在一页完成。"
        chips={
          <>
            <Chip size="small" sx={statusMeta.chipSx} label={statusMeta.label} />
            <Chip size="small" color={saveMeta.color} icon={saveMeta.icon} label={saveMeta.text} />
          </>
        }
        onBack={() => requestNavigation("/reports")}
        saveState={saveState}
        canSave={canSaveReport}
        readonly={readonly}
        onSave={() => saveReport({ quiet: false, force: true })}
        statusActions={actions}
        onStatusAction={handleStatusAction}
      />

      <EditPageNotices
        error={error}
        readonly={readonly}
        readonlyMessage="已核对、已提交和已报销状态为只读，不可修改报销单内容、发票、附件和车票。"
        uploadState={uploadState}
      />

      <Card sx={editSectionNavSx}>
        <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EDIT_SECTIONS.map((section) => (
              <Button
                key={section.id}
                size="small"
                variant="text"
                onClick={() => scrollToSection(section.id)}
                sx={section.hideOnXl ? { display: { xs: "inline-flex", xl: "none" } } : undefined}
              >
                {section.label}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Box sx={editMainLayoutSx}>
        <Box sx={{ minWidth: 0 }}>
          <Stack spacing={SECTION_GAP}>
            <Stack id="basic-info-section" spacing={1.5} sx={sectionAnchorSx}>
              <SectionHeader title="基本信息" />
              <Card sx={workCardSx}>
                <CardContent sx={sectionCardContentSx}>
                  <Box sx={basicInfoGridSx}>
                        <Box sx={{ gridColumn: { sm: "span 6", lg: "span 3" } }}>
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
                        <Box sx={{ gridColumn: { sm: "span 6", lg: "span 3" } }}>
                          <TextField fullWidth size="small" label="部门" value={form.department} onChange={handleChange("department")} disabled={readonly} />
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 6", lg: "span 3" } }}>
                          <TextField
                            fullWidth
                            size="small"
                            label="出差人"
                            value={form.employee_name}
                            onChange={handleChange("employee_name")}
                            disabled={readonly}
                          />
                        </Box>
                        <Box sx={{ gridColumn: { sm: "span 6", lg: "span 3" } }}>
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
                        <Accordion
                          defaultExpanded={hasAdvanceInfo}
                          disableGutters
                          elevation={0}
                          sx={{
                            ...accordionCardSx,
                            gridColumn: { xs: "1 / -1", sm: "span 12" },
                          }}
                        >
                          <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            aria-controls="advance-payment-content"
                            id="advance-payment-header"
                            sx={{
                              minHeight: 48,
                              px: 1.5,
                              "& .MuiAccordionSummary-content": { my: 1 },
                            }}
                          >
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={{ xs: 0.25, sm: 1 }}
                              alignItems={{ xs: "flex-start", sm: "center" }}
                            >
                              <Typography fontWeight={800}>预支信息</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {advanceSummary}
                              </Typography>
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails id="advance-payment-content" sx={{ px: 1.5, pt: 0.5, pb: 1.5 }}>
                            <Box sx={{ ...basicInfoGridSx, gap: { xs: 1.25, sm: 1.5 } }}>
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
                          </AccordionDetails>
                        </Accordion>
                  </Box>
                </CardContent>
              </Card>
            </Stack>

            <Stack id="trip-list-section" spacing={1.5} sx={sectionAnchorSx}>
              <SectionHeader
                title="行程列表"
                chip={tripYearRangeLabel && <Chip size="small" color="info" variant="outlined" label={tripYearRangeLabel} />}
                description="复制、返程和排序都会自动保存。"
                actions={
                  <>
                    <Button variant="contained" onClick={handleOpenTicketImport} disabled={readonly || saveState === "saving"}>
                      从车票导入
                    </Button>
                    <Button startIcon={<AddIcon />} variant="outlined" onClick={addTrip} disabled={readonly}>
                      手动添加
                    </Button>
                  </>
                }
              />

              {trips.length === 0 ? (
                <Alert severity="info">暂无行程。可以批量导入铁路电子客票自动生成，也可以手动添加第一段行程。</Alert>
              ) : (
                <Stack spacing={SECTION_GAP}>
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
                    const confirmedInvoiceCount = confirmedElectronicCount + paperInvoiceCount;
                    const invoiceAmountText = confirmedInvoiceCount > 0 ? ` · 发票 ${formatAmount(confirmedAmount)}` : "";
                    const summaryText = `${markerPrefix}${tripTime(trip.depart_month, trip.depart_day, trip.depart_hour)} ${
                      trip.depart_place || "出发地"
                    } -> ${tripTime(trip.arrive_month, trip.arrive_day, trip.arrive_hour)} ${
                      trip.arrive_place || "到达地"
                    }${markerSuffix} · ${trip.transport || "交通工具"}${invoiceAmountText}`;

                    return (
                      <Card
                        key={trip.id || `new-${index}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => dropTrip(index)}
                        sx={{
                          ...workCardSx,
                          ...(dragIndex === index ? draggingCardSx : {}),
                        }}
                      >
                      <CardContent sx={sectionCardContentSx}>
                        <Stack spacing={2}>
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            alignItems={{ xs: "stretch", sm: "flex-start" }}
                            justifyContent="space-between"
                            spacing={1}
                          >
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: "1 1 auto" }}>
                              <DragHandle
                                label={`拖动排序：${tripTitle}`}
                                disabled={readonly}
                                active={dragIndex === index}
                                onDragStart={() => startTripDrag(index)}
                                onDragEnd={endTripDrag}
                              />
                              <Box sx={{ minWidth: 0, flex: "1 1 auto" }}>
                                <Tooltip title={tripTitle}>
                                  <Typography fontWeight={900} noWrap sx={tripCardTitleSx}>
                                    {tripTitle}
                                  </Typography>
                                </Tooltip>
                                <Stack direction="row" alignItems="center" spacing={0.75} sx={tripCardMetaRowSx}>
                                  <Chip
                                    size="small"
                                    color={tripInvoiceColor}
                                    variant="outlined"
                                    label={tripInvoiceLabel}
                                    sx={tripCardInvoiceChipSx}
                                  />
                                  <Tooltip title={summaryText}>
                                    <Typography variant="body2" color="text.secondary" noWrap sx={tripCardSummarySx}>
                                      {summaryText}
                                    </Typography>
                                  </Tooltip>
                                </Stack>
                              </Box>
                            </Stack>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={tripCardActionsSx}>
                              {TRIP_CARD_ACTION_POLICY.directActions.includes("start") && (
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
                              )}
                              {TRIP_CARD_ACTION_POLICY.directActions.includes("end") && (
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
                              )}
                              {TRIP_CARD_ACTION_POLICY.directActions.includes("return") && (
                                <Tooltip title="生成返程">
                                  <span>
                                    <IconButton
                                      size="small"
                                      disabled={readonly}
                                      onClick={() => returnTrip(index)}
                                      aria-label={`生成返程：${tripTitle}`}
                                    >
                                      <KeyboardReturnIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                              <CardOrderControls
                                index={index}
                                totalItems={trips.length}
                                itemLabel={tripTitle}
                                disabled={readonly}
                                onMove={moveTripByIndex}
                              />
                              <Tooltip title="更多行程操作">
                                <span>
                                  <IconButton
                                    size="small"
                                    disabled={readonly}
                                    onClick={(event) => setTripActionMenu({ anchorEl: event.currentTarget, index })}
                                    aria-label={`更多行程操作：${tripTitle}`}
                                    aria-haspopup="menu"
                                    aria-expanded={tripActionMenu.index === index ? "true" : undefined}
                                  >
                                    <MoreVertIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          </Stack>

                          <Box sx={tripSegmentGridSx}>
                            <Box sx={tripSegmentPanelSx}>
                              <Box sx={tripFieldGridSx}>
                                <Typography variant="subtitle2" fontWeight={900} sx={tripSegmentLabelSx}>
                                  出发
                                </Typography>
                                <TextField
                                  size="small"
                                  sx={tripDateFieldSx}
                                  label="日期"
                                  type="date"
                                  value={trip.depart_date}
                                  disabled={readonly}
                                  onChange={(event) => updateTrip(index, "depart_date", event.target.value)}
                                  InputLabelProps={{ shrink: true }}
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
                            </Box>
                            <Box sx={tripSegmentPanelSx}>
                              <Box sx={tripFieldGridSx}>
                                <Typography variant="subtitle2" fontWeight={900} sx={tripSegmentLabelSx}>
                                  到达
                                </Typography>
                                <TextField
                                  size="small"
                                  sx={tripDateFieldSx}
                                  label="日期"
                                  type="date"
                                  value={trip.arrive_date}
                                  disabled={readonly}
                                  onChange={(event) => updateTrip(index, "arrive_date", event.target.value)}
                                  InputLabelProps={{ shrink: true }}
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
                            </Box>
                            <Box sx={tripTransportFieldSx}>
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
                                {renderInvoiceList(
                                  tripInvoices,
                                  <FileDropSlot
                                    kind="invoice"
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
                                  />,
                                )}
                                {(!readonly || hasPaperInvoice(trip)) && (
                                  <Box sx={cardSubSectionDividerSx}>
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
                    );
                  })}
                </Stack>
              )}
            </Stack>

            <Menu
              anchorEl={tripActionMenu.anchorEl}
              open={Boolean(tripActionMenu.anchorEl)}
              onClose={closeTripActionMenu}
              MenuListProps={{ "aria-label": "更多行程操作" }}
            >
              {TRIP_CARD_ACTION_POLICY.overflowActions.map((actionId) => {
                const action = TRIP_OVERFLOW_ACTION_META[actionId];
                const ActionIcon = action.Icon;
                return (
                  <MenuItem
                    key={actionId}
                    disabled={readonly}
                    onClick={() => handleTripOverflowAction(actionId)}
                    sx={action.destructive ? { color: "error.main" } : undefined}
                  >
                    <ListItemIcon sx={action.destructive ? { color: "error.main" } : undefined}>
                      <ActionIcon fontSize="small" />
                    </ListItemIcon>
                    {action.label}
                  </MenuItem>
                );
              })}
            </Menu>

            <Stack id="expense-section" spacing={1.5} sx={sectionAnchorSx}>
              <SectionHeader
                title="其他费用发票"
                description="只显示已录入或有发票的费用类别，其余通过「添加费用」补充。"
                actions={
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    endIcon={<ArrowDropDownIcon />}
                    disabled={readonly}
                    onClick={(event) => setExpenseMenuAnchor(event.currentTarget)}
                    aria-haspopup="menu"
                    aria-expanded={expenseMenuAnchor ? "true" : undefined}
                  >
                    添加费用
                  </Button>
                }
              />
              <Card sx={workCardSx}>
                <CardContent sx={sectionCardContentSx}>
                  {visibleExpenseCategories.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      暂无其他费用。点击「添加费用」选择费用类别。
                    </Typography>
                  ) : (
                    <ExpenseCategoryList
                      categories={visibleExpenseCategories}
                      expenseItems={expenseItems}
                      invoicesForCategory={invoicesForCategory}
                      readonly={readonly}
                      saveState={saveState}
                      uploadState={uploadState}
                      pinnedCategories={pinnedExpenseCategories}
                      paperInvoiceEditor={paperInvoiceEditor}
                      onUpdateExpenseItem={updateExpenseItem}
                      onRemoveCategory={removeExpenseCategory}
                      onFilesUpload={handleFilesUpload}
                      onUploadError={onUploadError}
                      onSelectInvoice={onSelectInvoice}
                      onDeleteInvoice={handleDeleteInvoice}
                      onOpenPaperInvoice={openPaperInvoiceEditor}
                      onChangePaperInvoice={updatePaperInvoiceEditor}
                      onSavePaperInvoice={savePaperInvoiceEditor}
                      onCancelPaperInvoice={closePaperInvoiceEditor}
                      onClearPaperInvoice={requestPaperInvoiceClear}
                    />
                  )}
                </CardContent>
              </Card>
            </Stack>

            <Menu
              anchorEl={expenseMenuAnchor}
              open={Boolean(expenseMenuAnchor)}
              onClose={closeExpenseMenu}
              MenuListProps={{ "aria-label": "添加费用" }}
            >
              {addableExpenseCategories.map((category) => (
                <MenuItem key={category.value} onClick={() => handleAddExpenseCategory(category.value)}>
                  {category.label}
                </MenuItem>
              ))}
              {addableExpenseCategories.length > 0 && <Divider />}
              <MenuItem onClick={handleOpenCustomExpense}>
                <ListItemIcon>
                  <AddIcon fontSize="small" />
                </ListItemIcon>
                自定义费用…
              </MenuItem>
            </Menu>

            <ReportAttachmentSection
              attachments={attachments}
              readonly={readonly}
              uploading={attachmentUploading}
              onFiles={handleAttachmentFilesUpload}
              onDelete={handleDeleteReportAttachment}
              onUploadError={onAttachmentUploadError}
            />
          </Stack>
        </Box>

        <Box id="summary-section" sx={{ ...summarySidebarSx, ...sectionAnchorSx }}>
          <Card sx={workCardSx}>
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

                <Alert severity={pdfGate.severity} sx={{ py: 0.75 }}>
                  {pdfGate.message}
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

                <PdfActionButtons
                  busy={pdfBusy}
                  previewDisabled={pdfGate.previewDisabled}
                  downloadDisabled={pdfGate.downloadDisabled}
                  previewBlocked={pdfGate.previewBlocked}
                  downloadBlocked={pdfGate.downloadBlocked}
                  previewBlockedLabel={pdfGate.previewBlockedLabel}
                  downloadBlockedLabel={pdfGate.downloadBlockedLabel}
                  onPreview={handlePdfPreview}
                  onDownload={handlePdfDownload}
                />
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
        ensureReportId={ensureReportIdForAction}
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

      <PdfPreviewDialog open={pdfPreviewOpen} onClose={closePdfPreview} pages={pdfPreviewPages} title="PDF 预览" />

      <PdfBlockedDialog
        open={pdfBlockedOpen}
        onClose={closePdfBlocked}
        title={pdfGate.dialogTitle}
        message={pdfGate.message}
      />

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
