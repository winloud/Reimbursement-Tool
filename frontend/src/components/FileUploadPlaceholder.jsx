import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import { Box, Button, Stack, Typography } from "@mui/material";

const uploadConfirm = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(36, 84, 166, 0.22); }
  100% { box-shadow: 0 0 0 9px rgba(36, 84, 166, 0); }
`;

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
        borderRadius: 1,
        bgcolor: !interactive
          ? "action.hover"
          : activeVisual
            ? "primary.50"
            : "rgba(233, 240, 251, 0.72)",
        px: 0.75,
        py: 0.5,
        position: "relative",
        overflow: "hidden",
        outline: "none",
        transition: "border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease",
        transform: activeVisual ? "translateY(-2px)" : "translateY(0)",
        boxShadow: activeVisual ? "0 10px 24px rgba(36, 84, 166, 0.14)" : "none",
        animation: received ? `${uploadConfirm} 480ms ease-out` : "none",
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
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ position: "relative", zIndex: 1, minHeight: "100%" }}>
        {showIcon && <UploadFileOutlinedIcon color={activeVisual ? "primary" : "action"} fontSize="small" />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            fontWeight={800}
            color={activeVisual ? "primary.dark" : interactive ? "primary.main" : "text.disabled"}
            noWrap
          >
            {primaryText}
          </Typography>
          {secondaryText && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", lineHeight: 1.2 }}>
              {secondaryText}
            </Typography>
          )}
        </Box>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flex: "0 0 auto" }}>
          <Box
            component="kbd"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              px: 0.6,
              py: 0.25,
              border: 1,
              borderColor: "divider",
              borderRadius: 0.75,
              bgcolor: "#F8FAFC",
              color: interactive ? "text.secondary" : "text.disabled",
              fontFamily: "inherit",
              fontSize: 10,
              fontWeight: 800,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            Ctrl+V
          </Box>
          <Button component="label" size="small" disabled={!interactive} sx={{ minWidth: 0, px: 0.75, whiteSpace: "nowrap", fontWeight: 800 }}>
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
