import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import BackupIcon from "@mui/icons-material/Backup";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import RestoreIcon from "@mui/icons-material/Restore";
import StorageIcon from "@mui/icons-material/Storage";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  checkMaintenanceDatabase,
  createMaintenanceBackup,
  downloadMaintenanceBackup,
  downloadMaintenanceDiagnostics,
  executeMaintenanceUpdate,
  executeMaintenanceRestore,
  getMaintenanceInfo,
  previewMaintenanceUpdate,
  previewMaintenanceRestore,
  previewMaintenanceRestoreFromBackupDialog,
  restartMaintenanceApp,
} from "../api/client";
import {
  browserRuntimeSummary,
  databaseCheckSeverity,
  databaseCheckSummary,
  databaseIssueSummary,
  formatFileSize,
  latestBackup,
  qrEngineSummary,
  restorePreviewSummary,
  updatePreviewSummary,
  yesNo,
} from "./maintenanceUtils";

const cardSx = {
  border: 1,
  borderColor: "rgba(148, 163, 184, 0.32)",
  borderRadius: "8px",
  boxShadow: "0 1px 0 rgba(15, 23, 42, 0.03)",
  bgcolor: "background.paper",
};

const cardContentSx = {
  p: { xs: 2, md: 2.25 },
  "&:last-child": { pb: { xs: 2, md: 2.25 } },
};

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

const shouldFallbackToBrowserFilePicker = (err) => {
  const status = err.response?.status;
  return !status || status >= 500 || [404, 405].includes(status);
};

const saveBlob = ({ blob, filename }) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function InfoRow({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {value || "-"}
      </Typography>
    </Box>
  );
}

export default function MaintenancePanel() {
  const fileInputRef = useRef(null);
  const updateFileInputRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [updateFile, setUpdateFile] = useState(null);
  const [updatePreview, setUpdatePreview] = useState(null);
  const [updateResult, setUpdateResult] = useState(null);
  const [databaseCheck, setDatabaseCheck] = useState(null);

  const backup = latestBackup(info?.backups);

  const loadInfo = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getMaintenanceInfo();
      if (!res.success) {
        setError(res.message || "加载数据维护信息失败");
        return;
      }
      setInfo(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "加载数据维护信息失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const handleCreateBackup = async () => {
    setBusy("backup");
    setError("");
    try {
      const res = await createMaintenanceBackup();
      if (!res.success) {
        setError(res.message || "创建备份失败");
        return;
      }
      setToast(`备份已创建：${res.data?.backup?.filename || ""}`);
      await loadInfo();
    } catch (err) {
      setError(getApiErrorMessage(err, "创建备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDownloadBackup = async () => {
    if (!backup) return;
    setBusy("download");
    setError("");
    try {
      saveBlob(await downloadMaintenanceBackup(backup.backup_id));
    } catch (err) {
      setError(getApiErrorMessage(err, "下载备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDiagnostics = async () => {
    setBusy("diagnostics");
    setError("");
    try {
      saveBlob(await downloadMaintenanceDiagnostics());
    } catch (err) {
      setError(getApiErrorMessage(err, "导出诊断信息失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDatabaseCheck = async () => {
    setBusy("database-check");
    setError("");
    try {
      const res = await checkMaintenanceDatabase();
      if (!res.success) {
        setError(res.message || "数据库检查失败");
        return;
      }
      setDatabaseCheck(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "数据库检查失败"));
    } finally {
      setBusy("");
    }
  };

  const openBrowserRestoreFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleChooseRestoreFile = async () => {
    setBusy("preview");
    setError("");
    try {
      const res = await previewMaintenanceRestoreFromBackupDialog();
      if (!res.success) {
        setError(res.message || "恢复预览失败");
        return;
      }
      if (!res.data?.selected) {
        return;
      }
      setRestoreFile({ name: res.data.filename || "backup.zip" });
      setRestorePreview(res.data.preview);
    } catch (err) {
      if (shouldFallbackToBrowserFilePicker(err)) {
        setBusy("");
        openBrowserRestoreFilePicker();
        return;
      }
      setError(getApiErrorMessage(err, "恢复预览失败"));
    } finally {
      setBusy("");
    }
  };

  const handleChooseUpdateFile = () => {
    updateFileInputRef.current?.click();
  };

  const handleRestoreFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRestoreFile(file);
    setRestorePreview(null);
    setBusy("preview");
    setError("");
    try {
      const res = await previewMaintenanceRestore(file);
      if (!res.success) {
        setError(res.message || "恢复预览失败");
        return;
      }
      setRestorePreview(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "恢复预览失败"));
    } finally {
      setBusy("");
    }
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview) return;
    const confirmed = window.confirm("恢复会替换当前数据库和附件；执行前会自动创建恢复前备份。确认恢复？");
    if (!confirmed) return;
    setBusy("restore");
    setError("");
    try {
      const res = await executeMaintenanceRestore({
        preview_id: restorePreview.preview_id,
        confirm_restore: true,
      });
      if (!res.success) {
        setError(res.message || "恢复失败");
        return;
      }
      setToast(`恢复完成，恢复前备份：${res.data?.pre_restore_backup?.filename || ""}`);
      setRestoreFile(null);
      setRestorePreview(null);
      await loadInfo();
    } catch (err) {
      setError(getApiErrorMessage(err, "恢复失败"));
    } finally {
      setBusy("");
    }
  };

  const handleUpdateFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUpdateFile(file);
    setUpdatePreview(null);
    setUpdateResult(null);
    setBusy("update-preview");
    setError("");
    try {
      const res = await previewMaintenanceUpdate(file);
      if (!res.success) {
        setError(res.message || "更新包预览失败");
        return;
      }
      setUpdatePreview(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "更新包预览失败"));
    } finally {
      setBusy("");
    }
  };

  const handleExecuteUpdate = async () => {
    if (!updatePreview) return;
    const confirmed = window.confirm("安装更新前会自动创建完整备份。安装完成后需要关闭程序，并从报销管理根目录重新启动。确认安装？");
    if (!confirmed) return;
    setBusy("update");
    setError("");
    try {
      const res = await executeMaintenanceUpdate({
        preview_id: updatePreview.preview_id,
        confirm_update: true,
      });
      if (!res.success) {
        setError(res.message || "安装更新失败");
        return;
      }
      setToast(`更新已安装：${res.data?.app_version || ""}。点击重启程序后生效。`);
      setUpdateResult(res.data);
      setUpdateFile(null);
      setUpdatePreview(null);
      await loadInfo();
    } catch (err) {
      setError(getApiErrorMessage(err, "安装更新失败"));
    } finally {
      setBusy("");
    }
  };

  const handleRestartApp = async () => {
    const confirmed = window.confirm("将关闭当前程序并启动已安装的新版本。确认重启？");
    if (!confirmed) return;
    setBusy("restart");
    setError("");
    try {
      const res = await restartMaintenanceApp();
      if (!res.success) {
        setError(res.message || "重启失败");
        return;
      }
      setToast("正在重启程序...");
      window.setTimeout(() => window.close(), 500);
    } catch (err) {
      setError(getApiErrorMessage(err, "重启失败"));
    } finally {
      setBusy("");
    }
  };

  return (
    <Card sx={cardSx}>
      <CardContent sx={cardContentSx}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
            <Box>
              <Typography variant="subtitle1" fontWeight={900}>
                维护操作
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                本地 ZIP 升级、备份恢复和诊断信息
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                variant="outlined"
                startIcon={busy === "database-check" ? <CircularProgress size={16} /> : <StorageIcon />}
                onClick={handleDatabaseCheck}
                disabled={loading || Boolean(busy)}
              >
                检查数据库
              </Button>
              <Button
                variant="outlined"
                startIcon={busy === "diagnostics" ? <CircularProgress size={16} /> : <DescriptionIcon />}
                onClick={handleDiagnostics}
                disabled={loading || Boolean(busy)}
              >
                导出诊断包
              </Button>
              <Button
                variant="contained"
                startIcon={busy === "backup" ? <CircularProgress size={16} color="inherit" /> : <BackupIcon />}
                onClick={handleCreateBackup}
                disabled={loading || Boolean(busy)}
              >
                创建备份
              </Button>
            </Stack>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
          {toast && (
            <Alert severity="success" onClose={() => setToast("")}>
              {toast}
            </Alert>
          )}
          {databaseCheck && (
            <Alert severity={databaseCheckSeverity(databaseCheck)}>
              <Stack spacing={0.75}>
                <Typography variant="body2" fontWeight={700}>
                  {databaseCheckSummary(databaseCheck)}
                </Typography>
                {(databaseCheck.issues || []).slice(0, 5).map((issue) => (
                  <Typography key={`${issue.category}-${issue.code}`} variant="body2">
                    {databaseIssueSummary(issue)}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          {loading ? (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={20} />
              <Typography color="text.secondary">加载中...</Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={800}>
                  诊断信息
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  诊断包包含日志、配置和环境摘要，不包含数据库或附件
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                  gap: 1.25,
                }}
              >
                <InfoRow label="程序版本" value={info?.app_version} />
                <InfoRow label="当前版本" value={info?.current_version} />
                <InfoRow label="安装根目录" value={info?.app_root} />
                <InfoRow label="当前版本目录" value={info?.current_version_dir} />
                <InfoRow label="数据目录" value={info?.data_dir} />
                <InfoRow label="数据库" value={info?.database_path} />
                <InfoRow label="附件目录" value={info?.uploads_dir} />
                <InfoRow label="备份目录" value={info?.backups_dir} />
                <InfoRow label="日志路径" value={info?.log_file?.path || info?.logs_dir} />
                <InfoRow
                  label="日志状态"
                  value={
                    info?.log_file?.exists
                      ? `${formatFileSize(info.log_file.size_bytes)}${info.log_file.modified_at ? ` · ${info.log_file.modified_at}` : ""}`
                      : "未生成"
                  }
                />
                <InfoRow label="QR 引擎" value={qrEngineSummary(info?.qr_engine)} />
                <InfoRow
                  label="OpenCV runtime"
                  value={
                    info?.qr_engine
                      ? `${yesNo(info.qr_engine.opencv_runtime_installed)}${info.qr_engine.opencv_package_version ? ` · ${info.qr_engine.opencv_package_version}` : ""}`
                      : "-"
                  }
                />
                <InfoRow label="浏览器/WebView2" value={browserRuntimeSummary(info?.browser_runtime)} />
              </Box>

              <Divider />

              <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800}>
                    最近备份
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                    {backup ? `${backup.filename} · ${formatFileSize(backup.size_bytes)}` : "暂无备份"}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={busy === "download" ? <CircularProgress size={16} /> : <DownloadIcon />}
                  onClick={handleDownloadBackup}
                  disabled={!backup || Boolean(busy)}
                >
                  下载最近备份
                </Button>
              </Stack>

              <Divider />

              <Stack spacing={1.25}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800}>
                    程序更新
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {info?.portable_install ? "选择新版发布 ZIP，安装后重启生效" : "当前运行方式不支持程序内更新"}
                  </Typography>
                </Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <input ref={updateFileInputRef} type="file" accept=".zip,application/zip" hidden onChange={handleUpdateFileChange} />
                  <Button
                    variant="outlined"
                    startIcon={busy === "update-preview" ? <CircularProgress size={16} /> : <UploadFileIcon />}
                    onClick={handleChooseUpdateFile}
                    disabled={!info?.portable_install || Boolean(busy)}
                  >
                    选择更新 ZIP
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={busy === "update" ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltIcon />}
                    onClick={handleExecuteUpdate}
                    disabled={!updatePreview || Boolean(busy)}
                  >
                    安装更新
                  </Button>
                </Stack>
                {updateFile && (
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                    已选择：{updateFile.name}
                  </Typography>
                )}
                {updatePreview && <Alert severity="info">更新预览：{updatePreviewSummary(updatePreview)}</Alert>}
                {updateResult?.restart_required && (
                  <Alert
                    severity="success"
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        startIcon={busy === "restart" ? <CircularProgress size={16} color="inherit" /> : <RestartAltIcon />}
                        onClick={handleRestartApp}
                        disabled={Boolean(busy)}
                      >
                        重启程序
                      </Button>
                    }
                  >
                    更新已安装：{updateResult.app_version}
                  </Alert>
                )}
              </Stack>

              <Divider />

              <Stack spacing={1.25}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800}>
                    备份恢复
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    选择备份 ZIP，恢复前会自动创建当前数据备份
                  </Typography>
                </Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <input ref={fileInputRef} type="file" accept=".zip,application/zip" hidden onChange={handleRestoreFileChange} />
                  <Button
                    variant="outlined"
                    startIcon={busy === "preview" ? <CircularProgress size={16} /> : <UploadFileIcon />}
                    onClick={handleChooseRestoreFile}
                    disabled={Boolean(busy)}
                  >
                    选择备份 ZIP
                  </Button>
                  <Button
                    variant="contained"
                    color="warning"
                    startIcon={busy === "restore" ? <CircularProgress size={16} color="inherit" /> : <RestoreIcon />}
                    onClick={handleExecuteRestore}
                    disabled={!restorePreview || Boolean(busy)}
                  >
                    执行恢复
                  </Button>
                </Stack>
                {restoreFile && (
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                    已选择：{restoreFile.name}
                  </Typography>
                )}
                {restorePreview && <Alert severity="warning">恢复预览：{restorePreviewSummary(restorePreview)}</Alert>}
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
