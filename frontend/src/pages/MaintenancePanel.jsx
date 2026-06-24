import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import BackupIcon from "@mui/icons-material/Backup";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import RestoreIcon from "@mui/icons-material/Restore";
import StorageIcon from "@mui/icons-material/Storage";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  checkMaintenanceDatabase,
  cleanupMaintenanceBackups,
  cleanupMaintenanceVersions,
  createMaintenanceBackup,
  deleteMaintenanceBackup,
  deleteMaintenanceVersion,
  downloadMaintenanceBackup,
  downloadMaintenanceDiagnostics,
  executeMaintenanceUpdate,
  executeMaintenanceRestore,
  getMaintenanceInfo,
  previewMaintenanceUpdate,
  previewMaintenanceRestore,
  previewMaintenanceRestoreFromBackupDialog,
  restartMaintenanceApp,
  switchMaintenanceVersion,
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

const softPanelSx = {
  border: 1,
  borderColor: "rgba(148, 163, 184, 0.24)",
  borderRadius: "8px",
  bgcolor: "rgba(248, 250, 252, 0.72)",
  p: { xs: 1.5, md: 1.75 },
};

const actionRowSx = {
  direction: { xs: "column", sm: "row" },
  spacing: 1,
};

const infoGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
  gap: 1.25,
};

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

const shouldFallbackToBrowserFilePicker = (err) => {
  const status = err.response?.status;
  return !status || status >= 500 || [404, 405].includes(status);
};

const dataCompatibilitySeverity = (compatibility) => {
  if (compatibility?.status === "compatible") return "info";
  if (compatibility?.status === "incompatible") return "error";
  return "warning";
};

const dataCompatibilityLabel = (compatibility) => {
  if (compatibility?.status === "compatible") return "兼容性通过";
  if (compatibility?.status === "incompatible") return "数据不兼容";
  return "兼容性未知";
};

const dataCompatibilityMessage = (compatibility) => compatibility?.message || "目标版本缺少数据兼容性信息，不能自动切换。";

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

function SectionHeader({ icon, title, description, action }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "flex-start" }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1,
            bgcolor: "rgba(37, 99, 235, 0.08)",
            color: "primary.main",
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            "& .MuiSvgIcon-root": {
              fontSize: 19,
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
      {action}
    </Stack>
  );
}

function SelectedFileText({ label, name }) {
  if (!name) return null;
  return (
    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
      {label}：{name}
    </Typography>
  );
}

export default function MaintenancePanel() {
  const fileInputRef = useRef(null);
  const updateFileInputRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [toast, setToast] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [updateFile, setUpdateFile] = useState(null);
  const [updatePreview, setUpdatePreview] = useState(null);
  const [updateResult, setUpdateResult] = useState(null);
  const [versionSwitchResult, setVersionSwitchResult] = useState(null);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [databaseCheck, setDatabaseCheck] = useState(null);

  const backups = info?.backups || [];
  const backup = latestBackup(info?.backups);
  const selectedBackup = selectedBackupId ? backups.find((item) => item.backup_id === selectedBackupId) : null;
  const backupSummary = backup ? `${backup.filename} · ${formatFileSize(backup.size_bytes)}` : "暂无备份";
  const installedVersions = info?.installed_versions || [];
  const switchableVersions = installedVersions.filter((version) => version.executable_exists && !version.current);
  const selectedVersionRecord = selectedVersion
    ? installedVersions.find((version) => version.version === selectedVersion)
    : null;
  const selectedVersionCompatibility = selectedVersionRecord?.data_compatibility;
  const selectedVersionCurrent = Boolean(selectedVersionRecord?.current);
  const selectedVersionCompatible = selectedVersionCompatibility?.status === "compatible";
  const selectedVersionDeletable = Boolean(selectedVersionRecord && !selectedVersionRecord.current);
  const oldVersionCleanupAvailable = installedVersions.some((version) => !version.current);
  const updateVersionRecord = updatePreview ? installedVersions.find((version) => version.version === updatePreview.app_version) : null;
  const updateVersionInstalled = Boolean(updateVersionRecord?.executable_exists);
  const updateVersionCurrent = Boolean(updateVersionRecord?.current);
  const updatePreviewCompatibility = updatePreview?.data_compatibility;
  const updatePreviewCompatible = updatePreviewCompatibility?.status === "compatible";
  const updateVersionCompatible = updateVersionRecord?.data_compatibility?.status === "compatible";

  const loadInfo = async () => {
    setLoading(true);
    setGlobalError("");
    try {
      const res = await getMaintenanceInfo();
      if (!res.success) {
        setGlobalError(res.message || "加载数据维护信息失败");
        return;
      }
      setInfo(res.data);
      const nextBackups = res.data?.backups || [];
      setSelectedBackupId((previous) =>
        nextBackups.some((backupItem) => backupItem.backup_id === previous) ? previous : nextBackups[0]?.backup_id || "",
      );
      const nextSwitchableVersions = (res.data?.installed_versions || []).filter((version) => version.executable_exists && !version.current);
      const nextInstalledVersions = res.data?.installed_versions || [];
      setSelectedVersion((previous) => {
        if (nextInstalledVersions.some((version) => version.version === previous)) {
          return previous;
        }
        return nextSwitchableVersions[0]?.version || nextInstalledVersions[0]?.version || "";
      });
    } catch (err) {
      setGlobalError(getApiErrorMessage(err, "加载数据维护信息失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfo();
  }, []);

  const handleCreateBackup = async () => {
    setBusy("backup");
    setBackupError("");
    try {
      const res = await createMaintenanceBackup();
      if (!res.success) {
        setBackupError(res.message || "创建备份失败");
        return;
      }
      setToast(`备份已创建：${res.data?.backup?.filename || ""}`);
      await loadInfo();
    } catch (err) {
      setBackupError(getApiErrorMessage(err, "创建备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDownloadBackup = async () => {
    if (!backup) return;
    setBusy("download");
    setBackupError("");
    try {
      saveBlob(await downloadMaintenanceBackup(backup.backup_id));
    } catch (err) {
      setBackupError(getApiErrorMessage(err, "下载备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDeleteBackup = async () => {
    if (!selectedBackup) return;
    const confirmed = window.confirm(`将删除备份 ${selectedBackup.filename}，此操作不能撤销。确认删除？`);
    if (!confirmed) return;
    setBusy("backup-delete");
    setBackupError("");
    try {
      const res = await deleteMaintenanceBackup(selectedBackup.backup_id);
      if (!res.success) {
        setBackupError(res.message || "删除备份失败");
        return;
      }
      setToast(`备份已删除：${selectedBackup.filename}`);
      await loadInfo();
    } catch (err) {
      setBackupError(getApiErrorMessage(err, "删除备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleCleanupBackups = async () => {
    if (backups.length <= 1) return;
    const confirmed = window.confirm("将保留最近备份，并删除其余旧备份。确认清理？");
    if (!confirmed) return;
    setBusy("backup-cleanup");
    setBackupError("");
    try {
      const res = await cleanupMaintenanceBackups();
      if (!res.success) {
        setBackupError(res.message || "清理旧备份失败");
        return;
      }
      const deletedCount = res.data?.deleted_backups?.length || 0;
      setToast(`旧备份已清理：${deletedCount} 个`);
      await loadInfo();
    } catch (err) {
      setBackupError(getApiErrorMessage(err, "清理旧备份失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDiagnostics = async () => {
    setBusy("diagnostics");
    setDiagnosticsError("");
    try {
      saveBlob(await downloadMaintenanceDiagnostics());
    } catch (err) {
      setDiagnosticsError(getApiErrorMessage(err, "导出诊断信息失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDatabaseCheck = async () => {
    setBusy("database-check");
    setDiagnosticsError("");
    try {
      const res = await checkMaintenanceDatabase();
      if (!res.success) {
        setDiagnosticsError(res.message || "数据库检查失败");
        return;
      }
      setDatabaseCheck(res.data);
    } catch (err) {
      setDiagnosticsError(getApiErrorMessage(err, "数据库检查失败"));
    } finally {
      setBusy("");
    }
  };

  const openBrowserRestoreFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleChooseRestoreFile = async () => {
    setBusy("preview");
    setRestoreError("");
    try {
      const res = await previewMaintenanceRestoreFromBackupDialog();
      if (!res.success) {
        setRestoreError(res.message || "恢复预览失败");
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
      setRestoreError(getApiErrorMessage(err, "恢复预览失败"));
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
    setRestoreError("");
    try {
      const res = await previewMaintenanceRestore(file);
      if (!res.success) {
        setRestoreError(res.message || "恢复预览失败");
        return;
      }
      setRestorePreview(res.data);
    } catch (err) {
      setRestoreError(getApiErrorMessage(err, "恢复预览失败"));
    } finally {
      setBusy("");
    }
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview) return;
    const confirmed = window.confirm("恢复会替换当前数据库和附件；执行前会自动创建恢复前备份。确认恢复？");
    if (!confirmed) return;
    setBusy("restore");
    setRestoreError("");
    try {
      const res = await executeMaintenanceRestore({
        preview_id: restorePreview.preview_id,
        confirm_restore: true,
      });
      if (!res.success) {
        setRestoreError(res.message || "恢复失败");
        return;
      }
      setToast(`恢复完成，恢复前备份：${res.data?.pre_restore_backup?.filename || ""}`);
      setRestoreFile(null);
      setRestorePreview(null);
      await loadInfo();
    } catch (err) {
      setRestoreError(getApiErrorMessage(err, "恢复失败"));
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
    setVersionSwitchResult(null);
    setBusy("update-preview");
    setUpdateError("");
    try {
      const res = await previewMaintenanceUpdate(file);
      if (!res.success) {
        setUpdateError(res.message || "更新包预览失败");
        return;
      }
      setUpdatePreview(res.data);
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "更新包预览失败"));
    } finally {
      setBusy("");
    }
  };

  const handleExecuteUpdate = async () => {
    if (!updatePreview) return;
    const confirmed = window.confirm("安装更新前会自动创建完整备份。安装完成后需要关闭程序，并从报销管理根目录重新启动。确认安装？");
    if (!confirmed) return;
    setBusy("update");
    setUpdateError("");
    try {
      const res = await executeMaintenanceUpdate({
        preview_id: updatePreview.preview_id,
        confirm_update: true,
      });
      if (!res.success) {
        setUpdateError(res.message || "安装更新失败");
        return;
      }
      setToast(`更新已安装：${res.data?.app_version || ""}。点击重启程序后生效。`);
      setUpdateResult(res.data);
      setVersionSwitchResult(null);
      setUpdateFile(null);
      setUpdatePreview(null);
      await loadInfo();
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "安装更新失败"));
    } finally {
      setBusy("");
    }
  };

  const handleSwitchVersion = async (version = selectedVersion) => {
    if (!version) return;
    const versionRecord = installedVersions.find((item) => item.version === version);
    if (versionRecord?.data_compatibility?.status && versionRecord.data_compatibility.status !== "compatible") {
      setUpdateError(dataCompatibilityMessage(versionRecord.data_compatibility));
      return;
    }
    const confirmed = window.confirm(`将切换到已安装版本 ${version}，切换前会自动创建完整备份。确认切换？`);
    if (!confirmed) return;
    setBusy("version-switch");
    setUpdateError("");
    try {
      const res = await switchMaintenanceVersion({
        version,
        confirm_switch: true,
      });
      if (!res.success) {
        setUpdateError(res.message || "切换版本失败");
        return;
      }
      setToast(`已切换到版本：${res.data?.app_version || version}。点击重启程序后生效。`);
      setVersionSwitchResult(res.data);
      setUpdateResult(null);
      await loadInfo();
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "切换版本失败"));
    } finally {
      setBusy("");
    }
  };

  const handleDeleteVersion = async () => {
    if (!selectedVersionRecord || selectedVersionRecord.current) return;
    const confirmed = window.confirm(`将删除已安装版本 ${selectedVersionRecord.version}，此操作不能撤销。确认删除？`);
    if (!confirmed) return;
    setBusy("version-delete");
    setUpdateError("");
    try {
      const res = await deleteMaintenanceVersion(selectedVersionRecord.version);
      if (!res.success) {
        setUpdateError(res.message || "删除版本失败");
        return;
      }
      setToast(`版本已删除：${selectedVersionRecord.version}`);
      setVersionSwitchResult(null);
      setUpdateResult(null);
      await loadInfo();
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "删除版本失败"));
    } finally {
      setBusy("");
    }
  };

  const handleCleanupVersions = async () => {
    if (!oldVersionCleanupAvailable) return;
    const confirmed = window.confirm("将保留当前版本，并删除所有旧版本目录。确认清理？");
    if (!confirmed) return;
    setBusy("version-cleanup");
    setUpdateError("");
    try {
      const res = await cleanupMaintenanceVersions();
      if (!res.success) {
        setUpdateError(res.message || "清理旧版本失败");
        return;
      }
      const deletedCount = res.data?.deleted_versions?.length || 0;
      setToast(`旧版本已清理：${deletedCount} 个`);
      setVersionSwitchResult(null);
      setUpdateResult(null);
      await loadInfo();
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "清理旧版本失败"));
    } finally {
      setBusy("");
    }
  };

  const handleRestartApp = async () => {
    const confirmed = window.confirm("将关闭当前程序并启动已安装的新版本。确认重启？");
    if (!confirmed) return;
    setBusy("restart");
    setUpdateError("");
    try {
      const res = await restartMaintenanceApp();
      if (!res.success) {
        setUpdateError(res.message || "重启失败");
        return;
      }
      setToast("正在重启程序...");
      window.setTimeout(() => window.close(), 500);
    } catch (err) {
      setUpdateError(getApiErrorMessage(err, "重启失败"));
    } finally {
      setBusy("");
    }
  };

  return (
    <Stack spacing={2}>
      {globalError && <Alert severity="error">{globalError}</Alert>}
      {toast && (
        <Alert severity="success" onClose={() => setToast("")}>
          {toast}
        </Alert>
      )}

      {loading ? (
        <Card sx={cardSx}>
          <CardContent sx={cardContentSx}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={20} />
              <Typography color="text.secondary">加载中...</Typography>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          <Card sx={cardSx}>
            <CardContent sx={cardContentSx}>
              <Stack spacing={2}>
                <SectionHeader
                  icon={<BackupIcon />}
                  title="备份与恢复"
                  description="创建完整备份，或从备份 ZIP 恢复数据"
                  action={
                    <Button
                      variant="contained"
                      startIcon={busy === "backup" ? <CircularProgress size={16} color="inherit" /> : <BackupIcon />}
                      onClick={handleCreateBackup}
                      disabled={Boolean(busy)}
                    >
                      创建备份
                    </Button>
                  }
                />

                {backupError && <Alert severity="error">{backupError}</Alert>}

                <Box sx={softPanelSx}>
                  <Stack spacing={1.5}>
                    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={800}>
                          最近备份
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: "break-all" }}>
                          {backupSummary}
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
                    <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ xs: "stretch", md: "center" }}>
                      <FormControl size="small" sx={{ minWidth: { xs: 0, md: 360 }, flex: 1 }}>
                        <InputLabel id="maintenance-backup-select-label">备份文件</InputLabel>
                        <Select
                          labelId="maintenance-backup-select-label"
                          label="备份文件"
                          value={selectedBackupId}
                          onChange={(event) => setSelectedBackupId(event.target.value)}
                          disabled={backups.length === 0}
                        >
                          {backups.map((backupItem) => (
                            <MenuItem key={backupItem.backup_id} value={backupItem.backup_id}>
                              {backupItem.filename} · {formatFileSize(backupItem.size_bytes)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={busy === "backup-delete" ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                        onClick={handleDeleteBackup}
                        disabled={!selectedBackup || Boolean(busy)}
                        sx={{ flex: "0 0 auto" }}
                      >
                        删除选中
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={busy === "backup-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                        onClick={handleCleanupBackups}
                        disabled={backups.length <= 1 || Boolean(busy)}
                        sx={{ flex: "0 0 auto" }}
                      >
                        清理旧备份
                      </Button>
                    </Stack>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: "break-all" }}>
                        清理旧备份会保留最近备份；删除选中备份不会影响当前数据。
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                <Divider />

                <Stack spacing={1.25}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={800}>
                      备份恢复
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                      选择备份 ZIP，恢复前会自动创建当前数据备份
                    </Typography>
                  </Box>
                  <Stack {...actionRowSx}>
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
                  <SelectedFileText label="已选择" name={restoreFile?.name} />
                  {restorePreview && <Alert severity="warning">恢复预览：{restorePreviewSummary(restorePreview)}</Alert>}
                  {restoreError && <Alert severity="error">{restoreError}</Alert>}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={cardSx}>
            <CardContent sx={cardContentSx}>
              <Stack spacing={2}>
                <SectionHeader
                  icon={<SystemUpdateAltIcon />}
                  title="程序更新"
                  description={info?.portable_install ? "选择新版发布 ZIP，安装后重启生效" : "当前运行方式不支持程序内更新"}
                  action={
                    <Chip
                      size="small"
                      color={info?.portable_install ? "success" : "default"}
                      label={info?.portable_install ? "便携模式" : "更新不可用"}
                      sx={{ alignSelf: { xs: "flex-start", sm: "center" }, fontWeight: 700 }}
                    />
                  }
                />

                <Stack spacing={1.5}>
                  <Box sx={softPanelSx}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={800}>
                          已安装版本
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                          当前版本：{info?.current_version || "-"}
                        </Typography>
                      </Box>
                      {installedVersions.length > 0 ? (
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ minWidth: { xs: 0, md: 620 } }}>
                          <FormControl size="small" fullWidth>
                            <InputLabel id="maintenance-version-switch-label">已安装版本</InputLabel>
                            <Select
                              labelId="maintenance-version-switch-label"
                              label="已安装版本"
                              value={selectedVersion}
                              onChange={(event) => setSelectedVersion(event.target.value)}
                            >
                              {installedVersions.map((version) => (
                                <MenuItem
                                  key={version.version}
                                  value={version.version}
                                >
                                  {version.version}
                                  {version.current ? "（当前）" : ""}
                                  {version.data_compatibility?.status !== "compatible" ? `（${dataCompatibilityLabel(version.data_compatibility)}）` : ""}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <Button
                            variant="outlined"
                            startIcon={busy === "version-switch" ? <CircularProgress size={16} /> : <RestartAltIcon />}
                            onClick={() => handleSwitchVersion(selectedVersion)}
                            disabled={!selectedVersion || selectedVersionCurrent || !selectedVersionCompatible || Boolean(busy)}
                            sx={{ flex: "0 0 auto" }}
                          >
                            切换版本
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={busy === "version-delete" ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                            onClick={handleDeleteVersion}
                            disabled={!selectedVersionDeletable || Boolean(busy)}
                            sx={{ flex: "0 0 auto" }}
                          >
                            删除选中
                          </Button>
                          <Button
                            variant="outlined"
                            startIcon={busy === "version-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                            onClick={handleCleanupVersions}
                            disabled={!oldVersionCleanupAvailable || Boolean(busy)}
                            sx={{ flex: "0 0 auto" }}
                          >
                            清理旧版本
                          </Button>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          暂无已安装版本
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
                      清理旧版本会保留当前版本；删除版本不会删除数据库、附件或备份。
                    </Typography>
                    {!selectedVersionCurrent && selectedVersionCompatibility?.status && selectedVersionCompatibility.status !== "compatible" && (
                      <Alert severity={dataCompatibilitySeverity(selectedVersionCompatibility)} sx={{ mt: 1.25 }}>
                        {dataCompatibilityMessage(selectedVersionCompatibility)}
                      </Alert>
                    )}
                  </Box>
                </Stack>

                <Divider />

                <Stack {...actionRowSx}>
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
                    disabled={!updatePreview || updateVersionInstalled || !updatePreviewCompatible || Boolean(busy)}
                  >
                    安装更新
                  </Button>
                </Stack>
                <SelectedFileText label="已选择" name={updateFile?.name} />
                {updatePreview && (
                  <Alert severity={dataCompatibilitySeverity(updatePreviewCompatibility)}>
                    <Stack spacing={0.5}>
                      <Typography variant="body2">更新预览：{updatePreviewSummary(updatePreview)}</Typography>
                      <Typography variant="body2">
                        {dataCompatibilityLabel(updatePreviewCompatibility)}：{dataCompatibilityMessage(updatePreviewCompatibility)}
                      </Typography>
                    </Stack>
                  </Alert>
                )}
                {updateVersionInstalled && (
                  <Alert
                    severity={updateVersionCurrent ? "success" : updateVersionCompatible ? "warning" : "error"}
                    action={
                      updateVersionCurrent || !updateVersionCompatible ? null : (
                        <Button
                          color="inherit"
                          size="small"
                          onClick={() => handleSwitchVersion(updatePreview.app_version)}
                          disabled={Boolean(busy)}
                        >
                          切换到此版本
                        </Button>
                      )
                    }
                  >
                    {updateVersionCurrent
                      ? `当前已经是 ${updatePreview.app_version}`
                      : updateVersionCompatible
                        ? `版本目录已存在，可直接切换到 ${updatePreview.app_version}`
                        : `版本目录已存在，但${dataCompatibilityMessage(updateVersionRecord?.data_compatibility)}`}
                  </Alert>
                )}
                {updateError && <Alert severity="error">{updateError}</Alert>}
                {(updateResult?.restart_required || versionSwitchResult?.restart_required) && (
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
                    {updateResult ? `更新已安装：${updateResult.app_version}` : `版本已切换：${versionSwitchResult.app_version}`}
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={cardSx}>
            <CardContent sx={cardContentSx}>
              <Stack spacing={2}>
                <SectionHeader
                  icon={<StorageIcon />}
                  title="诊断与检查"
                  description="检查数据库状态，导出排查问题所需的日志和环境摘要"
                  action={
                    <Stack {...actionRowSx}>
                      <Button
                        variant="outlined"
                        startIcon={busy === "database-check" ? <CircularProgress size={16} /> : <StorageIcon />}
                        onClick={handleDatabaseCheck}
                        disabled={Boolean(busy)}
                      >
                        检查数据库
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={busy === "diagnostics" ? <CircularProgress size={16} /> : <DescriptionIcon />}
                        onClick={handleDiagnostics}
                        disabled={Boolean(busy)}
                      >
                        导出诊断包
                      </Button>
                    </Stack>
                  }
                />

                {diagnosticsError && <Alert severity="error">{diagnosticsError}</Alert>}
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

                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800}>
                    诊断信息
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    诊断包包含日志、配置和环境摘要，不包含数据库或附件
                  </Typography>
                </Box>
                <Box sx={{ ...softPanelSx, ...infoGridSx }}>
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
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}
    </Stack>
  );
}
