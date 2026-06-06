from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text

from backend.database import connection
from backend.models.settings import Settings
from backend.schemas.settings import SettingsUpdate
from backend.services import settings_service


def test_font_list_returns_existing_system_fonts(monkeypatch, tmp_path):
    from backend.services import font_service

    simsun = tmp_path / "simsun.ttc"
    simsun.write_bytes(b"not a real font")
    monkeypatch.setattr(
        font_service,
        "SYSTEM_FONT_DEFINITIONS",
        [{"key": "system:simsun", "name": "宋体", "paths": [simsun]}],
    )
    monkeypatch.setattr(font_service, "BUNDLED_FONTS_DIR", tmp_path / "missing")

    fonts = font_service.list_available_fonts()

    assert fonts == [
        {
            "key": "system:simsun",
            "name": "宋体",
            "source": "system",
            "source_label": "系统字体",
        }
    ]


def test_font_list_includes_bundled_font_with_filename_fallback(monkeypatch, tmp_path):
    from backend.services import font_service

    bundled_dir = tmp_path / "fonts"
    bundled_dir.mkdir()
    font_path = bundled_dir / "My Font.otf"
    font_path.write_bytes(b"not a real font")
    monkeypatch.setattr(font_service, "SYSTEM_FONT_DEFINITIONS", [])
    monkeypatch.setattr(font_service, "BUNDLED_FONTS_DIR", bundled_dir)

    fonts = font_service.list_available_fonts()

    assert len(fonts) == 1
    assert fonts[0]["key"].startswith("bundled:")
    assert fonts[0]["name"] == "My Font"
    assert fonts[0]["source"] == "bundled"
    assert fonts[0]["source_label"] == "项目内置字体"


def test_update_settings_rejects_unknown_font_key(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: False)

    with pytest.raises(HTTPException) as exc:
        settings_service.update_settings(
            db,
            SettingsUpdate(
                department="财务部",
                employee_name="李四",
                daily_subsidy=Decimal("100.00"),
                pdf_fill_font_key="missing:font",
            ),
        )

    assert exc.value.status_code == 400
    assert "字体" in exc.value.detail


def test_settings_default_pdf_fill_font_key(db):
    db.add(Settings(id=1, daily_subsidy=Decimal("90.00")))
    db.commit()

    settings = settings_service.get_or_create_settings(db)

    assert settings.pdf_fill_font_key == "system:simsun"


def test_migrate_sqlite_schema_adds_pdf_fill_font_key(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as db:
        db.execute(text("CREATE TABLE trips (id INTEGER PRIMARY KEY)"))
        db.execute(
            text(
                "CREATE TABLE settings ("
                "id INTEGER PRIMARY KEY, "
                "department VARCHAR, "
                "employee_name VARCHAR, "
                "daily_subsidy NUMERIC(18, 2) NOT NULL DEFAULT 0"
                ")"
            )
        )
    monkeypatch.setattr(connection, "engine", engine)

    connection.migrate_sqlite_schema()

    with engine.begin() as db:
        columns = {row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()}
    assert "pdf_fill_font_key" in columns
