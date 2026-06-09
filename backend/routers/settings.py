from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.settings import FontOptionRead, SettingsRead, SettingsUpdate
from backend.services.font_service import list_available_fonts
from backend.services.settings_service import get_or_create_settings, update_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=ApiResponse[SettingsRead])
def get_settings(db: Session = Depends(get_db)) -> ApiResponse[SettingsRead]:
    return ApiResponse(data=get_or_create_settings(db))


@router.get("/fonts", response_model=ApiResponse[list[FontOptionRead]])
def get_fonts() -> ApiResponse[list[FontOptionRead]]:
    return ApiResponse(data=list_available_fonts())


@router.put("", response_model=ApiResponse[SettingsRead])
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> ApiResponse[SettingsRead]:
    return ApiResponse(data=update_settings(db, payload))
