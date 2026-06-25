import importlib.util
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "extract_changelog_section.py"
spec = importlib.util.spec_from_file_location("extract_changelog_section", SCRIPT_PATH)
extract_changelog_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(extract_changelog_module)


def test_extract_changelog_section_accepts_plain_version():
    changelog = """# 更新日志

## Unreleased

## v1.1.1 - 2026-06-20

### Fixed

- 修复保存体验。

## v1.1.0 - 2026-06-09

### Added

- 历史版本。
"""

    assert (
        extract_changelog_module.extract_changelog_section(changelog, "1.1.1")
        == "### Fixed\n\n- 修复保存体验。"
    )


def test_extract_changelog_section_errors_when_version_missing():
    with pytest.raises(ValueError, match="not found"):
        extract_changelog_module.extract_changelog_section("## v1.0.0\n\n- old", "v9.9.9")


def test_release_workflow_extracts_changelog_before_publishing():
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "publish-release.yml").read_text(
        encoding="utf-8"
    )

    assert "scripts/extract_changelog_section.py" in workflow
    assert "gh release create" in workflow
    assert "release-notes.md" in workflow
    assert "BuildOpenCvRuntime = $true" in workflow
    assert "ReleaseDate = $env:RELEASE_DATE" in workflow
    assert "Validate local release ZIP" in workflow
    assert "-ZipPath $mainZip.FullName" in workflow
    assert "China Standard Time" in workflow
    assert "reimbursement-tool-v$env:RELEASE_VERSION-$env:RELEASE_DATE.zip" in workflow
    assert 'gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$tag"' in workflow
    assert "releases/assets/$($asset.id)" in workflow


def test_preview_workflow_manually_builds_artifact_without_publishing_release():
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "build-preview.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "preview_serial:" in workflow
    assert "docs/releases/active-plan.md" in workflow
    assert "China Standard Time" in workflow
    assert "actions: read" in workflow
    assert "actions/artifacts?per_page=100" in workflow
    assert "-PreviewBuild" in workflow
    assert "-PreviewSerial" in workflow
    assert "Expand-Archive -LiteralPath $previewZip.FullName" in workflow
    assert "Expanded preview artifact payload is missing portable-release.json." in workflow
    assert "artifact_path=release/preview-artifact-payload/*" in workflow
    assert "actions/upload-artifact@v7" in workflow
    assert "retention-days: 14" in workflow
    assert '$artifactBaseName = "reimbursement-tool-v$version-$previewId"' in workflow
    assert "gh release create" not in workflow
    assert "contents: read" in workflow


def test_release_publish_script_covers_release_governance_flow():
    script = (Path(__file__).resolve().parents[1] / "scripts" / "release_publish.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert "Assert-CleanWorktree" in script
    assert "Assert-ReleaseTagAvailable" in script
    assert "RepublishExistingTag" in script
    assert "Assert-ReleaseTagExistsForRepublish" in script
    assert "Update-Changelog" in script
    assert "Freeze-ReleasePlan" in script
    assert "prepare_release.ps1" in script
    assert "git\" -ArgumentList @(\"commit\", \"-m\", \"chore(release): publish $TagName\")" in script
    assert "git\" -ArgumentList @(\"tag\", \"-a\", $TagName" in script
    assert "git\" -ArgumentList @(\"tag\", \"-f\", \"-a\", $TagName" in script
    assert "refs/tags/${TagName}:refs/tags/${TagName}" in script
    assert "gh run watch" in script
    assert "validate_release_asset.ps1" in script
    assert "DownloadReleaseAssetForValidation" in script
    assert "MetadataOnly = $true" in script
    assert "collect_release_metrics.ps1" in script
    assert "docs(release): record $TagName verification" in script


def test_release_asset_validator_checks_portable_zip_contract():
    script = (Path(__file__).resolve().parents[1] / "scripts" / "validate_release_asset.ps1").read_text(
        encoding="utf-8"
    )

    assert "reimbursement-tool-v$Version-$ReleaseDate.zip" in script
    assert "Invoke-ReleaseAssetDownload" in script
    assert "MetadataOnly" in script
    assert "ZipPath" in script
    assert "github_release_metadata" in script
    assert "local_zip" in script
    assert "portable-release.json" in script
    assert "current-version.json" in script
    assert "versions/$Version" in script
    assert "data_schema_version" in script
    assert "min_supported_data_schema_version" in script
    assert "/data/" in script
    assert "/uploads/" in script
    assert "/logs/" in script
    assert "opencv-wechat-runtime-*.zip" in script


def test_release_metrics_collector_outputs_json_and_markdown():
    script = (Path(__file__).resolve().parents[1] / "scripts" / "collect_release_metrics.ps1").read_text(
        encoding="utf-8"
    )

    assert "gh run view $Id --json url,createdAt,updatedAt,conclusion,jobs" in script
    assert "duration_seconds" in script
    assert "CompareRunId" in script
    assert "OutputJson" in script
    assert "OutputMarkdown" in script
    assert "ConvertTo-MetricsMarkdown" in script
