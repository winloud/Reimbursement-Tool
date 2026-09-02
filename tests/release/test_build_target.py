from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "build_target.ps1"
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")
COMMIT = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def invoke(*args: str) -> subprocess.CompletedProcess[str]:
    if POWERSHELL is None:
        pytest.skip("PowerShell is required")
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


@pytest.mark.parametrize(
    ("target", "expected_order"),
    [("Zip", "Zip"), ("Tauri", "Tauri"), ("All", "Zip -> Tauri")],
)
def test_plan_exposes_target_chain_and_shared_build_context(target: str, expected_order: str):
    result = invoke(
        "-Target", target,
        "-Version", "2.0.0",
        "-ReleaseDate", "20260902",
        "-PlanOnly",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"order:        {expected_order}" in result.stdout
    assert "version:      2.0.0" in result.stdout
    assert f"commit:       {COMMIT}" in result.stdout


def test_all_supports_reverse_order_without_changing_target_contract():
    result = invoke(
        "-Target", "All",
        "-Version", "2.0.0",
        "-ReleaseDate", "20260902",
        "-BuildOrder", "TauriFirst",
        "-PlanOnly",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "order:        Tauri -> Zip" in result.stdout


def test_illegal_target_is_rejected_by_the_public_entrypoint():
    result = invoke("-Target", "Unknown", "-Version", "2.0.0", "-PlanOnly")

    assert result.returncode != 0
    assert "ValidateSet" in result.stderr or "Unknown" in result.stderr


def test_orchestrator_keeps_target_validators_and_failure_checks_explicit():
    script = SCRIPT.read_text(encoding="utf-8-sig")

    assert "build_release.ps1" in script
    assert "validate_zip_release.ps1" in script
    assert "build_tauri_release.ps1" in script
    assert "validate_tauri_release.ps1" in script
    assert 'throw "$Name failed with exit code $LASTEXITCODE."' in script
    assert "Formal target builds require a clean tracked worktree" in script
