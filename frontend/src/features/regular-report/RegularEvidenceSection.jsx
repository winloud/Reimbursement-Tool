import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

import { getReportAttachmentFileUrl } from "../../api/client";
import FileUploadPlaceholder from "../../components/FileUploadPlaceholder";
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
  return (
    <>
      {attachments.length === 0 && disabled ? (
        <Typography variant="body2" color="text.secondary">
          暂无报销凭据
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 0.5, alignItems: "stretch" }}>
          {attachments.map((attachment) => {
            const filename = attachment.original_filename || attachment.file_name || "未命名凭据";
            const pageCount = Math.max(1, Number(attachment.page_count || 1));
            return (
              <Paper key={attachment.id} variant="outlined" sx={{ minHeight: 54, height: "100%", px: 1, py: 0.5, bgcolor: "#F8FAFC" }}>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, minHeight: "100%" }}>
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
          {!disabled && (
            <FileUploadPlaceholder
              accept={ACCEPTED_EVIDENCE}
              ariaLabel="报销凭据上传区，可拖放、粘贴或选择 PDF 和图片"
              uploading={uploading}
              hint="添加报销凭据"
              uploadingText="正在上传凭据"
              selectedText="已选中凭据上传区域"
              dragText="松开即可上传凭据"
              idleDetail="可选；拖入、Ctrl+V 或选择 PDF / 图片"
              selectedDetail="按 Ctrl+V 粘贴凭据，或选择文件"
              dragDetail="当前报销项目已锁定为上传目标"
              getClipboardFiles={getClipboardReportAttachmentFiles}
              getClipboardFilename={getClipboardReportAttachmentFilename}
              pasteErrorMessage="剪贴板中没有可上传的 PDF 或图片凭据"
              onFiles={onFiles}
              onPasteError={onError}
            />
          )}
        </Box>
      )}
    </>
  );
}
