from __future__ import annotations

from pydantic import BaseModel, Field


class BackupRead(BaseModel):
    backup_id: str
    filename: str
    path: str
    size_bytes: int
    created_at: str
    reason: str = "manual"


class DiagnosticQrEngineRead(BaseModel):
    selected_engine: str
    selected_engine_label: str
    opencv_runtime_installed: bool = False
    opencv_package_version: str | None = None
    opencv_runtime_dir: str | None = None
    opencv_model_files_complete: bool = False
    opencv_model_files_missing: list[str] = Field(default_factory=list)


class DiagnosticBrowserRuntimeRead(BaseModel):
    webview2_available: bool = False
    chromium_available: bool = False
    chromium_name: str | None = None
    chromium_path: str | None = None
    preferred_runtime: str
    error: str | None = None


class DiagnosticLogFileRead(BaseModel):
    path: str
    exists: bool = False
    size_bytes: int = 0
    modified_at: str | None = None


class MaintenanceInfoRead(BaseModel):
    app_version: str
    app_root: str
    portable_install: bool = False
    current_version: str | None = None
    current_version_dir: str | None = None
    launcher_path: str | None = None
    data_dir: str
    database_path: str
    uploads_dir: str
    backups_dir: str
    logs_dir: str
    database_exists: bool
    uploads_exists: bool
    backups: list[BackupRead] = Field(default_factory=list)
    qr_engine: DiagnosticQrEngineRead | None = None
    browser_runtime: DiagnosticBrowserRuntimeRead | None = None
    log_file: DiagnosticLogFileRead | None = None


class BackupCreateRead(BaseModel):
    backup: BackupRead


class RestorePreviewRead(BaseModel):
    preview_id: str
    app_version: str | None = None
    created_at: str | None = None
    reason: str | None = None
    files_total: int = 0
    size_bytes: int = 0
    database_included: bool = False
    uploads_files: int = 0
    vendor_files: int = 0


class RestoreExecuteRequest(BaseModel):
    preview_id: str
    confirm_restore: bool = False


class RestoreExecuteRead(BaseModel):
    restored: bool
    pre_restore_backup: BackupRead
    database_restored: bool = False
    uploads_restored: bool = False
    vendor_restored: bool = False


class UpdatePreviewRead(BaseModel):
    preview_id: str
    app_version: str
    package_format: str
    files_total: int = 0
    size_bytes: int = 0
    version_dir: str
    executable_path: str


class UpdateExecuteRequest(BaseModel):
    preview_id: str
    confirm_update: bool = False


class UpdateExecuteRead(BaseModel):
    installed: bool
    app_version: str
    previous_version: str | None = None
    pre_update_backup: BackupRead
    restart_required: bool = True
    version_dir: str
