import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import CollapsibleRow from "../report-edit-shared/CollapsibleRow";
import FileDropSlot from "../report-edit-shared/FileDropSlot";
import InvoiceCardList from "../report-edit-shared/InvoiceCardList";
import stopSummaryInteraction from "../report-edit-shared/stopSummaryInteraction";
import { cardSubSectionDividerSx, collapsibleRowListSx, collapsibleRowNestedSurfaceSx } from "../report-edit-shared/editPageStyles";
import PaperInvoiceEntry from "./PaperInvoiceEntry";
import {
  formatAmount,
  getConfirmedInvoiceCount,
  getExpenseItemAmount,
  getExpenseItemInvoiceShortfall,
  getPaperInvoiceCount,
  hasPaperInvoice,
  isCustomExpenseCategory,
  shouldExpandExpenseItem,
  supportsManualExpenseAmount,
  validateExpenseReimbursableAmount,
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

const EMPTY_CATEGORY_SET = new Set();

const categoryRowGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "minmax(0, 1fr) 64px",
    sm: "minmax(0, 1fr) 132px 72px",
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

export function useExpenseCategoryExpansion({
  categories = [],
  expenseItems = [],
  invoicesForCategory = () => [],
  pinnedCategories = EMPTY_CATEGORY_SET,
  ready = true,
}) {
  const pinned = useMemo(
    () => (pinnedCategories instanceof Set ? pinnedCategories : new Set(pinnedCategories || [])),
    [pinnedCategories],
  );
  const categoryKeys = useMemo(() => categories.map((category) => category.value), [categories]);
  const categorySignature = categoryKeys.join("|");
  const knownCategoriesRef = useRef(new Set());
  const initializedRef = useRef(false);
  // 已加载的其他费用默认收起；新增类别由下面的 key 差异检测自动展开。
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());

  useEffect(() => {
    const current = new Set(categoryKeys);
    if (!ready) {
      initializedRef.current = false;
      knownCategoriesRef.current = new Set();
      setExpandedCategories((previous) => (previous.size === 0 ? previous : new Set()));
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      knownCategoriesRef.current = current;
      setExpandedCategories((previous) => (previous.size === 0 ? previous : new Set()));
      return;
    }
    const addedCategories = categories.filter(
      (category) => !knownCategoriesRef.current.has(category.value),
    );
    knownCategoriesRef.current = current;
    setExpandedCategories((previous) => {
      const next = new Set([...previous].filter((category) => current.has(category)));
      let changed = next.size !== previous.size;
      addedCategories.forEach((category) => {
        const item = expenseItems.find((expenseItem) => expenseItem.category === category.value) || {
          ...EMPTY_ITEM,
          category: category.value,
        };
        if (
          shouldExpandExpenseItem(item, invoicesForCategory(category.value) || []) ||
          pinned.has(category.value)
        ) {
          if (!next.has(category.value)) {
            next.add(category.value);
            changed = true;
          }
        }
      });
      return changed ? next : previous;
    });
  }, [categorySignature, categories, expenseItems, invoicesForCategory, pinned, ready]);

  const allExpanded = categories.length > 0 && categoryKeys.every((category) => expandedCategories.has(category));
  const toggleAll = () => {
    setExpandedCategories((previous) => {
      const shouldCollapse = categories.length > 0 && categoryKeys.every((category) => previous.has(category));
      return shouldCollapse ? new Set() : new Set(categoryKeys);
    });
  };

  return { expandedCategories, setExpandedCategories, allExpanded, toggleAll };
}

// 其他费用：类别摘要保持浅灰，明细抽屉翻白；发票小卡和上传槽在抽屉内回到浅灰。
export default function ExpenseCategoryList({
  categories = [],
  expenseItems = [],
  invoicesForCategory,
  readonly,
  saveState,
  uploadState,
  expandedCategories = EMPTY_CATEGORY_SET,
  onExpandedCategoriesChange,
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
  return (
    <Stack sx={collapsibleRowListSx}>
        {categories.map((category) => {
          const item = expenseItems.find((expenseItem) => expenseItem.category === category.value) || {
            ...EMPTY_ITEM,
            category: category.value,
          };
          const uploadKey = `expense-${category.value}`;
          const paperInvoiceKey = `expense:${category.value}`;
          const uploading = uploadState?.key === uploadKey;
          const hasManualExpenseAmount = supportsManualExpenseAmount(category.value);
          const categoryInvoices = invoicesForCategory(category.value);
          const invoiceCount = getConfirmedInvoiceCount(categoryInvoices) + getPaperInvoiceCount(item);
          const amount = getExpenseItemAmount(item, categoryInvoices);
          const manualAmountError = validateExpenseReimbursableAmount(item);
          const invoiceShortfall = getExpenseItemInvoiceShortfall(item, categoryInvoices);
          const removeLabel = isCustomExpenseCategory(category.value)
            ? `删除自定义费用：${category.label}`
            : `移除费用：${category.label}`;

          const summary = (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>
              <Box sx={categoryRowGridSx}>
                <Box
                  sx={{
                    ...categoryNameCellSx,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography variant="body2" fontWeight={800} noWrap>
                    {category.label}
                  </Typography>
                  {invoiceShortfall > 0 && (
                    <Tooltip
                      title="发票金额不足；仍可预览 PDF，补足后才能修改状态或下载。"
                      arrow
                    >
                      <Box
                        component="span"
                        role="status"
                        aria-label={`${category.label}发票缺口 ${formatAmount(invoiceShortfall)}`}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.25,
                          minWidth: 0,
                          maxWidth: "100%",
                          color: "warning.dark",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <WarningAmberIcon fontSize="small" aria-hidden="true" />
                        <Typography component="span" variant="caption" fontWeight={800} noWrap>
                          发票缺口 {formatAmount(invoiceShortfall)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )}
                </Box>
                <Metric label="报销" value={amount > 0 ? formatAmount(amount) : "—"} muted={amount <= 0} />
                <Metric label="" value={invoiceCount > 0 ? `${invoiceCount} 张` : "—"} muted={invoiceCount <= 0} />
              </Box>
            </Box>
          );
          const actions = !readonly ? (
            <Tooltip title={removeLabel}>
              <span {...stopSummaryInteraction}>
                <IconButton
                  size="small"
                  color="error"
                  disabled={saveState === "saving"}
                  aria-label={removeLabel}
                  onClick={() => onRemoveCategory(category.value)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null;

          return (
            <CollapsibleRow
              key={category.value}
              id={`expense-row-${category.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
              summary={summary}
              actions={actions}
              expanded={expandedCategories.has(category.value)}
              onExpandedChange={(expanded) =>
                onExpandedCategoriesChange((previous) => {
                  const next = new Set(previous);
                  if (expanded) next.add(category.value);
                  else next.delete(category.value);
                  return next;
                })
              }
              toggleLabel={`${category.label}明细`}
              drawerSx={{
                px: { xs: 1.25, sm: 1.5 },
                py: 1.5,
                "& .MuiPaper-root": collapsibleRowNestedSurfaceSx,
                '& [role="group"]': collapsibleRowNestedSurfaceSx,
              }}
            >
              <Stack spacing={1.5}>
                {hasManualExpenseAmount && (
                  <TextField
                    fullWidth
                    size="small"
                    label={`${category.label}报销金额`}
                    type="number"
                    value={item.reimbursable_amount ?? ""}
                    disabled={readonly}
                    error={Boolean(manualAmountError)}
                    helperText={manualAmountError || "留空则按已确认发票合计报销"}
                    onChange={(event) => onUpdateExpenseItem(category.value, { reimbursable_amount: event.target.value })}
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
                      onFiles={(files) => onFilesUpload({ files, expenseCategory: category.value, key: uploadKey })}
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
                      onOpen={() => onOpenPaperInvoice({ key: paperInvoiceKey, kind: "expense", category: category.value }, item)}
                      onChange={onChangePaperInvoice}
                      onSave={onSavePaperInvoice}
                      onCancel={onCancelPaperInvoice}
                      onClear={onClearPaperInvoice}
                    />
                  </Box>
                )}
              </Stack>
            </CollapsibleRow>
          );
        })}
    </Stack>
  );
}
