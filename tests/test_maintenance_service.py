from __future__ import annotations

import json
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


def write_version_manifest(
    app_root: Path,
    version: str,
    *,
    data_schema_version: int = maintenance_service.DATA_SCHEMA_VERSION,
    min_supported_data_schema_version: int = maintenance_service.MIN_SUPPORTED_DATA_SCHEMA_VERSION,
    max_supported_data_schema_version: int = maintenance_service.MAX_SUPPORTED_DATA_SCHEMA_VERSION,
) -> None:
    version_dir = app_root / "versions" / version
    version_dir.mkdir(parents=True, exist_ok=True)
    (version_dir / "portable-release.json").write_text(
        json.dumps(
            {
                "schema_version": maintenance_service.UPDATE_SCHEMA_VERSION,
                "package_type": "reimbursement_portable_release",
                "app_version": version,
                "app_dir": "报销管理",
                "data_schema_version": data_schema_version,
                "min_supported_data_schema_version": min_supported_data_schema_version,
                "max_supported_data_schema_version": max_supported_data_schema_version,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def make_portable_release_zip(
    version: str = "1.2.0",
    *,
    include_data_compatibility: bool = True,
    data_schema_version: int = maintenance_service.DATA_SCHEMA_VERSION,
    min_supported_data_schema_version: int = maintenance_service.MIN_SUPPORTED_DATA_SCHEMA_VERSION,
    max_supported_data_schema_version: int = maintenance_service.MAX_SUPPORTED_DATA_SCHEMA_VERSION,
) -> bytes:
    payload = BytesIO()
    manifest = {
        "schema_version": maintenance_service.UPDATE_SCHEMA_VERSION,
        "package_type": "reimbursement_portable_release",
        "app_version": version,
        "app_dir": "报销管理",
        "executable_path": f"报销管理/versions/{version}/报销管理.exe",
    }
    current = {"current_version": version}
    if include_data_compatibility:
        manifest.update(
            {
                "data_schema_version": data_schema_version,
                "min_supported_data_schema_version": min_supported_data_schema_version,
                "max_supported_data_schema_version": max_supported_data_schema_version,
            }
        )
        current.update(
            {
                "data_schema_version": data_schema_version,
                "min_supported_data_schema_version": min_supported_data_schema_version,
                "max_supported_data_schema_version": max_supported_data_schema_version,
            }
        )
    with zipfile.ZipFile(payload, mode="w") as archive:
        archive.writestr("portable-release.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("报销管理/portable-release.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("报销管理/current-version.json", json.dumps(current, ensure_ascii=False))
        archive.writestr("报销管理/报销管理.exe", b"launcher")
        archive.writestr("报销管理/zip-upgrade-guide.md", "guide")
        archive.writestr(f"报销管理/versions/{version}/", b"")
        archive.writestr(f"报销管理/versions/{version}/报销管理.exe", b"app exe")
        if include_data_compatibility:
            archive.writestr(f"报销管理/versions/{version}/portable-release.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr(f"报销管理/versions/{version}/_internal/frontend/dist/index.html", b"html")
    return payload.getvalue()


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
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1" / "报销管理.exe").write_bytes(b"old exe")
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")
    backup = maintenance_service.create_backup(reason="manual")

    info = maintenance_service.get_maintenance_info()

    assert info.database_exists is True
    assert info.database_path == paths["database"].as_posix()
    assert info.backups[0].backup_id == backup.backup_id
    assert {version.version for version in info.installed_versions} == {"1.1.1", "1.2.0"}
    assert [version for version in info.installed_versions if version.current][0].version == "1.2.0"
    assert info.qr_engine.selected_engine == "zxing"
    assert info.browser_runtime.webview2_available is True
    assert info.browser_runtime.chromium_name == "Google Chrome"
    assert all(version.data_compatibility is not None for version in info.installed_versions)


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


def test_update_preview_validates_portable_release_package(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configure_runtime(monkeypatch, tmp_path)

    preview = maintenance_service.create_update_preview(upload_file_from_bytes(make_portable_release_zip("1.2.0"), "release.zip"))

    assert preview.app_version == "1.2.0"
    assert preview.package_format == "reimbursement_portable_release"
    assert preview.executable_path == "versions/1.2.0/报销管理.exe"
    assert preview.data_compatibility.status == "compatible"


def test_update_preview_marks_missing_data_compatibility_as_unknown(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    configure_runtime(monkeypatch, tmp_path)
    write_database(tmp_path / "app" / "data" / "expense.db", "current")

    preview = maintenance_service.create_update_preview(
        upload_file_from_bytes(
            make_portable_release_zip("1.2.0", include_data_compatibility=False),
            "release.zip",
        )
    )

    assert preview.data_compatibility.status == "unknown"
    assert "缺少数据兼容性信息" in preview.data_compatibility.message


def test_update_preview_rejects_malicious_zip_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configure_runtime(monkeypatch, tmp_path)
    payload = BytesIO()
    with zipfile.ZipFile(payload, mode="w") as archive:
        archive.writestr("../evil.txt", "bad")
        archive.writestr(
            "portable-release.json",
            json.dumps(
                {
                    "schema_version": maintenance_service.UPDATE_SCHEMA_VERSION,
                    "package_type": "reimbursement_portable_release",
                    "app_version": "1.2.0",
                    "app_dir": "报销管理",
                },
                ensure_ascii=False,
            ),
        )

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.create_update_preview(upload_file_from_bytes(payload.getvalue(), "release.zip"))

    assert exc_info.value.status_code == 400


def test_execute_update_installs_new_version_and_creates_pre_update_backup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current")
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.1.1"}', encoding="utf-8")
    preview = maintenance_service.create_update_preview(upload_file_from_bytes(make_portable_release_zip("1.2.0"), "release.zip"))

    result = maintenance_service.execute_update(preview.preview_id, confirm_update=True)

    assert result.installed is True
    assert result.app_version == "1.2.0"
    assert result.previous_version == "1.1.1"
    assert result.pre_update_backup.filename.startswith("pre_update_")
    assert (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").read_bytes() == b"app exe"
    assert (paths["app_root"] / "versions" / "1.2.0" / "portable-release.json").is_file()
    assert (paths["app_root"] / "报销管理.exe").read_bytes() == b"launcher"
    assert (paths["app_root"] / "zip-upgrade-guide.md").read_text(encoding="utf-8") == "guide"
    current = json.loads((paths["app_root"] / "current-version.json").read_text(encoding="utf-8"))
    assert current["current_version"] == "1.2.0"
    assert current["data_schema_version"] == maintenance_service.DATA_SCHEMA_VERSION


def test_execute_update_refuses_unknown_data_compatibility(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current")
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.1.1"}', encoding="utf-8")
    preview = maintenance_service.create_update_preview(
        upload_file_from_bytes(make_portable_release_zip("1.2.0", include_data_compatibility=False), "release.zip")
    )

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.execute_update(preview.preview_id, confirm_update=True)

    assert exc_info.value.status_code == 400
    assert "缺少数据兼容性信息" in exc_info.value.detail


def test_execute_update_refuses_incompatible_data_schema(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current", data_schema_version=maintenance_service.DATA_SCHEMA_VERSION + 1)
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.1.1"}', encoding="utf-8")
    preview = maintenance_service.create_update_preview(
        upload_file_from_bytes(
            make_portable_release_zip("1.2.0", data_schema_version=1, min_supported_data_schema_version=1, max_supported_data_schema_version=1),
            "release.zip",
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.execute_update(preview.preview_id, confirm_update=True)

    assert exc_info.value.status_code == 400
    assert "不在 1.2.0 支持范围" in exc_info.value.detail


def test_execute_update_refuses_existing_version_directory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.1.1"}', encoding="utf-8")
    preview = maintenance_service.create_update_preview(upload_file_from_bytes(make_portable_release_zip("1.2.0"), "release.zip"))

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.execute_update(preview.preview_id, confirm_update=True)

    assert exc_info.value.status_code == 409


def test_switch_installed_version_updates_current_version_and_creates_backup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current")
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1" / "报销管理.exe").write_bytes(b"old exe")
    write_version_manifest(paths["app_root"], "1.1.1")
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    result = maintenance_service.switch_installed_version("1.1.1", confirm_switch=True)

    assert result.switched is True
    assert result.app_version == "1.1.1"
    assert result.previous_version == "1.2.0"
    assert result.pre_switch_backup.filename.startswith("pre_version_switch_")
    current = json.loads((paths["app_root"] / "current-version.json").read_text(encoding="utf-8"))
    assert current["current_version"] == "1.1.1"
    assert current["previous_version"] == "1.2.0"
    assert current["data_schema_version"] == maintenance_service.DATA_SCHEMA_VERSION
    assert "switched_at" in current


def test_switch_installed_version_refuses_unknown_data_compatibility(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current")
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1" / "报销管理.exe").write_bytes(b"old exe")
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.switch_installed_version("1.1.1", confirm_switch=True)

    assert exc_info.value.status_code == 400
    assert "缺少数据兼容性信息" in exc_info.value.detail


def test_switch_installed_version_refuses_incompatible_data_schema(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "current", data_schema_version=maintenance_service.DATA_SCHEMA_VERSION + 1)
    paths["app_root"].mkdir(parents=True, exist_ok=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1" / "报销管理.exe").write_bytes(b"old exe")
    write_version_manifest(
        paths["app_root"],
        "1.1.1",
        data_schema_version=1,
        min_supported_data_schema_version=1,
        max_supported_data_schema_version=1,
    )
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.switch_installed_version("1.1.1", confirm_switch=True)

    assert exc_info.value.status_code == 400
    assert "不在 1.1.1 支持范围" in exc_info.value.detail


def test_switch_installed_version_rejects_missing_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions").mkdir()
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.switch_installed_version("1.1.1", confirm_switch=True)

    assert exc_info.value.status_code == 404


def test_delete_installed_version_removes_non_current_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.1.1" / "报销管理.exe").write_bytes(b"old exe")
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    result = maintenance_service.delete_installed_version("1.1.1", confirm_delete=True)

    assert result.deleted is True
    assert result.version == "1.1.1"
    assert not (paths["app_root"] / "versions" / "1.1.1").exists()
    assert (paths["app_root"] / "versions" / "1.2.0").exists()


def test_delete_installed_version_rejects_current_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0" / "报销管理.exe").write_bytes(b"new exe")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.delete_installed_version("1.2.0", confirm_delete=True)

    assert exc_info.value.status_code == 400
    assert "不能删除当前" in exc_info.value.detail
    assert (paths["app_root"] / "versions" / "1.2.0").exists()


def test_cleanup_old_installed_versions_keeps_current_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    for version in ("1.0.0", "1.1.1", "1.2.0"):
        (paths["app_root"] / "versions" / version).mkdir(parents=True)
        (paths["app_root"] / "versions" / version / "报销管理.exe").write_bytes(version.encode("utf-8"))
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")

    result = maintenance_service.cleanup_old_installed_versions(confirm_cleanup=True)

    assert {item.version for item in result.deleted_versions} == {"1.0.0", "1.1.1"}
    assert not (paths["app_root"] / "versions" / "1.0.0").exists()
    assert not (paths["app_root"] / "versions" / "1.1.1").exists()
    assert (paths["app_root"] / "versions" / "1.2.0").exists()


def test_request_application_restart_schedules_launcher(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions").mkdir()
    launcher = paths["app_root"] / "报销管理.exe"
    launcher.write_bytes(b"launcher")
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")
    monkeypatch.setattr(maintenance_service.sys, "platform", "win32")
    monkeypatch.setenv("REIMBURSEMENT_DESKTOP_MODE", "1")
    scheduled: list[tuple[Path, Path]] = []

    monkeypatch.setattr(
        maintenance_service.desktop_restart,
        "schedule_application_restart",
        lambda path, *, app_root: scheduled.append((path, app_root)),
    )

    result = maintenance_service.request_application_restart()

    assert result.restart_scheduled is True
    assert result.launcher_path == launcher.as_posix()
    assert scheduled == [(launcher, paths["app_root"])]


def test_request_application_restart_rejects_non_desktop_runtime(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions").mkdir()
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.2.0"}', encoding="utf-8")
    monkeypatch.setattr(maintenance_service.sys, "platform", "win32")
    monkeypatch.delenv("REIMBURSEMENT_DESKTOP_MODE", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.request_application_restart()

    assert exc_info.value.status_code == 400
