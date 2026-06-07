from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.stats import StatsCalendarRead, StatsCategoryRead, StatsSummaryRead
from backend.services.stats_service import get_stats_calendar, get_stats_category, get_stats_summary

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/summary", response_model=ApiResponse[StatsSummaryRead])
def get_summary(
    start_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    end_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[StatsSummaryRead]:
    return ApiResponse(data=get_stats_summary(db, start_month=start_month, end_month=end_month))


@router.get("/category", response_model=ApiResponse[StatsCategoryRead])
def get_category(
    start_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    end_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[StatsCategoryRead]:
    return ApiResponse(data=get_stats_category(db, start_month=start_month, end_month=end_month))


@router.get("/calendar", response_model=ApiResponse[StatsCalendarRead])
def get_calendar(
    year: Annotated[int, Query(ge=1900, le=2100)] = date.today().year,
    month: Annotated[int | None, Query(ge=1, le=12)] = None,
    start_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    end_month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[StatsCalendarRead]:
    return ApiResponse(data=get_stats_calendar(db, year=year, month=month, start_month=start_month, end_month=end_month))
