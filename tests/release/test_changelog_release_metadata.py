import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "extract_changelog_section.py"
spec = importlib.util.spec_from_file_location("extract_changelog_release_metadata", SCRIPT_PATH)
extract_changelog_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(extract_changelog_module)


def test_extract_changelog_metadata_returns_release_fields():
    changelog = """# 更新日志

## Unreleased

## v1.2.3 - 2026-07-13

### Added

- 新增发布元数据。

## v1.2.2 - 2026-07-01

- 旧版本。
"""

    assert extract_changelog_module.extract_changelog_metadata(changelog, "1.2.3") == {
        "version": "1.2.3",
        "tag": "v1.2.3",
        "release_date": "2026-07-13",
        "release_date_compact": "20260713",
        "notes": "### Added\n\n- 新增发布元数据。",
    }


@pytest.mark.parametrize("release_date", ["2026-7-13", "2026/07/13", "2026-02-30"])
def test_extract_changelog_metadata_rejects_invalid_release_date(release_date):
    changelog = f"## v1.2.3 - {release_date}\n\n- notes"

    with pytest.raises(ValueError, match="YYYY-MM-DD|release date is invalid"):
        extract_changelog_module.extract_changelog_metadata(changelog, "1.2.3")


def test_extract_changelog_metadata_rejects_duplicate_version_headings():
    changelog = """## v1.2.3 - 2026-07-13

- first

## v1.2.3 - 2026-07-14

- second
"""

    with pytest.raises(ValueError, match="duplicate sections"):
        extract_changelog_module.extract_changelog_metadata(changelog, "1.2.3")


def test_extract_changelog_metadata_errors_when_version_missing():
    with pytest.raises(ValueError, match="not found"):
        extract_changelog_module.extract_changelog_metadata("## v1.2.2 - 2026-07-01\n\n- old", "1.2.3")


def test_extract_changelog_metadata_errors_when_notes_are_empty():
    changelog = """## v1.2.3 - 2026-07-13

## v1.2.2 - 2026-07-01

- old
"""

    with pytest.raises(ValueError, match="section is empty"):
        extract_changelog_module.extract_changelog_metadata(changelog, "1.2.3")


def test_cli_writes_release_notes_and_metadata_json(tmp_path):
    changelog_path = tmp_path / "CHANGELOG.md"
    notes_path = tmp_path / "release-notes.md"
    metadata_path = tmp_path / "release-metadata.json"
    changelog_path.write_text(
        "## v1.2.3 - 2026-07-13\n\n### Fixed\n\n- 修复发布流程。\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--version",
            "v1.2.3",
            "--changelog",
            str(changelog_path),
            "--output",
            str(notes_path),
            "--metadata-output",
            str(metadata_path),
        ],
        check=True,
    )

    assert notes_path.read_text(encoding="utf-8") == "### Fixed\n\n- 修复发布流程。\n"
    assert json.loads(metadata_path.read_text(encoding="utf-8")) == {
        "version": "1.2.3",
        "tag": "v1.2.3",
        "release_date": "2026-07-13",
        "release_date_compact": "20260713",
        "notes": "### Fixed\n\n- 修复发布流程。",
    }
