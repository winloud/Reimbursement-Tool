from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.schemas.report_attachment import ReportAttachmentRead

DateValue = date

REPORT_STATUS_VALUES = ("draft", "checked", "printed", "reimbursed")
ReportStatus = Literal["draft", "checked", "printed", "reimbursed"]
ReportInvoiceState = Literal["all", "has_unconfirmed", "all_confirmed", "no_invoice"]
ReportType = Literal["travel", "regular"]
RegularMode = Literal["no_invoice", "invoice"]
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
    # depart_date/arrive_date 是行程日期的真源；月日可省略，由日期拆出后写库供 PDF 等沿用。
    # 只有旧客户端和历史导入包才会只带月日，此时年份仍由后端按报销单日期推断。
    depart_date: date | None = None
    depart_month: int | None = Field(default=None, ge=1, le=12)
    depart_day: int | None = Field(default=None, ge=1, le=31)
    depart_hour: int | None = Field(default=None, ge=0, le=23)
    depart_place: str | None = None
    arrive_date: date | None = None
    arrive_month: int | None = Field(default=None, ge=1, le=12)
    arrive_day: int | None = Field(default=None, ge=1, le=31)
    arrive_hour: int | None = Field(default=None, ge=0, le=23)
    arrive_place: str | None = None
    transport: str | None = None
    subsidy_start: bool = False
    subsidy_end: bool = False
    paper_invoice_amount: Decimal | None = Field(default=None, ge=0)
    paper_invoice_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def sync_month_day_from_dates(self):
        if self.depart_date is not None:
            self.depart_month = self.depart_date.month
            self.depart_day = self.depart_date.day
        elif self.depart_month is None or self.depart_day is None:
            raise ValueError("行程缺少出发日期")
        if self.arrive_date is not None:
            self.arrive_month = self.arrive_date.month
            self.arrive_day = self.arrive_date.day
        elif self.arrive_month is None or self.arrive_day is None:
            raise ValueError("行程缺少到达日期")
        return self

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


class RegularItemWrite(BaseModel):
    id: int | None = None
    sort_order: int = Field(ge=1)
    occurred_on: date | None = None
    description: str | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    remark: str | None = None


class ReportBase(BaseModel):
    report_type: ReportType = "travel"
    regular_mode: RegularMode | None = None
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
    regular_items: list[RegularItemWrite] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_report_kind_payload(self):
        if self.report_type == "travel":
            if self.regular_mode is not None or self.regular_items:
                raise ValueError("出差报销单不能包含常规报销模式或项目")
            return self

        if self.regular_mode is None:
            raise ValueError("常规报销单必须选择有票或无票模式")
        if self.trips or self.expense_items:
            raise ValueError("常规报销单不能包含行程或差旅费用项目")
        if self.department or self.purpose:
            raise ValueError("常规报销单不能包含部门或出差事由")
        if any(
            (
                self.daily_subsidy,
                self.subsidy_days,
                self.subsidy_total,
                self.manual_subsidy_total,
                self.advance_date_month,
                self.advance_date_day,
                self.advance_amount,
                self.shortfall,
                self.surplus,
            )
        ):
            raise ValueError("常规报销单不能包含差旅补贴或预支数据")
        if self.regular_mode == "invoice" and any(item.amount is not None for item in self.regular_items):
            raise ValueError("有票常规报销项目金额由已确认发票自动汇总，不能手工填写")
        return self


class ReportUpdate(ReportBase):
    report_type: ReportType | None = None
    regular_mode: RegularMode | None = None
    trips: list[TripWrite] | None = None
    expense_items: list[ExpenseItemWrite] | None = None
    regular_items: list[RegularItemWrite] | None = None


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


class ReportDownloadPreparationRead(BaseModel):
    download_url: str
    filename: str
    expires_in_seconds: int = Field(gt=0)


class ReportCategoryOption(BaseModel):
    value: str
    label: str


class ReportFilterOptionsRead(BaseModel):
    categories: list[ReportCategoryOption] = Field(default_factory=list)


class ReportDayOccupancyRead(BaseModel):
    date: DateValue = Field(validation_alias="occupied_on")
    report_id: int

    model_config = ConfigDict(from_attributes=True)


class TripRead(BaseModel):
    id: int
    sort_order: int
    depart_date: date | None = None
    depart_month: int
    depart_day: int
    depart_hour: int | None = None
    depart_place: str | None = None
    arrive_date: date | None = None
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


class RegularItemRead(BaseModel):
    id: int
    sort_order: int
    occurred_on: date | None = None
    description: str | None = None
    amount: Decimal = Decimal("0.00")
    document_count: int = 0
    remark: str | None = None

    model_config = ConfigDict(from_attributes=True)


class InvoiceRead(BaseModel):
    id: int
    trip_id: int | None = None
    regular_item_id: int | None = None
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
    document_count: int = 0
    regular_item_count: int = 0
    regular_item_summary: str | None = None
    status: ReportStatus
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ReportDetailRead(ReportRead):
    occupied_dates: list[date] = Field(default_factory=list)
    trips: list[TripRead] = Field(default_factory=list)
    expense_items: list[ExpenseItemRead] = Field(default_factory=list)
    regular_items: list[RegularItemRead] = Field(default_factory=list)
    invoices: list[InvoiceRead] = Field(default_factory=list, validation_alias="active_invoices")
    attachments: list[ReportAttachmentRead] = Field(default_factory=list, validation_alias="active_attachments")
