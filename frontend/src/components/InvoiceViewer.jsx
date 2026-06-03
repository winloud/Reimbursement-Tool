import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { getInvoiceFileUrl, updateInvoice } from "../api/client";

const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function FieldLine({ label, value }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700}>
        {value || "-"}
      </Typography>
    </Stack>
  );
}

export default function InvoiceViewer({ invoice, open, readonly = false, onClose, onUpdated }) {
  const [amount, setAmount] = useState(invoice ? Number(invoice.amount ?? 0).toFixed(2) : "0.00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (invoice) {
      setAmount(Number(invoice.amount ?? 0).toFixed(2));
      setError("");
    }
  }, [invoice]);

  if (!invoice) return null;

  const handleConfirm = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await updateInvoice(invoice.id, { amount, amount_confirmed: true });
      if (!res.success) {
        setError(res.message || "金额确认失败");
        return;
      }
      onUpdated?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "金额确认失败");
    } finally {
      setSaving(false);
    }
  };

  const fileUrl = getInvoiceFileUrl(invoice.id);
  const parsed = invoice.parsed || {};

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>发票金额确认</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {readonly && (
          <Alert severity="info" sx={{ mb: 2 }}>
            已报销状态为只读，不能修改发票金额。
          </Alert>
        )}
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={4}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle1" fontWeight={800}>
                  关键字段
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  未识别或识别错误时，可以手动修正金额后确认。
                </Typography>
              </Box>

              <Stack spacing={1.5}>
                <FieldLine label="发票号码" value={invoice.invoice_no || parsed.invoice_no} />
                <FieldLine label="发票日期" value={invoice.invoice_date || parsed.invoice_date} />
                <FieldLine label="购买方" value={parsed.buyer_name} />
                <FieldLine label="销售方" value={parsed.seller_name} />
                <FieldLine label="当前金额" value={formatAmount(invoice.amount)} />
                <FieldLine label="确认状态" value={invoice.amount_confirmed ? "已确认" : "待确认"} />
              </Stack>

              <Divider />

              <TextField
                label="确认金额"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={readonly}
                inputProps={{ min: 0, step: "0.01" }}
              />

              <Button href={fileUrl} target="_blank" rel="noreferrer" variant="outlined" startIcon={<OpenInNewIcon />}>
                打开原始文件
              </Button>
            </Stack>
          </Grid>
          <Grid item xs={12} md={8}>
            <Box
              sx={{
                minHeight: 480,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "grey.50",
                overflow: "hidden",
              }}
            >
              {invoice.file_type === "pdf" ? (
                <iframe title="invoice-pdf" src={fileUrl} style={{ width: "100%", height: 520, border: 0 }} />
              ) : invoice.file_type === "image" ? (
                <Box sx={{ p: 2, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 480 }}>
                  <img src={fileUrl} alt="invoice" style={{ maxWidth: "100%", maxHeight: 500 }} />
                </Box>
              ) : (
                <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 480, p: 3 }}>
                  <Typography fontWeight={800}>{invoice.file_type.toUpperCase()} 发票</Typography>
                  <Typography variant="body2" color="text.secondary" align="center">
                    此类型以关键字段确认为主，可打开原始文件核对内容。
                  </Typography>
                  <Button href={fileUrl} target="_blank" rel="noreferrer" variant="contained" startIcon={<OpenInNewIcon />}>
                    打开原始文件
                  </Button>
                </Stack>
              )}
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button onClick={handleConfirm} variant="contained" disabled={saving || readonly}>
          {saving ? "确认中..." : "确认金额"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
