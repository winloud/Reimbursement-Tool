import {
  Box,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";

import { formatAmount } from "../../pages/reportEditUtils";

// 已上传发票的统一卡片列表：标题行（张数徽标）+ 两列发票小卡 + 上传占位。
export default function InvoiceCardList({ invoices, readonly, uploadSlot, onSelect, onDelete }) {
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
