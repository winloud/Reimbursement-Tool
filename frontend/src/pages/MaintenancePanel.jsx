import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
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
  formatFileSize,
  latestBackup,
} from "./maintenanceUtils";
import {
  MaintenanceBackupSection,
  MaintenanceDiagnosticsSection,
  MaintenanceUpdateSection,
  cardContentSx,
  cardSx,
  dataCompatibilityMessage,
} from "./MaintenanceSections";

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

          <MaintenanceUpdateSection
            busy={busy}
            info={info}
            installedVersions={installedVersions}
            selectedVersion={selectedVersion}
            selectedVersionCurrent={selectedVersionCurrent}
            selectedVersionCompatibility={selectedVersionCompatibility}
            selectedVersionCompatible={selectedVersionCompatible}
            selectedVersionDeletable={selectedVersionDeletable}
            oldVersionCleanupAvailable={oldVersionCleanupAvailable}
            updateVersionRecord={updateVersionRecord}
            updateVersionInstalled={updateVersionInstalled}
            updateVersionCurrent={updateVersionCurrent}
            updatePreview={updatePreview}
            updatePreviewCompatibility={updatePreviewCompatibility}
            updatePreviewCompatible={updatePreviewCompatible}
            updateVersionCompatible={updateVersionCompatible}
            updateFile={updateFile}
            updateResult={updateResult}
            versionSwitchResult={versionSwitchResult}
            updateError={updateError}
            updateFileInputRef={updateFileInputRef}
            onSelectVersion={setSelectedVersion}
            onChooseUpdateFile={handleChooseUpdateFile}
            onUpdateFileChange={handleUpdateFileChange}
            onExecuteUpdate={handleExecuteUpdate}
            onSwitchVersion={handleSwitchVersion}
            onDeleteVersion={handleDeleteVersion}
            onCleanupVersions={handleCleanupVersions}
            onRestartApp={handleRestartApp}
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
    </Stack>
  );
}
