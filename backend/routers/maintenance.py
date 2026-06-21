from typing import Annotated

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse, Response

from backend.schemas.common import ApiResponse
from backend.schemas.maintenance import (
    BackupCreateRead,
    BackupRead,
    MaintenanceInfoRead,
    RestoreExecuteRead,
    RestoreExecuteRequest,
    RestorePreviewRead,
    UpdateExecuteRead,
    UpdateExecuteRequest,
    UpdatePreviewRead,
)
from backend.services.maintenance_service import (
    build_diagnostics_json,
    create_backup,
    create_restore_preview,
    create_update_preview,
    execute_restore,
    execute_update,
    get_backup_file,
    get_maintenance_info,
    list_backups,
)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


@router.get("/info", response_model=ApiResponse[MaintenanceInfoRead])
def get_info() -> ApiResponse[MaintenanceInfoRead]:
    return ApiResponse(data=get_maintenance_info())


@router.get("/backups", response_model=ApiResponse[list[BackupRead]])
def get_backups() -> ApiResponse[list[BackupRead]]:
    return ApiResponse(data=list_backups())


@router.post("/backups", response_model=ApiResponse[BackupCreateRead])
def post_backup() -> ApiResponse[BackupCreateRead]:
    return ApiResponse(data=BackupCreateRead(backup=create_backup(reason="manual")), message="备份已创建")


@router.get("/backups/{backup_id}/download")
def download_backup(backup_id: str) -> FileResponse:
    path = get_backup_file(backup_id)
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.post("/restore/preview", response_model=ApiResponse[RestorePreviewRead])
def post_restore_preview(file: Annotated[UploadFile, File()]) -> ApiResponse[RestorePreviewRead]:
    return ApiResponse(data=create_restore_preview(file), message="恢复预览已生成")


@router.post("/restore/execute", response_model=ApiResponse[RestoreExecuteRead])
def post_restore_execute(payload: RestoreExecuteRequest) -> ApiResponse[RestoreExecuteRead]:
    return ApiResponse(data=execute_restore(payload.preview_id, payload.confirm_restore), message="恢复完成")


@router.post("/updates/preview", response_model=ApiResponse[UpdatePreviewRead])
def post_update_preview(file: Annotated[UploadFile, File()]) -> ApiResponse[UpdatePreviewRead]:
    return ApiResponse(data=create_update_preview(file), message="更新包预览已生成")


@router.post("/updates/execute", response_model=ApiResponse[UpdateExecuteRead])
def post_update_execute(payload: UpdateExecuteRequest) -> ApiResponse[UpdateExecuteRead]:
    return ApiResponse(data=execute_update(payload.preview_id, payload.confirm_update), message="更新已安装，重启后生效")


@router.get("/diagnostics")
def get_diagnostics() -> Response:
    payload, filename = build_diagnostics_json()
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
