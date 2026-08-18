import {
  Alert,
  Box,
  Button,
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
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import InvoiceUploadResultDialog from "../components/InvoiceUploadResultDialog";
import InvoiceViewer from "../components/InvoiceViewer";
import AttachmentCardList from "../features/report-edit-shared/AttachmentCardList";
import BlockCard from "../features/report-edit-shared/BlockCard";
import CardOrderControls, { DragHandle } from "../features/report-edit-shared/CardOrderControls";
import CollapsibleRow from "../features/report-edit-shared/CollapsibleRow";
import EditPageHeader from "../features/report-edit-shared/EditPageHeader";
import EditPageLoading from "../features/report-edit-shared/EditPageLoading";
import EditPageNotices from "../features/report-edit-shared/EditPageNotices";
import FileDropSlot from "../features/report-edit-shared/FileDropSlot";
import InvoiceCardList from "../features/report-edit-shared/InvoiceCardList";
import PdfActionButtons from "../features/report-edit-shared/PdfActionButtons";
import PdfBlockedDialog from "../features/report-edit-shared/PdfBlockedDialog";
import PdfPreviewDialog from "../features/report-edit-shared/PdfPreviewDialog";
import stopSummaryInteraction from "../features/report-edit-shared/stopSummaryInteraction";
import {
  FIELD_GAP,
  SECTION_GAP,
  collapsibleRowListSx,
  collapsibleRowNestedSurfaceSx,
  dashedAddCardSx,
  draggingCardSx,
  editMainLayoutSx,
  pageContentSx,
  summarySidebarSx,
} from "../features/report-edit-shared/editPageStyles";
import {
  formatRegularAmount,
  getRegularItemDerived,
  getRegularModeLabel,
} from "./regularReportUtils";

function AddRegularItemPlaceholder({ onClick }) {
  return (
    <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={onClick} sx={dashedAddCardSx}>
      添加报销项目
    </Button>
  );
}

// 详情字段：xl 下把备注并进同一行，窄屏时备注独占一行。
const itemFieldGridSx = {
  no_invoice: {
    display: "grid",
    gridTemplateColumns: {
      xs: "1fr",
      sm: "170px minmax(0, 1fr) 160px",
      xl: "170px minmax(0, 1fr) 160px minmax(0, 1fr)",
    },
    gap: 1.25,
  },
  invoice: {
    display: "grid",
    gridTemplateColumns: {
      xs: "1fr",
      sm: "170px minmax(0, 1fr)",
      xl: "170px minmax(0, 1fr) minmax(0, 1fr)",
    },
    gap: 1.25,
  },
};

const itemRemarkFieldSx = {
  gridColumn: { xs: "1 / -1", xl: "auto" },
};

// 抽屉内的文件卡与上传槽回到浅灰第三层；抽屉本身仍保持白底。
// FileDropSlot 的根节点由共享组件绘制，这里用后代选择器只改变它在本页抽屉中的底色。
const nestedUploadSlotSx = {
  ...collapsibleRowNestedSurfaceSx,
  minWidth: 0,
  height: "100%",
  "& > [role='group']": {
    bgcolor: "inherit",
    borderColor: "divider",
  },
};

const itemSummaryGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "24px 30px minmax(0, 1fr)",
    sm: "24px 30px minmax(0, 1fr) auto",
  },
  columnGap: 1,
  rowGap: 0.5,
  alignItems: "center",
  width: "100%",
  minWidth: 0,
};

const itemSummaryFactsSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr) auto auto",
    sm: "96px 78px 104px",
  },
  gridColumn: { xs: "1 / -1", sm: 4 },
  gridRow: { xs: 2, sm: 1 },
  gap: 1,
  alignItems: "baseline",
  minWidth: 0,
};

const itemSummaryMetricSx = {
  minWidth: 0,
  fontSize: 12.5,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
};

function RegularItemCard({
  item,
  index,
  totalItems,
  mode,
  invoices,
  attachments,
  readonly,
  uploadState,
  dragging,
  onUpdate,
  onMove,
  onDragStart,
  onDrop,
  onDragEnd,
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
    <CollapsibleRow
      component="article"
      defaultExpanded={!item.id}
      toggleLabel={`报销项目：${title}`}
      summary={
        <Box sx={itemSummaryGridSx}>
          <DragHandle
            label={`拖动排序：${title}`}
            disabled={readonly}
            active={dragging}
            onDragStart={() => onDragStart(index)}
            onDragEnd={onDragEnd}
          />
          <Chip size="small" label={index + 1} sx={{ minWidth: 30, "& .MuiChip-label": { px: 0.75 } }} />
          <Tooltip title={title}>
            <Typography variant="body2" fontWeight={800} noWrap sx={{ minWidth: 0 }}>
              {title}
            </Typography>
          </Tooltip>
          <Box sx={itemSummaryFactsSx}>
            <Typography variant="body2" color="text.secondary" sx={itemSummaryMetricSx}>
              {item.occurred_on || "日期待填写"}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="right" sx={itemSummaryMetricSx}>
              {derived.documentCount} 张单据
            </Typography>
            <Typography
              variant="body2"
              fontWeight={900}
              textAlign="right"
              sx={{ ...itemSummaryMetricSx, fontSize: 14, color: "text.primary" }}
            >
              {formatRegularAmount(derived.amount)}
            </Typography>
          </Box>
        </Box>
      }
      actions={
        !readonly ? (
          <Stack direction="row" spacing={0} alignItems="center" {...stopSummaryInteraction}>
            <CardOrderControls index={index} totalItems={totalItems} itemLabel={title} onMove={onMove} />
            <Tooltip title="删除项目">
              <IconButton
                size="small"
                color="error"
                aria-label={`删除项目：${title}`}
                onClick={() => onDelete(item)}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null
      }
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDrop(index)}
      sx={{
        ...(dragging ? draggingCardSx : {}),
      }}
      summarySx={{ minHeight: 46 }}
      drawerSx={{
        px: { xs: 1.5, md: 2 },
        py: { xs: 1.5, md: 2 },
      }}
    >
      <Stack spacing={1.5}>
        <Box sx={mode === "no_invoice" ? itemFieldGridSx.no_invoice : itemFieldGridSx.invoice}>
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
            <TextField
              size="small"
              sx={itemRemarkFieldSx}
              label="备注（可选）"
              disabled={readonly}
              value={item.remark}
              onChange={(event) => onUpdate(index, "remark", event.target.value)}
              inputProps={{ maxLength: 200 }}
            />
          </Box>

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
                  <Box sx={nestedUploadSlotSx}>
                    <FileDropSlot
                      kind="invoice"
                      disabled={readonly}
                      uploading={uploading && uploadState?.kind === "invoice"}
                      onFiles={(files) => onInvoiceFiles(item, files)}
                      onPasteError={onUploadError}
                    />
                  </Box>
                }
                onSelect={onSelectInvoice}
                onDelete={onDeleteInvoice}
              />
            ) : (
              <AttachmentCardList
                attachments={derived.attachments}
                title="已上传凭据"
                countUnit="个"
                emptyText="暂无报销凭据"
                readonly={readonly}
                uploadSlot={
                  <Box sx={nestedUploadSlotSx}>
                    <FileDropSlot
                      kind="attachment"
                      hint="添加报销凭据"
                      uploadingText="正在上传凭据"
                      disabled={readonly}
                      uploading={uploading && uploadState?.kind === "evidence"}
                      onFiles={(files) => onEvidenceFiles(item, files)}
                      onPasteError={onUploadError}
                    />
                  </Box>
                }
                onDelete={onDeleteEvidence}
              />
            )}
        </Box>
      </Stack>
    </CollapsibleRow>
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
    dragIndex,
    onAdd,
    onUpdate,
    onMove,
    onDragStart,
    onDrop,
    onDragEnd,
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

  const basicSummary = `${form.employee_name || "报销人待填写"} · ${form.report_date || "报销日期待填写"}`;
  const itemsSummary =
    items.length > 0
      ? `${items.length} 项 · ${formatRegularAmount(summary.totalAmount)} · ${summary.documentCount} 张单据`
      : "尚未添加报销项目";

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
            <BlockCard
              id="regular-basic-info"
              title="基本信息"
              summary={<Typography variant="body2" color="text.secondary" noWrap>{basicSummary}</Typography>}
              bodySx={{ p: { xs: 2, md: 2.5 } }}
            >
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
            </BlockCard>

            <BlockCard
              id="regular-items"
              title="报销项目"
              summary={<Typography variant="body2" color="text.secondary" noWrap>{itemsSummary}</Typography>}
              actions={
                <Button size="small" startIcon={<AddIcon />} variant="outlined" onClick={onAdd} disabled={readonly}>
                  添加项目
                </Button>
              }
            >
              <Stack spacing={1} sx={{ mb: 1.25 }}>
                <Typography variant="body2" color="text.secondary">
                  一行一个自定义项目，可排序并独立管理单据。
                </Typography>
              </Stack>
              <Stack sx={collapsibleRowListSx}>
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
                    dragging={dragIndex === index}
                    onUpdate={onUpdate}
                    onMove={onMove}
                    onDragStart={onDragStart}
                    onDrop={onDrop}
                    onDragEnd={onDragEnd}
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
                {items.length === 0 && readonly && <Alert severity="info">暂无报销项目。</Alert>}
              </Stack>
            </BlockCard>
          </Stack>
        </Box>

        <Box sx={summarySidebarSx}>
          <BlockCard
            id="regular-summary"
            title="费用汇总"
            summary={<Typography variant="body2" color="primary.main" fontWeight={900} noWrap>{formatRegularAmount(summary.totalAmount)}</Typography>}
            sx={{ height: "100%" }}
          >
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {mode === "invoice" ? "未确认金额不计入报销总额。" : "金额按项目录入自动合计。"}
              </Typography>

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
                previewDisabled={pdfGate.previewDisabled}
                downloadDisabled={pdfGate.downloadDisabled}
                previewBlocked={pdfGate.previewBlocked}
                downloadBlocked={pdfGate.downloadBlocked}
                previewBlockedLabel={pdfGate.previewBlockedLabel}
                downloadBlockedLabel={pdfGate.downloadBlockedLabel}
                onPreview={onPreview}
                onDownload={onDownload}
              />
            </Stack>
          </BlockCard>
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
        title={pdfGate.dialogTitle}
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
