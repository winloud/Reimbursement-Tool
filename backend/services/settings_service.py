from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.models.settings import Settings
from backend.schemas.settings import (
    AUTOSAVE_DELAY_MAX_SECONDS,
    AUTOSAVE_DELAY_MIN_SECONDS,
    DEFAULT_AUTOSAVE_DELAY_SECONDS,
    SettingsUpdate,
)
from backend.services.font_service import DEFAULT_PDF_FILL_FONT_KEY, font_key_exists
from backend.services.invoice_qr_runtime import (
    INVOICE_QR_ENGINE_OPENCV_WECHAT,
    INVOICE_QR_ENGINE_ZXING,
    ensure_opencv_runtime_installed,
    normalize_invoice_qr_engine,
)

DEFAULT_DAILY_SUBSIDY = Decimal("80.00")


def normalize_autosave_delay_seconds(value: int | None) -> int:
    try:
        delay = int(value)
    except (TypeError, ValueError):
        return DEFAULT_AUTOSAVE_DELAY_SECONDS
    if AUTOSAVE_DELAY_MIN_SECONDS <= delay <= AUTOSAVE_DELAY_MAX_SECONDS:
        return delay
    return DEFAULT_AUTOSAVE_DELAY_SECONDS


def get_or_create_settings(db: Session) -> Settings:
    settings = db.get(Settings, 1)
    if settings is None:
        settings = Settings(
            id=1,
            daily_subsidy=DEFAULT_DAILY_SUBSIDY,
            pdf_fill_font_key=DEFAULT_PDF_FILL_FONT_KEY,
            invoice_qr_engine=INVOICE_QR_ENGINE_ZXING,
            autosave_delay_seconds=DEFAULT_AUTOSAVE_DELAY_SECONDS,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    else:
        changed = False
        if not settings.pdf_fill_font_key:
            settings.pdf_fill_font_key = DEFAULT_PDF_FILL_FONT_KEY
            changed = True
        normalized_engine = normalize_invoice_qr_engine(getattr(settings, "invoice_qr_engine", None))
        if settings.invoice_qr_engine != normalized_engine:
            settings.invoice_qr_engine = normalized_engine
            changed = True
        normalized_delay = normalize_autosave_delay_seconds(getattr(settings, "autosave_delay_seconds", None))
        if settings.autosave_delay_seconds != normalized_delay:
            settings.autosave_delay_seconds = normalized_delay
            changed = True
        if changed:
            db.commit()
            db.refresh(settings)
    return settings


def update_settings(db: Session, payload: SettingsUpdate) -> Settings:
    if not font_key_exists(payload.pdf_fill_font_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF 填充字体不存在")
    if payload.invoice_qr_engine == INVOICE_QR_ENGINE_OPENCV_WECHAT:
        try:
            ensure_opencv_runtime_installed()
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    settings = get_or_create_settings(db)
    settings.department = payload.department
    settings.employee_name = payload.employee_name
    settings.daily_subsidy = payload.daily_subsidy
    settings.pdf_fill_font_key = payload.pdf_fill_font_key
    settings.double_print_vat_special_invoices = payload.double_print_vat_special_invoices
    settings.invoice_qr_engine = payload.invoice_qr_engine
    settings.autosave_delay_seconds = payload.autosave_delay_seconds
    db.commit()
    db.refresh(settings)
    return settings
