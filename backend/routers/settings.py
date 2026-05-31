from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.settings import SettingsRead, SettingsUpdate
from backend.services.settings_service import get_or_create_settings, update_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=ApiResponse[SettingsRead])
def get_settings(db: Session = Depends(get_db)) -> ApiResponse[SettingsRead]:
    return ApiResponse(data=get_or_create_settings(db))


@router.put("", response_model=ApiResponse[SettingsRead])
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> ApiResponse[SettingsRead]:
    return ApiResponse(data=update_settings(db, payload))
