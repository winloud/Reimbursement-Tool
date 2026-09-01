from __future__ import annotations

import os
import sys
from pathlib import Path

from backend.distribution import DistributionTarget, TAURI_SOURCE_FALLBACK_ENV, get_distribution_target


SOURCE_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT_ENV = "REIMBURSEMENT_APP_ROOT"


def is_frozen_app() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", SOURCE_ROOT)).resolve()


def app_root() -> Path:
    target = get_distribution_target()
    configured_root = os.environ.get(APP_ROOT_ENV)

    if target is DistributionTarget.TAURI:
        if configured_root:
            return Path(configured_root).resolve()
        if not is_frozen_app() and os.environ.get(TAURI_SOURCE_FALLBACK_ENV) == "1":
            return SOURCE_ROOT
        raise RuntimeError(
            f"Tauri Target 缺少 {APP_ROOT_ENV}，拒绝回退到 ZIP 便携目录"
        )

    if configured_root:
        return Path(configured_root).resolve()
    if is_frozen_app():
        executable_dir = Path(sys.executable).resolve().parent
        if executable_dir.parent.name == "versions":
            return executable_dir.parent.parent
        return executable_dir
    return SOURCE_ROOT


def upload_root() -> Path:
    target = get_distribution_target()
    configured_root = os.environ.get(APP_ROOT_ENV)
    if target is DistributionTarget.TAURI:
        if configured_root:
            return app_root() / "uploads"
        if not is_frozen_app() and os.environ.get(TAURI_SOURCE_FALLBACK_ENV) == "1":
            return SOURCE_ROOT / "backend" / "uploads"
        return app_root() / "uploads"
    if configured_root or is_frozen_app():
        return app_root() / "uploads"
    return SOURCE_ROOT / "backend" / "uploads"


PROJECT_ROOT = SOURCE_ROOT
BUNDLE_ROOT = bundle_root()
APP_ROOT = app_root()
DATA_DIR = APP_ROOT / "data"
DATABASE_PATH = DATA_DIR / "expense.db"
UPLOAD_ROOT = upload_root()
LOG_DIR = APP_ROOT / "logs"
FRONTEND_DIST_DIR = BUNDLE_ROOT / "frontend" / "dist"


def resource_path(*parts: str) -> Path:
    return BUNDLE_ROOT.joinpath(*parts)


def uploaded_path(relative_path: str | Path, upload_root: Path = UPLOAD_ROOT) -> Path:
    path = Path(relative_path)
    if path.is_absolute():
        return path
    if path.parts and path.parts[0] == "uploads":
        return upload_root.joinpath(*path.parts[1:])
    return upload_root / path
