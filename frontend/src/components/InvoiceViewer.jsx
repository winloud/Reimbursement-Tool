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
  FormControl,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
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

const INVOICE_TYPE_OPTIONS = [
  { value: "unknown", label: "未知" },
  { value: "normal", label: "普票" },
  { value: "vat_special", label: "专票" },
];

const invoiceTypeLabel = (value) => INVOICE_TYPE_OPTIONS.find((option) => option.value === value)?.label || "未知";

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

function PreviewHighlight({ highlight }) {
  if (!highlight) return null;
  return (
    <Box
      title={highlight.label || "高亮区域"}
      sx={{
        position: "absolute",
        left: `${Number(highlight.x || 0) * 100}%`,
        top: `${Number(highlight.y || 0) * 100}%`,
        width: `${Number(highlight.width || 0) * 100}%`,
        height: `${Number(highlight.height || 0) * 100}%`,
        minWidth: 18,
        minHeight: 14,
        border: "2px solid",
        borderColor: "warning.main",
        borderRadius: 0.5,
        bgcolor: "rgba(255, 193, 7, 0.22)",
        boxShadow: "0 0 0 2px rgba(255, 193, 7, 0.18)",
        pointerEvents: "none",
      }}
    />
  );
}

function FieldLine({ label, value, dense = false, sx }) {
  return (
    <Stack spacing={dense ? 0 : 0.25} sx={sx}>
      <Typography variant="caption" color="text.secondary" sx={dense ? { lineHeight: 1.2 } : undefined}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700} sx={dense ? { fontSize: 13, lineHeight: 1.35, wordBreak: "break-word" } : undefined}>
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
                  <FieldLine label="发票类型" value={invoiceTypeLabel(result.invoice_type || parsed.invoice_type || invoice.invoice_type)} />
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

export default function InvoiceViewer({ invoice, open, readonly = false, onClose, onSkip, onUpdated }) {
  const [amount, setAmount] = useState(invoice ? Number(invoice.amount ?? 0).toFixed(2) : "0.00");
  const [invoiceType, setInvoiceType] = useState(invoice?.invoice_type || "unknown");
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
  const previewHighlights = Array.isArray(parsed.raw?.preview_highlights) ? parsed.raw.preview_highlights : [];

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
      const nextParsed = res.data || null;
      setDiagnosticsParsed(nextParsed);
      setInvoiceType((prev) => (prev === "unknown" && nextParsed?.invoice_type ? nextParsed.invoice_type : prev));
      return nextParsed;
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
      setInvoiceType(invoice.invoice_type || invoice.parsed?.invoice_type || "unknown");
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
      const res = await updateInvoice(invoice.id, { amount, amount_confirmed: true, invoice_type: invoiceType });
      if (!res.success) {
        setError(res.message || "发票信息确认失败");
        return;
      }
      onUpdated?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "发票信息确认失败");
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
      <DialogTitle>发票信息确认</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {readonly && (
          <Alert severity="info" sx={{ mb: 2 }}>
            已报销状态为只读，不能修改发票信息。
          </Alert>
        )}
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={4}>
            <Stack spacing={1.25}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Typography variant="subtitle1" fontWeight={800}>
                  关键字段
                </Typography>
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  columnGap: 1.5,
                  rowGap: 0.75,
                }}
              >
                <FieldLine dense label="发票号码" value={invoice.invoice_no || parsed.invoice_no} sx={{ gridColumn: "1 / -1" }} />
                <FieldLine dense label="发票日期" value={invoice.invoice_date || parsed.invoice_date} sx={{ gridColumn: "1 / -1" }} />
                <FieldLine dense label="购买方" value={parsed.buyer_name} />
                <FieldLine dense label="销售方" value={parsed.seller_name} />
                <FieldLine dense label="当前金额" value={formatAmount(invoice.amount)} />
                <FieldLine dense label="确认状态" value={invoice.amount_confirmed ? "已确认" : "待确认"} />
              </Box>

              <Box sx={{ pt: 1.25 }}>
                <TextField
                  fullWidth
                  label="确认金额"
                  type="number"
                  size="small"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={readonly}
                  inputProps={{ min: 0, step: "0.01" }}
                />
              </Box>

              <FormControl disabled={readonly}>
                <Typography variant="caption" color="text.secondary">
                  发票类型
                </Typography>
                <RadioGroup
                  row
                  value={invoiceType}
                  onChange={(event) => setInvoiceType(event.target.value)}
                  sx={{
                    mt: 0.5,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 0.75,
                  }}
                >
                  {INVOICE_TYPE_OPTIONS.map((option) => (
                    <FormControlLabel
                      key={option.value}
                      value={option.value}
                      control={<Radio size="small" sx={{ p: 0.5 }} />}
                      label={
                        <Typography variant="body2" fontWeight={invoiceType === option.value ? 700 : 500} sx={{ fontSize: 13 }}>
                          {option.label}
                        </Typography>
                      }
                      sx={{
                        m: 0,
                        px: 0.75,
                        py: 0.25,
                        minHeight: 30,
                        justifyContent: "center",
                        border: 1,
                        borderColor: invoiceType === option.value ? "primary.main" : "divider",
                        borderRadius: 1,
                        bgcolor: invoiceType === option.value ? "action.selected" : "transparent",
                      }}
                    />
                  ))}
                </RadioGroup>
              </FormControl>

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
                  <Box sx={{ position: "relative", display: "inline-block", maxWidth: "100%", lineHeight: 0 }}>
                    <Box
                      component="img"
                      src={previewImage}
                      alt="invoice preview"
                      sx={{ display: "block", maxWidth: "100%", maxHeight: 500, objectFit: "contain" }}
                    />
                    {previewHighlights.map((highlight, index) => (
                      <PreviewHighlight key={`${highlight.type || "highlight"}-${index}`} highlight={highlight} />
                    ))}
                  </Box>
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
        {onSkip && (
          <Button onClick={onSkip} disabled={saving}>
            跳过
          </Button>
        )}
        <Button onClick={onClose}>关闭</Button>
        <Button onClick={handleConfirm} variant="contained" disabled={saving || readonly}>
          {saving ? "确认中..." : "确认信息"}
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
