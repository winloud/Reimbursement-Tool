import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import { Box, Button, Stack, Typography } from "@mui/material";

const uploadConfirm = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(36, 84, 166, 0.22); }
  100% { box-shadow: 0 0 0 9px rgba(36, 84, 166, 0); }
`;

const uploadActionSx = {
  height: 24,
  boxSizing: "border-box",
  py: 0,
  fontSize: 10,
  lineHeight: "16px",
  flexShrink: 0,
};

export default function FileUploadPlaceholder({
  accept,
  ariaLabel,
  disabled = false,
  uploading = false,
  hint,
  uploadingText,
  selectedText,
  dragText,
  idleDetail,
  selectedDetail,
  dragDetail,
  getClipboardFiles,
  getClipboardFilename,
  pasteErrorMessage,
  showIcon = true,
  onFiles,
  onPasteError,
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
    if (!interactive) {
      setFocused(false);
      setDragActive(false);
      dragDepthRef.current = 0;
    }
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

  const submitFiles = (files) => {
    if (!files || files.length === 0) return;
    playReceiveFeedback();
    onFiles(files);
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
    submitFiles(event.dataTransfer.files);
  };

  const handlePaste = (event) => {
    if (!interactive) return;
    const clipboardFiles = getClipboardFiles?.(event.clipboardData) || [];
    if (clipboardFiles.length === 0) {
      event.preventDefault();
      onPasteError?.(pasteErrorMessage);
      return;
    }
    event.preventDefault();
    const timestamp = Date.now();
    const normalizedFiles = clipboardFiles.map((file, index) => {
      const filename = getClipboardFilename?.(file, index, timestamp);
      if (!filename || filename === file.name || typeof File !== "function") return file;
      return new File([file], filename, {
        type: file.type,
        lastModified: file.lastModified || timestamp,
      });
    });
    submitFiles(normalizedFiles);
  };

  const selected = focused && interactive;
  const activeVisual = dragActive || selected;
  const primaryText = dragActive
    ? dragText
    : uploading
      ? uploadingText
      : selected
        ? selectedText
        : hint;
  const secondaryText = dragActive ? dragDetail : selected ? selectedDetail : idleDetail;

  return (
    <Box
      role="group"
      tabIndex={interactive ? 0 : -1}
      aria-label={ariaLabel}
      aria-disabled={!interactive || undefined}
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
        minWidth: 0,
        minHeight: 54,
        height: "100%",
        border: 1,
        borderStyle: activeVisual ? "solid" : "dashed",
        borderColor: !interactive
          ? "divider"
          : activeVisual
            ? "primary.main"
            : "rgba(94, 131, 201, 0.68)",
        borderRadius: 0.75,
        bgcolor: !interactive
          ? "action.hover"
          : activeVisual
            ? "primary.50"
            : "#F8FAFC",
        px: 0.75,
        py: 0.5,
        position: "relative",
        overflow: "hidden",
        outline: "none",
        transition: "border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease",
        boxShadow: activeVisual ? "inset 0 0 0 1px #2454A6" : "none",
        animation: received ? `${uploadConfirm} 480ms ease-out` : "none",
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          animation: "none",
        },
      }}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0, height: "100%", justifyContent: "center" }}>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
          {showIcon && <UploadFileOutlinedIcon color={activeVisual ? "primary" : "action"} sx={{ fontSize: 16, flexShrink: 0 }} />}
          <Typography
            variant="body2"
            fontWeight={600}
            color={activeVisual ? "primary.dark" : interactive ? "primary.main" : "text.disabled"}
            sx={{ fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere" }}
          >
            {primaryText}
          </Typography>
        </Stack>
        {secondaryText && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, overflowWrap: "anywhere" }}>
            {secondaryText}
          </Typography>
        )}
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="caption" color={interactive ? "text.secondary" : "text.disabled"} sx={{ fontSize: 11, whiteSpace: "nowrap" }}>
            拖拽
          </Typography>
          <Typography variant="caption" color="text.disabled" aria-hidden="true">/</Typography>
          <Box
            component="kbd"
            sx={{
              ...uploadActionSx,
              display: "inline-flex",
              alignItems: "center",
              px: 0.6,
              border: 1,
              borderColor: "divider",
              borderRadius: 0.75,
              bgcolor: "#F8FAFC",
              color: interactive ? "text.secondary" : "text.disabled",
              fontFamily: "inherit",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            Ctrl+V
          </Box>
          <Typography variant="caption" color="text.disabled" aria-hidden="true">/</Typography>
          <Button component="label" size="small" disabled={!interactive} sx={{ ...uploadActionSx, minWidth: 0, px: 0.6, fontSize: 11, whiteSpace: "nowrap", fontWeight: 600 }}>
            选择文件
            <input
              hidden
              multiple
              type="file"
              accept={accept}
              disabled={!interactive}
              onChange={(event) => {
                submitFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
