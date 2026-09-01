from __future__ import annotations

from pathlib import Path

import pytest

from backend.distribution import (
    DISTRIBUTION_TARGET_ENV,
    DistributionTarget,
    get_distribution_target,
    parse_distribution_target,
)


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("zip", DistributionTarget.ZIP), ("tauri", DistributionTarget.TAURI), (" TAURI ", DistributionTarget.TAURI)],
)
def test_distribution_target_parsing(raw: str, expected: DistributionTarget):
    assert parse_distribution_target(raw) is expected


@pytest.mark.parametrize("raw", ["", "browser", "desktop", "foo"])
def test_invalid_distribution_target_fails_clearly(raw: str):
    with pytest.raises(RuntimeError, match=DISTRIBUTION_TARGET_ENV):
        parse_distribution_target(raw)


def test_missing_distribution_target_uses_temporary_zip_compatibility_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(DISTRIBUTION_TARGET_ENV, raising=False)
    assert get_distribution_target() is DistributionTarget.ZIP


def test_explicit_invalid_distribution_target_never_falls_back(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "foo")
    with pytest.raises(RuntimeError, match="仅支持 zip, tauri"):
        get_distribution_target()


def test_desktop_entries_inject_their_distribution_targets():
    desktop_source = (ROOT / "desktop_app.py").read_text(encoding="utf-8")
    launcher_source = (ROOT / "portable_launcher.py").read_text(encoding="utf-8")
    sidecar_source = (ROOT / "sidecar_app.py").read_text(encoding="utf-8")

    assert 'os.environ["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "zip"' in desktop_source
    assert 'env["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "zip"' in launcher_source
    assert 'os.environ["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "tauri"' in sidecar_source
