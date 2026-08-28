// 阶段 6：程序更新区块（Tauri updater）。
//
// 取代旧 ZIP 更新 UI：检查更新 -> 显示版本与数据结构兼容性 ->
// 用户确认 -> 安装（pre_update 备份 + 停 sidecar + 下载验签 + passive 安装）。
// 浏览器模式显示不支持提示。

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
import { checkForUpdate, installUpdate, isInTauriEnvironment } from "../api/tauriBridge";

/// 判断 invoke 错误是否为"进程正在重启"（app.restart() 断开连接）。
/// Tauri invoke 断连的错误信息含 channel/disconnected/network 等关键词。
function isRestartInProgress(message) {
  return /disconnected|channel|network|failed to fetch|aborted/i.test(message);
}

export default function UpdateSection() {
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
      const info = await checkForUpdate();
      setUpdateInfo(info);
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
      await installUpdate();
      // 正常不会走到这里：install_update 成功后调用 app.restart()，进程被替换，
      // invoke 连接断开，进入 catch。若意外返回则按成功处理。
      setInstallResult({ success: true, backup_path: "" });
    } catch (err) {
      const msg = String(err?.message || err || "");
      // 安装成功后 app.restart() 会断开 invoke 连接，表现为网络/通道错误。
      // 此时进程正在重启，不当作失败；否则为真实安装失败（后端已恢复）。
      if (isRestartInProgress(msg)) {
        setInstallResult({ success: true, backup_path: "" });
      } else {
        setError(msg || "安装更新失败");
      }
    } finally {
      setInstalling(false);
    }
  };

  if (!isInTauriEnvironment()) {
    return null; // 浏览器模式不显示更新区块
  }

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
            <Alert severity="success">
              更新已安装，程序正在自动重启。如未自动重启请手动重新打开。
            </Alert>
          )}

          {updateInfo && (
            <Box>
              {updateInfo.available ? (
                <Stack spacing={1}>
                  <Alert severity={updateInfo.data_compatible ? "info" : "warning"}>
                    发现新版本 {updateInfo.version}（当前 {updateInfo.current_version}）
                  </Alert>
                  {updateInfo.message && (
                    <Typography variant="body2" color="text.secondary">
                      {updateInfo.message}
                    </Typography>
                  )}
                  {updateInfo.notes && (
                    <Box
                      sx={{
                        maxHeight: 200,
                        overflowY: "auto",
                        p: 1,
                        bgcolor: "action.hover",
                        borderRadius: 1,
                        whiteSpace: "pre-wrap",
                      }}
                    >
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
