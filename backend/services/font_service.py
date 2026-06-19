from __future__ import annotations

import hashlib
import re
from pathlib import Path

from backend.runtime_paths import APP_ROOT, PROJECT_ROOT, resource_path

BUNDLED_FONTS_DIR = resource_path("backend", "assets", "fonts")
APP_FONTS_DIR = APP_ROOT / "fonts"
SUPPORTED_FONT_EXTENSIONS = {".ttf", ".ttc", ".otf"}

DEFAULT_PDF_FILL_FONT_KEY = "system:simsun"

SYSTEM_FONT_DEFINITIONS = [
    {"key": "system:msyh", "name": "微软雅黑", "filenames": ["msyh.ttc"], "paths": [Path("C:/Windows/Fonts/msyh.ttc")]},
    {"key": "system:simsun", "name": "宋体", "filenames": ["simsun.ttc", "simsun.ttf"], "paths": [Path("C:/Windows/Fonts/simsun.ttc"), Path("C:/Windows/Fonts/simsun.ttf")]},
    {"key": "system:simfang", "name": "仿宋", "filenames": ["simfang.ttf"], "paths": [Path("C:/Windows/Fonts/simfang.ttf")]},
    {"key": "system:simkai", "name": "楷体", "filenames": ["simkai.ttf"], "paths": [Path("C:/Windows/Fonts/simkai.ttf")]},
    {"key": "system:simhei", "name": "黑体", "filenames": ["simhei.ttf"], "paths": [Path("C:/Windows/Fonts/simhei.ttf")]},
]


def _first_existing_path(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def _configured_font_paths(item: dict[str, object]) -> list[Path]:
    paths = list(item.get("paths", []))
    filenames = item.get("filenames", [])
    for filename in filenames:
        paths.append(BUNDLED_FONTS_DIR / str(filename))
        paths.append(APP_FONTS_DIR / str(filename))
    return paths


def _bundled_font_key(path: Path) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", path.stem).strip("-").lower() or "font"
    digest = hashlib.sha1(path.name.encode("utf-8")).hexdigest()[:8]
    return f"bundled:{safe_name}-{digest}"


def _read_font_display_name(path: Path) -> str:
    try:
        from fontTools.ttLib import TTFont as FontToolsTTFont
    except Exception:
        return path.stem

    font = None
    try:
        try:
            font = FontToolsTTFont(str(path), fontNumber=0)
        except TypeError:
            font = FontToolsTTFont(str(path))
        records = font["name"].names
        for name_id in (4, 1):
            for record in records:
                if record.nameID != name_id:
                    continue
                value = record.toUnicode().strip()
                if value:
                    return value
    except Exception:
        return path.stem
    finally:
        if font is not None:
            font.close()
    return path.stem


def _bundled_font_paths() -> list[Path]:
    if not BUNDLED_FONTS_DIR.exists():
        return []
    return sorted(
        (path for path in BUNDLED_FONTS_DIR.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_FONT_EXTENSIONS),
        key=lambda path: path.name.lower(),
    )


def _system_font_paths() -> set[Path]:
    paths: set[Path] = set()
    for item in SYSTEM_FONT_DEFINITIONS:
        for path in _configured_font_paths(item):
            paths.add(path.resolve() if path.exists() else path)
    return paths


def list_available_fonts() -> list[dict[str, str]]:
    fonts: list[dict[str, str]] = []
    for item in SYSTEM_FONT_DEFINITIONS:
        font_path = _first_existing_path(_configured_font_paths(item))
        if font_path:
            fonts.append(
                {
                    "key": item["key"],
                    "name": item["name"],
                    "source": "system" if font_path in item.get("paths", []) else "bundled",
                    "source_label": "系统字体" if font_path in item.get("paths", []) else "部署字体",
                }
            )

    system_font_paths = _system_font_paths()
    for path in _bundled_font_paths():
        if path.resolve() in system_font_paths:
            continue
        fonts.append(
            {
                "key": _bundled_font_key(path),
                "name": _read_font_display_name(path),
                "source": "bundled",
                "source_label": "项目内置字体",
            }
        )
    return fonts


def resolve_font_file(font_key: str | None) -> Path | None:
    if not font_key:
        return None
    for item in SYSTEM_FONT_DEFINITIONS:
        if item["key"] == font_key:
            return _first_existing_path(_configured_font_paths(item))
    if font_key.startswith("bundled:"):
        for path in _bundled_font_paths():
            if _bundled_font_key(path) == font_key:
                return path
    return None


def font_key_exists(font_key: str | None) -> bool:
    return resolve_font_file(font_key) is not None
