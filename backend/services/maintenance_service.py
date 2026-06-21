from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from backend.app_metadata import APP_VERSION
from backend.database import connection as db_connection
from backend.runtime_paths import APP_ROOT, DATA_DIR, DATABASE_PATH, LOG_DIR, UPLOAD_ROOT
from backend.schemas.maintenance import BackupRead, MaintenanceInfoRead, RestoreExecuteRead, RestorePreviewRead, UpdateExecuteRead, UpdatePreviewRead

BACKUP_SCHEMA_VERSION = 1
UPDATE_SCHEMA_VERSION = 1
BACKUP_ROOT = DATA_DIR / "backups"
RESTORE_STAGING_ROOT = DATA_DIR / "restore_staging"
UPDATE_STAGING_ROOT = DATA_DIR / "update_staging"
VENDOR_ROOT = APP_ROOT / "vendor"
MANIFEST_NAME = "backup-manifest.json"
PORTABLE_RELEASE_MANIFEST_NAME = "portable-release.json"
APP_DIR_NAME = "报销管理"
APP_EXE_NAME = "报销管理.exe"
CURRENT_VERSION_FILE = "current-version.json"
VERSIONS_DIR_NAME = "versions"
LOG_TAIL_BYTES = 200 * 1024


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


def _safe_version(version: str | None) -> str:
    if not version or any(part in version for part in ("/", "\\", "..")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的更新版本号")
    return version


def _is_portable_install() -> bool:
    return (APP_ROOT / CURRENT_VERSION_FILE).is_file() and (APP_ROOT / VERSIONS_DIR_NAME).is_dir()


def _current_installed_version() -> str | None:
    current_path = APP_ROOT / CURRENT_VERSION_FILE
    try:
        payload = json.loads(current_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return APP_VERSION
    version = payload.get("current_version")
    if isinstance(version, str) and version:
        return version
    return APP_VERSION


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


def get_maintenance_info() -> MaintenanceInfoRead:
    current_version = _current_installed_version()
    current_version_dir = None
    if current_version:
        current_version_dir = (APP_ROOT / VERSIONS_DIR_NAME / current_version).as_posix()
    return MaintenanceInfoRead(
        app_version=APP_VERSION,
        app_root=APP_ROOT.as_posix(),
        portable_install=_is_portable_install(),
        current_version=current_version,
        current_version_dir=current_version_dir,
        launcher_path=(APP_ROOT / APP_EXE_NAME).as_posix(),
        data_dir=DATA_DIR.as_posix(),
        database_path=DATABASE_PATH.as_posix(),
        uploads_dir=UPLOAD_ROOT.as_posix(),
        backups_dir=BACKUP_ROOT.as_posix(),
        logs_dir=LOG_DIR.as_posix(),
        database_exists=DATABASE_PATH.exists(),
        uploads_exists=UPLOAD_ROOT.exists(),
        backups=list_backups(),
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


def get_backup_file(backup_id: str) -> Path:
    path = _backup_path(backup_id)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="备份不存在")
    return path


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


def _read_update_manifest(archive: zipfile.ZipFile) -> dict:
    names = archive.namelist()
    for name in names:
        _safe_archive_name(name)

    manifest_name = PORTABLE_RELEASE_MANIFEST_NAME
    if manifest_name not in names:
        nested_manifest = f"{APP_DIR_NAME}/{PORTABLE_RELEASE_MANIFEST_NAME}"
        if nested_manifest in names:
            manifest_name = nested_manifest
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="更新包缺少 portable-release.json")

    try:
        manifest = json.loads(archive.read(manifest_name).decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="portable-release.json 格式无效") from exc
    if manifest.get("schema_version") != UPDATE_SCHEMA_VERSION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="更新包版本不支持")
    if manifest.get("package_type") != "reimbursement_portable_release":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不是有效的便携发布更新包")
    if manifest.get("app_dir") != APP_DIR_NAME:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="更新包应用目录不匹配")
    _safe_version(manifest.get("app_version"))
    return manifest


def _validate_update_package(package_path: Path) -> dict:
    try:
        archive = zipfile.ZipFile(package_path)
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="更新包不是有效 ZIP 文件") from exc
    try:
        manifest = _read_update_manifest(archive)
        names = set(archive.namelist())
        version = _safe_version(manifest.get("app_version"))
        required = {
            f"{APP_DIR_NAME}/{APP_EXE_NAME}",
            f"{APP_DIR_NAME}/{CURRENT_VERSION_FILE}",
            f"{APP_DIR_NAME}/{PORTABLE_RELEASE_MANIFEST_NAME}",
            f"{APP_DIR_NAME}/{VERSIONS_DIR_NAME}/{version}/{APP_EXE_NAME}",
        }
        missing = sorted(required - names)
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"更新包缺少文件：{missing[0]}")
        return manifest
    finally:
        archive.close()


def _preview_update_from_manifest(preview_id: str, package_path: Path, manifest: dict) -> UpdatePreviewRead:
    version = _safe_version(manifest.get("app_version"))
    files_total = 0
    with zipfile.ZipFile(package_path) as archive:
        files_total = sum(1 for item in archive.infolist() if not item.is_dir())
    return UpdatePreviewRead(
        preview_id=preview_id,
        app_version=version,
        package_format=str(manifest.get("package_type")),
        files_total=files_total,
        size_bytes=package_path.stat().st_size,
        version_dir=f"{VERSIONS_DIR_NAME}/{version}",
        executable_path=f"{VERSIONS_DIR_NAME}/{version}/{APP_EXE_NAME}",
    )


def create_update_preview(upload_file: UploadFile) -> UpdatePreviewRead:
    preview_id = uuid4().hex
    preview_dir = UPDATE_STAGING_ROOT / preview_id
    preview_dir.mkdir(parents=True, exist_ok=False)
    package_path = preview_dir / "release.zip"
    with package_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)

    manifest = _validate_update_package(package_path)
    return _preview_update_from_manifest(preview_id, package_path, manifest)


def _update_preview_package(preview_id: str) -> tuple[Path, dict]:
    safe_id = _safe_preview_id(preview_id)
    package_path = UPDATE_STAGING_ROOT / safe_id / "release.zip"
    if not package_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="更新预览不存在或已过期")
    manifest = _validate_update_package(package_path)
    return package_path, manifest


def _extract_update_payload(package_path: Path, manifest: dict, target_root: Path) -> None:
    version = _safe_version(manifest.get("app_version"))
    allowed_root_files = {
        APP_EXE_NAME,
        CURRENT_VERSION_FILE,
        PORTABLE_RELEASE_MANIFEST_NAME,
        "README.md",
        "zip-upgrade-guide.md",
        "upgrade_zip_release.ps1",
    }
    version_prefix = PurePosixPath(APP_DIR_NAME, VERSIONS_DIR_NAME, version)
    app_prefix = f"{APP_DIR_NAME}/"

    with zipfile.ZipFile(package_path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            safe_name = _safe_archive_name(item.filename)
            if safe_name == PORTABLE_RELEASE_MANIFEST_NAME:
                continue
            if not safe_name.startswith(app_prefix):
                continue

            relative = PurePosixPath(safe_name).relative_to(APP_DIR_NAME)
            if len(relative.parts) == 1 and relative.parts[0] in allowed_root_files:
                target = _path_inside(target_root, relative.as_posix())
            elif PurePosixPath(APP_DIR_NAME, *relative.parts).is_relative_to(version_prefix):
                target = _path_inside(target_root, relative.as_posix())
            else:
                continue
            _write_archive_file(archive, safe_name, target)


def execute_update(preview_id: str, confirm_update: bool) -> UpdateExecuteRead:
    if not confirm_update:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="安装更新需要二次确认")
    if not _is_portable_install():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前运行目录不是便携式安装根目录，不能执行程序内更新")

    package_path, manifest = _update_preview_package(preview_id)
    version = _safe_version(manifest.get("app_version"))
    previous_version = _current_installed_version()
    target_version_dir = APP_ROOT / VERSIONS_DIR_NAME / version
    if target_version_dir.exists():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"版本目录已存在：{target_version_dir}")

    work_root = UPDATE_STAGING_ROOT / _safe_preview_id(preview_id) / "work"
    extracted_root = work_root / "extracted"
    try:
        if work_root.exists():
            shutil.rmtree(work_root)
        extracted_root.mkdir(parents=True, exist_ok=True)
        _extract_update_payload(package_path, manifest, extracted_root)

        extracted_version_dir = extracted_root / VERSIONS_DIR_NAME / version
        extracted_exe = extracted_version_dir / APP_EXE_NAME
        if not extracted_exe.is_file():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="更新包未包含可执行程序")

        pre_update_backup = create_backup(reason="pre_update")
        (APP_ROOT / VERSIONS_DIR_NAME).mkdir(parents=True, exist_ok=True)
        shutil.move(str(extracted_version_dir), str(target_version_dir))

        for name in (APP_EXE_NAME, PORTABLE_RELEASE_MANIFEST_NAME, "README.md", "zip-upgrade-guide.md", "upgrade_zip_release.ps1"):
            source = extracted_root / name
            if source.exists() and source.is_file():
                shutil.copy2(source, APP_ROOT / name)

        current_payload = {
            "current_version": version,
            "previous_version": previous_version,
            "updated_at": _utc_now().isoformat(),
        }
        temp_current = APP_ROOT / f"{CURRENT_VERSION_FILE}.tmp"
        temp_current.write_text(json.dumps(current_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_current.replace(APP_ROOT / CURRENT_VERSION_FILE)
    finally:
        try:
            shutil.rmtree(work_root)
        except OSError:
            pass

    return UpdateExecuteRead(
        installed=True,
        app_version=version,
        previous_version=previous_version,
        pre_update_backup=pre_update_backup,
        restart_required=True,
        version_dir=(APP_ROOT / VERSIONS_DIR_NAME / version).as_posix(),
    )


def build_diagnostics_json() -> tuple[bytes, str]:
    info = get_maintenance_info()
    payload = {
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
            "portable_install": info.portable_install,
            "current_version": info.current_version,
            "database_exists": info.database_exists,
            "uploads_exists": info.uploads_exists,
            "backups_total": len(info.backups),
        },
        "backups": [backup.model_dump() for backup in info.backups[:20]],
    }
    filename = f"reimbursement-diagnostics-{_timestamp()}.json"
    return _write_json_bytes(payload), filename
