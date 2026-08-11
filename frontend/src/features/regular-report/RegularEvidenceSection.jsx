import { useEffect, useRef, useState } from "react";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

import { getReportAttachmentFileUrl } from "../../api/client";
import {
  getClipboardReportAttachmentFilename,
  getClipboardReportAttachmentFiles,
} from "../../pages/reportEditUtils";

const ACCEPTED_EVIDENCE =
  ".pdf,.jpg,.jpeg,.png,.bmp,.gif,.webp,application/pdf,image/jpeg,image/png,image/bmp,image/gif,image/webp";

export default function RegularEvidenceSection({
  attachments = [],
  disabled = false,
  uploading = false,
  onFiles,
  onDelete,
  onError,
}) {
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const interactive = !disabled && !uploading;

  useEffect(() => {
    if (!interactive) setFocused(false);
  }, [interactive]);

  const resetDrag = () => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  const handlePaste = (event) => {
    if (!interactive) return;
    const files = getClipboardReportAttachmentFiles(event.clipboardData);
    if (files.length === 0) {
      event.preventDefault();
      onError?.("剪贴板中没有可上传的 PDF 或图片凭据");
      return;
    }
    event.preventDefault();
    const timestamp = Date.now();
    onFiles(files.map((file, index) => {
      const filename = getClipboardReportAttachmentFilename(file, index, timestamp);
      if (!filename || filename === file.name || typeof File !== "function") return file;
      return new File([file], filename, { type: file.type, lastModified: file.lastModified || timestamp });
    }));
  };

  const active = dragActive || (focused && interactive);
  return (
    <Stack spacing={1}>
      <Box
        role="group"
        tabIndex={interactive ? 0 : -1}
        aria-label="报销凭据上传区，可拖放、粘贴或选择 PDF 和图片"
        onFocus={() => interactive && setFocused(true)}
        onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
        onPaste={handlePaste}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!interactive) return;
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (dragDepthRef.current > 0) dragDepthRef.current -= 1;
          if (dragDepthRef.current === 0) setDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = interactive ? "copy" : "none";
        }}
        onDrop={(event) => {
          event.preventDefault();
          resetDrag();
          if (interactive) onFiles(event.dataTransfer.files);
        }}
        sx={{
          border: 1,
          borderStyle: active ? "solid" : "dashed",
          borderColor: active ? "primary.main" : "rgba(94, 131, 201, 0.68)",
          borderRadius: 1,
          bgcolor: disabled ? "action.hover" : active ? "primary.50" : "rgba(233, 240, 251, 0.72)",
          px: 1.5,
          py: 1.25,
          outline: "none",
          transition: "border-color 160ms ease, background-color 160ms ease, transform 160ms ease",
          transform: active ? "translateY(-1px)" : "none",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <AttachFileIcon color={active ? "primary" : "action"} fontSize="small" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" color={active ? "primary.dark" : "primary.main"} fontWeight={800}>
              {dragActive ? "松开即可上传凭据" : uploading ? "正在上传凭据" : "添加报销凭据"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              可选；支持拖入、Ctrl+V 或选择 PDF / 图片
            </Typography>
          </Box>
          <Button component="label" size="small" disabled={!interactive} sx={{ whiteSpace: "nowrap" }}>
            选择文件
            <input
              hidden
              multiple
              type="file"
              accept={ACCEPTED_EVIDENCE}
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </Button>
        </Stack>
      </Box>

      {attachments.length > 0 && (
        <Stack spacing={0.5}>
          {attachments.map((attachment) => {
            const filename = attachment.original_filename || attachment.file_name || "未命名凭据";
            const pageCount = Math.max(1, Number(attachment.page_count || 1));
            return (
              <Paper key={attachment.id} variant="outlined" sx={{ px: 1, py: 0.5, bgcolor: "#F8FAFC" }}>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                  <AttachFileIcon color="action" fontSize="small" />
                  <Tooltip title={filename}>
                    <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0, flex: 1 }}>
                      {filename}
                    </Typography>
                  </Tooltip>
                  <Chip size="small" variant="outlined" label={`${pageCount} 页`} />
                  <IconButton
                    component="a"
                    href={getReportAttachmentFileUrl(attachment.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    aria-label={`打开凭据 ${filename}`}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                  {!disabled && (
                    <IconButton size="small" color="error" onClick={() => onDelete(attachment.id)} aria-label={`删除凭据 ${filename}`}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
