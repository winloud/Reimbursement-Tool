import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import {
  createReport,
  getReport,
  getSettings,
  updateReport,
  updateReportStatus,
} from "../api/client";

const STATUS_META = {
  draft: { label: "草稿", color: "default" },
  printed: { label: "已打印", color: "info" },
  reimbursed: { label: "已报销", color: "success" },
};

// 状态机：允许的流转 + 中文标签
const STATUS_ACTIONS = {
  draft: [{ target: "printed", label: "标记为已打印", color: "primary" }],
  printed: [
    { target: "reimbursed", label: "标记为已报销", color: "success" },
    { target: "draft", label: "退回草稿", color: "inherit" },
  ],
  reimbursed: [],
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  report_date: todayStr(),
  department: "",
  employee_name: "",
  purpose: "",
  daily_subsidy: "0.00",
};

export default function ReportEdit() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("draft");
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const readonly = status === "reimbursed";

  const loadForEdit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getReport(id);
      if (res.success) {
        const r = res.data;
        setForm({
          report_date: r.report_date || todayStr(),
          department: r.department || "",
          employee_name: r.employee_name || "",
          purpose: r.purpose || "",
          daily_subsidy: Number(r.daily_subsidy ?? 0).toFixed(2),
        });
        setStatus(r.status);
      } else {
        setError(res.message || "加载报销单失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "加载报销单失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadDefaults = useCallback(async () => {
    try {
      const res = await getSettings();
      if (res.success && res.data) {
        setForm((prev) => ({
          ...prev,
          department: res.data.department || "",
          employee_name: res.data.employee_name || "",
          daily_subsidy: Number(res.data.daily_subsidy ?? 0).toFixed(2),
        }));
      }
    } catch {
      // 设置读取失败不阻塞新增，使用空默认值
    }
  }, []);

  useEffect(() => {
    if (isEdit) {
      loadForEdit();
    } else {
      loadDefaults();
    }
  }, [isEdit, loadForEdit, loadDefaults]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const buildPayload = () => ({
    report_date: form.report_date || null,
    department: form.department.trim() || null,
    employee_name: form.employee_name.trim() || null,
    purpose: form.purpose.trim() || null,
    daily_subsidy: form.daily_subsidy === "" ? "0.00" : form.daily_subsidy,
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (isEdit) {
        const res = await updateReport(id, payload);
        if (res.success) {
          setToast("已保存");
        } else {
          setError(res.message || "保存失败");
        }
      } else {
        const res = await createReport(payload);
        if (res.success) {
          navigate(`/reports/${res.data.id}/edit`, { replace: true });
          setToast("草稿已创建");
        } else {
          setError(res.message || "创建失败");
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusAction = async (target) => {
    setSaving(true);
    setError("");
    try {
      const res = await updateReportStatus(id, target);
      if (res.success) {
        setStatus(res.data.status);
        setToast("状态已更新");
      } else {
        setError(res.message || "状态更新失败");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "状态更新失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const statusMeta = STATUS_META[status] || { label: status, color: "default" };
  const actions = STATUS_ACTIONS[status] || [];

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <div>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h5" fontWeight={700}>
              {isEdit ? "编辑报销单" : "新增报销单"}
            </Typography>
            {isEdit && <Chip size="small" color={statusMeta.color} label={statusMeta.label} />}
          </Stack>
          <Typography color="text.secondary">基本信息（行程与发票录入将在后续 Phase 完成）。</Typography>
        </div>
        <Button component={RouterLink} to="/reports" variant="outlined">
          返回列表
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {readonly && <Alert severity="info">已报销状态为只读，不可修改。</Alert>}

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="报销日期"
                type="date"
                value={form.report_date}
                onChange={handleChange("report_date")}
                InputLabelProps={{ shrink: true }}
                disabled={readonly}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="部门"
                value={form.department}
                onChange={handleChange("department")}
                disabled={readonly}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="出差人"
                value={form.employee_name}
                onChange={handleChange("employee_name")}
                disabled={readonly}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="途中补贴日标准"
                type="number"
                value={form.daily_subsidy}
                onChange={handleChange("daily_subsidy")}
                disabled={readonly}
                InputProps={{
                  startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                  inputProps: { min: 0, step: "0.01" },
                }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="出差事由"
                value={form.purpose}
                onChange={handleChange("purpose")}
                disabled={readonly}
                multiline
                minRows={2}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={handleSave} disabled={saving || readonly}>
              {isEdit ? "保存" : "保存草稿"}
            </Button>
            {isEdit &&
              actions.map((action) => (
                <Button
                  key={action.target}
                  variant="outlined"
                  color={action.color === "inherit" ? "inherit" : action.color}
                  onClick={() => handleStatusAction(action.target)}
                  disabled={saving}
                >
                  {action.label}
                </Button>
              ))}
          </Stack>
        </CardContent>
      </Card>

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
