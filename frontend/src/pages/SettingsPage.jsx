import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import TuneIcon from "@mui/icons-material/Tune";
import { getSettingFonts, getSettings, updateSettings } from "../api/client";
import { groupFontsBySource } from "./settingsPageUtils";

const CONTENT_MAX_WIDTH = 900;

const emptySettings = {
  department: "",
  employee_name: "",
  daily_subsidy: "0.00",
  pdf_fill_font_key: "system:simsun",
};

const toMoney = (value) => Number(value || 0).toFixed(2);

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
        setForm({
          department: settings.department || "",
          employee_name: settings.employee_name || "",
          daily_subsidy: toMoney(settings.daily_subsidy),
          pdf_fill_font_key: settings.pdf_fill_font_key || "system:simsun",
        });
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

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        department: form.department.trim() || null,
        employee_name: form.employee_name.trim() || null,
        daily_subsidy: form.daily_subsidy || "0.00",
        pdf_fill_font_key: form.pdf_fill_font_key,
      };
      const res = await updateSettings(payload);
      if (!res.success) {
        setError(res.message || "保存个性化设置失败");
        return;
      }
      const settings = res.data || payload;
      setForm({
        department: settings.department || "",
        employee_name: settings.employee_name || "",
        daily_subsidy: toMoney(settings.daily_subsidy),
        pdf_fill_font_key: settings.pdf_fill_font_key || form.pdf_fill_font_key,
      });
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
