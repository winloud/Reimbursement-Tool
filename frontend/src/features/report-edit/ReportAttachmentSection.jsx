import { Chip, Typography } from "@mui/material";

import AttachmentCardList from "../report-edit-shared/AttachmentCardList";
import BlockCard from "../report-edit-shared/BlockCard";
import FileDropSlot from "../report-edit-shared/FileDropSlot";
import {
  sectionAnchorSx,
} from "../report-edit-shared/editPageStyles";

export default function ReportAttachmentSection({
  attachments = [],
  readonly,
  uploading,
  onFiles,
  onDelete,
  onUploadError,
}) {
  return (
    <BlockCard
      id="report-attachment-section"
      title="非发票附件"
      sx={sectionAnchorSx}
      summary={
        <>
          <Chip size="small" label={`${attachments.length} 个`} />
          <Typography component="span" variant="body2" color="text.secondary">
            不计入发票数量，导出时排在全部发票之后。
          </Typography>
        </>
      }
      bodySx={{ p: { xs: 2, md: 2.5 } }}
    >
      <AttachmentCardList
        attachments={attachments}
        title="已上传附件"
        countUnit="个"
        emptyText="暂无非发票附件"
        readonly={readonly}
        uploadSlot={
          <FileDropSlot
            kind="attachment"
            hint="添加 PDF 或图片附件"
            uploading={uploading}
            onFiles={onFiles}
            onPasteError={onUploadError}
          />
        }
        onDelete={onDelete}
      />
    </BlockCard>
  );
}
