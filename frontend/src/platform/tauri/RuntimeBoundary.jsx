import { useEffect, useState } from "react";
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
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import NoteAddIcon from "@mui/icons-material/NoteAdd";

import tauriAdapter from "./adapter.js";

const STATUS_LOADING = "loading";
const STATUS_READY = "ready";
const STATUS_NEEDS_INIT = "needs_init";

export default function TauriRuntimeBoundary({ children }) {
  const [status, setStatus] = useState(STATUS_LOADING);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [legacyCheck, setLegacyCheck] = useState(null);
  const [legacyRoot, setLegacyRoot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initStatus = await tauriAdapter.getRuntimeInitStatus();
        if (!cancelled) {
          setStatus(initStatus === STATUS_NEEDS_INIT ? STATUS_NEEDS_INIT : STATUS_READY);
        }
      } catch {
        if (!cancelled) setStatus(STATUS_READY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNewBlank = async () => {
    setBusy("new");
    setError("");
    try {
      await tauriAdapter.startSidecarAfterInit(null);
      reloadAfterInit();
    } catch (err) {
      setError(String(err?.message || err || "初始化失败"));
    } finally {
      setBusy("");
    }
  };

  const handleChooseLegacy = async () => {
    setBusy("choose");
    setError("");
    try {
      const check = await tauriAdapter.chooseLegacyRoot();
      if (!check) {
        setError("当前环境不支持选择目录");
        return;
      }
      if (!check.valid) {
        setError(check.reason || "选择的目录无效");
        setLegacyCheck(check);
        return;
      }
      setLegacyCheck(check);
      setLegacyRoot(check.path);
    } catch (err) {
      setError(String(err?.message || err || "选择目录失败"));
    } finally {
      setBusy("");
    }
  };

  const handleMigrate = async () => {
    if (!legacyRoot) return;
    setBusy("migrate");
    setError("");
    try {
      await tauriAdapter.startSidecarAfterInit(legacyRoot);
      reloadAfterInit();
    } catch (err) {
      setError(String(err?.message || err || "迁移失败"));
    } finally {
      setBusy("");
    }
  };

  if (status === STATUS_LOADING) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status === STATUS_READY) return children;

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", p: 3 }}>
      <Card sx={{ maxWidth: 640, width: "100%" }}>
        <CardContent>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h5" gutterBottom>
                首次使用设置
              </Typography>
              <Typography variant="body2" color="text.secondary">
                运行数据将保存在 <code>%LOCALAPPDATA%\com.winloud.reimbursementtool\runtime</code>，
                离开安装目录，卸载重装不丢数据。
              </Typography>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}

            {legacyCheck?.valid && (
              <Alert severity="info">
                已选择旧目录：{legacyCheck.path}
                <br />
                可迁入：{legacyCheck.found_entries.join("、")}
              </Alert>
            )}

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                startIcon={<NoteAddIcon />}
                onClick={handleNewBlank}
                disabled={Boolean(busy)}
              >
                新建空白数据
              </Button>
              <Button
                variant="outlined"
                startIcon={<FolderOpenIcon />}
                onClick={handleChooseLegacy}
                disabled={Boolean(busy)}
              >
                从旧便携版迁移
              </Button>
              {legacyCheck?.valid && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleMigrate}
                  disabled={Boolean(busy) || !legacyRoot}
                >
                  开始迁移
                </Button>
              )}
            </Stack>

            {busy && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  处理中…
                </Typography>
              </Box>
            )}

            <Typography variant="caption" color="text.secondary">
              迁移会复制旧目录的数据库、附件、备份和 OpenCV 组件；旧目录不会被修改。
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function reloadAfterInit() {
  if (typeof window !== "undefined" && window.location) {
    window.location.reload();
  }
}
