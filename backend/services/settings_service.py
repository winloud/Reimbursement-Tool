from decimal import Decimal

from sqlalchemy.orm import Session

from backend.models.settings import Settings
from backend.schemas.settings import SettingsUpdate

DEFAULT_DAILY_SUBSIDY = Decimal("80.00")


def get_or_create_settings(db: Session) -> Settings:
    settings = db.get(Settings, 1)
    if settings is None:
        settings = Settings(id=1, daily_subsidy=DEFAULT_DAILY_SUBSIDY)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def update_settings(db: Session, payload: SettingsUpdate) -> Settings:
    settings = get_or_create_settings(db)
    settings.department = payload.department
    settings.employee_name = payload.employee_name
    settings.daily_subsidy = payload.daily_subsidy
    db.commit()
    db.refresh(settings)
    return settings
