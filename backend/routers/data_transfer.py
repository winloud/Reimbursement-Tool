from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Path, UploadFile, status
from fastapi import Response
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.data_transfer import DataExportRequest, ImportExecuteRead, ImportExecuteRequest, ImportPreviewRead
from backend.schemas.report import ReportDownloadPreparationRead
from backend.services.data_transfer_service import build_export_zip, create_import_preview, execute_import
from backend.services.prepared_download_service import (
    PREPARED_DOWNLOAD_TTL_SECONDS,
    get_prepared_download,
    prepare_download,
)

router = APIRouter(prefix="/api/data", tags=["data"])


@router.post("/export")
def post_data_export(payload: DataExportRequest, db: Session = Depends(get_db)) -> Response:
    zip_bytes, filename = build_export_zip(db, payload)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/prepare", response_model=ApiResponse[ReportDownloadPreparationRead])
def post_prepare_data_export(
    payload: DataExportRequest,
    db: Session = Depends(get_db),
) -> ApiResponse[ReportDownloadPreparationRead]:
    zip_bytes, filename = build_export_zip(db, payload)
    token = prepare_download(zip_bytes, filename, "application/zip")
    return ApiResponse(
        data=ReportDownloadPreparationRead(
            download_url=f"/api/data/exports/{token}",
            filename=filename,
            expires_in_seconds=PREPARED_DOWNLOAD_TTL_SECONDS,
        ),
        message="数据包已生成，请选择保存位置",
    )


@router.get("/exports/{token}")
def get_prepared_data_export(
    token: Annotated[str, Path(min_length=20, max_length=200)],
) -> Response:
    prepared = get_prepared_download(token)
    if prepared is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="下载链接已失效，请重新生成")
    return Response(
        content=prepared.content,
        media_type=prepared.media_type,
        headers={"Content-Disposition": f'attachment; filename="{prepared.filename}"'},
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
