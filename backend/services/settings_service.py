from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.models.settings import Settings
from backend.schemas.settings import SettingsUpdate
from backend.services.font_service import DEFAULT_PDF_FILL_FONT_KEY, font_key_exists

DEFAULT_DAILY_SUBSIDY = Decimal("80.00")


def get_or_create_settings(db: Session) -> Settings:
    settings = db.get(Settings, 1)
    if settings is None:
        settings = Settings(id=1, daily_subsidy=DEFAULT_DAILY_SUBSIDY, pdf_fill_font_key=DEFAULT_PDF_FILL_FONT_KEY)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    elif not settings.pdf_fill_font_key:
        settings.pdf_fill_font_key = DEFAULT_PDF_FILL_FONT_KEY
        db.commit()
        db.refresh(settings)
    return settings


def update_settings(db: Session, payload: SettingsUpdate) -> Settings:
    if not font_key_exists(payload.pdf_fill_font_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF 填充字体不存在")
    settings = get_or_create_settings(db)
    settings.department = payload.department
    settings.employee_name = payload.employee_name
    settings.daily_subsidy = payload.daily_subsidy
    settings.pdf_fill_font_key = payload.pdf_fill_font_key
    settings.double_print_vat_special_invoices = payload.double_print_vat_special_invoices
    db.commit()
    db.refresh(settings)
    return settings
