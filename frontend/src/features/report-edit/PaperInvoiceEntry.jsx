import {
  Box,
  Button,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";

import {
  formatAmount,
  getPaperInvoiceCount,
  hasPaperInvoice,
} from "../../pages/reportEditUtils";

export default function PaperInvoiceEntry({
  value,
  editor,
  disabled,
  onOpen,
  onChange,
  onSave,
  onCancel,
  onClear,
}) {
  const exists = hasPaperInvoice(value);

  if (editor) {
    return (
      <Paper
        variant="outlined"
        sx={{
          borderColor: "rgba(191, 135, 32, 0.52)",
          borderLeft: 3,
          borderLeftColor: "warning.main",
          borderRadius: 1,
          bgcolor: "rgba(255, 248, 232, 0.72)",
          px: 1.25,
          py: 1,
        }}
      >
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
            <Box>
              <Typography variant="body2" fontWeight={800}>
                纸质发票
              </Typography>
              <Typography variant="caption" color="text.secondary">
                仅登记金额和张数，不上传附件。
              </Typography>
            </Box>
            {exists && (
              <Button size="small" color="error" onClick={onClear}>
                清空
              </Button>
            )}
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              fullWidth
              size="small"
              label="合计金额"
              type="number"
              value={editor.paper_invoice_amount}
              onChange={(event) => onChange("paper_invoice_amount", event.target.value)}
              InputProps={{
                startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                inputProps: { min: 0, step: "0.01" },
              }}
            />
            <TextField
              fullWidth
              size="small"
              label="张数"
              type="number"
              value={editor.paper_invoice_count}
              onChange={(event) => onChange("paper_invoice_count", event.target.value)}
              inputProps={{ min: 0, step: 1 }}
            />
          </Stack>
          <Stack direction="row" justifyContent="flex-end" spacing={0.75}>
            <Button size="small" onClick={onCancel}>
              取消
            </Button>
            <Button size="small" variant="contained" onClick={onSave}>
              保存
            </Button>
          </Stack>
        </Stack>
      </Paper>
    );
  }

  if (exists) {
    return (
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minHeight: 30 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          纸质发票 {formatAmount(value.paper_invoice_amount)} / {getPaperInvoiceCount(value)} 张
        </Typography>
        {!disabled && (
          <Button size="small" startIcon={<EditIcon />} onClick={onOpen}>
            编辑
          </Button>
        )}
      </Stack>
    );
  }

  if (disabled) return null;

  return (
    <Stack direction="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={0.1} sx={{ alignSelf: "flex-start" }}>
      <Button size="small" variant="text" startIcon={<AddIcon />} onClick={onOpen} sx={{ alignSelf: "flex-start", px: 0.5 }}>
        添加纸质发票
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>
        仅添加记录，请自行粘贴发票
      </Typography>
    </Stack>
  );
}
