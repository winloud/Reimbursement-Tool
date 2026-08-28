from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import date, datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from time import perf_counter, time
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.app_metadata import APP_VERSION
from backend.database import connection as db_connection
from backend.data_schema import (
    DATA_SCHEMA_VERSION,
    MAX_SUPPORTED_DATA_SCHEMA_VERSION,
    MIN_SUPPORTED_DATA_SCHEMA_VERSION,
)
from backend.runtime_paths import APP_ROOT, DATA_DIR, DATABASE_PATH, LOG_DIR, UPLOAD_ROOT, uploaded_path
from backend.schemas.maintenance import (
    BackupCleanupRead,
    BackupRead,
    BackupDeleteRead,
    DatabaseIntegrityCheckRead,
    DatabaseIntegrityIssueRead,
    DiagnosticLogFileRead,
    DiagnosticQrEngineRead,
    MaintenanceInfoRead,
    RestoreDialogPreviewRead,
    RestoreExecuteRead,
    RestorePreviewRead,
)
from backend.schemas.report import REPORT_STATUS_VALUES
from backend.services.invoice_qr_runtime import (
    INVOICE_QR_ENGINE_OPENCV_WECHAT,
    INVOICE_QR_ENGINE_ZXING,
    OPENCV_RUNTIME_DIR,
    get_installed_opencv_runtime,
    normalize_invoice_qr_engine,
    wechat_model_paths,
)
from backend.services.settings_service import get_or_create_settings

BACKUP_SCHEMA_VERSION = 1
BACKUP_ROOT = DATA_DIR / "backups"
RESTORE_STAGING_ROOT = DATA_DIR / "restore_staging"
VENDOR_ROOT = APP_ROOT / "vendor"
MANIFEST_NAME = "backup-manifest.json"
LOG_TAIL_BYTES = 200 * 1024
logger = logging.getLogger(__name__)
VALID_REPORT_STATUSES = set(REPORT_STATUS_VALUES)
VALID_EXPENSE_CATEGORIES = {
    "transport_fare",
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    "fuel_subsidy",
}
VALID_INVOICE_CATEGORIES = VALID_EXPENSE_CATEGORIES | {"regular"}


def _utc_now() -> datetime:
    return datetime.utcnow()


def _timestamp() -> str:
    return _utc_now().strftime("%Y%m%d%H%M%S")


def _file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bytes_hash(payload: bytes) -> str:
    return sha256(payload).hexdigest()


def _safe_archive_name(name: str) -> str:
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"备份包包含非法路径：{name}")
    normalized = candidate.as_posix()
    if not normalized or normalized == ".":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备份包包含空路径")
    return normalized


def _safe_preview_id(preview_id: str) -> str:
    if not preview_id or any(part in preview_id for part in ("/", "\\", "..")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的预览 ID")
    return preview_id


def _read_json_file(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _manifest_int(manifest: dict | None, key: str) -> int | None:
    if not manifest:
        return None
    value = manifest.get(key)
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _current_data_schema_version() -> int | None:
    if not DATABASE_PATH.exists():
        return DATA_SCHEMA_VERSION
    try:
        connection = sqlite3.connect(DATABASE_PATH)
        try:
            row = connection.execute("PRAGMA user_version").fetchone()
        finally:
            connection.close()
    except sqlite3.Error:
        return None
    if not row:
        return None
    version = row[0]
    if isinstance(version, int) and version > 0:
        return version
    return None


def _current_app_manifest(version: str | None = None) -> dict:
    return {
        "app_version": version or APP_VERSION,
        "data_schema_version": DATA_SCHEMA_VERSION,
        "min_supported_data_schema_version": MIN_SUPPORTED_DATA_SCHEMA_VERSION,
        "max_supported_data_schema_version": MAX_SUPPORTED_DATA_SCHEMA_VERSION,
    }


def _path_inside(root: Path, *parts: str) -> Path:
    root_resolved = root.resolve()
    target = root_resolved.joinpath(*parts).resolve()
    if target != root_resolved and not target.is_relative_to(root_resolved):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"目标路径越界：{target}")
    return target


def _backup_path(backup_id: str) -> Path:
    if not backup_id.endswith(".zip") or any(part in backup_id for part in ("/", "\\", "..")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的备份 ID")
    return BACKUP_ROOT / backup_id


def _write_json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _read_log_tail() -> bytes | None:
    log_path = LOG_DIR / "app.log"
    if not log_path.exists() or not log_path.is_file():
        return None
    size = log_path.stat().st_size
    with log_path.open("rb") as source:
        if size > LOG_TAIL_BYTES:
            source.seek(-LOG_TAIL_BYTES, 2)
        return source.read()


def _iter_directory_files(root: Path, archive_prefix: str):
    if not root.exists() or not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file():
            yield path, f"{archive_prefix}/{path.relative_to(root).as_posix()}"


def _copy_sqlite_database(target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(DATABASE_PATH)
    try:
        target = sqlite3.connect(target_path)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()


def _zip_file_entry(archive: zipfile.ZipFile, source_path: Path, archive_path: str) -> dict:
    safe_path = _safe_archive_name(archive_path)
    archive.write(source_path, safe_path)
    return {
        "path": safe_path,
        "size_bytes": source_path.stat().st_size,
        "sha256": _file_hash(source_path),
    }


def _zip_bytes_entry(archive: zipfile.ZipFile, payload: bytes, archive_path: str) -> dict:
    safe_path = _safe_archive_name(archive_path)
    archive.writestr(safe_path, payload)
    return {
        "path": safe_path,
        "size_bytes": len(payload),
        "sha256": _bytes_hash(payload),
    }


def _read_manifest(archive: zipfile.ZipFile) -> dict:
    names = archive.namelist()
    for name in names:
        _safe_archive_name(name)
    if MANIFEST_NAME not in names:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备份包缺少 backup-manifest.json")
    try:
        manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="backup-manifest.json 格式无效") from exc
    if manifest.get("schema_version") != BACKUP_SCHEMA_VERSION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备份包版本不支持")
    return manifest


def _validate_manifest_files(archive: zipfile.ZipFile, manifest: dict) -> None:
    names = set(archive.namelist())
    for item in manifest.get("files", []):
        path = _safe_archive_name(item.get("path") or "")
        if path not in names:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"备份包缺少文件：{path}")
        payload = archive.read(path)
        if len(payload) != int(item.get("size_bytes") or 0):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"备份文件大小不一致：{path}")
        if _bytes_hash(payload) != item.get("sha256"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"备份文件 hash 不一致：{path}")


def _load_valid_backup(package_path: Path) -> tuple[dict, zipfile.ZipFile]:
    try:
        archive = zipfile.ZipFile(package_path)
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备份包不是有效 ZIP 文件") from exc
    try:
        manifest = _read_manifest(archive)
        _validate_manifest_files(archive, manifest)
    except Exception:
        archive.close()
        raise
    return manifest, archive


def _backup_read(path: Path) -> BackupRead:
    created_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat()
    reason = "manual"
    try:
        with zipfile.ZipFile(path) as archive:
            manifest = _read_manifest(archive)
            reason = str(manifest.get("reason") or reason)
            created_at = str(manifest.get("created_at") or created_at)
    except Exception:
        pass
    return BackupRead(
        backup_id=path.name,
        filename=path.name,
        path=path.as_posix(),
        size_bytes=path.stat().st_size,
        created_at=created_at,
        reason=reason,
    )


def list_backups() -> list[BackupRead]:
    if not BACKUP_ROOT.exists():
        return []
    backups = [_backup_read(path) for path in BACKUP_ROOT.glob("*.zip") if path.is_file()]
    return sorted(backups, key=lambda item: item.created_at, reverse=True)


def delete_backup(backup_id: str, confirm_delete: bool) -> BackupDeleteRead:
    if not confirm_delete:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="删除备份需要二次确认")
    path = get_backup_file(backup_id)
    deleted_path = path.as_posix()
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"删除备份失败：{exc}") from exc
    return BackupDeleteRead(deleted=True, backup_id=path.name, deleted_path=deleted_path)


def cleanup_old_backups(confirm_cleanup: bool) -> BackupCleanupRead:
    if not confirm_cleanup:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="清理旧备份需要二次确认")
    backups = list_backups()
    kept_backup_id = backups[0].backup_id if backups else None
    deleted_backups = [delete_backup(backup.backup_id, confirm_delete=True) for backup in backups[1:]]
    return BackupCleanupRead(deleted_backups=deleted_backups, kept_backup_id=kept_backup_id)


def _settings_payload(db: Session | None = None) -> dict:
    if db is None:
        return {"available": False, "reason": "database session unavailable"}
    settings = get_or_create_settings(db)
    return {
        "available": True,
        "department": settings.department,
        "employee_name": settings.employee_name,
        "daily_subsidy": str(settings.daily_subsidy),
        "pdf_fill_font_key": settings.pdf_fill_font_key,
        "double_print_vat_special_invoices": settings.double_print_vat_special_invoices,
        "invoice_qr_engine": settings.invoice_qr_engine,
        "autosave_delay_seconds": settings.autosave_delay_seconds,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


def _json_config_file_payload(path: Path) -> dict:
    payload: dict = {
        "path": path.as_posix(),
        "exists": path.is_file(),
    }
    if not path.is_file():
        return payload
    try:
        stat = path.stat()
        payload.update(
            {
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "content": json.loads(path.read_text(encoding="utf-8-sig")),
            }
        )
    except json.JSONDecodeError as exc:
        payload["error"] = f"invalid json: {exc}"
    except OSError as exc:
        payload["error"] = str(exc)
    return payload


def _runtime_config_payload() -> dict:
    # v2.0.0 起安装与版本切换由 Tauri/NSIS 负责，运行配置只剩窗口状态（见 ADR 0009）。
    return {
        "files": {
            "window-state.json": _json_config_file_payload(APP_ROOT / "window-state.json"),
        },
    }


def _selected_qr_engine(db: Session | None = None) -> str:
    if db is None:
        return INVOICE_QR_ENGINE_ZXING
    settings = get_or_create_settings(db)
    return normalize_invoice_qr_engine(settings.invoice_qr_engine)


def _qr_engine_label(engine: str) -> str:
    if engine == INVOICE_QR_ENGINE_OPENCV_WECHAT:
        return "OpenCV WeChatQRCode"
    return "zxing-cpp"


def get_qr_engine_diagnostics(db: Session | None = None) -> DiagnosticQrEngineRead:
    selected_engine = _selected_qr_engine(db)
    runtime_manifest = get_installed_opencv_runtime()
    model_paths = wechat_model_paths()
    missing_models = [relative for relative, path in model_paths.items() if not path.exists()]
    return DiagnosticQrEngineRead(
        selected_engine=selected_engine,
        selected_engine_label=_qr_engine_label(selected_engine),
        opencv_runtime_installed=runtime_manifest is not None,
        opencv_package_version=runtime_manifest.get("opencv_package_version") if runtime_manifest else None,
        opencv_runtime_dir=OPENCV_RUNTIME_DIR.as_posix(),
        opencv_model_files_complete=runtime_manifest is not None and not missing_models,
        opencv_model_files_missing=missing_models,
    )


def get_log_file_diagnostics() -> DiagnosticLogFileRead:
    log_path = LOG_DIR / "app.log"
    if not log_path.exists() or not log_path.is_file():
        return DiagnosticLogFileRead(path=log_path.as_posix(), exists=False)
    stat = log_path.stat()
    return DiagnosticLogFileRead(
        path=log_path.as_posix(),
        exists=True,
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
    )


def _database_issue(
    severity: str,
    category: str,
    code: str,
    message: str,
    *,
    count: int = 0,
    details: list[str] | None = None,
) -> DatabaseIntegrityIssueRead:
    return DatabaseIntegrityIssueRead(
        severity=severity,
        category=category,
        code=code,
        message=message,
        count=count,
        details=details or [],
    )


def _database_check_status(issues: list[DatabaseIntegrityIssueRead]) -> str:
    if any(issue.severity == "error" for issue in issues):
        return "error"
    if issues:
        return "warning"
    return "ok"


def _quote_identifier(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) + chr(34))}"'


def _open_readonly_database() -> sqlite3.Connection:
    connection = sqlite3.connect(f"{DATABASE_PATH.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }


def _table_counts(connection: sqlite3.Connection, tables: set[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in sorted(tables):
        counts[table] = int(connection.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table)}").fetchone()[0])
    return counts


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row["name"]) for row in connection.execute(f"PRAGMA table_info({_quote_identifier(table)})").fetchall()}


def _rows_issue(
    issues: list[DatabaseIntegrityIssueRead],
    rows: list[sqlite3.Row],
    *,
    severity: str,
    category: str,
    code: str,
    message: str,
    detail_builder,
) -> None:
    if not rows:
        return
    issues.append(
        _database_issue(
            severity,
            category,
            code,
            message,
            count=len(rows),
            details=[detail_builder(row) for row in rows[:20]],
        )
    )


def _sqlite_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _append_occupancy_candidate_checks(
    connection: sqlite3.Connection,
    tables: set[str],
    issues: list[DatabaseIntegrityIssueRead],
) -> None:
    if not {"expense_reports", "report_day_occupancies", "trips"}.issubset(tables):
        return

    report_columns = _table_columns(connection, "expense_reports")
    occupancy_columns = _table_columns(connection, "report_day_occupancies")
    trip_columns = _table_columns(connection, "trips")
    required_report_columns = {"id", "report_type", "report_date", "deleted_at"}
    required_occupancy_columns = {"id", "report_id", "occupied_on"}
    required_trip_columns = {
        "report_id",
        "sort_order",
        "depart_date",
        "depart_month",
        "depart_day",
        "depart_hour",
        "arrive_date",
        "arrive_month",
        "arrive_day",
        "arrive_hour",
        "subsidy_start",
        "subsidy_end",
    }
    if not (
        required_report_columns.issubset(report_columns)
        and required_occupancy_columns.issubset(occupancy_columns)
        and required_trip_columns.issubset(trip_columns)
    ):
        return

    occupancy_rows = connection.execute(
        """
        SELECT report_day_occupancies.id, report_day_occupancies.report_id,
               report_day_occupancies.occupied_on, expense_reports.report_date
        FROM report_day_occupancies
        JOIN expense_reports ON expense_reports.id = report_day_occupancies.report_id
        WHERE expense_reports.report_type = 'travel'
          AND expense_reports.deleted_at IS NULL
        ORDER BY report_day_occupancies.report_id, report_day_occupancies.occupied_on
        """
    ).fetchall()
    if not occupancy_rows:
        return

    report_ids = sorted({int(row["report_id"]) for row in occupancy_rows})
    placeholders = ", ".join("?" for _report_id in report_ids)
    trip_rows = connection.execute(
        f"""
        SELECT report_id, sort_order,
               depart_date, depart_month, depart_day, depart_hour,
               arrive_date, arrive_month, arrive_day, arrive_hour,
               subsidy_start, subsidy_end
        FROM trips
        WHERE report_id IN ({placeholders})
        ORDER BY report_id, sort_order
        """,
        report_ids,
    ).fetchall()
    trips_by_report: dict[int, list[SimpleNamespace]] = {report_id: [] for report_id in report_ids}
    for row in trip_rows:
        trips_by_report[int(row["report_id"])].append(
            SimpleNamespace(
                sort_order=row["sort_order"],
                depart_date=_sqlite_date(row["depart_date"]),
                depart_month=row["depart_month"],
                depart_day=row["depart_day"],
                depart_hour=row["depart_hour"],
                arrive_date=_sqlite_date(row["arrive_date"]),
                arrive_month=row["arrive_month"],
                arrive_day=row["arrive_day"],
                arrive_hour=row["arrive_hour"],
                subsidy_start=bool(row["subsidy_start"]),
                subsidy_end=bool(row["subsidy_end"]),
            )
        )

    # 延迟导入避免 maintenance_service 与 report_service 的模块级循环依赖。
    from backend.services.report_service import TripDateError, calculate_report_candidate_dates

    candidate_dates_by_report: dict[int, set[date] | None] = {}
    invalid_details: list[str] = []
    for row in occupancy_rows:
        report_id = int(row["report_id"])
        if report_id not in candidate_dates_by_report:
            report = SimpleNamespace(
                report_type="travel",
                report_date=_sqlite_date(row["report_date"]),
                trips=trips_by_report.get(report_id, []),
            )
            try:
                candidate_dates_by_report[report_id] = set(calculate_report_candidate_dates(report))
            except (TripDateError, TypeError, ValueError):
                # 无效历史行程无法可靠推导候选日期，这里不产生额外误报。
                candidate_dates_by_report[report_id] = None

        candidate_dates = candidate_dates_by_report[report_id]
        occupied_on = _sqlite_date(row["occupied_on"])
        if candidate_dates is not None and (occupied_on is None or occupied_on not in candidate_dates):
            invalid_details.append(
                f"occupancy_id={row['id']}, report_id={report_id}, occupied_on={row['occupied_on']}"
            )

    if invalid_details:
        issues.append(
            _database_issue(
                "error",
                "business",
                "occupancy_date_outside_candidate_range",
                "日期占用不属于所属报销单的候选补贴日期",
                count=len(invalid_details),
                details=invalid_details[:20],
            )
        )


def _append_duplicate_uid_checks(
    connection: sqlite3.Connection,
    tables: set[str],
    issues: list[DatabaseIntegrityIssueRead],
) -> None:
    if "expense_reports" in tables:
        rows = connection.execute(
            """
            SELECT report_uid, COUNT(*) AS duplicate_count
            FROM expense_reports
            WHERE report_uid IS NOT NULL AND TRIM(report_uid) <> ''
            GROUP BY report_uid
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="duplicate_report_uid",
            message="存在重复报销单 UID",
            detail_builder=lambda row: f"{row['report_uid']} ({row['duplicate_count']} 条)",
        )
    if "invoices" in tables:
        rows = connection.execute(
            """
            SELECT invoice_uid, COUNT(*) AS duplicate_count
            FROM invoices
            WHERE invoice_uid IS NOT NULL AND TRIM(invoice_uid) <> ''
            GROUP BY invoice_uid
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="duplicate_invoice_uid",
            message="存在重复发票 UID",
            detail_builder=lambda row: f"{row['invoice_uid']} ({row['duplicate_count']} 条)",
        )
    if "report_attachments" in tables:
        rows = connection.execute(
            """
            SELECT attachment_uid, COUNT(*) AS duplicate_count
            FROM report_attachments
            WHERE attachment_uid IS NOT NULL AND TRIM(attachment_uid) <> ''
            GROUP BY attachment_uid
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="duplicate_report_attachment_uid",
            message="存在重复非发票附件 UID",
            detail_builder=lambda row: f"{row['attachment_uid']} ({row['duplicate_count']} 条)",
        )


def _append_business_integrity_checks(
    connection: sqlite3.Connection,
    tables: set[str],
    issues: list[DatabaseIntegrityIssueRead],
) -> None:
    _append_duplicate_uid_checks(connection, tables, issues)

    if "expense_reports" in tables:
        placeholders = ", ".join("?" for _item in REPORT_STATUS_VALUES)
        rows = connection.execute(
            f"SELECT id, status FROM expense_reports WHERE status NOT IN ({placeholders})",
            REPORT_STATUS_VALUES,
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="invalid_report_status",
            message="存在无效报销单状态",
            detail_builder=lambda row: f"report_id={row['id']}, status={row['status']}",
        )

        report_columns = _table_columns(connection, "expense_reports")
        if {"report_type", "regular_mode"}.issubset(report_columns):
            rows = connection.execute(
                """
                SELECT id, report_type, regular_mode
                FROM expense_reports
                WHERE report_type NOT IN ('travel', 'regular')
                   OR report_type IS NULL
                   OR (report_type = 'travel' AND regular_mode IS NOT NULL)
                   OR (report_type = 'regular' AND (regular_mode IS NULL OR regular_mode NOT IN ('no_invoice', 'invoice')))
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="invalid_report_kind",
                message="存在无效的报销单类型或常规报销模式",
                detail_builder=lambda row: (
                    f"report_id={row['id']}, report_type={row['report_type']}, regular_mode={row['regular_mode']}"
                ),
            )

            regular_travel_field_conditions: list[str] = []
            for column in ("department", "purpose"):
                if column in report_columns:
                    regular_travel_field_conditions.append(
                        f"NULLIF(TRIM(COALESCE({_quote_identifier(column)}, '')), '') IS NOT NULL"
                    )
            for column in (
                "daily_subsidy",
                "subsidy_days",
                "subsidy_total",
                "advance_amount",
                "shortfall",
                "surplus",
            ):
                if column in report_columns:
                    regular_travel_field_conditions.append(f"COALESCE({_quote_identifier(column)}, 0) != 0")
            for column in ("manual_subsidy_total", "advance_date_month", "advance_date_day"):
                if column in report_columns:
                    regular_travel_field_conditions.append(f"{_quote_identifier(column)} IS NOT NULL")
            if regular_travel_field_conditions:
                rows = connection.execute(
                    "SELECT id FROM expense_reports "
                    "WHERE report_type = 'regular' AND ("
                    + " OR ".join(regular_travel_field_conditions)
                    + ")"
                ).fetchall()
                _rows_issue(
                    issues,
                    rows,
                    severity="error",
                    category="business",
                    code="regular_report_has_travel_fields",
                    message="常规报销单包含部门、出差事由、补贴、预支或补领归还等差旅字段",
                    detail_builder=lambda row: f"report_id={row['id']}",
                )

    if {"report_day_occupancies", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT report_day_occupancies.id, report_day_occupancies.report_id
            FROM report_day_occupancies
            LEFT JOIN expense_reports ON expense_reports.id = report_day_occupancies.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_report_day_occupancy",
            message="存在无所属报销单的日期占用",
            detail_builder=lambda row: f"occupancy_id={row['id']}, report_id={row['report_id']}",
        )

        report_columns = _table_columns(connection, "expense_reports")
        if {"report_type", "deleted_at", "employee_name"}.issubset(report_columns):
            rows = connection.execute(
                """
                SELECT report_day_occupancies.id, report_day_occupancies.report_id,
                       expense_reports.report_type, expense_reports.deleted_at
                FROM report_day_occupancies
                JOIN expense_reports ON expense_reports.id = report_day_occupancies.report_id
                WHERE expense_reports.report_type IS NULL
                   OR expense_reports.report_type != 'travel'
                   OR expense_reports.deleted_at IS NOT NULL
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="occupancy_on_inactive_or_regular_report",
                message="已删除或常规报销单下存在日期占用",
                detail_builder=lambda row: (
                    f"occupancy_id={row['id']}, report_id={row['report_id']}, "
                    f"report_type={row['report_type']}, deleted_at={row['deleted_at']}"
                ),
            )

            employee_rows = connection.execute(
                """
                SELECT report_day_occupancies.id, report_day_occupancies.report_id,
                       report_day_occupancies.employee_key, expense_reports.employee_name
                FROM report_day_occupancies
                JOIN expense_reports ON expense_reports.id = report_day_occupancies.report_id
                """
            ).fetchall()
            # SQLite TRIM 只处理 ASCII 空格；复用业务层的 Python str.strip 规则，
            # 才能与制表符、全角空白等姓名规范化结果保持一致。
            from backend.services.report_service import normalize_employee_key

            rows = [
                row
                for row in employee_rows
                if row["employee_key"] is None
                or row["employee_key"] != normalize_employee_key(row["employee_name"])
            ]
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="occupancy_employee_mismatch",
                message="日期占用的报销人与所属报销单不一致",
                detail_builder=lambda row: (
                    f"occupancy_id={row['id']}, report_id={row['report_id']}, "
                    f"employee_key={row['employee_key']}, employee_name={row['employee_name']}"
                ),
            )

        _append_occupancy_candidate_checks(connection, tables, issues)

    if {"trips", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT trips.id, trips.report_id
            FROM trips
            LEFT JOIN expense_reports ON expense_reports.id = trips.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_trip",
            message="存在无所属报销单的行程",
            detail_builder=lambda row: f"trip_id={row['id']}, report_id={row['report_id']}",
        )
        if "report_type" in _table_columns(connection, "expense_reports"):
            rows = connection.execute(
                """
                SELECT trips.id, trips.report_id
                FROM trips
                JOIN expense_reports ON expense_reports.id = trips.report_id
                WHERE expense_reports.report_type = 'regular'
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="trip_on_regular_report",
                message="常规报销单下存在差旅行程",
                detail_builder=lambda row: f"trip_id={row['id']}, report_id={row['report_id']}",
            )

    if {"expense_items", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT expense_items.id, expense_items.report_id
            FROM expense_items
            LEFT JOIN expense_reports ON expense_reports.id = expense_items.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_expense_item",
            message="存在无所属报销单的费用项",
            detail_builder=lambda row: f"expense_item_id={row['id']}, report_id={row['report_id']}",
        )
        if "report_type" in _table_columns(connection, "expense_reports"):
            rows = connection.execute(
                """
                SELECT expense_items.id, expense_items.report_id
                FROM expense_items
                JOIN expense_reports ON expense_reports.id = expense_items.report_id
                WHERE expense_reports.report_type = 'regular'
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="travel_expense_item_on_regular_report",
                message="常规报销单下存在差旅费用项",
                detail_builder=lambda row: f"expense_item_id={row['id']}, report_id={row['report_id']}",
            )

    if {"regular_items", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT regular_items.id, regular_items.report_id
            FROM regular_items
            LEFT JOIN expense_reports ON expense_reports.id = regular_items.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_regular_item",
            message="存在无所属报销单的常规报销项目",
            detail_builder=lambda row: f"regular_item_id={row['id']}, report_id={row['report_id']}",
        )
        if "report_type" in _table_columns(connection, "expense_reports"):
            rows = connection.execute(
                """
                SELECT regular_items.id, regular_items.report_id, expense_reports.report_type
                FROM regular_items
                JOIN expense_reports ON expense_reports.id = regular_items.report_id
                WHERE expense_reports.report_type != 'regular'
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="regular_item_on_travel_report",
                message="出差报销单下存在常规报销项目",
                detail_builder=lambda row: f"regular_item_id={row['id']}, report_id={row['report_id']}",
            )

    if {"invoices", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT invoices.id, invoices.report_id
            FROM invoices
            LEFT JOIN expense_reports ON expense_reports.id = invoices.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_invoice",
            message="存在无所属报销单的发票",
            detail_builder=lambda row: f"invoice_id={row['id']}, report_id={row['report_id']}",
        )

        rows = connection.execute(
            """
            SELECT invoices.id, invoices.report_id
            FROM invoices
            JOIN expense_reports ON expense_reports.id = invoices.report_id
            WHERE expense_reports.deleted_at IS NOT NULL AND invoices.deleted_at IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="active_invoice_in_deleted_report",
            message="已删除报销单下仍存在未删除发票",
            detail_builder=lambda row: f"invoice_id={row['id']}, report_id={row['report_id']}",
        )

        invoice_columns = _table_columns(connection, "invoices")
        report_columns = _table_columns(connection, "expense_reports")
        if "regular_item_id" in invoice_columns and "regular_items" in tables:
            rows = connection.execute(
                """
                SELECT invoices.id, invoices.report_id, invoices.regular_item_id
                FROM invoices
                LEFT JOIN regular_items ON regular_items.id = invoices.regular_item_id
                WHERE invoices.regular_item_id IS NOT NULL AND regular_items.id IS NULL
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="orphan_invoice_regular_item",
                message="发票关联了不存在的常规报销项目",
                detail_builder=lambda row: (
                    f"invoice_id={row['id']}, report_id={row['report_id']}, regular_item_id={row['regular_item_id']}"
                ),
            )
            rows = connection.execute(
                """
                SELECT invoices.id, invoices.report_id, invoices.regular_item_id,
                       regular_items.report_id AS item_report_id
                FROM invoices
                JOIN regular_items ON regular_items.id = invoices.regular_item_id
                WHERE invoices.report_id != regular_items.report_id
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="invoice_regular_item_report_mismatch",
                message="发票关联的常规报销项目不属于同一报销单",
                detail_builder=lambda row: (
                    f"invoice_id={row['id']}, report_id={row['report_id']}, "
                    f"regular_item_id={row['regular_item_id']}, item_report_id={row['item_report_id']}"
                ),
            )
        if "regular_item_id" in invoice_columns and {"report_type", "regular_mode"}.issubset(report_columns):
            rows = connection.execute(
                """
                SELECT invoices.id, invoices.report_id, invoices.trip_id, invoices.regular_item_id,
                       expense_reports.report_type, expense_reports.regular_mode
                FROM invoices
                JOIN expense_reports ON expense_reports.id = invoices.report_id
                WHERE invoices.deleted_at IS NULL
                  AND (
                    (expense_reports.report_type = 'travel' AND invoices.regular_item_id IS NOT NULL)
                    OR (expense_reports.report_type = 'regular' AND expense_reports.regular_mode = 'invoice'
                        AND invoices.regular_item_id IS NULL)
                    OR (expense_reports.report_type = 'regular' AND expense_reports.regular_mode = 'no_invoice')
                    OR (expense_reports.report_type = 'regular' AND invoices.trip_id IS NOT NULL)
                    OR (expense_reports.report_type = 'regular' AND invoices.expense_category != 'regular')
                    OR (expense_reports.report_type = 'travel' AND invoices.expense_category = 'regular')
                  )
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="invoice_report_kind_mismatch",
                message="发票与报销单类型或常规报销模式不匹配",
                detail_builder=lambda row: (
                    f"invoice_id={row['id']}, report_id={row['report_id']}, "
                    f"report_type={row['report_type']}, regular_mode={row['regular_mode']}, "
                    f"trip_id={row['trip_id']}, regular_item_id={row['regular_item_id']}"
                ),
            )

    if {"report_attachments", "expense_reports"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT report_attachments.id, report_attachments.report_id
            FROM report_attachments
            LEFT JOIN expense_reports ON expense_reports.id = report_attachments.report_id
            WHERE expense_reports.id IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="orphan_report_attachment",
            message="存在无所属报销单的非发票附件",
            detail_builder=lambda row: f"attachment_id={row['id']}, report_id={row['report_id']}",
        )

        attachment_columns = _table_columns(connection, "report_attachments")
        report_columns = _table_columns(connection, "expense_reports")
        if "regular_item_id" in attachment_columns and "regular_items" in tables:
            rows = connection.execute(
                """
                SELECT report_attachments.id, report_attachments.report_id,
                       report_attachments.regular_item_id
                FROM report_attachments
                LEFT JOIN regular_items ON regular_items.id = report_attachments.regular_item_id
                WHERE report_attachments.regular_item_id IS NOT NULL AND regular_items.id IS NULL
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="orphan_attachment_regular_item",
                message="凭据附件关联了不存在的常规报销项目",
                detail_builder=lambda row: (
                    f"attachment_id={row['id']}, report_id={row['report_id']}, "
                    f"regular_item_id={row['regular_item_id']}"
                ),
            )
            rows = connection.execute(
                """
                SELECT report_attachments.id, report_attachments.report_id,
                       report_attachments.regular_item_id, regular_items.report_id AS item_report_id
                FROM report_attachments
                JOIN regular_items ON regular_items.id = report_attachments.regular_item_id
                WHERE report_attachments.report_id != regular_items.report_id
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="attachment_regular_item_report_mismatch",
                message="凭据附件关联的常规报销项目不属于同一报销单",
                detail_builder=lambda row: (
                    f"attachment_id={row['id']}, report_id={row['report_id']}, "
                    f"regular_item_id={row['regular_item_id']}, item_report_id={row['item_report_id']}"
                ),
            )
        if "regular_item_id" in attachment_columns and {"report_type", "regular_mode"}.issubset(report_columns):
            rows = connection.execute(
                """
                SELECT report_attachments.id, report_attachments.report_id,
                       report_attachments.regular_item_id,
                       expense_reports.report_type, expense_reports.regular_mode
                FROM report_attachments
                JOIN expense_reports ON expense_reports.id = report_attachments.report_id
                WHERE report_attachments.deleted_at IS NULL
                  AND (
                    (expense_reports.report_type = 'travel' AND report_attachments.regular_item_id IS NOT NULL)
                    OR (expense_reports.report_type = 'regular' AND expense_reports.regular_mode = 'no_invoice'
                        AND report_attachments.regular_item_id IS NULL)
                    OR (expense_reports.report_type = 'regular' AND expense_reports.regular_mode = 'invoice')
                  )
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="attachment_report_kind_mismatch",
                message="凭据附件与报销单类型或常规报销模式不匹配",
                detail_builder=lambda row: (
                    f"attachment_id={row['id']}, report_id={row['report_id']}, "
                    f"report_type={row['report_type']}, regular_mode={row['regular_mode']}, "
                    f"regular_item_id={row['regular_item_id']}"
                ),
            )
        if "page_count" in attachment_columns:
            rows = connection.execute(
                """
                SELECT id, report_id, page_count
                FROM report_attachments
                WHERE deleted_at IS NULL AND (page_count IS NULL OR page_count < 1)
                """
            ).fetchall()
            _rows_issue(
                issues,
                rows,
                severity="error",
                category="business",
                code="invalid_attachment_page_count",
                message="凭据附件页数必须为正整数",
                detail_builder=lambda row: (
                    f"attachment_id={row['id']}, report_id={row['report_id']}, page_count={row['page_count']}"
                ),
            )

        rows = connection.execute(
            """
            SELECT report_attachments.id, report_attachments.report_id
            FROM report_attachments
            JOIN expense_reports ON expense_reports.id = report_attachments.report_id
            WHERE expense_reports.deleted_at IS NOT NULL AND report_attachments.deleted_at IS NULL
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="active_report_attachment_in_deleted_report",
            message="已删除报销单下仍存在未删除的非发票附件",
            detail_builder=lambda row: f"attachment_id={row['id']}, report_id={row['report_id']}",
        )

    if {"invoices", "trips"}.issubset(tables):
        rows = connection.execute(
            """
            SELECT invoices.id, invoices.report_id, invoices.trip_id, trips.report_id AS trip_report_id
            FROM invoices
            JOIN trips ON trips.id = invoices.trip_id
            WHERE invoices.trip_id IS NOT NULL AND invoices.report_id != trips.report_id
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="error",
            category="business",
            code="invoice_trip_report_mismatch",
            message="发票关联的行程不属于同一报销单",
            detail_builder=lambda row: (
                f"invoice_id={row['id']}, report_id={row['report_id']}, "
                f"trip_id={row['trip_id']}, trip_report_id={row['trip_report_id']}"
            ),
        )

    if "invoices" in tables:
        category_list = ", ".join(f"'{category}'" for category in sorted(VALID_INVOICE_CATEGORIES))
        rows = connection.execute(
            f"""
            SELECT id, expense_category
            FROM invoices
            WHERE expense_category NOT IN ({category_list})
              AND expense_category NOT LIKE 'custom:%'
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="warning",
            category="business",
            code="unknown_invoice_category",
            message="存在未知发票费用类别",
            detail_builder=lambda row: f"invoice_id={row['id']}, category={row['expense_category']}",
        )

    if "expense_items" in tables:
        category_list = ", ".join(f"'{category}'" for category in sorted(VALID_EXPENSE_CATEGORIES))
        rows = connection.execute(
            f"""
            SELECT id, category
            FROM expense_items
            WHERE category NOT IN ({category_list})
              AND category NOT LIKE 'custom:%'
            """
        ).fetchall()
        _rows_issue(
            issues,
            rows,
            severity="warning",
            category="business",
            code="unknown_expense_category",
            message="存在未知费用项类别",
            detail_builder=lambda row: f"expense_item_id={row['id']}, category={row['category']}",
        )


def _append_attachment_checks(
    connection: sqlite3.Connection,
    tables: set[str],
    issues: list[DatabaseIntegrityIssueRead],
) -> None:
    attachment_tables = [
        ("invoices", "invoice_id"),
        ("report_attachments", "attachment_id"),
    ]
    available_tables = [(table, id_label) for table, id_label in attachment_tables if table in tables]
    if not available_tables:
        return
    upload_root = UPLOAD_ROOT.resolve()
    unsafe: list[str] = []
    missing: list[str] = []
    for table, id_label in available_tables:
        rows = connection.execute(
            f"""
            SELECT id, file_path
            FROM {_quote_identifier(table)}
            WHERE deleted_at IS NULL AND file_path IS NOT NULL AND TRIM(file_path) <> ''
            """
        ).fetchall()
        for row in rows:
            file_path = str(row["file_path"])
            try:
                resolved = uploaded_path(file_path, UPLOAD_ROOT).resolve()
            except OSError as exc:
                unsafe.append(f"{id_label}={row['id']}, path={file_path}, error={exc}")
                continue
            if resolved != upload_root and not resolved.is_relative_to(upload_root):
                unsafe.append(f"{id_label}={row['id']}, path={file_path}")
                continue
            if not resolved.exists():
                missing.append(f"{id_label}={row['id']}, path={file_path}")

    if unsafe:
        issues.append(
            _database_issue(
                "error",
                "attachments",
                "unsafe_attachment_path",
                "存在越界或不可解析的附件路径",
                count=len(unsafe),
                details=unsafe[:20],
            )
        )
    if missing:
        issues.append(
            _database_issue(
                "warning",
                "attachments",
                "missing_attachment_file",
                "存在缺失的附件文件",
                count=len(missing),
                details=missing[:20],
            )
        )


def check_database_integrity(db: Session | None = None) -> DatabaseIntegrityCheckRead:
    del db
    started = perf_counter()
    checked_at = _utc_now().isoformat()
    database_exists = DATABASE_PATH.exists()
    database_size = DATABASE_PATH.stat().st_size if database_exists else 0
    issues: list[DatabaseIntegrityIssueRead] = []
    tables: dict[str, int] = {}
    sqlite_integrity = None
    foreign_key_issues = 0

    if not database_exists:
        issues.append(
            _database_issue(
                "error",
                "database",
                "database_missing",
                "数据库文件不存在",
                count=1,
                details=[DATABASE_PATH.as_posix()],
            )
        )
        return DatabaseIntegrityCheckRead(
            status="error",
            checked_at=checked_at,
            elapsed_ms=round((perf_counter() - started) * 1000),
            database_path=DATABASE_PATH.as_posix(),
            database_exists=False,
            database_size_bytes=0,
            sqlite_integrity=None,
            foreign_key_issues=0,
            tables={},
            issues=issues,
        )

    try:
        connection = _open_readonly_database()
    except sqlite3.Error as exc:
        issues.append(
            _database_issue(
                "error",
                "database",
                "database_open_failed",
                "数据库无法以只读方式打开",
                count=1,
                details=[str(exc)],
            )
        )
        return DatabaseIntegrityCheckRead(
            status="error",
            checked_at=checked_at,
            elapsed_ms=round((perf_counter() - started) * 1000),
            database_path=DATABASE_PATH.as_posix(),
            database_exists=True,
            database_size_bytes=database_size,
            sqlite_integrity=None,
            foreign_key_issues=0,
            tables={},
            issues=issues,
        )

    try:
        integrity_rows = [row[0] for row in connection.execute("PRAGMA integrity_check").fetchall()]
        sqlite_integrity = "ok" if integrity_rows == ["ok"] else "; ".join(str(item) for item in integrity_rows)
        if sqlite_integrity != "ok":
            issues.append(
                _database_issue(
                    "error",
                    "sqlite",
                    "integrity_check_failed",
                    "SQLite 物理完整性检查失败",
                    count=len(integrity_rows),
                    details=[str(item) for item in integrity_rows[:20]],
                )
            )

        foreign_rows = connection.execute("PRAGMA foreign_key_check").fetchall()
        foreign_key_issues = len(foreign_rows)
        if foreign_rows:
            issues.append(
                _database_issue(
                    "error",
                    "sqlite",
                    "foreign_key_check_failed",
                    "SQLite 外键一致性检查失败",
                    count=len(foreign_rows),
                    details=[
                        f"table={row[0]}, rowid={row[1]}, parent={row[2]}, fkid={row[3]}"
                        for row in foreign_rows[:20]
                    ],
                )
            )

        table_set = _table_names(connection)
        tables = _table_counts(connection, table_set)
        _append_business_integrity_checks(connection, table_set, issues)
        _append_attachment_checks(connection, table_set, issues)
    finally:
        connection.close()

    return DatabaseIntegrityCheckRead(
        status=_database_check_status(issues),
        checked_at=checked_at,
        elapsed_ms=round((perf_counter() - started) * 1000),
        database_path=DATABASE_PATH.as_posix(),
        database_exists=True,
        database_size_bytes=database_size,
        sqlite_integrity=sqlite_integrity,
        foreign_key_issues=foreign_key_issues,
        tables=tables,
        issues=issues,
    )


def get_maintenance_info(db: Session | None = None) -> MaintenanceInfoRead:
    return MaintenanceInfoRead(
        app_version=APP_VERSION,
        app_root=APP_ROOT.as_posix(),
        data_dir=DATA_DIR.as_posix(),
        database_path=DATABASE_PATH.as_posix(),
        uploads_dir=UPLOAD_ROOT.as_posix(),
        backups_dir=BACKUP_ROOT.as_posix(),
        logs_dir=LOG_DIR.as_posix(),
        database_exists=DATABASE_PATH.exists(),
        uploads_exists=UPLOAD_ROOT.exists(),
        backups=list_backups(),
        qr_engine=get_qr_engine_diagnostics(db),
        log_file=get_log_file_diagnostics(),
    )


def create_backup(reason: str = "manual") -> BackupRead:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    timestamp = _timestamp()
    safe_reason = "".join(char for char in reason if char.isalnum() or char in ("_", "-")) or "manual"
    backup_path = BACKUP_ROOT / f"{safe_reason}_{timestamp}_{uuid4().hex[:8]}.zip"
    temp_zip_path = backup_path.with_suffix(".zip.tmp")
    if backup_path.exists() or temp_zip_path.exists():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="备份文件已存在，请稍后重试")

    try:
        files: list[dict] = []
        created_at = _utc_now().isoformat()
        with tempfile.TemporaryDirectory(dir=BACKUP_ROOT) as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            db_snapshot = temp_dir / "expense.db"
            if DATABASE_PATH.exists():
                _copy_sqlite_database(db_snapshot)

            with zipfile.ZipFile(temp_zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
                if db_snapshot.exists():
                    files.append(_zip_file_entry(archive, db_snapshot, "data/expense.db"))
                for source, archive_path in _iter_directory_files(UPLOAD_ROOT, "uploads") or []:
                    files.append(_zip_file_entry(archive, source, archive_path))
                for source, archive_path in _iter_directory_files(VENDOR_ROOT, "vendor") or []:
                    files.append(_zip_file_entry(archive, source, archive_path))
                log_tail = _read_log_tail()
                if log_tail:
                    files.append(_zip_bytes_entry(archive, log_tail, "logs/app.log.tail.txt"))

                manifest = {
                    "schema_version": BACKUP_SCHEMA_VERSION,
                    "app_version": APP_VERSION,
                    "created_at": created_at,
                    "reason": safe_reason,
                    "database_path": DATABASE_PATH.as_posix(),
                    "uploads_included": any(item["path"].startswith("uploads/") for item in files),
                    "files": files,
                }
                archive.writestr(MANIFEST_NAME, _write_json_bytes(manifest))

        temp_zip_path.replace(backup_path)
    except Exception:
        temp_zip_path.unlink(missing_ok=True)
        raise
    return _backup_read(backup_path)


def _session_database_path(db: Session) -> Path | None:
    try:
        database = db.get_bind().url.database
    except Exception:
        return None
    if not database or database == ":memory:":
        return None
    return Path(database).resolve()


def _session_uses_runtime_database(db: Session) -> bool:
    session_path = _session_database_path(db)
    if session_path is None:
        return False
    runtime_path = DATABASE_PATH.resolve()
    try:
        return session_path.samefile(runtime_path)
    except OSError:
        return session_path == runtime_path


def create_safety_snapshot(db: Session, reason: str) -> BackupRead | None:
    if not _session_uses_runtime_database(db):
        return None
    return create_backup(reason=reason)


def get_backup_file(backup_id: str) -> Path:
    path = _backup_path(backup_id)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="备份不存在")
    return path


def _desktop_file_dialog_enabled() -> bool:
    return sys.platform == "win32" and (
        os.environ.get("REIMBURSEMENT_DESKTOP_MODE") == "1" or bool(getattr(sys, "frozen", False))
    )


def _open_windows_zip_file_dialog(initial_dir: Path, title: str) -> Path | None:
    if sys.platform != "win32":
        raise RuntimeError("Windows file dialog is not available on this platform")

    import ctypes
    from ctypes import wintypes

    class OpenFileNameW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    file_buffer = ctypes.create_unicode_buffer(32768)
    file_filter = "ZIP 文件 (*.zip)\0*.zip\0所有文件 (*.*)\0*.*\0\0"
    ofn = OpenFileNameW()
    ofn.lStructSize = ctypes.sizeof(OpenFileNameW)
    ofn.lpstrFilter = file_filter
    ofn.nFilterIndex = 1
    ofn.lpstrFile = file_buffer
    ofn.nMaxFile = len(file_buffer)
    ofn.lpstrInitialDir = initial_dir.as_posix()
    ofn.lpstrTitle = title
    ofn.lpstrDefExt = "zip"
    ofn.Flags = 0x00000008 | 0x00000800 | 0x00001000 | 0x00080000

    comdlg32 = ctypes.windll.comdlg32
    comdlg32.GetOpenFileNameW.argtypes = [ctypes.POINTER(OpenFileNameW)]
    comdlg32.GetOpenFileNameW.restype = wintypes.BOOL
    comdlg32.CommDlgExtendedError.restype = wintypes.DWORD
    if comdlg32.GetOpenFileNameW(ctypes.byref(ofn)):
        return Path(file_buffer.value)

    error_code = int(comdlg32.CommDlgExtendedError())
    if error_code == 0:
        return None
    raise RuntimeError(f"Windows file dialog failed: {error_code}")


def _open_backup_zip_file_dialog() -> Path | None:
    if not _desktop_file_dialog_enabled():
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="本地文件选择器仅在桌面版可用")
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    return _open_windows_zip_file_dialog(BACKUP_ROOT, "选择备份 ZIP")


def create_restore_preview_from_path(package_source_path: Path) -> RestorePreviewRead:
    if not package_source_path.exists() or not package_source_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="备份文件不存在")

    preview_id = uuid4().hex
    preview_dir = RESTORE_STAGING_ROOT / preview_id
    preview_dir.mkdir(parents=True, exist_ok=False)
    package_path = preview_dir / "backup.zip"
    shutil.copy2(package_source_path, package_path)

    manifest, archive = _load_valid_backup(package_path)
    archive.close()
    return _preview_from_manifest(preview_id, package_path, manifest)


def create_restore_preview_from_backup_dialog() -> RestoreDialogPreviewRead:
    selected_path = _open_backup_zip_file_dialog()
    if selected_path is None:
        return RestoreDialogPreviewRead(selected=False)
    preview = create_restore_preview_from_path(selected_path)
    return RestoreDialogPreviewRead(selected=True, filename=selected_path.name, preview=preview)


def create_restore_preview(upload_file: UploadFile) -> RestorePreviewRead:
    preview_id = uuid4().hex
    preview_dir = RESTORE_STAGING_ROOT / preview_id
    preview_dir.mkdir(parents=True, exist_ok=False)
    package_path = preview_dir / "backup.zip"
    with package_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)

    manifest, archive = _load_valid_backup(package_path)
    archive.close()
    return _preview_from_manifest(preview_id, package_path, manifest)


def _preview_from_manifest(preview_id: str, package_path: Path, manifest: dict) -> RestorePreviewRead:
    files = manifest.get("files", [])
    return RestorePreviewRead(
        preview_id=preview_id,
        app_version=manifest.get("app_version"),
        created_at=manifest.get("created_at"),
        reason=manifest.get("reason"),
        files_total=len(files),
        size_bytes=package_path.stat().st_size,
        database_included=any(item.get("path") == "data/expense.db" for item in files),
        uploads_files=sum(1 for item in files if str(item.get("path", "")).startswith("uploads/")),
        vendor_files=sum(1 for item in files if str(item.get("path", "")).startswith("vendor/")),
    )


def _restore_preview_package(preview_id: str) -> tuple[Path, dict, zipfile.ZipFile]:
    safe_id = _safe_preview_id(preview_id)
    package_path = RESTORE_STAGING_ROOT / safe_id / "backup.zip"
    if not package_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="恢复预览不存在或已过期")
    manifest, archive = _load_valid_backup(package_path)
    return package_path, manifest, archive


def _write_archive_file(archive: zipfile.ZipFile, archive_path: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(_safe_archive_name(archive_path)) as source, target.open("wb") as output:
        shutil.copyfileobj(source, output)


def _extract_archive_prefix(archive: zipfile.ZipFile, prefix: str, target_root: Path) -> bool:
    restored = False
    for name in archive.namelist():
        safe_name = _safe_archive_name(name)
        if not safe_name.startswith(f"{prefix}/"):
            continue
        relative = PurePosixPath(safe_name).relative_to(prefix)
        target = target_root.joinpath(*relative.parts)
        _write_archive_file(archive, safe_name, target)
        restored = True
    return restored


def _replace_directory(source: Path, target: Path, rollback_root: Path) -> Path | None:
    original_backup = None
    if target.exists():
        original_backup = rollback_root / f"original_{target.name}"
        shutil.move(str(target), str(original_backup))
    try:
        if source.exists():
            shutil.copytree(source, target)
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        if original_backup and original_backup.exists():
            shutil.move(str(original_backup), str(target))
        raise
    return original_backup


def execute_restore(preview_id: str, confirm_restore: bool) -> RestoreExecuteRead:
    if not confirm_restore:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="恢复数据需要二次确认")

    package_path, manifest, archive = _restore_preview_package(preview_id)
    work_root = RESTORE_STAGING_ROOT / _safe_preview_id(preview_id) / "work"
    database_restored = False
    uploads_restored = False
    vendor_restored = False
    original_db = None
    try:
        pre_restore_backup = create_backup(reason="pre_restore")
        if work_root.exists():
            shutil.rmtree(work_root)
        work_root.mkdir(parents=True, exist_ok=True)
        rollback_root = work_root / "rollback"
        rollback_root.mkdir()
        extracted_root = work_root / "extracted"
        extracted_root.mkdir()

        if any(item.get("path") == "data/expense.db" for item in manifest.get("files", [])):
            _write_archive_file(archive, "data/expense.db", extracted_root / "data" / "expense.db")
        uploads_restored = _extract_archive_prefix(archive, "uploads", extracted_root / "uploads")
        vendor_restored = _extract_archive_prefix(archive, "vendor", extracted_root / "vendor")
        archive.close()

        db_connection.engine.dispose()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if (extracted_root / "data" / "expense.db").exists():
            if DATABASE_PATH.exists():
                original_db = rollback_root / "expense.db"
                shutil.copy2(DATABASE_PATH, original_db)
            shutil.copy2(extracted_root / "data" / "expense.db", DATABASE_PATH)
            database_restored = True

        if uploads_restored:
            _replace_directory(extracted_root / "uploads", UPLOAD_ROOT, rollback_root)
        if vendor_restored:
            _replace_directory(extracted_root / "vendor", VENDOR_ROOT, rollback_root)
        if database_restored:
            db_connection.create_db_and_tables()
    except Exception:
        db_connection.engine.dispose()
        if original_db and original_db.exists():
            DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original_db, DATABASE_PATH)
        archive.close()
        raise
    finally:
        try:
            shutil.rmtree(work_root)
        except OSError:
            pass

    return RestoreExecuteRead(
        restored=True,
        pre_restore_backup=pre_restore_backup,
        database_restored=database_restored,
        uploads_restored=uploads_restored,
        vendor_restored=vendor_restored,
    )


def _environment_payload() -> dict:
    return {
        "python_version": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "executable": sys.executable,
        "frozen": bool(getattr(sys, "frozen", False)),
        "cwd": Path.cwd().as_posix(),
        "environment": {
            key: value
            for key in ("REIMBURSEMENT_APP_ROOT", "REIMBURSEMENT_APP_VERSION", "PYTHONPATH")
            if (value := os.environ.get(key))
        },
    }


def _diagnostic_bool(value: bool | None) -> str:
    if value is None:
        return "-"
    return "是" if value else "否"


def _diagnostics_summary_text(diagnostics: dict) -> bytes:
    paths = diagnostics.get("paths") or {}
    database_check = diagnostics.get("database_check") or {}
    qr_engine = diagnostics.get("qr_engine") or {}
    log_file = diagnostics.get("log_file") or {}
    log_size = int(log_file.get("size_bytes") or 0)
    log_truncated = bool(log_size > LOG_TAIL_BYTES)
    log_size_suffix = f"，{log_size} bytes" if log_file.get("exists") else ""
    log_truncated_suffix = "，诊断包仅包含尾部日志" if log_truncated else ""
    opencv_version = qr_engine.get("opencv_package_version")
    opencv_version_suffix = f"，版本 {opencv_version}" if opencv_version else ""
    lines = [
        "报销管理诊断摘要",
        "",
        f"生成时间: {diagnostics.get('generated_at') or '-'}",
        f"程序版本: {diagnostics.get('app_version') or '-'}",
        f"安装根目录: {paths.get('app_root') or '-'}",
        f"数据目录: {paths.get('data_dir') or '-'}",
        f"数据库路径: {paths.get('database_path') or '-'}",
        f"日志路径: {log_file.get('path') or paths.get('logs_dir') or '-'}",
        f"日志状态: {'已生成' if log_file.get('exists') else '未生成'}"
        f"{log_size_suffix}"
        f"{log_truncated_suffix}",
        "",
        "运行能力",
        f"QR 引擎: {qr_engine.get('selected_engine_label') or qr_engine.get('selected_engine') or '-'}",
        f"OpenCV runtime: {_diagnostic_bool(qr_engine.get('opencv_runtime_installed'))}"
        f"{opencv_version_suffix}",
        f"OpenCV 模型完整: {_diagnostic_bool(qr_engine.get('opencv_model_files_complete'))}",
        "",
        "数据库检查",
        f"状态: {database_check.get('status') or '-'}",
        f"SQLite integrity_check: {database_check.get('sqlite_integrity') or '-'}",
        f"外键问题数: {database_check.get('foreign_key_issues') or 0}",
        f"业务问题数: {len(database_check.get('issues') or [])}",
        "",
        "诊断包内容",
        "已包含: diagnostics.json、summary.txt、config/settings.json、config/runtime.json、env/environment.json、logs/app.log（如存在）。",
        "不包含: data/expense.db、uploads/ 附件、备份 ZIP。",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _diagnostics_payload(db: Session | None = None) -> dict:
    info = get_maintenance_info(db)
    settings = _settings_payload(db)
    payload = {
        "schema_version": 1,
        "app_version": APP_VERSION,
        "generated_at": _utc_now().isoformat(),
        "paths": {
            "app_root": info.app_root,
            "data_dir": info.data_dir,
            "database_path": info.database_path,
            "uploads_dir": info.uploads_dir,
            "backups_dir": info.backups_dir,
            "logs_dir": info.logs_dir,
        },
        "state": {
            "database_exists": info.database_exists,
            "uploads_exists": info.uploads_exists,
            "backups_total": len(info.backups),
        },
        "database_check": check_database_integrity(db).model_dump(),
        "qr_engine": info.qr_engine.model_dump() if info.qr_engine else None,
        "log_file": info.log_file.model_dump() if info.log_file else None,
        "settings": settings,
        "runtime_config": _runtime_config_payload(),
        "environment": _environment_payload(),
        "backups": [backup.model_dump() for backup in info.backups[:20]],
    }
    return payload


def build_diagnostics_json(db: Session | None = None) -> tuple[bytes, str]:
    payload = _diagnostics_payload(db)
    filename = f"reimbursement-diagnostics-{_timestamp()}.json"
    return _write_json_bytes(payload), filename


def build_diagnostics_package(db: Session | None = None) -> tuple[bytes, str]:
    diagnostics = _diagnostics_payload(db)
    settings = diagnostics.get("settings") or {"available": False}
    runtime_config = diagnostics.get("runtime_config") or {}
    environment = diagnostics.get("environment") or {}
    files: list[dict] = []
    payload = BytesIO()
    log_tail = _read_log_tail()
    with zipfile.ZipFile(payload, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        files.append(_zip_bytes_entry(archive, _write_json_bytes(diagnostics), "diagnostics.json"))
        files.append(_zip_bytes_entry(archive, _diagnostics_summary_text(diagnostics), "summary.txt"))
        files.append(_zip_bytes_entry(archive, _write_json_bytes(settings), "config/settings.json"))
        files.append(_zip_bytes_entry(archive, _write_json_bytes(runtime_config), "config/runtime.json"))
        files.append(_zip_bytes_entry(archive, _write_json_bytes(environment), "env/environment.json"))
        if log_tail:
            files.append(_zip_bytes_entry(archive, log_tail, "logs/app.log"))

        manifest = {
            "schema_version": 1,
            "package_type": "reimbursement_diagnostics",
            "app_version": APP_VERSION,
            "generated_at": diagnostics["generated_at"],
            "log_tail_bytes": LOG_TAIL_BYTES,
            "log_truncated": bool(
                diagnostics.get("log_file", {}).get("size_bytes", 0) > LOG_TAIL_BYTES
                if diagnostics.get("log_file")
                else False
            ),
            "files": files,
        }
        archive.writestr("manifest.json", _write_json_bytes(manifest))

    filename = f"reimbursement-diagnostics-{_timestamp()}.zip"
    return payload.getvalue(), filename
