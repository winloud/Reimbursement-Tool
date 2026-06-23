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
    assert "-BuildOpenCvRuntime" in workflow
    assert "-ReleaseDate $env:RELEASE_DATE" in workflow
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
    assert "China Standard Time" in workflow
    assert "-PreviewBuild" in workflow
    assert "-PreviewSerial" in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "retention-days: 14" in workflow
    assert "reimbursement-tool-v$version-$previewId" in workflow
    assert "gh release create" not in workflow
    assert "contents: read" in workflow
