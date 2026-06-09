import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import TuneIcon from "@mui/icons-material/Tune";
import { getSettingFonts, getSettings, updateSettings } from "../api/client";
import {
  buildSettingsPayload,
  groupFontsBySource,
  INVOICE_QR_ENGINE_OPTIONS,
  normalizeSettingsForm,
} from "./settingsPageUtils";

const CONTENT_MAX_WIDTH = 900;

const emptySettings = {
  department: "",
  employee_name: "",
  daily_subsidy: "0.00",
  pdf_fill_font_key: "system:simsun",
  double_print_vat_special_invoices: true,
  invoice_qr_engine: "zxing",
};

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

export default function SettingsPage() {
  const [form, setForm] = useState(emptySettings);
  const [fonts, setFonts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const fontGroups = useMemo(() => groupFontsBySource(fonts), [fonts]);
  const selectedFontExists = fonts.some((font) => font.key === form.pdf_fill_font_key);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [settingsRes, fontsRes] = await Promise.all([getSettings(), getSettingFonts()]);
        if (cancelled) return;
        const settings = settingsRes.success && settingsRes.data ? settingsRes.data : {};
        const nextFonts = fontsRes.success && Array.isArray(fontsRes.data) ? fontsRes.data : [];
        setFonts(nextFonts);
        setForm(normalizeSettingsForm(settings));
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, "加载个性化设置失败"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleToggle = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.checked }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = buildSettingsPayload(form);
      const res = await updateSettings(payload);
      if (!res.success) {
        setError(res.message || "保存个性化设置失败");
        return;
      }
      const settings = res.data || payload;
      setForm(normalizeSettingsForm(settings, form));
      setToast("个性化设置已保存");
    } catch (err) {
      setError(getApiErrorMessage(err, "保存个性化设置失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2.5} sx={{ width: "100%", maxWidth: CONTENT_MAX_WIDTH, mx: "auto", pb: 4 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={900}>
            个性化设置
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            默认信息和 PDF 填充字体
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          disabled={loading || saving || !form.pdf_fill_font_key || !selectedFontExists}
          onClick={handleSave}
        >
          {saving ? "保存中" : "保存设置"}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Alert severity="warning">
        字体文件由用户自行提供和使用，本工具不提供字体，也不承担字体授权风险。
      </Alert>

      <Card sx={{ border: 1, borderColor: "divider", borderRadius: 2, boxShadow: "none" }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 }, "&:last-child": { pb: { xs: 2, md: 2.5 } } }}>
          {loading ? (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={20} />
              <Typography color="text.secondary">加载中...</Typography>
            </Stack>
          ) : (
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TuneIcon color="primary" />
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    默认报销信息
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    新建报销单会自动带入这些默认值。
                  </Typography>
                </Box>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                  gap: { xs: 1.5, md: 2 },
                }}
              >
                <TextField
                  fullWidth
                  label="部门"
                  value={form.department}
                  onChange={handleChange("department")}
                />
                <TextField
                  fullWidth
                  label="出差人"
                  value={form.employee_name}
                  onChange={handleChange("employee_name")}
                />
                <TextField
                  fullWidth
                  label="途中补贴日标准"
                  type="number"
                  value={form.daily_subsidy}
                  onChange={handleChange("daily_subsidy")}
                  inputProps={{ min: 0, step: "0.01" }}
                />
              </Box>

              <Divider />

              <Stack spacing={1}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <QrCodeScannerIcon color="primary" />
                  <Typography variant="h6" fontWeight={800}>
                    发票二维码识别引擎
                  </Typography>
                </Stack>
                <Select
                  fullWidth
                  value={form.invoice_qr_engine}
                  onChange={handleChange("invoice_qr_engine")}
                >
                  {INVOICE_QR_ENGINE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="h6" fontWeight={800}>
                  PDF 导出
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(form.double_print_vat_special_invoices)}
                      onChange={handleToggle("double_print_vat_special_invoices")}
                    />
                  }
                  label="增值税专用发票附件打印两遍"
                />
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="h6" fontWeight={800}>
                  PDF 填充字体
                </Typography>
                <Select
                  fullWidth
                  value={selectedFontExists ? form.pdf_fill_font_key : ""}
                  displayEmpty
                  disabled={fonts.length === 0}
                  onChange={handleChange("pdf_fill_font_key")}
                >
                  {!selectedFontExists && (
                    <MenuItem value="" disabled>
                      当前字体不可用
                    </MenuItem>
                  )}
                  {fontGroups.flatMap((group) => [
                    <MenuItem key={`${group.source}-header`} disabled sx={{ fontWeight: 800, opacity: 1 }}>
                      {group.label}
                    </MenuItem>,
                    ...group.fonts.map((font) => (
                      <MenuItem key={font.key} value={font.key}>
                        {font.name}
                      </MenuItem>
                    )),
                  ])}
                </Select>
                <Typography variant="body2" color="text.secondary">
                  其他费用项目名固定使用楷体，页码固定使用默认字体。
                </Typography>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, bgcolor: "background.paper" }}>
        <Typography variant="body2" color="text.secondary">
          项目内置字体读取 `backend/assets/fonts/` 下的 .ttf、.ttc、.otf 文件。
        </Typography>
      </Paper>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2500}
        onClose={() => setToast("")}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
