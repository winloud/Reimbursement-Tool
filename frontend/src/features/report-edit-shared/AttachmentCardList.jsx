import { IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";

import { getReportAttachmentFileUrl } from "../../api/client";
import FileListShell from "./FileListShell";
import { fileCardSx } from "./editPageStyles";

const getAttachmentName = (attachment) =>
  attachment.original_filename || attachment.file_name || "未命名文件";

const getTypeLabel = (attachment) => (attachment.file_type === "pdf" ? "PDF" : "图片");

const getPageLabel = (attachment) => `${Math.max(1, Number(attachment.page_count || 1))} 页`;

// 已上传附件/凭据的统一卡片列表，与 InvoiceCardList 逐行对齐：
// 第一行「主值 + 类型」，第二行「次要信息 + 操作」。
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
      {attachments.map((attachment) => {
        const filename = getAttachmentName(attachment);

        return (
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
                  <Tooltip title="在新标签页打开">
                    <IconButton
                      component="a"
                      href={getReportAttachmentFileUrl(attachment.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      aria-label={`打开 ${filename}`}
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
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
        );
      })}
    </FileListShell>
  );
}
