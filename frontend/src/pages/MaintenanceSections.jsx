import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  browserRuntimeSummary,
  databaseCheckSeverity,
  databaseCheckSummary,
  databaseIssueSummary,
  formatFileSize,
  formatUpdateStagingTime,
  qrEngineSummary,
  restorePreviewSummary,
  updatePreviewSummary,
  yesNo,
} from "./maintenanceUtils";

export const cardSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  boxShadow: "none",
  bgcolor: "background.paper",
};

export const cardContentSx = {
  p: { xs: 2, md: 2.25 },
  "&:last-child": { pb: { xs: 2, md: 2.25 } },
};

const softPanelSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "#F8FAFC",
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

export const dataCompatibilitySeverity = (compatibility) => {
  if (compatibility?.status === "compatible") return "info";
  if (compatibility?.status === "incompatible") return "error";
  return "warning";
};

export const dataCompatibilityLabel = (compatibility) => {
  if (compatibility?.status === "compatible") return "兼容性通过";
  if (compatibility?.status === "incompatible") return "数据不兼容";
  return "兼容性未知";
};

export const dataCompatibilityMessage = (compatibility) => compatibility?.message || "目标版本缺少数据兼容性信息，不能自动切换。";

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
            bgcolor: "primary.50",
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

export function MaintenanceBackupSection({
  busy,
  backupError,
  backup,
  backupSummary,
  backups,
  selectedBackup,
  selectedBackupId,
  onSelectBackup,
  onCreateBackup,
  onDownloadBackup,
  onDeleteBackup,
  onCleanupBackups,
  fileInputRef,
  onChooseRestoreFile,
  onRestoreFileChange,
  onExecuteRestore,
  restoreFile,
  restorePreview,
  restoreError,
}) {
  return (
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
                onClick={onCreateBackup}
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
                  onClick={onDownloadBackup}
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
                    onChange={(event) => onSelectBackup(event.target.value)}
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
                  onClick={onDeleteBackup}
                  disabled={!selectedBackup || Boolean(busy)}
                  sx={{ flex: "0 0 auto" }}
                >
                  删除选中
                </Button>
                <Button
                  variant="outlined"
                  startIcon={busy === "backup-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                  onClick={onCleanupBackups}
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
              <input ref={fileInputRef} type="file" accept=".zip,application/zip" hidden onChange={onRestoreFileChange} />
              <Button
                variant="outlined"
                startIcon={busy === "preview" ? <CircularProgress size={16} /> : <UploadFileIcon />}
                onClick={onChooseRestoreFile}
                disabled={Boolean(busy)}
              >
                选择备份 ZIP
              </Button>
              <Button
                variant="contained"
                color="warning"
                startIcon={busy === "restore" ? <CircularProgress size={16} color="inherit" /> : <RestoreIcon />}
                onClick={onExecuteRestore}
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
  );
}

export function MaintenanceUpdateSection({
  busy,
  info,
  installedVersions,
  selectedVersion,
  selectedVersionCurrent,
  selectedVersionCompatibility,
  selectedVersionCompatible,
  selectedVersionDeletable,
  oldVersionCleanupAvailable,
  updateVersionRecord,
  updateVersionInstalled,
  updateVersionCurrent,
  updatePreview,
  updatePreviewCompatibility,
  updatePreviewCompatible,
  updateVersionCompatible,
  updateStagingPackages,
  selectedUpdateStagingIds,
  selectedUpdateStagingSummary,
  updateStagingCleanupAvailable,
  updateFile,
  updateResult,
  versionSwitchResult,
  updateError,
  updateFileInputRef,
  onSelectVersion,
  onChooseUpdateFile,
  onUpdateFileChange,
  onExecuteUpdate,
  onSwitchVersion,
  onDeleteVersion,
  onCleanupVersions,
  onToggleUpdateStaging,
  onCleanupUpdateStaging,
  onRestartApp,
}) {
  return (
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
                        onChange={(event) => onSelectVersion(event.target.value)}
                      >
                        {installedVersions.map((version) => (
                          <MenuItem key={version.version} value={version.version}>
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
                      onClick={() => onSwitchVersion(selectedVersion)}
                      disabled={!selectedVersion || selectedVersionCurrent || !selectedVersionCompatible || Boolean(busy)}
                      sx={{ flex: "0 0 auto" }}
                    >
                      切换版本
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={busy === "version-delete" ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                      onClick={onDeleteVersion}
                      disabled={!selectedVersionDeletable || Boolean(busy)}
                      sx={{ flex: "0 0 auto" }}
                    >
                      删除选中
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={busy === "version-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                      onClick={onCleanupVersions}
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

          <Box sx={softPanelSx}>
            <Stack spacing={1}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800}>
                    更新暂存包
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    共 {info?.update_staging?.total_count || updateStagingPackages.length} 个，{formatFileSize(info?.update_staging?.total_size_bytes)}；超过 {info?.update_staging?.retention_days || 7} 天的包默认勾选
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={busy === "update-staging-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                  onClick={onCleanupUpdateStaging}
                  disabled={!updateStagingCleanupAvailable || Boolean(busy)}
                  sx={{ flex: "0 0 auto" }}
                >
                  清理选中（{selectedUpdateStagingSummary?.count || 0}）
                </Button>
              </Stack>
              {updateStagingPackages.length > 0 ? (
                <Box sx={{ maxHeight: 240, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
                  <Stack divider={<Divider />} spacing={0}>
                    {updateStagingPackages.map((item) => {
                      const checked = selectedUpdateStagingIds.includes(item.preview_id);
                      return (
                        <Stack key={item.preview_id} direction="row" spacing={0.75} alignItems="center" sx={{ px: 0.5, py: 0.35 }}>
                          <Checkbox
                            size="small"
                            checked={checked}
                            onChange={() => onToggleUpdateStaging(item.preview_id)}
                            disabled={Boolean(busy)}
                            inputProps={{ "aria-label": `选择更新暂存包 ${item.app_version || item.preview_id}` }}
                          />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography variant="body2" fontWeight={700} noWrap>
                                {item.app_version || "无法解析版本"}
                              </Typography>
                              {!item.valid && <Chip size="small" color="warning" label="无效包" />}
                              {item.expired && <Chip size="small" variant="outlined" label={`超过${info?.update_staging?.retention_days || 7}天`} />}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {formatFileSize(item.size_bytes)} · {formatUpdateStagingTime(item.modified_at)} · {item.preview_id}
                            </Typography>
                          </Box>
                        </Stack>
                      );
                    })}
                  </Stack>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  暂无更新暂存包。
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                这里只删除选中的更新暂存包，不会影响已安装版本、数据库、附件或备份。
              </Typography>
            </Stack>
          </Box>

          <Divider />

          <Stack {...actionRowSx}>
            <input ref={updateFileInputRef} type="file" accept=".zip,application/zip" hidden onChange={onUpdateFileChange} />
            <Button
              variant="outlined"
              startIcon={busy === "update-preview" ? <CircularProgress size={16} /> : <UploadFileIcon />}
              onClick={onChooseUpdateFile}
              disabled={!info?.portable_install || Boolean(busy)}
            >
              选择更新 ZIP
            </Button>
            <Button
              variant="contained"
              startIcon={busy === "update" ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltIcon />}
              onClick={onExecuteUpdate}
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
                    onClick={() => onSwitchVersion(updatePreview.app_version)}
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
                  onClick={onRestartApp}
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
  );
}

export function MaintenanceDiagnosticsSection({ busy, diagnosticsError, databaseCheck, info, onDatabaseCheck, onDiagnostics }) {
  return (
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
                  onClick={onDatabaseCheck}
                  disabled={Boolean(busy)}
                >
                  检查数据库
                </Button>
                <Button
                  variant="outlined"
                  startIcon={busy === "diagnostics" ? <CircularProgress size={16} /> : <DescriptionIcon />}
                  onClick={onDiagnostics}
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
  );
}
