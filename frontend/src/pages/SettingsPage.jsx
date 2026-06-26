import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ScheduleIcon from "@mui/icons-material/Schedule";
import TuneIcon from "@mui/icons-material/Tune";
import TranslateIcon from "@mui/icons-material/Translate";
import { getSettingFonts, getSettings, updateSettings } from "../api/client";
import {
  AUTOSAVE_DELAY_MAX_SECONDS,
  AUTOSAVE_DELAY_MIN_SECONDS,
  buildSettingsPayload,
  groupFontsBySource,
  INVOICE_QR_ENGINE_OPTIONS,
  normalizeSettingsForm,
  validateAutosaveDelaySeconds,
} from "./settingsPageUtils";

const settingsCardSx = {
  border: 1,
  borderColor: "rgba(148, 163, 184, 0.32)",
  borderRadius: "8px",
  boxShadow: "0 1px 0 rgba(15, 23, 42, 0.03)",
  bgcolor: "background.paper",
};

const settingsCardContentSx = {
  p: { xs: 2, md: 2.25 },
  "&:last-child": { pb: { xs: 2, md: 2.25 } },
};

const settingsGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
  gap: { xs: 2, md: 2.5 },
  alignItems: "stretch",
};

const splitGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 260px) minmax(0, 1fr)" },
  gap: { xs: 1.5, md: 2 },
  alignItems: "start",
};

const fontHintAlertSx = {
  borderRadius: 1,
  alignItems: "flex-start",
  py: 0.75,
  "& .MuiAlert-icon": {
    mr: 1,
  },
};

function SectionHeader({ icon, title, description }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start">
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: 1,
          bgcolor: "rgba(37, 99, 235, 0.08)",
          color: "primary.main",
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
          "& .MuiSvgIcon-root": {
            fontSize: 18,
          },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={900} sx={{ lineHeight: 1.25 }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

const emptySettings = {
  department: "",
  employee_name: "",
  daily_subsidy: "0.00",
  pdf_fill_font_key: "system:simsun",
  double_print_vat_special_invoices: true,
  invoice_qr_engine: "zxing",
  autosave_delay_seconds: 3,
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
  const autosaveDelayError = validateAutosaveDelaySeconds(form.autosave_delay_seconds);

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
    if (autosaveDelayError) {
      setError(autosaveDelayError);
      return;
    }
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
    <Stack spacing={2.5} sx={{ width: "100%", pb: 4 }}>
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
          disabled={loading || saving || !form.pdf_fill_font_key || !selectedFontExists || Boolean(autosaveDelayError)}
          onClick={handleSave}
        >
          {saving ? "保存中" : "保存设置"}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {loading ? (
        <Card sx={settingsCardSx}>
          <CardContent sx={settingsCardContentSx}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={20} />
              <Typography color="text.secondary">加载中...</Typography>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          <Card sx={settingsCardSx}>
            <CardContent sx={settingsCardContentSx}>
              <Box sx={splitGridSx}>
                <SectionHeader
                  icon={<TuneIcon />}
                  title="默认报销信息"
                  description="新建报销单会自动带入这些默认值。"
                />
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                    gap: { xs: 1.5, md: 2 },
                  }}
                >
                  <TextField fullWidth label="部门" value={form.department} onChange={handleChange("department")} />
                  <TextField fullWidth label="出差人" value={form.employee_name} onChange={handleChange("employee_name")} />
                  <TextField
                    fullWidth
                    label="途中补贴日标准"
                    type="number"
                    value={form.daily_subsidy}
                    onChange={handleChange("daily_subsidy")}
                    inputProps={{ min: 0, step: "0.01" }}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Box sx={settingsGridSx}>
            <Card sx={settingsCardSx}>
              <CardContent sx={settingsCardContentSx}>
                <Stack spacing={2}>
                  <SectionHeader
                    icon={<ScheduleIcon />}
                    title="编辑体验"
                    description="控制报销单编辑页的保存节奏。"
                  />
                  <TextField
                    fullWidth
                    label="自动保存延时"
                    type="number"
                    value={form.autosave_delay_seconds}
                    onChange={handleChange("autosave_delay_seconds")}
                    error={Boolean(autosaveDelayError)}
                    helperText={autosaveDelayError || "修改停止后等待多久自动保存，范围 3-60 秒。"}
                    inputProps={{
                      min: AUTOSAVE_DELAY_MIN_SECONDS,
                      max: AUTOSAVE_DELAY_MAX_SECONDS,
                      step: 1,
                    }}
                  />
                </Stack>
              </CardContent>
            </Card>

            <Card sx={settingsCardSx}>
              <CardContent sx={settingsCardContentSx}>
                <Stack spacing={2}>
                  <SectionHeader
                    icon={<QrCodeScannerIcon />}
                    title="发票二维码识别"
                    description="选择发票解析时使用的二维码识别引擎。"
                  />
                  <Select fullWidth value={form.invoice_qr_engine} onChange={handleChange("invoice_qr_engine")}>
                    {INVOICE_QR_ENGINE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={settingsCardSx}>
              <CardContent sx={settingsCardContentSx}>
                <Stack spacing={2}>
                  <SectionHeader
                    icon={<PictureAsPdfIcon />}
                    title="PDF 导出"
                    description="控制 PDF 附件打印规则。"
                  />
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
              </CardContent>
            </Card>

          </Box>

          <Card sx={settingsCardSx}>
            <CardContent sx={settingsCardContentSx}>
              <Box sx={splitGridSx}>
                <SectionHeader
                  icon={<TranslateIcon />}
                  title="PDF 填充字体"
                  description="选择报销单 PDF 中主要填充内容的字体。"
                />
                <Stack spacing={1.25}>
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
                  <Alert severity="warning" sx={{ ...fontHintAlertSx, mt: 0.75 }}>
                    字体文件由用户自行提供和使用，本工具不提供字体，也不承担字体授权风险。
                  </Alert>
                  <Alert severity="info" sx={fontHintAlertSx}>
                    项目内置字体读取 `backend/assets/fonts/` 下的 .ttf、.ttc、.otf 文件。
                  </Alert>
                </Stack>
              </Box>
            </CardContent>
          </Card>

        </Stack>
      )}

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
