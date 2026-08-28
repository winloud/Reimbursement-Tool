from __future__ import annotations

from typing import Literal

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


class DiagnosticLogFileRead(BaseModel):
    path: str
    exists: bool = False
    size_bytes: int = 0
    modified_at: str | None = None


class DatabaseIntegrityIssueRead(BaseModel):
    severity: Literal["warning", "error"]
    category: str
    code: str
    message: str
    count: int = 0
    details: list[str] = Field(default_factory=list)


class DatabaseIntegrityCheckRead(BaseModel):
    status: Literal["ok", "warning", "error"]
    checked_at: str
    elapsed_ms: int
    database_path: str
    database_exists: bool
    database_size_bytes: int = 0
    sqlite_integrity: str | None = None
    foreign_key_issues: int = 0
    tables: dict[str, int] = Field(default_factory=dict)
    issues: list[DatabaseIntegrityIssueRead] = Field(default_factory=list)


class MaintenanceInfoRead(BaseModel):
    app_version: str
    app_root: str
    data_dir: str
    database_path: str
    uploads_dir: str
    backups_dir: str
    logs_dir: str
    database_exists: bool
    uploads_exists: bool
    backups: list[BackupRead] = Field(default_factory=list)
    qr_engine: DiagnosticQrEngineRead | None = None
    log_file: DiagnosticLogFileRead | None = None


class BackupCreateRead(BaseModel):
    backup: BackupRead


class BackupDeleteRequest(BaseModel):
    confirm_delete: bool = False


class BackupDeleteRead(BaseModel):
    deleted: bool
    backup_id: str
    deleted_path: str


class BackupCleanupRequest(BaseModel):
    confirm_cleanup: bool = False


class BackupCleanupRead(BaseModel):
    deleted_backups: list[BackupDeleteRead] = Field(default_factory=list)
    kept_backup_id: str | None = None


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


class RestoreDialogPreviewRead(BaseModel):
    selected: bool = False
    filename: str | None = None
    preview: RestorePreviewRead | None = None


class RestoreExecuteRequest(BaseModel):
    preview_id: str
    confirm_restore: bool = False


class RestoreExecuteRead(BaseModel):
    restored: bool
    pre_restore_backup: BackupRead
    database_restored: bool = False
    uploads_restored: bool = False
    vendor_restored: bool = False
