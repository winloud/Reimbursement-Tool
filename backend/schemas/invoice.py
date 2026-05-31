from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

InvoiceFileType = Literal["xml", "pdf", "ofd", "image"]


class InvoiceParsedData(BaseModel):
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    seller_name: str | None = None
    buyer_name: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class InvoiceUploadResult(BaseModel):
    id: int
    report_id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: InvoiceFileType
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal
    amount_confirmed: bool
    created_at: datetime
    parsed: InvoiceParsedData | None = None

    model_config = ConfigDict(from_attributes=True)


class InvoiceUpdate(BaseModel):
    amount: Decimal = Field(ge=0)
    amount_confirmed: bool = True


class InvoiceRead(BaseModel):
    id: int
    report_id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: InvoiceFileType
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal
    amount_confirmed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
