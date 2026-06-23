from __future__ import annotations

import os
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[1]


def is_frozen_app() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", SOURCE_ROOT)).resolve()


def app_root() -> Path:
    configured_root = os.environ.get("REIMBURSEMENT_APP_ROOT")
    if configured_root:
        return Path(configured_root).resolve()
    if is_frozen_app():
        executable_dir = Path(sys.executable).resolve().parent
        if executable_dir.parent.name == "versions":
            return executable_dir.parent.parent
        return executable_dir
    return SOURCE_ROOT


PROJECT_ROOT = SOURCE_ROOT
BUNDLE_ROOT = bundle_root()
APP_ROOT = app_root()
DATA_DIR = APP_ROOT / "data"
DATABASE_PATH = DATA_DIR / "expense.db"
UPLOAD_ROOT = APP_ROOT / "uploads" if is_frozen_app() else PROJECT_ROOT / "backend" / "uploads"
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
