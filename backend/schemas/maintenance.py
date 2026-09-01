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


class DataCompatibilityRead(BaseModel):
    status: Literal["compatible", "incompatible", "unknown"]
    current_data_schema_version: int | None = None
    target_data_schema_version: int | None = None
    min_supported_data_schema_version: int | None = None
    max_supported_data_schema_version: int | None = None
    message: str


class InstalledVersionRead(BaseModel):
    version: str
    version_dir: str
    executable_path: str
    executable_exists: bool = False
    current: bool = False
    modified_at: str | None = None
    data_compatibility: DataCompatibilityRead | None = None


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


class UpdateStagingPackageRead(BaseModel):
    preview_id: str
    app_version: str | None = None
    size_bytes: int = 0
    modified_at: str | None = None
    valid: bool = False
    expired: bool = False


class UpdateStagingInfoRead(BaseModel):
    retention_days: int = 7
    total_count: int = 0
    total_size_bytes: int = 0
    packages: list[UpdateStagingPackageRead] = Field(default_factory=list)


class MaintenanceInfoRead(BaseModel):
    app_version: str
    app_root: str
    portable_install: bool = False
    current_version: str | None = None
    current_version_dir: str | None = None
    launcher_path: str | None = None
    installed_versions: list[InstalledVersionRead] = Field(default_factory=list)
    data_dir: str
    database_path: str
    uploads_dir: str
    backups_dir: str
    logs_dir: str
    database_exists: bool
    uploads_exists: bool
    backups: list[BackupRead] = Field(default_factory=list)
    update_staging: UpdateStagingInfoRead = Field(default_factory=UpdateStagingInfoRead)
    qr_engine: DiagnosticQrEngineRead | None = None
    browser_runtime: DiagnosticBrowserRuntimeRead | None = None
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


class RestartRead(BaseModel):
    restart_scheduled: bool
    launcher_path: str


class VersionSwitchRequest(BaseModel):
    version: str
    confirm_switch: bool = False


class VersionSwitchRead(BaseModel):
    switched: bool
    app_version: str
    previous_version: str | None = None
    pre_switch_backup: BackupRead | None = None
    restart_required: bool = True
    version_dir: str
    data_compatibility: DataCompatibilityRead


class VersionDeleteRequest(BaseModel):
    confirm_delete: bool = False


class VersionDeleteRead(BaseModel):
    deleted: bool
    version: str
    deleted_path: str


class VersionCleanupRequest(BaseModel):
    confirm_cleanup: bool = False


class VersionCleanupRead(BaseModel):
    deleted_versions: list[VersionDeleteRead] = Field(default_factory=list)


class UpdateStagingCleanupRequest(BaseModel):
    preview_ids: list[str] = Field(default_factory=list)
    confirm_cleanup: bool = False


class UpdateStagingDeleteRead(BaseModel):
    deleted: bool
    preview_id: str
    deleted_path: str


class UpdateStagingCleanupFailureRead(BaseModel):
    preview_id: str
    message: str


class UpdateStagingCleanupRead(BaseModel):
    deleted_packages: list[UpdateStagingDeleteRead] = Field(default_factory=list)
    failed_packages: list[UpdateStagingCleanupFailureRead] = Field(default_factory=list)


class UpdatePreviewRead(BaseModel):
    preview_id: str
    app_version: str
    package_format: str
    files_total: int = 0
    size_bytes: int = 0
    version_dir: str
    executable_path: str
    data_compatibility: DataCompatibilityRead


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
    data_compatibility: DataCompatibilityRead
