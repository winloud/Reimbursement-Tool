from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SettingsRead(BaseModel):
    id: int
    department: str | None = None
    employee_name: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"))

    model_config = ConfigDict(from_attributes=True)


class SettingsUpdate(BaseModel):
    department: str | None = None
    employee_name: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"), ge=0)
