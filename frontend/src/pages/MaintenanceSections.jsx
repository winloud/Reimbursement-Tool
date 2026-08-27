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
  qrEngineSummary,
  restorePreviewSummary,
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

const statusGridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" },
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
          </Box>

          <Box sx={softPanelSx}>
            <Stack spacing={1.25}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={800}>
                  备份管理
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  选择历史备份进行删除，或保留最近备份并清理其余文件
                </Typography>
              </Box>
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
                  variant="text"
                  color="error"
                  startIcon={busy === "backup-delete" ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                  onClick={onDeleteBackup}
                  disabled={!selectedBackup || Boolean(busy)}
                  sx={{ flex: "0 0 auto" }}
                >
                  删除选中
                </Button>
                <Button
                  variant="text"
                  startIcon={busy === "backup-cleanup" ? <CircularProgress size={16} /> : <CleaningServicesIcon />}
                  onClick={onCleanupBackups}
                  disabled={backups.length <= 1 || Boolean(busy)}
                  sx={{ flex: "0 0 auto" }}
                >
                  清理旧备份
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                删除备份不会影响当前数据库或附件。
              </Typography>
            </Stack>
          </Box>

          <Box sx={softPanelSx}>
            <Stack spacing={1.25}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={800}>
                  恢复数据
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  选择备份 ZIP；执行恢复前会自动创建当前数据备份
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
          </Box>
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
              运行状态
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              诊断包包含日志、配置和环境摘要，不包含数据库或附件
            </Typography>
          </Box>
          <Box sx={{ ...softPanelSx, ...statusGridSx }}>
            <InfoRow label="程序版本" value={info?.app_version} />
            <InfoRow label="当前版本" value={info?.current_version} />
            <InfoRow label="数据库检查" value={databaseCheck ? databaseCheckSummary(databaseCheck) : "尚未检查"} />
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

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800}>
              运行路径
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              排查启动、数据或附件问题时使用的本机目录
            </Typography>
          </Box>
          <Box sx={{ ...softPanelSx, ...infoGridSx }}>
            <InfoRow label="安装根目录" value={info?.app_root} />
            <InfoRow label="当前版本目录" value={info?.current_version_dir} />
            <InfoRow label="数据目录" value={info?.data_dir} />
            <InfoRow label="数据库" value={info?.database_path} />
            <InfoRow label="附件目录" value={info?.uploads_dir} />
            <InfoRow label="备份目录" value={info?.backups_dir} />
            <InfoRow label="日志路径" value={info?.log_file?.path || info?.logs_dir} />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
