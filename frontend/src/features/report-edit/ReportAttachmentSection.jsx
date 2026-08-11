import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteIcon from "@mui/icons-material/Delete";
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

const ATTACHMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.bmp,.gif,.webp,application/pdf,image/jpeg,image/png,image/bmp,image/gif,image/webp";

export default function ReportAttachmentSection({
  attachments = [],
  readonly,
  uploading,
  onFiles,
  onDelete,
  onUploadError,
}) {
  return (
    <Stack
      id="report-attachment-section"
      spacing={1.5}
      sx={{ scrollMarginTop: { xs: 24, lg: 80 } }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="h6" fontWeight={800}>
            非发票附件
          </Typography>
          <Chip size="small" label={`${attachments.length} 个`} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          不计入发票数量，导出时排在全部发票之后。
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 1.5, md: 2 } }}>
        {attachments.length === 0 && readonly ? (
          <Typography variant="body2" color="text.secondary">
            暂无非发票附件
          </Typography>
        ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                gap: 0.75,
                alignItems: "stretch",
              }}
            >
              {attachments.map((attachment) => {
                const filename = attachment.original_filename || attachment.file_name || "未命名附件";
                const typeLabel = attachment.file_type === "pdf" ? "PDF" : "图片";
                return (
                  <Paper key={attachment.id} variant="outlined" sx={{ minHeight: 54, height: "100%", px: 1, py: 0.625, borderRadius: 1, bgcolor: "#F8FAFC" }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, minHeight: "100%" }}>
                      <AttachFileIcon fontSize="small" color="action" />
                      <Tooltip title={filename}>
                        <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0, flex: 1 }}>
                          {filename}
                        </Typography>
                      </Tooltip>
                      <Chip size="small" variant="outlined" label={typeLabel} />
                      <Tooltip title="打开附件">
                        <IconButton
                          component="a"
                          href={getReportAttachmentFileUrl(attachment.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          size="small"
                          aria-label={`打开附件 ${filename}`}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {!readonly && (
                        <Tooltip title="删除附件">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={`删除附件 ${filename}`}
                            onClick={() => onDelete(attachment.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
              {!readonly && (
                <FileUploadPlaceholder
                  accept={ATTACHMENT_ACCEPT}
                  ariaLabel="非发票附件上传区，可拖放、粘贴或选择文件"
                  uploading={uploading}
                  hint="添加 PDF 或图片附件"
                  uploadingText="正在上传附件"
                  selectedText="已选中附件上传区域"
                  dragText="松开即可上传到这里"
                  idleDetail="拖入、Ctrl+V 或选择 PDF / 图片"
                  selectedDetail="按 Ctrl+V 粘贴附件，或选择文件"
                  dragDetail="非发票附件已锁定为上传目标"
                  getClipboardFiles={getClipboardReportAttachmentFiles}
                  getClipboardFilename={getClipboardReportAttachmentFilename}
                  pasteErrorMessage="剪贴板中没有可上传的 PDF 或图片附件"
                  onFiles={onFiles}
                  onPasteError={onUploadError}
                />
              )}
            </Box>
        )}
      </Paper>
    </Stack>
  );
}
