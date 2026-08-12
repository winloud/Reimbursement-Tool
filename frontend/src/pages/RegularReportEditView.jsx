import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import InvoiceDropzone from "../features/report-edit/InvoiceDropzone";
import RegularEvidenceSection from "../features/regular-report/RegularEvidenceSection";
import EditPageHeader from "../features/report-edit-shared/EditPageHeader";
import EditPageLoading from "../features/report-edit-shared/EditPageLoading";
import EditPageNotices from "../features/report-edit-shared/EditPageNotices";
import InvoiceCardList from "../features/report-edit-shared/InvoiceCardList";
import PdfActionButtons from "../features/report-edit-shared/PdfActionButtons";
import PdfBlockedDialog from "../features/report-edit-shared/PdfBlockedDialog";
import PdfPreviewDialog from "../features/report-edit-shared/PdfPreviewDialog";
import SectionHeader from "../features/report-edit-shared/SectionHeader";
import {
  FIELD_GAP,
  SECTION_GAP,
  accordionCardSx,
  dashedAddCardSx,
  editMainLayoutSx,
  pageContentSx,
  repeatedCardGridSx,
  sectionCardContentSx,
  summarySidebarSx,
  workCardSx,
} from "../features/report-edit-shared/editPageStyles";
import {
  formatRegularAmount,
  getRegularItemDerived,
  getRegularModeLabel,
} from "./regularReportUtils";

const stopSummaryInteraction = {
  onClick: (event) => event.stopPropagation(),
  onMouseDown: (event) => event.stopPropagation(),
  onKeyDown: (event) => event.stopPropagation(),
  onFocus: (event) => event.stopPropagation(),
};

function AddRegularItemPlaceholder({ onClick }) {
  return (
    <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={onClick} sx={dashedAddCardSx}>
      添加报销项目
    </Button>
  );
}

function RegularItemCard({
  item,
  index,
  totalItems,
  mode,
  invoices,
  attachments,
  readonly,
  uploadState,
  onUpdate,
  onMove,
  onDelete,
  onInvoiceFiles,
  onEvidenceFiles,
  onSelectInvoice,
  onDeleteInvoice,
  onDeleteEvidence,
  onUploadError,
}) {
  const derived = getRegularItemDerived({ item, mode, invoices, attachments });
  const title = String(item.description || "").trim() || "未命名项目";
  const uploading = uploadState?.regularItemId === item.id;

  return (
    <Accordion
      defaultExpanded={index === 0 || !item.id}
      disableGutters
      elevation={0}
      sx={{ ...accordionCardSx, height: "100%" }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 64,
          px: { xs: 1.5, md: 2 },
          "& .MuiAccordionSummary-content": { my: 1.25, minWidth: 0 },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, width: "100%", pr: 1 }}>
          <Chip size="small" label={index + 1} sx={{ minWidth: 30 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Tooltip title={title}>
              <Typography fontWeight={800} noWrap>
                {title}
              </Typography>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              {item.occurred_on || "发生日期待填写"} · {derived.documentCount} 张单据
            </Typography>
          </Box>
          <Typography fontWeight={900} sx={{ whiteSpace: "nowrap" }}>
            {formatRegularAmount(derived.amount)}
          </Typography>
          {!readonly && (
            <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }} {...stopSummaryInteraction}>
              <Tooltip title="上移">
                <span>
                  <IconButton
                    size="small"
                    disabled={index === 0}
                    aria-label={`上移项目：${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(index, index - 1);
                    }}
                  >
                    <KeyboardArrowUpIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="下移">
                <span>
                  <IconButton
                    size="small"
                    disabled={index === totalItems - 1}
                    aria-label={`下移项目：${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(index, index + 1);
                    }}
                  >
                    <KeyboardArrowDownIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="删除项目">
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`删除项目：${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, px: { xs: 1.5, md: 2 }, pb: { xs: 1.5, md: 2 } }}>
        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={1.5}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: mode === "no_invoice" ? "170px minmax(0, 1fr) 160px" : "170px minmax(0, 1fr)" }, gap: 1.25 }}>
            <TextField
              size="small"
              label="发生日期"
              type="date"
              required
              disabled={readonly}
              value={item.occurred_on}
              onChange={(event) => onUpdate(index, "occurred_on", event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="项目名称"
              required
              disabled={readonly}
              value={item.description}
              onChange={(event) => onUpdate(index, "description", event.target.value)}
              inputProps={{ maxLength: 100 }}
            />
            {mode === "no_invoice" && (
              <TextField
                size="small"
                label="报销金额"
                type="number"
                required
                disabled={readonly}
                value={item.amount}
                onChange={(event) => onUpdate(index, "amount", event.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment>, inputProps: { min: 0, step: "0.01" } }}
              />
            )}
          </Box>
          <TextField
            size="small"
            label="备注（可选）"
            disabled={readonly}
            value={item.remark}
            onChange={(event) => onUpdate(index, "remark", event.target.value)}
            inputProps={{ maxLength: 200 }}
          />

          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={0.25} sx={{ mb: 0.75 }}>
              <Typography variant="subtitle2" fontWeight={900}>{mode === "invoice" ? "项目发票" : "报销凭据"}</Typography>
              <Typography variant="caption" color="text.secondary">
                {mode === "invoice" ? "金额由已确认发票自动汇总" : "凭据可选，页数自动计入单据张数"}
              </Typography>
            </Stack>
            {mode === "invoice" ? (
              <InvoiceCardList
                invoices={derived.invoices}
                readonly={readonly}
                uploadSlot={
                  <InvoiceDropzone
                    disabled={readonly}
                    uploading={uploading && uploadState?.kind === "invoice"}
                    onFiles={(files) => onInvoiceFiles(item, files)}
                    onPasteError={onUploadError}
                    hint="上传发票"
                  />
                }
                onSelect={onSelectInvoice}
                onDelete={onDeleteInvoice}
              />
            ) : (
              <RegularEvidenceSection
                attachments={derived.attachments}
                disabled={readonly}
                uploading={uploading && uploadState?.kind === "evidence"}
                onFiles={(files) => onEvidenceFiles(item, files)}
                onDelete={onDeleteEvidence}
                onError={onUploadError}
              />
            )}
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function RegularReportEditView({ page, header, editor, invoiceFlow, overlays }) {
  const {
    loading,
    error,
    readonly,
    statusMeta,
    saveMeta,
    saveState,
    reportId,
    mode,
    statusActions,
    pdfBusy,
    pdfGate,
    canSave,
    onBack,
    onSave,
    onStatusAction,
    onPreview,
    onDownload,
  } = page;
  const { form, onChange } = header;
  const {
    items,
    invoices,
    attachments,
    summary,
    uploadState,
    onAdd,
    onUpdate,
    onMove,
    onDelete,
    onInvoiceFiles,
    onEvidenceFiles,
    onDeleteInvoice,
    onDeleteEvidence,
    onUploadError,
  } = editor;
  const {
    selectedInvoice,
    invoiceQueue,
    uploadResult,
    onSelectInvoice,
    onCloseViewer,
    onInvoiceUpdated,
    onInvoiceSkipped,
    onUploadResultClose,
    onUploadResultContinue,
  } = invoiceFlow;

  if (loading) {
    return <EditPageLoading message="正在加载常规报销单..." />;
  }

  return (
    <Stack spacing={SECTION_GAP} sx={pageContentSx}>
      <EditPageHeader
        title={reportId ? `常规报销单 #${reportId}` : "新建常规报销单"}
        subtitle="报销项目、单据和金额在一页完成。"
        chips={
          <>
            <Tooltip title="报销模式创建后不可切换">
              <Chip
                size="small"
                icon={<LockOutlinedIcon />}
                label={getRegularModeLabel(mode)}
                color={mode === "invoice" ? "primary" : "default"}
              />
            </Tooltip>
            <Chip size="small" sx={statusMeta.chipSx} label={statusMeta.label} />
            <Chip size="small" color={saveMeta.color} icon={saveMeta.icon} label={saveMeta.text} />
          </>
        }
        onBack={onBack}
        saveState={saveState}
        canSave={canSave}
        readonly={readonly}
        onSave={onSave}
        statusActions={statusActions}
        onStatusAction={onStatusAction}
      />

      <EditPageNotices
        error={error}
        readonly={readonly}
        readonlyMessage="已核对、已提交和已报销状态为只读，不可修改常规报销单内容、发票和凭据。"
        uploadState={uploadState}
      />

      <Box sx={editMainLayoutSx}>
        <Box sx={{ minWidth: 0 }}>
          <Stack spacing={SECTION_GAP}>
            <Stack spacing={1.5}>
              <SectionHeader title="基本信息" />
              <Card sx={workCardSx}>
                <CardContent sx={sectionCardContentSx}>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "220px minmax(0, 1fr)" }, gap: FIELD_GAP, alignItems: "start" }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="date"
                      label="报销日期"
                      required
                      disabled={readonly}
                      value={form.report_date}
                      onChange={(event) => onChange("report_date", event.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label="报销人"
                      required
                      disabled={readonly}
                      value={form.employee_name}
                      onChange={(event) => onChange("employee_name", event.target.value)}
                      inputProps={{ maxLength: 50 }}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Stack>

            <Stack spacing={1.5}>
              <SectionHeader
                title="报销项目"
                chip={items.length > 0 ? <Chip size="small" variant="outlined" label={`${items.length} 项`} /> : null}
                description="一行一个自定义项目，可排序并独立管理单据。"
                actions={
                  <Button startIcon={<AddIcon />} variant="outlined" onClick={onAdd} disabled={readonly}>
                    添加项目
                  </Button>
                }
              />
              <Box sx={repeatedCardGridSx}>
                {items.map((item, index) => (
                  <RegularItemCard
                    key={item.clientKey || item.id}
                    item={item}
                    index={index}
                    totalItems={items.length}
                    mode={mode}
                    invoices={invoices}
                    attachments={attachments}
                    readonly={readonly}
                    uploadState={uploadState}
                    onUpdate={onUpdate}
                    onMove={onMove}
                    onDelete={onDelete}
                    onInvoiceFiles={onInvoiceFiles}
                    onEvidenceFiles={onEvidenceFiles}
                    onSelectInvoice={onSelectInvoice}
                    onDeleteInvoice={onDeleteInvoice}
                    onDeleteEvidence={onDeleteEvidence}
                    onUploadError={onUploadError}
                  />
                ))}
                {!readonly && <AddRegularItemPlaceholder onClick={onAdd} />}
                {items.length === 0 && readonly && (
                  <Alert severity="info" sx={{ gridColumn: "1 / -1" }}>暂无报销项目。</Alert>
                )}
              </Box>
            </Stack>
          </Stack>
        </Box>

        <Box sx={summarySidebarSx}>
          <Card sx={workCardSx}>
            <CardContent sx={sectionCardContentSx}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    费用汇总
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {mode === "invoice" ? "未确认金额不计入报销总额。" : "金额按项目录入自动合计。"}
                  </Typography>
                </Box>

                <Alert severity={pdfGate.severity} sx={{ py: 0.75 }}>
                  {pdfGate.message}
                </Alert>

                <Divider />

                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography color="text.secondary">报销总金额</Typography>
                    <Typography variant="h5" fontWeight={900} color="primary.main">
                      {formatRegularAmount(summary.totalAmount)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">报销项目</Typography>
                    <Typography fontWeight={800}>{items.length} 个</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">单据张数</Typography>
                    <Typography fontWeight={800}>{summary.documentCount} 张</Typography>
                  </Stack>
                </Stack>

                <Divider />

                <PdfActionButtons
                  busy={pdfBusy}
                  previewBlocked={pdfGate.previewBlocked}
                  downloadBlocked={pdfGate.downloadBlocked}
                  downloadBlockedLabel={pdfGate.unconfirmedCount > 0 ? "确认后下载" : "完善后下载"}
                  onPreview={onPreview}
                  onDownload={onDownload}
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
        onSkip={invoiceQueue.length > 0 ? onInvoiceSkipped : undefined}
        onUpdated={onInvoiceUpdated}
      />
      <InvoiceUploadResultDialog result={uploadResult} onClose={onUploadResultClose} onContinue={onUploadResultContinue} />

      <PdfPreviewDialog
        open={overlays.previewOpen}
        onClose={overlays.onClosePreview}
        pages={overlays.previewPages}
        title="常规报销单预览"
      />

      <PdfBlockedDialog
        open={overlays.pdfBlockedOpen}
        onClose={overlays.onClosePdfBlocked}
        title={pdfGate.unconfirmedCount > 0 ? "存在未确认发票" : "报销信息尚未完整"}
        message={pdfGate.message}
      />

      <Snackbar
        open={Boolean(overlays.toast)}
        autoHideDuration={2500}
        onClose={overlays.onCloseToast}
        message={overlays.toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
