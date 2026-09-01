from __future__ import annotations

import os


DEFAULT_APP_VERSION = "1.4.2"


def resolve_app_version() -> str:
    # v2.0.0 起版本号由 Tauri 通过 REIMBURSEMENT_APP_VERSION 注入（见 ADR 0009）；
    # 旧便携版从 versions/<version>/ 目录名推断的路径已随 ZIP 链路一并删除。
    configured_version = os.environ.get("REIMBURSEMENT_APP_VERSION")
    if configured_version:
        return configured_version
    return DEFAULT_APP_VERSION


APP_VERSION = resolve_app_version()
APP_TITLE = "出差旅费报销管理工具"
