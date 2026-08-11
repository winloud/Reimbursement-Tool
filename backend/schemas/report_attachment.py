from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


ReportAttachmentFileType = Literal["pdf", "image"]


class ReportAttachmentRead(BaseModel):
    id: int
    report_id: int
    regular_item_id: int | None = None
    original_filename: str
    file_type: ReportAttachmentFileType
    page_count: int = 1
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
