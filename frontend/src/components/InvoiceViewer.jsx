import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
  Chip,
  Paper,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import ImageIcon from "@mui/icons-material/Image";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { getInvoiceFileUrl, parseInvoice, updateInvoice } from "../api/client";

const formatAmount = (value) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD_LABELS = {
  qrcode: "二维码识别",
  text_regex: "PDF 文本正则",
  manual_required: "未自动识别",
  pymupdf_render: "PyMuPDF 渲染",
  opencv_wechat_qrcode: "OpenCV WeChatQRCode",
  opencv_qrcode_detector_multi: "OpenCV 标准二维码（多码）",
  opencv_qrcode_detector: "OpenCV 标准二维码",
  opencv_qrcode: "OpenCV 二维码",
  pymupdf_text_regex: "PyMuPDF 文本正则",
};

const formatDiagnosticValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

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

function ParseDiagnosticsDialog({ invoice, parsed, loading, error, open, onClose }) {
  const raw = parsed.raw || {};
  const result = raw.parsed_result || {
    invoice_no: invoice.invoice_no || parsed.invoice_no,
    invoice_date: invoice.invoice_date || parsed.invoice_date,
    amount: invoice.amount || parsed.amount,
  };
  const attempts = Array.isArray(raw.parse_attempts) ? raw.parse_attempts : [];
  const parseMethod = raw.parse_method || "manual_required";
  const hasDiagnostics = Boolean(raw.parse_method || attempts.length);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>发票解析依据</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {loading && (
            <Alert severity="info" icon={<CircularProgress size={18} />}>
              正在重新解析当前发票...
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {!hasDiagnostics && (
            <Alert severity="info">当前记录暂无解析诊断信息。PDF 发票会在点击后即时解析并显示结果。</Alert>
          )}

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography fontWeight={800}>最终采用方式</Typography>
                <Chip size="small" label={METHOD_LABELS[parseMethod] || parseMethod} />
                <Chip
                  size="small"
                  color={raw.parse_success ? "success" : "warning"}
                  label={raw.parse_success ? "已识别" : "未自动识别"}
                />
              </Stack>
              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={4}>
                  <FieldLine label="发票号码" value={result.invoice_no} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FieldLine label="开票日期" value={result.invoice_date} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FieldLine label="金额" value={result.amount ? formatAmount(result.amount) : "-"} />
                </Grid>
              </Grid>
            </Stack>
          </Paper>

          <Stack spacing={1.25}>
            <Typography fontWeight={800}>方式尝试结果</Typography>
            {attempts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无解析尝试明细。
              </Typography>
            ) : (
              attempts.map((attempt, index) => (
                <Paper key={`${attempt.method}-${index}`} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" fontWeight={800}>
                        {METHOD_LABELS[attempt.method] || attempt.method}
                      </Typography>
                      <Chip
                        size="small"
                        color={attempt.success ? "success" : "default"}
                        label={attempt.success ? "成功" : "未成功"}
                      />
                    </Stack>
                    {attempt.message && (
                      <Typography variant="caption" color="text.secondary">
                        {attempt.message}
                      </Typography>
                    )}
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1.25,
                        borderRadius: 1,
                        bgcolor: "grey.50",
                        border: 1,
                        borderColor: "divider",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {formatDiagnosticValue(attempt.result)}
                    </Box>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function InvoiceViewer({ invoice, open, readonly = false, onClose, onUpdated }) {
  const [amount, setAmount] = useState(invoice ? Number(invoice.amount ?? 0).toFixed(2) : "0.00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsParsed, setDiagnosticsParsed] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");

  const fileUrl = invoice ? getInvoiceFileUrl(invoice.id) : "";
  const parsed = diagnosticsParsed || invoice?.parsed || {};
  const hasDiagnostics = Boolean(parsed.raw?.parse_method || parsed.raw?.parse_attempts?.length);
  const previewImage = parsed.preview_image || parsed.raw?.preview_image;

  const fetchParsed = useCallback(async () => {
    if (!invoice || diagnosticsLoading) return null;
    setDiagnosticsError("");
    setDiagnosticsLoading(true);
    try {
      const res = await parseInvoice(invoice.id);
      if (!res.success) {
        setDiagnosticsError(res.message || "解析依据获取失败");
        return null;
      }
      setDiagnosticsParsed(res.data || null);
      return res.data || null;
    } catch (err) {
      setDiagnosticsError(err.response?.data?.message || err.message || "解析依据获取失败");
      return null;
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [diagnosticsLoading, invoice]);

  useEffect(() => {
    if (invoice) {
      setAmount(Number(invoice.amount ?? 0).toFixed(2));
      setError("");
      setDiagnosticsOpen(false);
      setDiagnosticsParsed(invoice.parsed || null);
      setDiagnosticsError("");
    }
  }, [invoice]);

  useEffect(() => {
    if (invoice?.file_type === "pdf" && !previewImage) {
      fetchParsed();
    }
  }, [fetchParsed, invoice?.file_type, previewImage]);

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

  const handleOpenDiagnostics = async () => {
    setDiagnosticsOpen(true);
    setDiagnosticsError("");
    if (!hasDiagnostics) await fetchParsed();
  };

  return (
    <>
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

              <Button
                variant="outlined"
                startIcon={diagnosticsLoading ? <CircularProgress size={18} /> : <FactCheckIcon />}
                onClick={handleOpenDiagnostics}
                disabled={diagnosticsLoading}
              >
                解析依据
              </Button>

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
              {diagnosticsLoading && invoice.file_type === "pdf" && !previewImage ? (
                <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 480, p: 3 }}>
                  <CircularProgress />
                  <Typography variant="body2" color="text.secondary">
                    正在生成图片预览...
                  </Typography>
                </Stack>
              ) : previewImage ? (
                <Box sx={{ p: 2, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 480 }}>
                  <Box
                    component="img"
                    src={previewImage}
                    alt="invoice preview"
                    sx={{ maxWidth: "100%", maxHeight: 500, objectFit: "contain" }}
                  />
                </Box>
              ) : invoice.file_type === "pdf" ? (
                <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 480, p: 3 }}>
                  <Typography fontWeight={800}>图片预览未生成</Typography>
                  {diagnosticsError && (
                    <Typography variant="body2" color="error" align="center">
                      {diagnosticsError}
                    </Typography>
                  )}
                  <Button variant="contained" startIcon={<ImageIcon />} onClick={fetchParsed}>
                    重新生成图片预览
                  </Button>
                </Stack>
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
      <ParseDiagnosticsDialog
        invoice={invoice}
        parsed={parsed}
        loading={diagnosticsLoading}
        error={diagnosticsError}
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />
    </>
  );
}
