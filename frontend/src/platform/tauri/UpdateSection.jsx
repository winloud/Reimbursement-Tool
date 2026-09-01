import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SystemUpdateIcon from "@mui/icons-material/SystemUpdate";

import tauriAdapter from "./adapter.js";

function isRestartInProgress(message) {
  return /disconnected|channel|network|failed to fetch|aborted/i.test(message);
}

export default function TauriUpdateSection() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [error, setError] = useState("");
  const [installResult, setInstallResult] = useState(null);

  const handleCheck = async () => {
    setChecking(true);
    setError("");
    setInstallResult(null);
    try {
      setUpdateInfo(await tauriAdapter.checkForUpdate());
    } catch (err) {
      setError(String(err?.message || err || "检查更新失败"));
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!updateInfo?.available || !updateInfo?.data_compatible) return;
    const confirmed = window.confirm(
      `将更新到 ${updateInfo.version}，安装前会自动创建升级前备份，安装完成后程序将自动重启。确认更新？`,
    );
    if (!confirmed) return;
    setInstalling(true);
    setError("");
    try {
      await tauriAdapter.installUpdate();
      setInstallResult({ success: true, backup_path: "" });
    } catch (err) {
      const message = String(err?.message || err || "");
      if (isRestartInProgress(message)) {
        setInstallResult({ success: true, backup_path: "" });
      } else {
        setError(message || "安装更新失败");
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" gutterBottom>
              程序更新
            </Typography>
            <Typography variant="body2" color="text.secondary">
              通过 GitHub Releases 检查并安装签名更新包，安装前自动备份当前数据。
            </Typography>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
          {installResult?.success && (
            <Alert severity="success">更新已安装，程序正在自动重启。如未自动重启请手动重新打开。</Alert>
          )}

          {updateInfo && (
            <Box>
              {updateInfo.available ? (
                <Stack spacing={1}>
                  <Alert severity={updateInfo.data_compatible ? "info" : "warning"}>
                    发现新版本 {updateInfo.version}（当前 {updateInfo.current_version}）
                  </Alert>
                  {updateInfo.message && <Typography variant="body2" color="text.secondary">{updateInfo.message}</Typography>}
                  {updateInfo.notes && (
                    <Box sx={{ maxHeight: 200, overflowY: "auto", p: 1, bgcolor: "action.hover", borderRadius: 1, whiteSpace: "pre-wrap" }}>
                      <Typography variant="body2">{updateInfo.notes}</Typography>
                    </Box>
                  )}
                </Stack>
              ) : (
                <Alert severity="success">{updateInfo.message || "已是最新版本"}</Alert>
              )}
            </Box>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              startIcon={checking ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={handleCheck}
              disabled={checking || installing}
            >
              检查更新
            </Button>
            {updateInfo?.available && updateInfo.data_compatible && (
              <Button
                variant="contained"
                color="primary"
                startIcon={installing ? <CircularProgress size={16} /> : <SystemUpdateIcon />}
                onClick={handleInstall}
                disabled={installing}
              >
                安装更新
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
