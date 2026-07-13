from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path
from typing import TypedDict


class ChangelogMetadata(TypedDict):
    version: str
    tag: str
    release_date: str
    release_date_compact: str
    notes: str


def normalize_version(version: str) -> str:
    version = version.strip()
    if not version:
        raise ValueError("version must not be empty")
    return version if version.startswith("v") else f"v{version}"


def extract_changelog_metadata(changelog_text: str, version: str) -> ChangelogMetadata:
    normalized_version = normalize_version(version)
    version_heading_pattern = re.compile(rf"^##\s+{re.escape(normalized_version)}(?:\s.*)?$")
    dated_heading_pattern = re.compile(
        rf"^##\s+{re.escape(normalized_version)}\s+-\s+(\d{{4}}-\d{{2}}-\d{{2}})\s*$"
    )
    next_version_pattern = re.compile(r"^##\s+")

    lines = changelog_text.splitlines()
    matching_headings = [(index, line) for index, line in enumerate(lines) if version_heading_pattern.match(line)]

    if not matching_headings:
        raise ValueError(f"CHANGELOG section not found for {normalized_version}")
    if len(matching_headings) > 1:
        raise ValueError(f"CHANGELOG contains duplicate sections for {normalized_version}")

    heading_index, heading = matching_headings[0]
    dated_heading = dated_heading_pattern.fullmatch(heading)
    if dated_heading is None:
        raise ValueError(
            f"CHANGELOG heading for {normalized_version} must use '## {normalized_version} - YYYY-MM-DD'"
        )

    release_date = dated_heading.group(1)
    try:
        date.fromisoformat(release_date)
    except ValueError as exc:
        raise ValueError(f"CHANGELOG release date is invalid for {normalized_version}: {release_date}") from exc

    start_index = heading_index + 1
    end_index = len(lines)
    for index in range(start_index, len(lines)):
        if next_version_pattern.match(lines[index]):
            end_index = index
            break

    section = "\n".join(lines[start_index:end_index]).strip()
    if not section:
        raise ValueError(f"CHANGELOG section is empty for {normalized_version}")
    return {
        "version": normalized_version.removeprefix("v"),
        "tag": normalized_version,
        "release_date": release_date,
        "release_date_compact": release_date.replace("-", ""),
        "notes": section,
    }


def extract_changelog_section(changelog_text: str, version: str) -> str:
    return extract_changelog_metadata(changelog_text, version)["notes"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract one version section from CHANGELOG.md.")
    parser.add_argument("--version", required=True, help="Version to extract, with or without v prefix.")
    parser.add_argument("--changelog", default="CHANGELOG.md", help="Path to CHANGELOG.md.")
    parser.add_argument("--output", required=True, help="Path to write extracted release notes.")
    parser.add_argument("--metadata-output", help="Optional path to write release metadata as JSON.")
    args = parser.parse_args()

    changelog_path = Path(args.changelog)
    output_path = Path(args.output)
    metadata = extract_changelog_metadata(changelog_path.read_text(encoding="utf-8"), args.version)
    output_path.write_text(metadata["notes"] + "\n", encoding="utf-8")
    if args.metadata_output:
        metadata_output_path = Path(args.metadata_output)
        metadata_output_path.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
