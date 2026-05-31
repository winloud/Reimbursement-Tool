from fastapi import APIRouter

from backend.database.connection import DATABASE_PATH
from backend.schemas.common import ApiResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=ApiResponse[dict[str, str]])
def health_check() -> ApiResponse[dict[str, str]]:
    return ApiResponse(
        data={
            "status": "ok",
            "database": str(DATABASE_PATH),
        }
    )
