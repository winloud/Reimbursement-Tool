from __future__ import annotations

import os
import sys
from pathlib import Path

from backend.distribution import DistributionTarget, TAURI_SOURCE_FALLBACK_ENV, get_distribution_target


DEFAULT_APP_VERSION = "1.4.2"
APP_VERSION_ENV = "REIMBURSEMENT_APP_VERSION"


def resolve_app_version() -> str:
    target = get_distribution_target()
    configured_version = os.environ.get(APP_VERSION_ENV)

    if target is DistributionTarget.TAURI:
        if configured_version:
            return configured_version
        if not getattr(sys, "frozen", False) and os.environ.get(TAURI_SOURCE_FALLBACK_ENV) == "1":
            return DEFAULT_APP_VERSION
        raise RuntimeError(f"Tauri Target 缺少 {APP_VERSION_ENV}")

    if configured_version:
        return configured_version
    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        if executable_dir.parent.name == "versions":
            return executable_dir.name
    return DEFAULT_APP_VERSION


APP_VERSION = resolve_app_version()
APP_TITLE = "出差旅费报销管理工具"
