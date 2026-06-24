from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.maintenance import (
    BackupCreateRead,
    BackupRead,
    DatabaseIntegrityCheckRead,
    MaintenanceInfoRead,
    RestartRead,
    RestoreDialogPreviewRead,
    RestoreExecuteRead,
    RestoreExecuteRequest,
    RestorePreviewRead,
    UpdateExecuteRead,
    UpdateExecuteRequest,
    UpdatePreviewRead,
    VersionSwitchRead,
    VersionSwitchRequest,
)
from backend.services.maintenance_service import (
    build_diagnostics_package,
    check_database_integrity,
    create_backup,
    create_restore_preview,
    create_restore_preview_from_backup_dialog,
    create_update_preview,
    execute_restore,
    execute_update,
    get_backup_file,
    get_maintenance_info,
    list_backups,
    request_application_restart,
    switch_installed_version,
)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


@router.get("/info", response_model=ApiResponse[MaintenanceInfoRead])
def get_info(db: Session = Depends(get_db)) -> ApiResponse[MaintenanceInfoRead]:
    return ApiResponse(data=get_maintenance_info(db))


@router.get("/database-check", response_model=ApiResponse[DatabaseIntegrityCheckRead])
def get_database_check(db: Session = Depends(get_db)) -> ApiResponse[DatabaseIntegrityCheckRead]:
    return ApiResponse(data=check_database_integrity(db), message="数据库检查已完成")


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


@router.post("/restore/dialog-preview", response_model=ApiResponse[RestoreDialogPreviewRead])
def post_restore_dialog_preview() -> ApiResponse[RestoreDialogPreviewRead]:
    result = create_restore_preview_from_backup_dialog()
    message = "恢复预览已生成" if result.selected else "已取消选择备份"
    return ApiResponse(data=result, message=message)


@router.post("/restore/execute", response_model=ApiResponse[RestoreExecuteRead])
def post_restore_execute(payload: RestoreExecuteRequest) -> ApiResponse[RestoreExecuteRead]:
    return ApiResponse(data=execute_restore(payload.preview_id, payload.confirm_restore), message="恢复完成")


@router.post("/updates/preview", response_model=ApiResponse[UpdatePreviewRead])
def post_update_preview(file: Annotated[UploadFile, File()]) -> ApiResponse[UpdatePreviewRead]:
    return ApiResponse(data=create_update_preview(file), message="更新包预览已生成")


@router.post("/updates/execute", response_model=ApiResponse[UpdateExecuteRead])
def post_update_execute(payload: UpdateExecuteRequest) -> ApiResponse[UpdateExecuteRead]:
    return ApiResponse(data=execute_update(payload.preview_id, payload.confirm_update), message="更新已安装，重启后生效")


@router.post("/versions/switch", response_model=ApiResponse[VersionSwitchRead])
def post_version_switch(payload: VersionSwitchRequest) -> ApiResponse[VersionSwitchRead]:
    return ApiResponse(data=switch_installed_version(payload.version, payload.confirm_switch), message="版本已切换，重启后生效")


@router.post("/restart", response_model=ApiResponse[RestartRead])
def post_restart() -> ApiResponse[RestartRead]:
    return ApiResponse(data=request_application_restart(), message="正在重启程序")


@router.get("/diagnostics")
def get_diagnostics(db: Session = Depends(get_db)) -> Response:
    payload, filename = build_diagnostics_package(db)
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
