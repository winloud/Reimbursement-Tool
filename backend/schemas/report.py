from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ReportStatus = Literal["draft", "printed", "reimbursed"]
ExpenseCategory = Literal[
    "transport_fare",
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    "fuel_subsidy",
]


class TripWrite(BaseModel):
    id: int | None = None
    sort_order: int = Field(ge=1)
    depart_month: int = Field(ge=1, le=12)
    depart_day: int = Field(ge=1, le=31)
    depart_hour: int | None = Field(default=None, ge=0, le=23)
    depart_place: str | None = None
    arrive_month: int = Field(ge=1, le=12)
    arrive_day: int = Field(ge=1, le=31)
    arrive_hour: int | None = Field(default=None, ge=0, le=23)
    arrive_place: str | None = None
    transport: str | None = None


class ExpenseItemWrite(BaseModel):
    id: int | None = None
    category: ExpenseCategory
    remark: str | None = None


class ReportBase(BaseModel):
    report_date: date | None = None
    department: str | None = None
    employee_name: str | None = None
    purpose: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"), ge=0)
    subsidy_days: int = Field(default=0, ge=0)
    subsidy_total: Decimal = Field(default=Decimal("0.00"), ge=0)
    advance_date_month: int | None = Field(default=None, ge=1, le=12)
    advance_date_day: int | None = Field(default=None, ge=1, le=31)
    advance_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    total_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    shortfall: Decimal = Field(default=Decimal("0.00"), ge=0)
    surplus: Decimal = Field(default=Decimal("0.00"), ge=0)


class ReportCreate(ReportBase):
    trips: list[TripWrite] = Field(default_factory=list)
    expense_items: list[ExpenseItemWrite] = Field(default_factory=list)


class ReportUpdate(ReportBase):
    trips: list[TripWrite] | None = None
    expense_items: list[ExpenseItemWrite] | None = None


class ReportStatusUpdate(BaseModel):
    status: ReportStatus


class TripRead(BaseModel):
    id: int
    sort_order: int
    depart_month: int
    depart_day: int
    depart_hour: int | None = None
    depart_place: str | None = None
    arrive_month: int
    arrive_day: int
    arrive_hour: int | None = None
    arrive_place: str | None = None
    transport: str | None = None
    invoice_count: int = 0
    amount: Decimal = Decimal("0.00")

    model_config = ConfigDict(from_attributes=True)


class ExpenseItemRead(BaseModel):
    id: int
    category: str
    remark: str | None = None
    invoice_count: int = 0
    amount: Decimal = Decimal("0.00")

    model_config = ConfigDict(from_attributes=True)


class InvoiceRead(BaseModel):
    id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: str
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal
    amount_confirmed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportRead(ReportBase):
    id: int
    status: ReportStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportDetailRead(ReportRead):
    trips: list[TripRead] = Field(default_factory=list)
    expense_items: list[ExpenseItemRead] = Field(default_factory=list)
    invoices: list[InvoiceRead] = Field(default_factory=list, validation_alias="active_invoices")
