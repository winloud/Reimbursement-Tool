import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import {
  checkMaintenanceDatabase,
  cleanupMaintenanceBackups,
  createMaintenanceBackup,
  deleteMaintenanceBackup,
  downloadMaintenanceBackup,
  downloadMaintenanceDiagnostics,
  executeMaintenanceRestore,
  getMaintenanceInfo,
  previewMaintenanceRestore,
  previewMaintenanceRestoreFromBackupDialog,
} from "../api/client";
import { saveBlobDownload } from "../utils/browserDownload";
import { formatFileSize, latestBackup } from "./maintenanceUtils";
import {
  MaintenanceBackupSection,
  MaintenanceDiagnosticsSection,
  cardContentSx,
  cardSx,
} from "./MaintenanceSections";

const getApiErrorMessage = (err, fallback) =>
  err.response?.data?.message || err.response?.data?.detail || err.message || fallback;

const shouldFallbackToBrowserFilePicker = (err) => {
  const status = err.response?.status;
  return !status || status >= 500 || [404, 405].includes(status);
};

export default function MaintenancePanel() {
  const fileInputRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [toast, setToast] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [databaseCheck, setDatabaseCheck] = useState(null);

  const backups = info?.backups || [];
  const backup = latestBackup(info?.backups);
  const selectedBackup = selectedBackupId ? backups.find((item) => item.backup_id === selectedBackupId) : null;
  const backupSummary = backup ? `${backup.filename} · ${formatFileSize(backup.size_bytes)}` : "暂无备份";

  const loadInfo = async ({ initial = false } = {}) => {
    if (initial) {
      setLoading(true);
      setGlobalError("");
    }
    try {
      const res = await getMaintenanceInfo();
      if (!res.success) {
        const message = res.message || "加载数据维护信息失败";
        if (initial) setGlobalError(message);
        else setToast(`操作已完成，但${message}`);
        return false;
      }
      setInfo(res.data);
      const nextBackups = res.data?.backups || [];
      setSelectedBackupId((previous) =>
        nextBackups.some((backupItem) => backupItem.backup_id === previous) ? previous : nextBackups[0]?.backup_id || "",
      );
      return true;
    } catch (err) {
      const message = getApiErrorMessage(err, "加载数据维护信息失败");
      if (initial) setGlobalError(message);
      else setToast(`操作已完成，但${message}`);
      return false;
    } finally {
      if (initial) setLoading(false);
    }
  };

  useEffect(() => {
    loadInfo({ initial: true });
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
      saveBlobDownload(await downloadMaintenanceBackup(backup.backup_id));
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
      saveBlobDownload(await downloadMaintenanceDiagnostics());
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

  return (
    <Stack spacing={2}>
      {globalError && <Alert severity="error">{globalError}</Alert>}

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
          <MaintenanceBackupSection
            busy={busy}
            backupError={backupError}
            backup={backup}
            backupSummary={backupSummary}
            backups={backups}
            selectedBackup={selectedBackup}
            selectedBackupId={selectedBackupId}
            onSelectBackup={setSelectedBackupId}
            onCreateBackup={handleCreateBackup}
            onDownloadBackup={handleDownloadBackup}
            onDeleteBackup={handleDeleteBackup}
            onCleanupBackups={handleCleanupBackups}
            fileInputRef={fileInputRef}
            onChooseRestoreFile={handleChooseRestoreFile}
            onRestoreFileChange={handleRestoreFileChange}
            onExecuteRestore={handleExecuteRestore}
            restoreFile={restoreFile}
            restorePreview={restorePreview}
            restoreError={restoreError}
          />

          <MaintenanceDiagnosticsSection
            busy={busy}
            diagnosticsError={diagnosticsError}
            databaseCheck={databaseCheck}
            info={info}
            onDatabaseCheck={handleDatabaseCheck}
            onDiagnostics={handleDiagnostics}
          />
        </Stack>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast("")}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
