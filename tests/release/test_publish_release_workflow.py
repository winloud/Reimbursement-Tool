import shutil
import subprocess
from pathlib import Path

import pytest
import yaml


WORKFLOW_PATH = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "publish-release.yml"


def workflow_text() -> str:
    return WORKFLOW_PATH.read_text(encoding="utf-8")


def test_release_workflow_supports_immutable_tag_push_and_manual_rebuild():
    workflow = workflow_text()

    assert 'tags:\n      - "v*"' in workflow
    assert "workflow_dispatch:" in workflow
    assert "run-name: Publish Release" in workflow
    assert "Existing immutable release tag to rebuild (vX.Y.Z)" in workflow
    assert "ref: refs/tags/${{ env.RELEASE_TAG }}" in workflow
    assert "fetch-depth: 0" in workflow
    assert "^v(?<version>0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" in workflow
    assert "Release tag must use strict SemVer vX.Y.Z format" in workflow
    assert "git merge-base --is-ancestor $tagCommit origin/main" in workflow
    assert "does not point to a commit contained in origin/main" in workflow


def test_release_workflow_is_serialized_and_bounded_per_tag():
    workflow = workflow_text()

    assert "group: publish-release-${{" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "timeout-minutes: 90" in workflow


def test_release_workflow_uses_changelog_metadata_for_release_date():
    workflow = workflow_text()

    assert "--metadata-output release-metadata.json" in workflow
    assert "$metadata.release_date" in workflow
    assert "yyyy-MM-dd" in workflow
    assert "China Standard Time" not in workflow
    assert "UtcNow" not in workflow
    assert "Get-Date" not in workflow


def test_release_workflow_verifies_reused_runtime_and_emits_integrity_assets():
    workflow = workflow_text()

    assert 'gh release download $release.tag_name --pattern "SHA256SUMS.txt"' in workflow
    assert "has no SHA256SUMS.txt; rejecting runtime candidate" in workflow
    assert "Get-FileHash -Algorithm SHA256" in workflow
    assert "Expand-Archive -LiteralPath $candidatePath" in workflow
    assert "Runtime ZIP is missing runtime.json" in workflow
    assert "Runtime manifest version or platform does not match" in workflow
    assert "Runtime manifest does not declare required model file" in workflow
    assert "Runtime cv2 directory has no files" in workflow
    assert "Runtime numpy directory has no files" in workflow
    assert 'Set-Content -LiteralPath "release\\release-manifest.json"' in workflow
    assert 'Set-Content -LiteralPath "release\\SHA256SUMS.txt"' in workflow
    assert "tag = $env:RELEASE_TAG" in workflow
    assert "commit = $env:RELEASE_COMMIT" in workflow
    assert "size = $_.Length" in workflow
    assert "sha256 =" in workflow


def test_release_workflow_drafts_new_release_and_preserves_unrelated_assets():
    workflow = workflow_text()

    assert "gh release create $tag @assetPaths --draft" in workflow
    assert "gh release edit $tag --draft=false" in workflow
    assert "gh release upload $tag @assetPaths --clobber" in workflow
    assert "reimbursement-tool-v$env:RELEASE_VERSION-$env:RELEASE_DATE.zip" in workflow
    assert 'Get-Item -LiteralPath "release\\release-manifest.json"' in workflow
    assert 'Get-Item -LiteralPath "release\\SHA256SUMS.txt"' in workflow
    assert "repos/$env:GITHUB_REPOSITORY/releases/assets/" not in workflow
    assert "gh api -X DELETE" not in workflow
    assert "--force" not in workflow


def test_release_workflow_yaml_and_powershell_blocks_parse(tmp_path: Path):
    workflow = yaml.load(workflow_text(), Loader=yaml.BaseLoader)
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if powershell is None:
        pytest.skip("PowerShell is required to parse workflow run blocks")

    blocks = [
        step["run"]
        for step in workflow["jobs"]["release"]["steps"]
        if step.get("shell") == "pwsh" and "run" in step
    ]
    assert len(blocks) == 7

    for index, block in enumerate(blocks):
        script_path = tmp_path / f"workflow-step-{index}.ps1"
        script_path.write_text(block, encoding="utf-8-sig")
        escaped_path = str(script_path).replace("'", "''")
        command = (
            "$errors=$null; "
            f"[System.Management.Automation.Language.Parser]::ParseFile('{escaped_path}', [ref]$null, [ref]$errors) | Out-Null; "
            "if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}"
        )
        result = subprocess.run(
            [powershell, "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        assert result.returncode == 0, result.stdout + result.stderr
