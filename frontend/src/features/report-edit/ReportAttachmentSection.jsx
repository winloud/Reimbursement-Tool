import { Card, CardContent, Chip, Stack } from "@mui/material";

import AttachmentCardList from "../report-edit-shared/AttachmentCardList";
import FileDropSlot from "../report-edit-shared/FileDropSlot";
import SectionHeader from "../report-edit-shared/SectionHeader";
import {
  sectionAnchorSx,
  sectionCardContentSx,
  workCardSx,
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
    <Stack id="report-attachment-section" spacing={1.5} sx={sectionAnchorSx}>
      <SectionHeader
        title="非发票附件"
        chip={<Chip size="small" label={`${attachments.length} 个`} />}
        description="不计入发票数量，导出时排在全部发票之后。"
      />
      <Card sx={workCardSx}>
        <CardContent sx={sectionCardContentSx}>
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
        </CardContent>
      </Card>
    </Stack>
  );
}
