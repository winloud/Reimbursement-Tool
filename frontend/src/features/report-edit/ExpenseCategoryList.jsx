import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import FileDropSlot from "../report-edit-shared/FileDropSlot";
import InvoiceCardList from "../report-edit-shared/InvoiceCardList";
import stopSummaryInteraction from "../report-edit-shared/stopSummaryInteraction";
import { cardSubSectionDividerSx } from "../report-edit-shared/editPageStyles";
import PaperInvoiceEntry from "./PaperInvoiceEntry";
import {
  formatAmount,
  getConfirmedInvoiceCount,
  getExpenseItemAmount,
  getExpenseItemInvoiceTotal,
  getFuelSubsidyInvoiceShortfall,
  getPaperInvoiceCount,
  hasPaperInvoice,
  isCustomExpenseCategory,
  shouldExpandExpenseItem,
  validateFuelSubsidyAmount,
} from "../../pages/reportEditUtils";

const EMPTY_ITEM = {
  remark: "",
  reimbursable_amount: "",
  paper_invoice_amount: "0.00",
  paper_invoice_count: 0,
  invoice_total: "0.00",
  amount: "0.00",
  invoice_count: 0,
};

// 折叠行：类别名 + 报销 / 发票 / 张数三列定宽，金额跨行对齐。
const categoryRowGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr) minmax(0, 1fr) 64px",
    sm: "minmax(0, 1fr) 132px 132px 72px",
  },
  columnGap: { xs: 1, sm: 1.5 },
  rowGap: 0.25,
  alignItems: "baseline",
  width: "100%",
  minWidth: 0,
};

const categoryNameCellSx = {
  gridColumn: { xs: "1 / -1", sm: "auto" },
  minWidth: 0,
};

const metricCellSx = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "flex-end",
  gap: 0.5,
  minWidth: 0,
};

const metricValueSx = {
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

// 每类别一行、行间 divider；外框由调用方的 Card 提供。
const rowAccordionSx = {
  borderRadius: 0,
  boxShadow: "none",
  bgcolor: "transparent",
  "&:before": { display: "none" },
  "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" },
};

const rowSummarySx = {
  minHeight: 40,
  px: 0,
  "& .MuiAccordionSummary-content": { my: 0.5, minWidth: 0 },
  "& .MuiAccordionSummary-expandIconWrapper": { color: "action.active" },
};

function Metric({ label, value, muted }) {
  return (
    <Box sx={metricCellSx}>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {label}
        </Typography>
      )}
      <Typography variant="body2" color={muted ? "text.disabled" : "text.primary"} sx={metricValueSx}>
        {value}
      </Typography>
    </Box>
  );
}

// 其他费用：容器卡内每类别一行，展开后是该类别的金额、发票与纸质发票录入。
export default function ExpenseCategoryList({
  categories = [],
  expenseItems = [],
  invoicesForCategory,
  readonly,
  saveState,
  uploadState,
  pinnedCategories,
  paperInvoiceEditor,
  onUpdateExpenseItem,
  onRemoveCategory,
  onFilesUpload,
  onUploadError,
  onSelectInvoice,
  onDeleteInvoice,
  onOpenPaperInvoice,
  onChangePaperInvoice,
  onSavePaperInvoice,
  onCancelPaperInvoice,
  onClearPaperInvoice,
}) {
  const pinned = pinnedCategories instanceof Set ? pinnedCategories : new Set(pinnedCategories || []);

  return (
    <Box>
      {categories.map((category) => {
        const item = expenseItems.find((expenseItem) => expenseItem.category === category.value) || {
          ...EMPTY_ITEM,
          category: category.value,
        };
        const uploadKey = `expense-${category.value}`;
        const paperInvoiceKey = `expense:${category.value}`;
        const uploading = uploadState?.key === uploadKey;
        const isFuelSubsidy = category.value === "fuel_subsidy";
        const categoryInvoices = invoicesForCategory(category.value);
        const invoiceTotal = getExpenseItemInvoiceTotal(item, categoryInvoices);
        const invoiceCount = getConfirmedInvoiceCount(categoryInvoices) + getPaperInvoiceCount(item);
        const amount = getExpenseItemAmount(item, categoryInvoices);
        const fuelAmountError = validateFuelSubsidyAmount(item);
        const fuelShortfall = getFuelSubsidyInvoiceShortfall(item, categoryInvoices);
        const hasInvoice = categoryInvoices.length > 0 || hasPaperInvoice(item);
        const removeLabel = isCustomExpenseCategory(category.value)
          ? `删除自定义费用：${category.label}`
          : `移除费用：${category.label}`;

        return (
          <Accordion
            key={category.value}
            defaultExpanded={shouldExpandExpenseItem(item, categoryInvoices) || pinned.has(category.value)}
            disableGutters
            elevation={0}
            sx={rowAccordionSx}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={rowSummarySx}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", minWidth: 0 }}>
                <Box sx={categoryRowGridSx}>
                  <Box sx={categoryNameCellSx}>
                    <Typography variant="body2" fontWeight={800} noWrap>
                      {category.label}
                    </Typography>
                  </Box>
                  <Metric label="报销" value={amount > 0 ? formatAmount(amount) : "—"} muted={amount <= 0} />
                  <Metric label="发票" value={invoiceTotal > 0 ? formatAmount(invoiceTotal) : "—"} muted={invoiceTotal <= 0} />
                  <Metric label="" value={invoiceCount > 0 ? `${invoiceCount} 张` : "—"} muted={invoiceCount <= 0} />
                </Box>
                {!readonly && (
                  <Tooltip title={hasInvoice ? "请先删除该类别下的发票" : removeLabel}>
                    <span {...stopSummaryInteraction}>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={hasInvoice}
                        aria-label={removeLabel}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveCategory(category.value);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0.25, pb: 1.5 }}>
              <Stack spacing={1.5}>
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
                      onUpdateExpenseItem(category.value, { reimbursable_amount: event.target.value })
                    }
                    InputProps={{
                      startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                      inputProps: { min: 0, step: "0.01" },
                    }}
                  />
                )}
                <InvoiceCardList
                  invoices={categoryInvoices}
                  readonly={readonly}
                  uploadSlot={
                    <FileDropSlot
                      kind="invoice"
                      disabled={readonly || saveState === "saving"}
                      uploading={uploading}
                      onPasteError={onUploadError}
                      onFiles={(files) =>
                        onFilesUpload({
                          files,
                          expenseCategory: category.value,
                          key: uploadKey,
                        })
                      }
                    />
                  }
                  onSelect={onSelectInvoice}
                  onDelete={onDeleteInvoice}
                />
                {(!readonly || hasPaperInvoice(item)) && (
                  <Box sx={cardSubSectionDividerSx}>
                    <PaperInvoiceEntry
                      value={item}
                      editor={paperInvoiceEditor?.key === paperInvoiceKey ? paperInvoiceEditor : null}
                      disabled={readonly}
                      onOpen={() =>
                        onOpenPaperInvoice({ key: paperInvoiceKey, kind: "expense", category: category.value }, item)
                      }
                      onChange={onChangePaperInvoice}
                      onSave={onSavePaperInvoice}
                      onCancel={onCancelPaperInvoice}
                      onClear={onClearPaperInvoice}
                    />
                  </Box>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}
