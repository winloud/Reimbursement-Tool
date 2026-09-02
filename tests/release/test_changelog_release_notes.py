import importlib.util
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "extract_changelog_section.py"
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
    workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "publish-release.yml").read_text(
        encoding="utf-8"
    )

    assert "scripts/extract_changelog_section.py" in workflow
    assert "gh release create" in workflow
    assert "release-notes.md" in workflow
    assert "build_tauri_release.ps1" in workflow
    assert "validate_tauri_release.ps1" in workflow
    assert "verify.ps1 -Profile Desktop" in workflow
    assert "build_opencv_runtime.ps1" in workflow
    assert "ReleaseDate = $env:RELEASE_DATE" in workflow
    assert "Validate Tauri release" in workflow
    assert "if (-not $?)" in workflow
    assert "--metadata-output release-metadata.json" in workflow
    assert '$metadata.release_date' in workflow
    assert "*-setup.exe" in workflow
    assert "dist-feed" in workflow
    assert 'gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$tag"' in workflow
    assert "release-manifest.json" in workflow
    assert "SHA256SUMS.txt" in workflow
    assert "releases/assets/$($asset.id)" not in workflow
    # Tauri 发布工作流保持单一职责，不混入并行 ZIP 工作流。
    assert "build_release.ps1" not in workflow
    assert "BuildOpenCvRuntime" not in workflow


def test_preview_workflow_manually_builds_artifact_without_publishing_release():
    workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "build-preview.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "preview_serial:" in workflow
    assert "docs/releases/active-plan.md" in workflow
    assert "China Standard Time" in workflow
    assert "actions: read" in workflow
    assert "actions/artifacts?per_page=100" in workflow
    assert "build_tauri_release.ps1" in workflow
    assert "verify.ps1 -Profile Desktop" in workflow
    assert "Preview NSIS setup exe was not generated" in workflow
    assert "artifact_path=release/preview-artifact-payload/*" in workflow
    assert "actions/upload-artifact@v7" in workflow
    assert "retention-days: 14" in workflow
    assert '$artifactBaseName = "reimbursement-tool-v$version-$previewId"' in workflow
    assert "gh release create" not in workflow
    assert "contents: read" in workflow
    # Tauri 预览工作流保持单一职责，ZIP 使用 build-zip-preview.yml。
    assert "build_release.ps1" not in workflow
    assert "portable-release.json" not in workflow


def test_release_publish_script_covers_release_governance_flow():
    script = (Path(__file__).resolve().parents[2] / "scripts" / "release_publish.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert "Assert-CleanForNewPreparation" in script
    assert "Assert-OnlyReleaseChanges" in script
    assert "AllowUntracked" in script
    assert 'ReleaseBranch = "main"' in script
    assert "Assert-ReleaseBranch" in script
    assert "Formal releases must be published from '$ReleaseBranch'" in script
    assert "Assert-ReleaseBranch -Branch $branch" in script
    assert "Test-ReleasePrepared" in script
    assert "Get-RemoteTagCommit" in script
    assert "Assert-TagCommitMatches" in script
    assert "NotBeforeUtc" in script
    assert "$parsed = $json | ConvertFrom-Json" in script
    assert "Update-Changelog" in script
    assert "Freeze-ReleasePlan" in script
    assert "prepare_release.ps1" in script
    assert "git\" -ArgumentList @(\"commit\", \"-m\", \"chore(release): publish $TagName\")" in script
    assert "Create immutable release tag" in script
    assert 'gh workflow run "Publish Release" --ref $ReleaseBranch' in script
    assert "RepublishExistingTag" not in script
    assert 'git reset --hard' not in script
    assert 'git push --delete' not in script
    assert 'git push --force' not in script
    assert 'tag\", \"-f' not in script
    assert "gh run watch" in script
    assert "gh run rerun" not in script
    assert "validate_release_asset.ps1" in script
    assert "DownloadReleaseAssetForValidation" in script
    assert "MetadataOnly = $true" in script
    assert "collect_release_metrics.ps1" in script
    assert "docs(release): record $TagName verification" not in script


def test_release_process_documents_main_first_release_flow():
    document = (Path(__file__).resolve().parents[2] / "docs" / "release-process.md").read_text(encoding="utf-8")

    assert "正式版本只从已合并并推送的 `main` 发布" in document
    assert "将开发分支合并到 `main`" in document
    assert "git checkout main" in document
    assert "git pull --ff-only origin main" in document
    assert "-Publish" in document
    assert "已推送的正式 `vX.Y.Z` tag 永不移动" in document
    assert "git push origin <branch>" not in document


def test_release_asset_validator_checks_nsis_and_updater_feed_contract():
    script = (Path(__file__).resolve().parents[2] / "scripts" / "validate_release_asset.ps1").read_text(
        encoding="utf-8"
    )

    assert "Invoke-ReleaseAssetDownload" in script
    assert "MetadataOnly" in script
    assert "github_release_metadata" in script
    assert "-setup.exe" in script
    assert "Updater signature asset is missing" in script
    assert "latest.json" in script
    assert "data-compat.json" in script
    assert "windows-x86_64" in script
    assert "min_data_schema_version" in script
    assert "opencv-wechat-runtime-*.zip" in script
    # Tauri 远端 validator 不混入 ZIP 契约；ZIP 使用 validate_zip_release.ps1。
    assert "portable-release.json" not in script
    assert "current-version.json" not in script
    assert "ZipPath" not in script


def test_release_metrics_collector_outputs_json_and_markdown():
    script = (Path(__file__).resolve().parents[2] / "scripts" / "collect_release_metrics.ps1").read_text(
        encoding="utf-8"
    )

    assert "gh run view $Id --json url,createdAt,updatedAt,conclusion,jobs" in script
    assert "duration_seconds" in script
    assert "CompareRunId" in script
    assert "OutputJson" in script
    assert "OutputMarkdown" in script
    assert "ConvertTo-MetricsMarkdown" in script
