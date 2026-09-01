// 阶段 5：运行时初始化引导。
//
// 首次启动 runtime 未就绪时，替代 App 渲染迁移/新建引导界面：
// - 新建空白数据：调 start_sidecar_after_init(null)，由 Rust 原子完成初始化和启动。
// - 从旧便携版迁移：choose_legacy_root 选目录预检后，把同一路径交给
//   start_sidecar_after_init(legacy) 原子完成迁移和启动。
// 就绪/浏览器模式直接渲染子元素（App）。
//
// 迁移成功后触发页面重载；业务界面的首个 API 请求再按需取得 sidecar 配置。

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
import {
  chooseLegacyRoot,
  getRuntimeInitStatus,
  isInTauriEnvironment,
  startSidecarAfterInit,
} from "../api/tauriBridge";

const STATUS_LOADING = "loading";
const STATUS_READY = "ready";
const STATUS_NEEDS_INIT = "needs_init";

export default function RuntimeInit({ children }) {
  const [status, setStatus] = useState(STATUS_LOADING);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [legacyCheck, setLegacyCheck] = useState(null);
  // 选中并通过预检的旧便携根路径；startSidecarAfterInit 需用同一值。
  const [legacyRoot, setLegacyRoot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initStatus = await getRuntimeInitStatus();
      if (cancelled) return;
      // browser 模式或 ready：直接进业务界面。error 也当 ready 放行，
      // 让 App 显示启动错误而非卡在引导。
      if (initStatus === "needs_init") {
        setStatus(STATUS_NEEDS_INIT);
      } else {
        setStatus(STATUS_READY);
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
      await startSidecarAfterInit(null);
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
      const check = await chooseLegacyRoot();
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
      await startSidecarAfterInit(legacyRoot);
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

  if (status === STATUS_READY) {
    return children;
  }

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
              {isInTauriEnvironment()
                ? "迁移会复制旧目录的数据库、附件、备份和 OpenCV 组件；旧目录不会被修改。"
                : "浏览器模式无需迁移。"}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

// 迁移完成并启动 sidecar 后重新加载页面；RuntimeInit 将识别 ready，随后
// client.js 在首个业务请求前取得真实的 api_base_url 与会话令牌。
function reloadAfterInit() {
  if (typeof window !== "undefined" && window.location) {
    window.location.reload();
  }
}
