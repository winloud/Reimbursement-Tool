from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.report_attachment import ReportAttachmentRead
from backend.services.report_attachment_service import (
    get_report_attachment_or_404,
    report_attachment_path,
    soft_delete_report_attachment,
    upload_report_attachment,
)

router = APIRouter(prefix="/api/report-attachments", tags=["report-attachments"])


@router.post("/upload", response_model=ApiResponse[ReportAttachmentRead])
def post_report_attachment_upload(
    report_id: Annotated[int, Form(ge=1)],
    file: Annotated[UploadFile, File()],
    regular_item_id: Annotated[int | None, Form(ge=1)] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[ReportAttachmentRead]:
    return ApiResponse(
        data=upload_report_attachment(db, report_id, file, regular_item_id=regular_item_id),
        message="非发票附件已上传",
    )


@router.get("/{attachment_id}/file")
def get_report_attachment_file(
    attachment_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> FileResponse:
    attachment = get_report_attachment_or_404(db, attachment_id)
    path = report_attachment_path(attachment.file_path, require_exists=True)
    media_type = "application/pdf" if attachment.file_type == "pdf" else None
    return FileResponse(path, media_type=media_type)


@router.delete("/{attachment_id}", response_model=ApiResponse[None])
def delete_report_attachment(
    attachment_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[None]:
    soft_delete_report_attachment(db, attachment_id)
    return ApiResponse(message="非发票附件已删除")
