import { Button, CircularProgress, Stack } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";

// 汇总卡底部的“预览 / 下载 PDF”按钮组。
// blocked 表示条件未满足：按钮仍可点击（由页面弹出原因说明），但置灰并改用提示文案。
export default function PdfActionButtons({
  busy = "",
  previewDisabled = false,
  downloadDisabled = false,
  previewBlocked = false,
  downloadBlocked = false,
  previewBlockedLabel = "确认后预览",
  downloadBlockedLabel = "确认后下载",
  onPreview,
  onDownload,
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
      <Button
        fullWidth
        variant="outlined"
        startIcon={busy === "preview" ? <CircularProgress size={16} /> : <VisibilityIcon />}
        onClick={onPreview}
        disabled={previewDisabled || busy === "download"}
        sx={previewBlocked ? { color: "text.disabled", borderColor: "divider" } : undefined}
      >
        {busy === "preview" ? "生成中" : previewBlocked ? previewBlockedLabel : "预览"}
      </Button>
      <Button
        fullWidth
        variant="contained"
        startIcon={busy === "download" ? <CircularProgress size={16} /> : <DownloadIcon />}
        onClick={onDownload}
        disabled={downloadDisabled || busy === "preview"}
        sx={downloadBlocked ? { bgcolor: "action.disabledBackground", color: "text.disabled" } : undefined}
      >
        {busy === "download" ? "生成中" : downloadBlocked ? downloadBlockedLabel : "下载"}
      </Button>
    </Stack>
  );
}
