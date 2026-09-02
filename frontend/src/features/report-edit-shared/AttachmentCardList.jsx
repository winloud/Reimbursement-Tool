import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";

import { capabilities, openProtectedResource } from "../../platform/index.js";
import FileListShell from "./FileListShell";
import { fileCardSx } from "./editPageStyles";

const getAttachmentName = (attachment) =>
  attachment.original_filename || attachment.file_name || "未命名文件";

const getTypeLabel = (attachment) => (attachment.file_type === "pdf" ? "PDF" : "图片");

const getPageLabel = (attachment) => `${Math.max(1, Number(attachment.page_count || 1))} 页`;

// 单个附件卡片：Tauri 用鉴权 blob 在应用内预览；浏览器继续用新标签页打开。
function AttachmentCard({ attachment, readonly, onDelete }) {
  const filename = getAttachmentName(attachment);
  const [fileUrl, setFileUrl] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const inAppPreview = capabilities.inAppProtectedResourcePreview;

  useEffect(() => {
    let revoked = false;
    let createdUrl = "";
    openProtectedResource(`/api/report-attachments/${encodeURIComponent(attachment.id)}/file`)
      .then((url) => {
        if (!revoked) {
          createdUrl = url;
          setFileUrl(url);
        }
      })
      .catch(() => {
        if (!revoked) setFileUrl("");
      });
    return () => {
      revoked = true;
      if (createdUrl.startsWith("blob:")) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.id]);

  return (
    <>
      <Paper key={attachment.id} variant="outlined" sx={{ ...fileCardSx, borderLeftColor: "divider" }}>
        <Stack spacing={0.125} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
            <Tooltip title={filename}>
              <Typography
                variant="body2"
                fontWeight={800}
                noWrap
                sx={{ lineHeight: 1.2, minWidth: 0, maxWidth: "100%" }}
              >
                {filename}
              </Typography>
            </Tooltip>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.2, fontWeight: 700 }}>
              {getTypeLabel(attachment)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.25} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {getPageLabel(attachment)}
            </Typography>
            <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }}>
              <Tooltip title={inAppPreview ? "预览" : "在新标签页打开"}>
                <span>
                  {inAppPreview ? (
                    <IconButton
                      size="small"
                      aria-label={`预览 ${filename}`}
                      disabled={!fileUrl}
                      onClick={() => setPreviewOpen(true)}
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  ) : (
                    <IconButton
                      component="a"
                      href={fileUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      aria-label={`打开 ${filename}`}
                      disabled={!fileUrl}
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  )}
                </span>
              </Tooltip>
              <Tooltip title="删除文件">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={`删除 ${filename}`}
                    disabled={readonly}
                    onClick={() => onDelete(attachment.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        </Stack>
      </Paper>
      {inAppPreview && (
        <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} fullWidth maxWidth="lg">
          <DialogTitle>{filename}</DialogTitle>
          <DialogContent dividers sx={{ bgcolor: "grey.50" }}>
            {attachment.file_type === "pdf" ? (
              <Box
                component="iframe"
                src={fileUrl}
                title={`预览 ${filename}`}
                sx={{ display: "block", width: "100%", height: "72vh", border: 0, bgcolor: "common.white" }}
              />
            ) : (
              <Box
                component="img"
                src={fileUrl}
                alt={filename}
                sx={{ display: "block", maxWidth: "100%", maxHeight: "72vh", mx: "auto", objectFit: "contain" }}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPreviewOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

// 已上传附件/凭据的统一卡片列表，与 InvoiceCardList 逐行对齐。
export default function AttachmentCardList({
  attachments = [],
  title = "已上传附件",
  countUnit = "个",
  emptyText = "暂无附件",
  readonly,
  uploadSlot,
  onDelete,
}) {
  return (
    <FileListShell
      title={title}
      count={attachments.length}
      countUnit={countUnit}
      emptyText={emptyText}
      readonly={readonly}
      uploadSlot={uploadSlot}
    >
      {attachments.map((attachment) => (
        <AttachmentCard key={attachment.id} attachment={attachment} readonly={readonly} onDelete={onDelete} />
      ))}
    </FileListShell>
  );
}
