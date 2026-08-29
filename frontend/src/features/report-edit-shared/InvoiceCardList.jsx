import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";

import { formatAmount, getInvoicePageCount } from "../../pages/reportEditUtils";
import FileListShell from "./FileListShell";
import { fileCardSx } from "./editPageStyles";

// 已上传发票的统一卡片列表：标题行（张数徽标）+ 自适应列数的发票小卡 + 上传占位。
export default function InvoiceCardList({ invoices, readonly, uploadSlot, onSelect, onDelete }) {
  return (
    <FileListShell
      title="已上传发票"
      count={invoices.length}
      countUnit="份"
      emptyText="暂无发票"
      readonly={readonly}
      uploadSlot={uploadSlot}
    >
      {invoices.map((invoice) => {
        const invoiceNumber = invoice.invoice_no || "无发票号码";
        const confirmationLabel = invoice.amount_confirmed ? "已确认" : "待确认";
        const fileType = String(invoice.file_type || "file").toUpperCase();
        const pageCount = getInvoicePageCount(invoice);

        return (
          <Paper
            key={invoice.id}
            variant="outlined"
            sx={{
              ...fileCardSx,
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
                    {fileType}
                  </Box>
                  <Box component="span" color="text.disabled" aria-hidden="true" sx={{ mx: 0.375 }}>
                    ·
                  </Box>
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    {pageCount} 页
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
    </FileListShell>
  );
}
