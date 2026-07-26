from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
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


def test_font_list_maps_known_bundled_font_to_stable_system_key(monkeypatch, tmp_path):
    from backend.services import font_service

    bundled_dir = tmp_path / "assets" / "fonts"
    app_fonts_dir = tmp_path / "app-fonts"
    bundled_dir.mkdir(parents=True)
    app_fonts_dir.mkdir()
    simsun = bundled_dir / "simsun.ttc"
    simsun.write_bytes(b"not a real font")
    monkeypatch.setattr(font_service, "BUNDLED_FONTS_DIR", bundled_dir)
    monkeypatch.setattr(font_service, "APP_FONTS_DIR", app_fonts_dir)
    monkeypatch.setattr(
        font_service,
        "SYSTEM_FONT_DEFINITIONS",
        [
            {
                "key": "system:simsun",
                "name": "宋体",
                "filenames": ["simsun.ttc"],
                "paths": [tmp_path / "missing" / "simsun.ttc"],
            }
        ],
    )

    fonts = font_service.list_available_fonts()

    assert fonts == [
        {
            "key": "system:simsun",
            "name": "宋体",
            "source": "bundled",
            "source_label": "部署字体",
        }
    ]
    assert font_service.resolve_font_file("system:simsun") == simsun


def test_resolve_font_file_checks_app_fonts_dir(monkeypatch, tmp_path):
    from backend.services import font_service

    bundled_dir = tmp_path / "bundled"
    app_fonts_dir = tmp_path / "fonts"
    bundled_dir.mkdir()
    app_fonts_dir.mkdir()
    simhei = app_fonts_dir / "simhei.ttf"
    simhei.write_bytes(b"not a real font")
    monkeypatch.setattr(font_service, "BUNDLED_FONTS_DIR", bundled_dir)
    monkeypatch.setattr(font_service, "APP_FONTS_DIR", app_fonts_dir)
    monkeypatch.setattr(
        font_service,
        "SYSTEM_FONT_DEFINITIONS",
        [
            {
                "key": "system:simhei",
                "name": "黑体",
                "filenames": ["simhei.ttf"],
                "paths": [tmp_path / "missing" / "simhei.ttf"],
            }
        ],
    )

    assert font_service.resolve_font_file("system:simhei") == simhei


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
    assert settings.double_print_vat_special_invoices is True
    assert settings.invoice_qr_engine == "zxing"
    assert settings.autosave_delay_seconds == 3


def test_update_settings_can_disable_vat_special_double_print(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: True)

    settings = settings_service.update_settings(
        db,
        SettingsUpdate(
            department="财务部",
            employee_name="李四",
            daily_subsidy=Decimal("100.00"),
            pdf_fill_font_key="system:simsun",
            double_print_vat_special_invoices=False,
        ),
    )

    assert settings.double_print_vat_special_invoices is False


def test_update_settings_saves_autosave_delay_seconds(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: True)

    settings = settings_service.update_settings(
        db,
        SettingsUpdate(
            department="财务部",
            employee_name="李四",
            daily_subsidy=Decimal("100.00"),
            pdf_fill_font_key="system:simsun",
            autosave_delay_seconds=12,
        ),
    )

    assert settings.autosave_delay_seconds == 12


def test_settings_update_rejects_autosave_delay_outside_limits():
    with pytest.raises(ValidationError):
        SettingsUpdate(autosave_delay_seconds=2)

    with pytest.raises(ValidationError):
        SettingsUpdate(autosave_delay_seconds=61)


def test_update_settings_saves_zxing_invoice_qr_engine_without_runtime_install(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: True)
    monkeypatch.setattr(settings_service, "ensure_opencv_runtime_installed", lambda: (_ for _ in ()).throw(AssertionError("unexpected install")))

    settings = settings_service.update_settings(
        db,
        SettingsUpdate(
            department="财务部",
            employee_name="李四",
            daily_subsidy=Decimal("100.00"),
            pdf_fill_font_key="system:simsun",
            invoice_qr_engine="zxing",
        ),
    )

    assert settings.invoice_qr_engine == "zxing"


def test_update_settings_rejects_opencv_engine_when_runtime_package_missing(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: True)
    monkeypatch.setattr(settings_service, "ensure_opencv_runtime_installed", lambda: (_ for _ in ()).throw(RuntimeError("未找到 OpenCV runtime 包")))

    with pytest.raises(HTTPException) as exc:
        settings_service.update_settings(
            db,
            SettingsUpdate(
                department="财务部",
                employee_name="李四",
                daily_subsidy=Decimal("100.00"),
                pdf_fill_font_key="system:simsun",
                invoice_qr_engine="opencv_wechat",
            ),
        )

    assert exc.value.status_code == 400
    assert "OpenCV" in exc.value.detail
    assert settings_service.get_or_create_settings(db).invoice_qr_engine == "zxing"


def test_update_settings_saves_opencv_engine_after_runtime_install(monkeypatch, db):
    monkeypatch.setattr(settings_service, "font_key_exists", lambda _key: True)
    monkeypatch.setattr(settings_service, "ensure_opencv_runtime_installed", lambda: {"opencv_package_version": "4.10.0.84"})

    settings = settings_service.update_settings(
        db,
        SettingsUpdate(
            department="财务部",
            employee_name="李四",
            daily_subsidy=Decimal("100.00"),
            pdf_fill_font_key="system:simsun",
            invoice_qr_engine="opencv_wechat",
        ),
    )

    assert settings.invoice_qr_engine == "opencv_wechat"


def test_migrate_sqlite_schema_adds_missing_settings_columns(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as db:
        db.execute(text("CREATE TABLE trips (id INTEGER PRIMARY KEY)"))
        db.execute(text("CREATE TABLE expense_items (id INTEGER PRIMARY KEY)"))
        db.execute(text("CREATE TABLE expense_reports (id INTEGER PRIMARY KEY, report_uid VARCHAR)"))
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
        expense_item_columns = {row[1] for row in db.execute(text("PRAGMA table_info(expense_items)")).fetchall()}
        trip_columns = {row[1] for row in db.execute(text("PRAGMA table_info(trips)")).fetchall()}
        report_columns = {row[1] for row in db.execute(text("PRAGMA table_info(expense_reports)")).fetchall()}
        data_schema_version = db.execute(text("PRAGMA user_version")).scalar_one()
    assert "pdf_fill_font_key" in columns
    assert "double_print_vat_special_invoices" in columns
    assert "invoice_qr_engine" in columns
    assert "autosave_delay_seconds" in columns
    assert "reimbursable_amount" in expense_item_columns
    assert {"paper_invoice_amount", "paper_invoice_count"}.issubset(expense_item_columns)
    assert {"paper_invoice_amount", "paper_invoice_count"}.issubset(trip_columns)
    assert "manual_subsidy_total" in report_columns
    assert data_schema_version == connection.DATA_SCHEMA_VERSION
