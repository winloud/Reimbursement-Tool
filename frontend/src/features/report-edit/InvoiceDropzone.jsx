import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import { Box, Button, Stack, Typography } from "@mui/material";

import {
  getClipboardInvoiceFilename,
  getClipboardInvoiceFiles,
} from "../../pages/reportEditUtils";

const dropzoneConfirm = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(36, 84, 166, 0.22); }
  100% { box-shadow: 0 0 0 9px rgba(36, 84, 166, 0); }
`;

export default function InvoiceDropzone({
  disabled,
  uploading,
  onFiles,
  onPasteError,
  hint = "上传新发票",
}) {
  const dragDepthRef = useRef(0);
  const feedbackTimerRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [received, setReceived] = useState(false);
  const interactive = !disabled && !uploading;

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!interactive) setFocused(false);
  }, [interactive]);

  const playReceiveFeedback = () => {
    setReceived(true);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setReceived(false), 520);
  };

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    if (!interactive) return;
    const dragTypes = Array.from(event.dataTransfer?.types || []);
    if (dragTypes.length > 0 && !dragTypes.includes("Files")) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    if (dragDepthRef.current > 0) dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = interactive ? "copy" : "none";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    resetDragState();
    if (!interactive) return;
    playReceiveFeedback();
    onFiles(event.dataTransfer.files);
  };

  const handlePaste = (event) => {
    if (!interactive) return;
    const clipboardFiles = getClipboardInvoiceFiles(event.clipboardData);
    if (clipboardFiles.length === 0) {
      event.preventDefault();
      onPasteError?.("剪贴板中没有可上传的 PDF 或图片");
      return;
    }
    event.preventDefault();
    const timestamp = Date.now();
    const normalizedFiles = clipboardFiles.map((file, index) => {
      const filename = getClipboardInvoiceFilename(file, index, timestamp);
      if (!filename || filename === file.name || typeof File !== "function") return file;
      return new File([file], filename, {
        type: file.type,
        lastModified: file.lastModified || timestamp,
      });
    });
    playReceiveFeedback();
    onFiles(normalizedFiles);
  };

  const selected = focused && interactive;
  const activeVisual = dragActive || selected;
  const primaryText = dragActive
    ? "松开即可上传到这里"
    : uploading
      ? "正在上传发票"
      : selected
        ? "已选中当前上传区域"
        : hint;
  const secondaryText = dragActive
    ? "当前费用分类已锁定为上传目标"
    : selected
      ? "按 Ctrl+V 粘贴到此费用分类，或选择文件"
      : "拖入、Ctrl+V 或选择 PDF / 图片";

  return (
    <Box
      role="group"
      tabIndex={interactive ? 0 : -1}
      aria-label="发票上传区，可拖放、粘贴或选择文件"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onFocus={() => {
        if (interactive) setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onMouseDown={(event) => {
        if (!interactive || event.target.closest?.("button, label, input")) return;
        event.currentTarget.focus();
      }}
      sx={{
        border: 1,
        borderStyle: activeVisual ? "solid" : "dashed",
        borderColor: disabled
          ? "divider"
          : activeVisual
            ? "primary.main"
            : "rgba(94, 131, 201, 0.68)",
        borderRadius: 1,
        bgcolor: disabled
          ? "action.hover"
          : activeVisual
            ? "primary.50"
            : "rgba(233, 240, 251, 0.72)",
        px: 1.5,
        py: 1.25,
        position: "relative",
        overflow: "hidden",
        outline: "none",
        transition: "border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
        transform: activeVisual ? "translateY(-2px)" : "translateY(0)",
        boxShadow: activeVisual
          ? "0 10px 24px rgba(36, 84, 166, 0.14)"
          : "none",
        animation: received ? `${dropzoneConfirm} 480ms ease-out` : "none",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "linear-gradient(105deg, transparent 18%, rgba(255,255,255,0.72) 48%, transparent 78%)",
          transform: activeVisual ? "translateX(80%)" : "translateX(-120%)",
          transition: activeVisual ? "transform 700ms ease" : "none",
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ position: "relative", zIndex: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            fontWeight={800}
            color={activeVisual ? "primary.dark" : "primary.main"}
          >
            {primaryText}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.15 }}>
            {secondaryText}
          </Typography>
        </Box>

        <Stack direction={{ xs: "column", sm: "row" }} alignItems="center" spacing={0.75} sx={{ flex: "0 0 auto" }}>
          <Box
            component="kbd"
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              alignItems: "center",
              gap: 0.4,
              px: 0.8,
              py: 0.35,
              border: 1,
              borderColor: "divider",
              borderRadius: 0.75,
              bgcolor: "#F8FAFC",
              color: "text.secondary",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            Ctrl+V
          </Box>
          <Button component="label" size="small" disabled={!interactive} sx={{ whiteSpace: "nowrap", fontWeight: 800 }}>
            选择文件
            <input
              hidden
              multiple
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.bmp,.gif,.webp,image/jpeg,image/png,image/bmp,image/gif,image/webp"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
