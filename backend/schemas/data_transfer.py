from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from backend.schemas.report import ReportInvoiceState, ReportStatus

ImportConflictStrategy = Literal["import_as_new", "overwrite", "skip"]


class DataExportRequest(BaseModel):
    status: ReportStatus | None = None
    trip_start: date | None = None
    trip_end: date | None = None
    keyword: str | None = None
    amount_min: Decimal | None = Field(default=None, ge=0)
    amount_max: Decimal | None = Field(default=None, ge=0)
    invoice_state: ReportInvoiceState = "all"
    category: str | None = None
    has_attachment: bool | None = None
    subsidy_days_min: int | None = Field(default=None, ge=0)
    subsidy_days_max: int | None = Field(default=None, ge=0)


class ImportConflictRead(BaseModel):
    item_type: Literal["report", "invoice"]
    source_uid: str
    local_id: int | None = None
    local_status: str | None = None
    reason: str
    requires_reimbursed_confirm: bool = False


class ImportSummaryRead(BaseModel):
    reports_total: int = 0
    reports_new: int = 0
    reports_conflict: int = 0
    invoices_total: int = 0
    invoices_conflict: int = 0
    attachments_total: int = 0


class ImportPreviewRead(BaseModel):
    preview_id: str
    summary: ImportSummaryRead
    conflicts: list[ImportConflictRead] = Field(default_factory=list)
    requires_reimbursed_confirm: bool = False


class ImportExecuteRequest(BaseModel):
    preview_id: str
    strategy: ImportConflictStrategy
    confirm_reimbursed_overwrite: bool = False


class ImportExecuteRead(BaseModel):
    reports_created: int = 0
    reports_overwritten: int = 0
    reports_skipped: int = 0
    invoices_created: int = 0
    attachments_written: int = 0
    backup_path: str
