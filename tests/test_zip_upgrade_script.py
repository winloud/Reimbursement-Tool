from pathlib import Path


def test_zip_upgrade_script_uses_safe_copy_only_flow():
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts" / "upgrade_zip_release.ps1").read_text(encoding="utf-8")

    assert "[Parameter(Mandatory = $true)][string]$OldAppDir" in script
    assert "[Parameter(Mandatory = $true)][string]$NewAppDir" in script
    assert "[switch]$AllowExistingRuntimeOverwrite" in script
    assert "$AppBaseName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))" in script
    assert "Assert-AppNotRunning" in script
    assert "Compress-Archive" in script
    assert "$RuntimeDirsToCopy = @(\"data\", \"uploads\", \"vendor\")" in script
    assert "$RuntimeFilesToCopy = @(\"window-state.json\")" in script
    assert "Target runtime directory already exists" in script
    assert "Target runtime file already exists" in script
    assert "Remove-PathInside -Path $target -AllowedRoot $NewApp" in script


def test_release_zip_includes_upgrade_script():
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts" / "build_release.ps1").read_text(encoding="utf-8")

    assert "$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))" in script
    assert "reimbursement_launcher.spec" in script
    assert "portable-release.json" in script
    assert '"versions\\$PackageVersion"' in script
    assert "-PreviewSerial" in script
    assert "docs\\zip-upgrade-guide.md" in script
    assert "scripts\\upgrade_zip_release.ps1" in script
    assert "upgrade_zip_release.ps1" in script
