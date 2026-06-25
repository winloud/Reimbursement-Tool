from __future__ import annotations

import os
import sys
from pathlib import Path


DEFAULT_APP_VERSION = "1.2.2"


def resolve_app_version() -> str:
    configured_version = os.environ.get("REIMBURSEMENT_APP_VERSION")
    if configured_version:
        return configured_version
    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        if executable_dir.parent.name == "versions":
            return executable_dir.name
    return DEFAULT_APP_VERSION


APP_VERSION = resolve_app_version()
APP_TITLE = "出差旅费报销管理工具"
