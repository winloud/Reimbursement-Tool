from __future__ import annotations

import argparse
import re
from pathlib import Path


def normalize_version(version: str) -> str:
    version = version.strip()
    if not version:
        raise ValueError("version must not be empty")
    return version if version.startswith("v") else f"v{version}"


def extract_changelog_section(changelog_text: str, version: str) -> str:
    normalized_version = normalize_version(version)
    heading_pattern = re.compile(rf"^##\s+{re.escape(normalized_version)}(?:\s+-\s+.+)?\s*$")
    next_version_pattern = re.compile(r"^##\s+")

    lines = changelog_text.splitlines()
    start_index: int | None = None
    for index, line in enumerate(lines):
        if heading_pattern.match(line):
            start_index = index + 1
            break

    if start_index is None:
        raise ValueError(f"CHANGELOG section not found for {normalized_version}")

    end_index = len(lines)
    for index in range(start_index, len(lines)):
        if next_version_pattern.match(lines[index]):
            end_index = index
            break

    section = "\n".join(lines[start_index:end_index]).strip()
    if not section:
        raise ValueError(f"CHANGELOG section is empty for {normalized_version}")
    return section


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract one version section from CHANGELOG.md.")
    parser.add_argument("--version", required=True, help="Version to extract, with or without v prefix.")
    parser.add_argument("--changelog", default="CHANGELOG.md", help="Path to CHANGELOG.md.")
    parser.add_argument("--output", required=True, help="Path to write extracted release notes.")
    args = parser.parse_args()

    changelog_path = Path(args.changelog)
    output_path = Path(args.output)
    section = extract_changelog_section(changelog_path.read_text(encoding="utf-8"), args.version)
    output_path.write_text(section + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
