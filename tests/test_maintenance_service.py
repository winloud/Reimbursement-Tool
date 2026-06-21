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


def write_database(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS sample (value TEXT)")
        connection.execute("DELETE FROM sample")
        connection.execute("INSERT INTO sample (value) VALUES (?)", (value,))
        connection.commit()
    finally:
        connection.close()


def read_database_value(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT value FROM sample").fetchone()[0]
    finally:
        connection.close()


def upload_file_from_bytes(payload: bytes, filename: str = "backup.zip") -> UploadFile:
    return UploadFile(file=BytesIO(payload), filename=filename)


def make_portable_release_zip(version: str = "1.2.0") -> bytes:
    payload = BytesIO()
    manifest = {
        "schema_version": maintenance_service.UPDATE_SCHEMA_VERSION,
        "package_type": "reimbursement_portable_release",
        "app_version": version,
        "app_dir": "报销管理",
        "executable_path": f"报销管理/versions/{version}/报销管理.exe",
    }
    current = {"current_version": version}
    with zipfile.ZipFile(payload, mode="w") as archive:
        archive.writestr("portable-release.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("报销管理/portable-release.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("报销管理/current-version.json", json.dumps(current, ensure_ascii=False))
        archive.writestr("报销管理/报销管理.exe", b"launcher")
        archive.writestr("报销管理/zip-upgrade-guide.md", "guide")
        archive.writestr(f"报销管理/versions/{version}/", b"")
        archive.writestr(f"报销管理/versions/{version}/报销管理.exe", b"app exe")
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


def test_maintenance_info_reports_runtime_paths_and_backups(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    write_database(paths["database"], "backup")
    backup = maintenance_service.create_backup(reason="manual")

    info = maintenance_service.get_maintenance_info()

    assert info.database_exists is True
    assert info.database_path == paths["database"].as_posix()
    assert info.backups[0].backup_id == backup.backup_id


def test_update_preview_validates_portable_release_package(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configure_runtime(monkeypatch, tmp_path)

    preview = maintenance_service.create_update_preview(upload_file_from_bytes(make_portable_release_zip("1.2.0"), "release.zip"))

    assert preview.app_version == "1.2.0"
    assert preview.package_format == "reimbursement_portable_release"
    assert preview.executable_path == "versions/1.2.0/报销管理.exe"


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
    assert (paths["app_root"] / "报销管理.exe").read_bytes() == b"launcher"
    assert (paths["app_root"] / "zip-upgrade-guide.md").read_text(encoding="utf-8") == "guide"
    current = json.loads((paths["app_root"] / "current-version.json").read_text(encoding="utf-8"))
    assert current["current_version"] == "1.2.0"


def test_execute_update_refuses_existing_version_directory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    paths = configure_runtime(monkeypatch, tmp_path)
    paths["app_root"].mkdir(parents=True)
    (paths["app_root"] / "versions" / "1.2.0").mkdir(parents=True)
    (paths["app_root"] / "current-version.json").write_text('{"current_version":"1.1.1"}', encoding="utf-8")
    preview = maintenance_service.create_update_preview(upload_file_from_bytes(make_portable_release_zip("1.2.0"), "release.zip"))

    with pytest.raises(HTTPException) as exc_info:
        maintenance_service.execute_update(preview.preview_id, confirm_update=True)

    assert exc_info.value.status_code == 409
