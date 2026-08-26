from __future__ import annotations

import json
import os
import sqlite3
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from backend.services import maintenance_service


class FakeEngine:
    def __init__(self) -> None:
        self.dispose_calls = 0

    def dispose(self) -> None:
        self.dispose_calls += 1


class FakeDbConnection:
    def __init__(self) -> None:
        self.engine = FakeEngine()
        self.migrate_calls = 0

    def create_db_and_tables(self) -> None:
        self.migrate_calls += 1


def configure_runtime(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Path]:
    app_root = tmp_path / "app"
    data_dir = app_root / "data"
    paths = {
        "app_root": app_root,
        "data_dir": data_dir,
        "database": data_dir / "expense.db",
        "uploads": app_root / "uploads",
        "logs": app_root / "logs",
        "vendor": app_root / "vendor",
        "backups": data_dir / "backups",
        "restore_staging": data_dir / "restore_staging",
        "update_staging": data_dir / "update_staging",
    }
    monkeypatch.setattr(maintenance_service, "APP_ROOT", paths["app_root"])
    monkeypatch.setattr(maintenance_service, "DATA_DIR", paths["data_dir"])
    monkeypatch.setattr(maintenance_service, "DATABASE_PATH", paths["database"])
    monkeypatch.setattr(maintenance_service, "UPLOAD_ROOT", paths["uploads"])
    monkeypatch.setattr(maintenance_service, "LOG_DIR", paths["logs"])
    monkeypatch.setattr(maintenance_service, "VENDOR_ROOT", paths["vendor"])
    monkeypatch.setattr(maintenance_service, "BACKUP_ROOT", paths["backups"])
    monkeypatch.setattr(maintenance_service, "RESTORE_STAGING_ROOT", paths["restore_staging"])
    monkeypatch.setattr(maintenance_service, "UPDATE_STAGING_ROOT", paths["update_staging"])
    return paths


def write_database(path: Path, value: str, data_schema_version: int = maintenance_service.DATA_SCHEMA_VERSION) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS sample (value TEXT)")
        connection.execute("DELETE FROM sample")
        connection.execute("INSERT INTO sample (value) VALUES (?)", (value,))
        connection.execute(f"PRAGMA user_version = {data_schema_version}")
        connection.commit()
    finally:
        connection.close()


def read_database_value(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT value FROM sample").fetchone()[0]
    finally:
        connection.close()


def write_app_database_with_integrity_issues(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE expense_reports (
                id INTEGER PRIMARY KEY,
                report_uid TEXT,
                status TEXT,
                deleted_at DATETIME
            );
            CREATE TABLE invoices (
                id INTEGER PRIMARY KEY,
                invoice_uid TEXT,
                report_id INTEGER,
                trip_id INTEGER,
                expense_category TEXT,
                file_path TEXT,
                deleted_at DATETIME
            );
            INSERT INTO expense_reports (id, report_uid, status, deleted_at)
            VALUES (1, 'report-1', 'archived', NULL);
            INSERT INTO invoices (id, invoice_uid, report_id, trip_id, expense_category, file_path, deleted_at)
            VALUES (1, 'invoice-1', 1, NULL, 'accommodation', 'uploads/1/missing.pdf', NULL);
            """
        )
        connection.commit()
    finally:
        connection.close()


def write_regular_database_with_integrity_issues(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE expense_reports (
                id INTEGER PRIMARY KEY,
                report_uid TEXT,
                report_type TEXT,
                regular_mode TEXT,
                status TEXT,
                deleted_at DATETIME
            );
            CREATE TABLE regular_items (
                id INTEGER PRIMARY KEY,
                report_id INTEGER,
                sort_order INTEGER,
                amount NUMERIC
            );
            CREATE TABLE invoices (
                id INTEGER PRIMARY KEY,
                invoice_uid TEXT,
                report_id INTEGER,
                trip_id INTEGER,
                regular_item_id INTEGER,
                expense_category TEXT,
                file_path TEXT,
                deleted_at DATETIME
            );
            CREATE TABLE report_attachments (
                id INTEGER PRIMARY KEY,
                attachment_uid TEXT,
                report_id INTEGER,
                regular_item_id INTEGER,
                page_count INTEGER,
                file_path TEXT,
                deleted_at DATETIME
            );
            INSERT INTO expense_reports VALUES
                (1, 'regular-invoice', 'regular', 'invoice', 'checked', NULL),
                (2, 'regular-no-invoice', 'regular', 'no_invoice', 'checked', NULL),
                (3, 'travel', 'travel', NULL, 'checked', NULL),
                (4, 'bad-mode', 'regular', NULL, 'draft', NULL);
            INSERT INTO regular_items VALUES
                (10, 1, 1, NULL),
                (20, 3, 1, 10.00),
                (30, 999, 1, 20.00);
            INSERT INTO invoices VALUES
                (100, 'invoice-mismatch', 1, NULL, 20, 'regular', '', NULL),
                (101, 'invoice-no-invoice-mode', 2, NULL, 20, 'regular', '', NULL);
            INSERT INTO report_attachments VALUES
                (200, 'attachment-invoice-mode', 1, 10, 1, '', NULL),
                (201, 'attachment-no-item', 2, NULL, 0, '', NULL);
            PRAGMA user_version = 6;
            """
        )
        connection.commit()
    finally:
        connection.close()


def write_regular_database_with_travel_fields(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE expense_reports (
                id INTEGER PRIMARY KEY,
                report_uid TEXT,
                report_type TEXT,
                regular_mode TEXT,
                status TEXT,
                deleted_at DATETIME,
                department TEXT,
                purpose TEXT,
                daily_subsidy NUMERIC,
                subsidy_days INTEGER,
                subsidy_total NUMERIC,
                manual_subsidy_total NUMERIC,
                advance_date_month INTEGER,
                advance_date_day INTEGER,
                advance_amount NUMERIC,
                shortfall NUMERIC,
                surplus NUMERIC
            );
            INSERT INTO expense_reports VALUES
                (1, 'regular-hidden-travel-fields', 'regular', 'no_invoice', 'draft', NULL,
                 '财务部', '隐藏事由', 10, 1, 10, 0, 8, 1, 5, 2, 3),
                (2, 'regular-clean', 'regular', 'no_invoice', 'draft', NULL,
                 NULL, NULL, 0, 0, 0, NULL, NULL, NULL, 0, 0, 0),
                (3, 'travel-fields-allowed', 'travel', NULL, 'draft', NULL,
                 '财务部', '出差', 10, 1, 10, NULL, NULL, NULL, 0, 10, 0);
            PRAGMA user_version = 6;
            """
        )
        connection.commit()
    finally:
        connection.close()


def write_occupancy_database_with_integrity_issues(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE expense_reports (
                id INTEGER PRIMARY KEY,
                report_uid TEXT,
                report_type TEXT,
                status TEXT,
                report_date DATE,
                employee_name TEXT,
                deleted_at DATETIME
            );
            CREATE TABLE trips (
                id INTEGER PRIMARY KEY,
                report_id INTEGER,
                sort_order INTEGER,
                depart_date DATE,
                depart_month INTEGER,
                depart_day INTEGER,
                depart_hour INTEGER,
                arrive_date DATE,
                arrive_month INTEGER,
                arrive_day INTEGER,
                arrive_hour INTEGER,
                subsidy_start BOOLEAN,
                subsidy_end BOOLEAN
            );
            CREATE TABLE report_day_occupancies (
                id INTEGER PRIMARY KEY,
                report_id INTEGER,
                employee_key TEXT,
                occupied_on DATE
            );
            INSERT INTO expense_reports VALUES
                (1, 'report-1', 'travel', 'draft', '2026-07-19', '\t张三　', NULL),
                (2, 'report-2', 'regular', 'draft', '2026-07-19', '李四', NULL),
                (3, 'report-3', 'travel', 'draft', '2026-07-19', '王五', '2026-07-20 00:00:00');
            INSERT INTO trips VALUES
                (1, 1, 1, '2026-07-18', 7, 18, 8, '2026-07-19', 7, 19, 18, 0, 0);
            INSERT INTO report_day_occupancies VALUES
                (10, 999, '孤立人', '2026-07-18'),
                (11, 2, '李四', '2026-07-18'),
                (12, 3, '王五', '2026-07-18'),
                (13, 1, '李四', '2026-07-20'),
                (14, 1, '张三', '2026-07-18');
            PRAGMA user_version = 7;
            """
        )
        connection.commit()
    finally:
        connection.close()


def upload_file_from_bytes(payload: bytes, filename: str = "backup.zip") -> UploadFile:
    return UploadFile(file=BytesIO(payload), filename=filename)


def write_backup_zip(path: Path, created_at: str, reason: str = "manual") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, mode="w") as archive:
        archive.writestr(
            "backup-manifest.json",
            json.dumps(
                {
                    "schema_version": maintenance_service.BACKUP_SCHEMA_VERSION,
                    "app_version": "test",
                    "created_at": created_at,
                    "reason": reason,
                    "files": [],
                },
                ensure_ascii=False,
            ),
        )




def test_create_backup_zip_contains_manifest_database_uploads_and_hashes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "backup")
    (paths["uploads"] / "1").mkdir(parents=True)
    (paths["uploads"] / "1" / "invoice.pdf").write_bytes(b"invoice")
    paths["logs"].mkdir(parents=True)
    (paths["logs"] / "app.log").write_text("latest log", encoding="utf-8")

    backup = maintenance_service.create_backup(reason="manual")

    backup_path = Path(backup.path)
    assert backup_path.exists()
    with zipfile.ZipFile(backup_path) as archive:
        names = set(archive.namelist())
        assert "backup-manifest.json" in names
        assert "data/expense.db" in names
        assert "uploads/1/invoice.pdf" in names
        assert "logs/app.log.tail.txt" in names
        manifest = json.loads(archive.read("backup-manifest.json").decode("utf-8"))
        assert manifest["schema_version"] == maintenance_service.BACKUP_SCHEMA_VERSION
        assert manifest["uploads_included"] is True
        for item in manifest["files"]:
            payload = archive.read(item["path"])
            assert len(payload) == item["size_bytes"]
            assert maintenance_service._bytes_hash(payload) == item["sha256"]


def test_delete_backup_removes_selected_backup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    backup_path = paths["backups"] / "manual_20260625000100_a.zip"
    write_backup_zip(backup_path, "2026-06-25T00:01:00")

    result = maintenance_service.delete_backup(backup_path.name, confirm_delete=True)

    assert result.deleted is True
    assert result.backup_id == backup_path.name
    assert not backup_path.exists()


def test_cleanup_old_backups_keeps_latest_backup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    oldest = paths["backups"] / "manual_20260625000100_a.zip"
    middle = paths["backups"] / "manual_20260625000200_b.zip"
    latest = paths["backups"] / "manual_20260625000300_c.zip"
    write_backup_zip(oldest, "2026-06-25T00:01:00")
    write_backup_zip(middle, "2026-06-25T00:02:00")
    write_backup_zip(latest, "2026-06-25T00:03:00")

    result = maintenance_service.cleanup_old_backups(confirm_cleanup=True)

    assert result.kept_backup_id == latest.name
    assert {item.backup_id for item in result.deleted_backups} == {oldest.name, middle.name}
    assert latest.exists()
    assert not oldest.exists()
    assert not middle.exists()


def test_restore_preview_rejects_malicious_zip_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configure_runtime(monkeypatch, tmp_path)
    payload = BytesIO()
    with zipfile.ZipFile(payload, mode="w") as archive:
        archive.writestr("../evil.txt", "bad")
        archive.writestr(
            "backup-manifest.json",
            json.dumps({"schema_version": maintenance_service.BACKUP_SCHEMA_VERSION, "files": []}),
        )

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.create_restore_preview(upload_file_from_bytes(payload.getvalue()))

    assert exc_info.value.status_code == 400


def test_execute_restore_creates_pre_restore_backup_and_restores_data(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    fake_db = FakeDbConnection()
    monkeypatch.setattr(maintenance_service, "db_connection", fake_db)

    write_database(paths["database"], "backup")
    (paths["uploads"] / "1").mkdir(parents=True)
    (paths["uploads"] / "1" / "invoice.pdf").write_bytes(b"backup invoice")
    backup = maintenance_service.create_backup(reason="manual")

    write_database(paths["database"], "current")
    (paths["uploads"] / "1" / "invoice.pdf").write_bytes(b"current invoice")
    preview = maintenance_service.create_restore_preview(upload_file_from_bytes(Path(backup.path).read_bytes()))

    result = maintenance_service.execute_restore(preview.preview_id, confirm_restore=True)

    assert result.restored is True
    assert result.database_restored is True
    assert result.uploads_restored is True
    assert result.pre_restore_backup.filename.startswith("pre_restore_")
    assert Path(result.pre_restore_backup.path).exists()
    assert read_database_value(paths["database"]) == "backup"
    assert (paths["uploads"] / "1" / "invoice.pdf").read_bytes() == b"backup invoice"
    assert fake_db.engine.dispose_calls >= 1
    assert fake_db.migrate_calls == 1


def test_restore_dialog_preview_uses_backup_dir_as_initial_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(maintenance_service.sys, "platform", "win32")
    monkeypatch.setenv("REIMBURSEMENT_DESKTOP_MODE", "1")
    write_database(paths["database"], "backup")
    backup = maintenance_service.create_backup(reason="manual")
    captured: dict[str, Path | str] = {}

    def fake_file_dialog(initial_dir: Path, title: str) -> Path:
        captured["initial_dir"] = initial_dir
        captured["title"] = title
        return Path(backup.path)

    monkeypatch.setattr(maintenance_service, "_open_windows_zip_file_dialog", fake_file_dialog)

    result = maintenance_service.create_restore_preview_from_backup_dialog()

    assert result.selected is True
    assert result.filename == backup.filename
    assert result.preview is not None
    assert result.preview.database_included is True
    assert captured["initial_dir"] == paths["backups"]
    assert captured["title"] == "选择备份 ZIP"


def test_restore_dialog_preview_returns_unselected_when_cancelled(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    configure_runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(maintenance_service.sys, "platform", "win32")
    monkeypatch.setenv("REIMBURSEMENT_DESKTOP_MODE", "1")
    monkeypatch.setattr(maintenance_service, "_open_windows_zip_file_dialog", lambda _initial_dir, _title: None)

    result = maintenance_service.create_restore_preview_from_backup_dialog()

    assert result.selected is False
    assert result.filename is None
    assert result.preview is None


def test_maintenance_info_reports_runtime_paths_and_backups(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(maintenance_service, "is_webview2_available", lambda: True)
    monkeypatch.setattr(maintenance_service, "find_chromium_browser", lambda: ("Google Chrome", tmp_path / "chrome.exe"))
    monkeypatch.setattr(maintenance_service, "get_installed_opencv_runtime", lambda: None)
    monkeypatch.setattr(maintenance_service, "wechat_model_paths", lambda: {})
    write_database(paths["database"], "backup")
    backup = maintenance_service.create_backup(reason="manual")

    info = maintenance_service.get_maintenance_info()

    assert info.database_exists is True
    assert info.database_path == paths["database"].as_posix()
    assert info.backups[0].backup_id == backup.backup_id
    assert info.qr_engine.selected_engine == "zxing"
    assert info.browser_runtime.webview2_available is True
    assert info.browser_runtime.chromium_name == "Google Chrome"


def test_database_integrity_check_reports_business_and_attachment_issues(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_app_database_with_integrity_issues(paths["database"])

    result = maintenance_service.check_database_integrity()

    codes = {issue.code for issue in result.issues}
    assert result.status == "error"
    assert result.sqlite_integrity == "ok"
    assert result.tables["expense_reports"] == 1
    assert "invalid_report_status" in codes
    assert "missing_attachment_file" in codes


def test_database_integrity_check_covers_regular_item_and_mode_associations(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_regular_database_with_integrity_issues(paths["database"])

    result = maintenance_service.check_database_integrity()

    codes = {issue.code for issue in result.issues}
    assert result.status == "error"
    assert {
        "invalid_report_kind",
        "orphan_regular_item",
        "regular_item_on_travel_report",
        "invoice_regular_item_report_mismatch",
        "invoice_report_kind_mismatch",
        "attachment_report_kind_mismatch",
        "invalid_attachment_page_count",
    }.issubset(codes)


def test_database_integrity_check_reports_travel_fields_on_regular_reports(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_regular_database_with_travel_fields(paths["database"])

    result = maintenance_service.check_database_integrity()

    issue = next(item for item in result.issues if item.code == "regular_report_has_travel_fields")
    assert result.status == "error"
    assert issue.count == 1
    assert issue.details == ["report_id=1"]


def test_database_integrity_check_covers_report_day_occupancy_business_rules(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_occupancy_database_with_integrity_issues(paths["database"])

    result = maintenance_service.check_database_integrity()

    issues = {issue.code: issue for issue in result.issues}
    assert result.status == "error"
    assert {
        "orphan_report_day_occupancy",
        "occupancy_on_inactive_or_regular_report",
        "occupancy_employee_mismatch",
        "occupancy_date_outside_candidate_range",
    }.issubset(issues)
    assert issues["occupancy_on_inactive_or_regular_report"].count == 2
    assert issues["occupancy_employee_mismatch"].count == 1
    assert issues["occupancy_date_outside_candidate_range"].details == [
        "occupancy_id=13, report_id=1, occupied_on=2026-07-20"
    ]


def test_diagnostics_package_contains_logs_config_env_and_excludes_user_data(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(maintenance_service, "is_webview2_available", lambda: False)
    monkeypatch.setattr(maintenance_service, "find_chromium_browser", lambda: None)
    monkeypatch.setattr(maintenance_service, "get_installed_opencv_runtime", lambda: {"opencv_package_version": "4.10.0.84"})
    monkeypatch.setattr(maintenance_service, "wechat_model_paths", lambda: {})
    write_database(paths["database"], "private data")
    (paths["uploads"] / "1").mkdir(parents=True)
    (paths["uploads"] / "1" / "invoice.pdf").write_bytes(b"private invoice")
    (paths["app_root"] / "current-version.json").write_text(
        json.dumps({"current_version": "1.2.0-preview-20260624-001"}),
        encoding="utf-8",
    )
    (paths["app_root"] / "portable-release.json").write_text(
        json.dumps({"app_version": "1.2.0-preview-20260624-001"}),
        encoding="utf-8",
    )
    paths["logs"].mkdir(parents=True)
    (paths["logs"] / "app.log").write_text("diagnostic log", encoding="utf-8")

    payload, filename = maintenance_service.build_diagnostics_package()

    assert filename.endswith(".zip")
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "diagnostics.json" in names
        assert "summary.txt" in names
        assert "config/settings.json" in names
        assert "config/runtime.json" in names
        assert "env/environment.json" in names
        assert "logs/app.log" in names
        assert "data/expense.db" not in names
        assert "uploads/1/invoice.pdf" not in names
        diagnostics = json.loads(archive.read("diagnostics.json").decode("utf-8"))
        assert diagnostics["qr_engine"]["opencv_runtime_installed"] is True
        assert diagnostics["browser_runtime"]["preferred_runtime"] == "unavailable"
        assert diagnostics["runtime_config"]["files"]["current-version.json"]["content"]["current_version"] == (
            "1.2.0-preview-20260624-001"
        )
        runtime_config = json.loads(archive.read("config/runtime.json").decode("utf-8"))
        assert runtime_config["files"]["portable-release.json"]["content"]["app_version"] == (
            "1.2.0-preview-20260624-001"
        )
        summary = archive.read("summary.txt").decode("utf-8")
        assert "诊断包内容" in summary
        assert "不包含: data/expense.db、uploads/ 附件、备份 ZIP。" in summary
        assert json.loads(archive.read("config/settings.json").decode("utf-8"))["available"] is False


