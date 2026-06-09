from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi import Response
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.data_transfer import DataExportRequest, ImportExecuteRead, ImportExecuteRequest, ImportPreviewRead
from backend.services.data_transfer_service import build_export_zip, create_import_preview, execute_import

router = APIRouter(prefix="/api/data", tags=["data"])


@router.post("/export")
def post_data_export(payload: DataExportRequest, db: Session = Depends(get_db)) -> Response:
    zip_bytes, filename = build_export_zip(db, payload)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import/preview", response_model=ApiResponse[ImportPreviewRead])
def post_data_import_preview(
    file: Annotated[UploadFile, File()],
    db: Session = Depends(get_db),
) -> ApiResponse[ImportPreviewRead]:
    return ApiResponse(data=create_import_preview(db, file), message="导入预览已生成")


@router.post("/import/execute", response_model=ApiResponse[ImportExecuteRead])
def post_data_import_execute(
    payload: ImportExecuteRequest,
    db: Session = Depends(get_db),
) -> ApiResponse[ImportExecuteRead]:
    return ApiResponse(data=execute_import(db, payload), message="导入完成")
