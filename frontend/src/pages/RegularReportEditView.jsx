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
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SaveIcon from "@mui/icons-material/Save";
import VisibilityIcon from "@mui/icons-material/Visibility";

import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import InvoiceDropzone from "../features/report-edit/InvoiceDropzone";
import RegularEvidenceSection from "../features/regular-report/RegularEvidenceSection";
import {
  formatRegularAmount,
  getRegularItemDerived,
  getRegularModeLabel,
} from "./regularReportUtils";

const repeatedCardGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
  gap: { xs: 2, md: 2.5 },
  alignItems: "stretch",
};

function InvoiceRows({ invoices, readonly, uploadSlot, onSelect, onDelete }) {
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
          {invoices.length} 张
        </Box>
        <Divider sx={{ flex: 1 }} />
      </Stack>
      {invoices.length === 0 && readonly ? (
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
          {invoices.map((invoice) => {
            const invoiceNumber = invoice.invoice_no || "无发票号码";
            const confirmationLabel = invoice.amount_confirmed ? "已确认" : "待确认";
            const fileType = String(invoice.file_type || "file").toUpperCase();

            return (
              <Paper
                key={invoice.id}
                variant="outlined"
                sx={{
                  minWidth: 0,
                  minHeight: 54,
                  height: "100%",
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
                    <Tooltip title={formatRegularAmount(invoice.amount)}>
                      <Typography
                        variant="body2"
                        fontWeight={800}
                        noWrap
                        sx={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.2, minWidth: 0, maxWidth: "100%" }}
                      >
                        {formatRegularAmount(invoice.amount)}
                      </Typography>
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.2 }}>
                      <Box component="span" sx={{ fontWeight: 700 }}>{fileType}</Box>
                      <Box component="span" color="text.disabled" aria-hidden="true" sx={{ mx: 0.375 }}>·</Box>
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
          {!readonly && uploadSlot}
        </Box>
      )}
    </Stack>
  );
}

function AddRegularItemPlaceholder({ onClick }) {
  return (
    <Button
      fullWidth
      variant="outlined"
      startIcon={<AddIcon />}
      onClick={onClick}
      sx={{
        minHeight: { xs: 96, md: 132 },
        borderStyle: "dashed",
        borderColor: "divider",
        bgcolor: "#F8FAFC",
        color: "text.secondary",
        "&:hover": { borderStyle: "dashed", borderColor: "primary.main", bgcolor: "primary.50" },
      }}
    >
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
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: "8px !important",
        overflow: "hidden",
        boxShadow: "none",
        height: "100%",
        "&::before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 54, px: { xs: 1.25, sm: 2 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, width: "100%", pr: 1 }}>
          <Chip size="small" label={index + 1} sx={{ minWidth: 30 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography fontWeight={800} noWrap>{title}</Typography>
            <Typography variant="caption" color="text.secondary">
              {item.occurred_on || "发生日期待填写"} · {derived.documentCount} 张单据
            </Typography>
          </Box>
          <Typography fontWeight={900} sx={{ whiteSpace: "nowrap" }}>{formatRegularAmount(derived.amount)}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, px: { xs: 1.25, sm: 2 }, pb: { xs: 1.5, sm: 2 } }}>
        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={1.5}>
          {!readonly && (
            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
              <Tooltip title="上移">
                <span><IconButton size="small" disabled={index === 0} onClick={() => onMove(index, index - 1)}><KeyboardArrowUpIcon fontSize="small" /></IconButton></span>
              </Tooltip>
              <Tooltip title="下移">
                <span><IconButton size="small" disabled={index === totalItems - 1} onClick={() => onMove(index, index + 1)}><KeyboardArrowDownIcon fontSize="small" /></IconButton></span>
              </Tooltip>
              <Tooltip title="删除项目">
                <IconButton size="small" color="error" onClick={() => onDelete(item)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
          )}

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
              <InvoiceRows
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
    return <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 420 }}><CircularProgress /></Stack>;
  }

  return (
    <Stack spacing={{ xs: 2, md: 2.5 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" fontWeight={800}>
              {reportId ? `常规报销单 #${reportId}` : "新建常规报销单"}
            </Typography>
            <Chip size="small" icon={<LockOutlinedIcon />} label={getRegularModeLabel(mode)} color={mode === "invoice" ? "primary" : "default"} />
            <Chip size="small" sx={statusMeta.chipSx} label={statusMeta.label} />
            <Chip size="small" color={saveMeta.color} icon={saveMeta.icon} label={saveMeta.text} />
          </Stack>
          <Typography color="text.secondary">报销模式创建后不可切换。</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ "& > .MuiButton-root": { whiteSpace: "nowrap" } }}>
          <Button startIcon={<ArrowBackIcon />} variant="outlined" onClick={onBack}>
            返回列表
          </Button>
          <Button
            startIcon={saveState === "saving" ? <CircularProgress size={16} /> : <SaveIcon />}
            variant="contained"
            onClick={onSave}
            disabled={readonly || saveState === "saving"}
          >
            手动保存
          </Button>
          {statusActions.map((action) => (
            <Button
              key={action.target}
              variant="outlined"
              color={action.color === "inherit" ? "inherit" : action.color}
              onClick={() => onStatusAction(action.target)}
              disabled={saveState === "saving"}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
      {readonly && <Alert severity="info">已核对、已提交和已报销状态为只读，不可修改常规报销单内容、发票和凭据。</Alert>}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px minmax(220px, 1fr)" }, gap: 1.25, alignItems: "start" }}>
        <TextField
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
          size="small"
          label="报销人"
          required
          disabled={readonly}
          value={form.employee_name}
          onChange={(event) => onChange("employee_name", event.target.value)}
          inputProps={{ maxLength: 50 }}
        />
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 300px" }, gap: 2, alignItems: "start" }}>
        <Stack spacing={1.25} sx={{ minWidth: 0 }}>
          <Box>
            <Typography variant="h6" fontWeight={800}>报销项目</Typography>
            <Typography variant="body2" color="text.secondary">一行一个自定义项目，可排序并独立管理单据。</Typography>
          </Box>
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

        <Box sx={{ position: { lg: "sticky" }, top: { lg: 24 } }}>
          <Card>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" fontWeight={800}>报销合计</Typography>
                  <Typography variant="h4" fontWeight={900} sx={{ mt: 0.25 }}>{formatRegularAmount(summary.totalAmount)}</Typography>
                  <Typography variant="body2" color="text.secondary">{items.length} 个项目 · {summary.documentCount} 张单据</Typography>
                </Box>
                <Divider />
                <Stack direction="row" spacing={1}>
                  <Button fullWidth variant="outlined" startIcon={pdfBusy === "preview" ? <CircularProgress size={16} /> : <VisibilityIcon />} onClick={onPreview} disabled={pdfBusy !== ""}>
                    预览
                  </Button>
                  <Button fullWidth variant="contained" startIcon={pdfBusy === "download" ? <CircularProgress size={16} /> : <DownloadIcon />} onClick={onDownload} disabled={pdfBusy !== ""}>
                    下载
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
        onSkip={invoiceQueue.length > 0 ? onInvoiceSkipped : undefined}
        onUpdated={onInvoiceUpdated}
      />
      <InvoiceUploadResultDialog result={uploadResult} onClose={onUploadResultClose} onContinue={onUploadResultContinue} />

      <Dialog open={overlays.previewOpen} onClose={overlays.onClosePreview} maxWidth="md" fullWidth>
        <DialogTitle>常规报销单预览</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {overlays.previewPages.map((page) => (
              <Box component="img" key={page.page} src={page.image_url} alt={`常规报销单第 ${page.page} 页`} sx={{ width: "100%", border: 1, borderColor: "divider" }} />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={overlays.onClosePreview}>关闭</Button></DialogActions>
      </Dialog>

      <Snackbar open={Boolean(overlays.toast)} autoHideDuration={3000} onClose={overlays.onCloseToast} message={overlays.toast} />
    </Stack>
  );
}
