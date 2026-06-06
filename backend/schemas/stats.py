from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class StatsPeriodSummary(BaseModel):
    pending_amount: Decimal = Field(default=Decimal("0.00"))
    pending_count: int = 0
    reimbursed_amount: Decimal = Field(default=Decimal("0.00"))
    reimbursed_count: int = 0
    trip_days: int = 0


class MonthlyTrendItem(BaseModel):
    month: str
    reimbursed_amount: Decimal = Field(default=Decimal("0.00"))
    trip_days: int = 0


class StatsSummaryRead(BaseModel):
    current_month: StatsPeriodSummary
    current_year: StatsPeriodSummary
    monthly_trend: list[MonthlyTrendItem] = Field(default_factory=list)


class StatsCategoryItem(BaseModel):
    category: str
    label: str
    amount: Decimal = Field(default=Decimal("0.00"))


class StatsCategoryRead(BaseModel):
    items: list[StatsCategoryItem] = Field(default_factory=list)


class StatsCalendarRead(BaseModel):
    year: int
    month: int
    total_days: int = 0
    year_dates: list[date] = Field(default_factory=list)
    month_dates: list[date] = Field(default_factory=list)
