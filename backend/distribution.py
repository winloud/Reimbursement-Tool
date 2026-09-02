from __future__ import annotations

import os
from enum import Enum


DISTRIBUTION_TARGET_ENV = "REIMBURSEMENT_DISTRIBUTION_TARGET"
TAURI_SOURCE_FALLBACK_ENV = "REIMBURSEMENT_ALLOW_TAURI_SOURCE_FALLBACK"


class DistributionTarget(str, Enum):
    ZIP = "zip"
    TAURI = "tauri"


def parse_distribution_target(value: str) -> DistributionTarget:
    try:
        return DistributionTarget(value.strip().lower())
    except (AttributeError, ValueError) as exc:
        supported = ", ".join(target.value for target in DistributionTarget)
        raise RuntimeError(
            f"{DISTRIBUTION_TARGET_ENV} 无效：{value!r}；仅支持 {supported}"
        ) from exc


def get_distribution_target() -> DistributionTarget:
    raw_target = os.environ.get(DISTRIBUTION_TARGET_ENV)
    if raw_target is None:
        raise RuntimeError(
            f"未设置 {DISTRIBUTION_TARGET_ENV}；必须显式指定 zip 或 tauri"
        )
    return parse_distribution_target(raw_target)
