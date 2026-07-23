from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Path, Query, UploadFile
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.ticket import RailTicketImportRequest, RailTicketImportResult, RailTicketPreview
from backend.services.ticket_service import create_ticket_preview, discard_ticket_preview, import_ticket_preview

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.post("/preview", response_model=ApiResponse[RailTicketPreview])
def post_ticket_preview(
    report_id: Annotated[int, Form(ge=1)],
    files: Annotated[list[UploadFile], File()],
    db: Session = Depends(get_db),
) -> ApiResponse[RailTicketPreview]:
    return ApiResponse(data=create_ticket_preview(db, report_id, files), message="车票解析完成，请确认行程分组")


@router.post("/import/{report_id}", response_model=ApiResponse[RailTicketImportResult])
def post_ticket_import(
    report_id: Annotated[int, Path(ge=1)],
    payload: RailTicketImportRequest,
    db: Session = Depends(get_db),
) -> ApiResponse[RailTicketImportResult]:
    result = import_ticket_preview(db, report_id, payload)
    return ApiResponse(data=result, message=f"已生成 {len(result.trip_ids)} 段行程并关联 {len(result.invoice_ids)} 张车票")


@router.delete("/preview/{token}", response_model=ApiResponse[None])
def delete_ticket_preview(
    token: Annotated[str, Path(min_length=1)],
    report_id: Annotated[int, Query(ge=1)],
) -> ApiResponse[None]:
    discard_ticket_preview(token, report_id)
    return ApiResponse(message="车票导入预览已取消")
