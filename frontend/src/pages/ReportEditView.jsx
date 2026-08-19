import {
  Alert,
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
import EditIcon from "@mui/icons-material/Edit";
import { useState } from "react";
import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import TicketImportDialog from "../components/TicketImportDialog";
import ExpenseCategoryList, { useExpenseCategoryExpansion } from "../features/report-edit/ExpenseCategoryList";
import ReportAttachmentSection from "../features/report-edit/ReportAttachmentSection";
import TripTimeline from "../features/report-edit/TripTimeline";
import BlockCard from "../features/report-edit-shared/BlockCard";
import CollapsibleRow from "../features/report-edit-shared/CollapsibleRow";
import EditPageHeader from "../features/report-edit-shared/EditPageHeader";
import EditPageLoading from "../features/report-edit-shared/EditPageLoading";
import EditPageNotices from "../features/report-edit-shared/EditPageNotices";
import PdfActionButtons from "../features/report-edit-shared/PdfActionButtons";
import PdfBlockedDialog from "../features/report-edit-shared/PdfBlockedDialog";
import PdfPreviewDialog from "../features/report-edit-shared/PdfPreviewDialog";
import {
  FIELD_GAP,
  SECTION_GAP,
  editMainLayoutSx,
  pageContentSx,
  sectionAnchorSx,
  sectionCardContentSx,
  summarySidebarSx,
  workCardSx,
} from "../features/report-edit-shared/editPageStyles";
import {
  formatAmount,
} from "./reportEditUtils";

const basicInfoGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(12, minmax(0, 1fr))" },
  gap: FIELD_GAP,
  alignItems: "start",
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
  } = page;
  const { form, handleChange } = basicInfo;
  const {
    tripYearRangeLabel,
    subsidyOccupiedDateKeys,
    subsidyIncludedDateKeys,
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
  const {
    expandedCategories: expandedExpenseCategories,
    setExpandedCategories: setExpandedExpenseCategories,
    allExpanded: allExpenseCategoriesExpanded,
    toggleAll: toggleAllExpenseCategories,
  } = useExpenseCategoryExpansion({
    categories: visibleExpenseCategories,
    expenseItems,
    invoicesForCategory,
    pinnedCategories: pinnedExpenseCategories,
    ready: !loading,
  });

  const hasAdvanceInfo = Boolean(
    form.advance_date_month || form.advance_date_day || Number(form.advance_amount || 0),
  );
  const basicInfoSummary = `${form.employee_name || "出差人待填写"} · ${form.department || "部门待填写"} · ${form.report_date || "报销日期待填写"}`;
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

      <Box sx={editMainLayoutSx}>
        <Box sx={{ minWidth: 0 }}>
          <Stack spacing={SECTION_GAP}>
            <BlockCard
              id="basic-info-section"
              title="基本信息"
              summary={<Typography variant="body2" color="text.secondary" noWrap>{basicInfoSummary}</Typography>}
              sx={sectionAnchorSx}
              bodySx={{ p: { xs: 2, md: 2.5 } }}
            >
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
                        <CollapsibleRow
                          id="advance-payment"
                          sx={{ gridColumn: { xs: "1 / -1", sm: "span 12" } }}
                          defaultExpanded={hasAdvanceInfo}
                          toggleLabel="预支信息明细"
                          summary={
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
                          }
                          drawerSx={{ px: 1.5, pt: 0.5, pb: 1.5 }}
                        >
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
                        </CollapsibleRow>
                  </Box>
            </BlockCard>

            <TripTimeline
              reportDate={form.report_date}
              dailySubsidy={form.daily_subsidy}
              occupiedDateKeys={subsidyOccupiedDateKeys}
              includedDateKeys={subsidyIncludedDateKeys}
              readonly={readonly}
              saveState={saveState}
              uploadState={uploadState}
              tripEditor={{
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
                startTripDrag,
                dropTrip,
                endTripDrag,
                moveTripByIndex,
              }}
              invoiceFlow={{
                handleFilesUpload,
                onUploadError,
                onSelectInvoice,
                onDeleteInvoice: handleDeleteInvoice,
              }}
              paperInvoice={{
                paperInvoiceEditor,
                openPaperInvoiceEditor,
                updatePaperInvoiceEditor,
                savePaperInvoiceEditor,
                closePaperInvoiceEditor,
                requestPaperInvoiceClear,
              }}
            />

            <BlockCard
              id="expense-section"
              title="其他费用"
              sx={sectionAnchorSx}
              summary={<Typography component="span" variant="body2" color="text.secondary">只显示已录入或有发票的费用类别。</Typography>}
              actions={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {visibleExpenseCategories.length > 0 && (
                    <Button size="small" variant="text" onClick={toggleAllExpenseCategories}>
                      {allExpenseCategoriesExpanded ? "全部收起" : "全部展开"}
                    </Button>
                  )}
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
                </Stack>
              }
              bodySx={{ p: visibleExpenseCategories.length === 0 ? { xs: 2, md: 2.5 } : { xs: 1.5, md: 2 } }}
            >
                  {visibleExpenseCategories.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {readonly ? "暂无其他费用。" : "暂无其他费用。点击「添加费用」选择费用类别。"}
                    </Typography>
                  ) : (
                    <ExpenseCategoryList
                      categories={visibleExpenseCategories}
                      expenseItems={expenseItems}
                      invoicesForCategory={invoicesForCategory}
                      readonly={readonly}
                      saveState={saveState}
                      uploadState={uploadState}
                      expandedCategories={expandedExpenseCategories}
                      onExpandedCategoriesChange={setExpandedExpenseCategories}
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
            </BlockCard>

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
                      <Typography fontWeight={800} color={hasTripMarkerIssue ? "warning.dark" : "text.primary"}>
                        {hasTripMarkerIssue ? "起止未成对" : `${summary.subsidyDays} 天`}
                      </Typography>
                    </Stack>
                  )}
                  {summary.subsidyOverlapDays > 0 && (
                    <Typography variant="caption" color="warning.dark">
                      有 {summary.subsidyOverlapDays} 个重叠日期未计入
                    </Typography>
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
