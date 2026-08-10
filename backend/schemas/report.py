from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.schemas.report_attachment import ReportAttachmentRead

REPORT_STATUS_VALUES = ("draft", "checked", "printed", "reimbursed")
ReportStatus = Literal["draft", "checked", "printed", "reimbursed"]
ReportInvoiceState = Literal["all", "has_unconfirmed", "all_confirmed", "no_invoice"]
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
    subsidy_start: bool = False
    subsidy_end: bool = False
    paper_invoice_amount: Decimal | None = Field(default=None, ge=0)
    paper_invoice_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_paper_invoice_pair(self):
        if (self.paper_invoice_amount is None) != (self.paper_invoice_count is None):
            raise ValueError("纸质发票金额和张数需同时填写")
        if bool(self.paper_invoice_amount) != bool(self.paper_invoice_count):
            raise ValueError("纸质发票金额和张数需同时填写")
        return self


class ExpenseItemWrite(BaseModel):
    id: int | None = None
    category: str = Field(min_length=1)
    remark: str | None = None
    reimbursable_amount: Decimal | None = Field(default=None, ge=0)
    paper_invoice_amount: Decimal | None = Field(default=None, ge=0)
    paper_invoice_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_paper_invoice_pair(self):
        if (self.paper_invoice_amount is None) != (self.paper_invoice_count is None):
            raise ValueError("纸质发票金额和张数需同时填写")
        if bool(self.paper_invoice_amount) != bool(self.paper_invoice_count):
            raise ValueError("纸质发票金额和张数需同时填写")
        return self


class ReportBase(BaseModel):
    report_date: date | None = None
    department: str | None = None
    employee_name: str | None = None
    purpose: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"), ge=0)
    subsidy_days: int = Field(default=0, ge=0)
    subsidy_total: Decimal = Field(default=Decimal("0.00"), ge=0)
    manual_subsidy_total: Decimal | None = Field(default=None, ge=0)
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


class ReportBatchRequest(BaseModel):
    report_ids: list[int] = Field(min_length=1, max_length=100)


class ReportBatchStatusRequest(ReportBatchRequest):
    status: ReportStatus


class ReportBatchStatusSkipped(BaseModel):
    report_id: int
    reason: str
    status: ReportStatus | None = None


class ReportBatchStatusResult(BaseModel):
    target_status: ReportStatus
    updated_count: int
    skipped_count: int
    skipped: list[ReportBatchStatusSkipped] = Field(default_factory=list)


class ReportBatchPdfFailure(BaseModel):
    report_id: int
    reason: str


class ReportBatchDeleteSkipped(BaseModel):
    report_id: int
    reason: str
    status: ReportStatus | None = None


class ReportBatchDeleteResult(BaseModel):
    deleted_count: int
    skipped_count: int
    skipped: list[ReportBatchDeleteSkipped] = Field(default_factory=list)


class ReportBatchRestoreResult(BaseModel):
    restored_count: int
    skipped_count: int
    skipped: list[ReportBatchDeleteSkipped] = Field(default_factory=list)


class ReportBatchPurgeResult(BaseModel):
    purged_count: int
    skipped_count: int
    files_deleted_count: int = 0
    skipped: list[ReportBatchDeleteSkipped] = Field(default_factory=list)


class PdfPreviewPage(BaseModel):
    page: int
    image_url: str


class PdfPreviewRead(BaseModel):
    pages: list[PdfPreviewPage] = Field(default_factory=list)


class ReportCategoryOption(BaseModel):
    value: str
    label: str


class ReportFilterOptionsRead(BaseModel):
    categories: list[ReportCategoryOption] = Field(default_factory=list)


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
    subsidy_start: bool = False
    subsidy_end: bool = False
    paper_invoice_amount: Decimal = Decimal("0.00")
    paper_invoice_count: int = 0
    invoice_count: int = 0
    amount: Decimal = Decimal("0.00")

    model_config = ConfigDict(from_attributes=True)


class ExpenseItemRead(BaseModel):
    id: int
    category: str
    remark: str | None = None
    invoice_count: int = 0
    invoice_total: Decimal = Decimal("0.00")
    amount: Decimal = Decimal("0.00")
    reimbursable_amount: Decimal | None = None
    paper_invoice_amount: Decimal = Decimal("0.00")
    paper_invoice_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class InvoiceRead(BaseModel):
    id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: str
    invoice_type: str = "unknown"
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal
    amount_confirmed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportRead(ReportBase):
    id: int
    trip_start_date: date | None = None
    trip_end_date: date | None = None
    invoice_count: int = 0
    status: ReportStatus
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ReportDetailRead(ReportRead):
    trips: list[TripRead] = Field(default_factory=list)
    expense_items: list[ExpenseItemRead] = Field(default_factory=list)
    invoices: list[InvoiceRead] = Field(default_factory=list, validation_alias="active_invoices")
    attachments: list[ReportAttachmentRead] = Field(default_factory=list, validation_alias="active_attachments")
