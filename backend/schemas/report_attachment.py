from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


ReportAttachmentFileType = Literal["pdf", "image"]


class ReportAttachmentRead(BaseModel):
    id: int
    report_id: int
    original_filename: str
    file_type: ReportAttachmentFileType
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
