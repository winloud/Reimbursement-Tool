from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

InvoiceFileType = Literal["pdf", "image"]
InvoiceType = Literal["unknown", "normal", "vat_special"]


class InvoiceParsedData(BaseModel):
    invoice_no: str | None = None
    invoice_date: date | None = None
    invoice_type: InvoiceType = "unknown"
    amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    seller_name: str | None = None
    buyer_name: str | None = None
    preview_image: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)

    @field_validator("amount", mode="before")
    @classmethod
    def normalize_amount(cls, value: Any) -> Decimal:
        if value is None or value == "":
            return Decimal("0.00")
        return Decimal(str(value)).quantize(Decimal("0.01"))


class InvoiceUploadResult(BaseModel):
    id: int
    report_id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: InvoiceFileType
    invoice_type: InvoiceType = "unknown"
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
    invoice_type: InvoiceType | None = None


class InvoiceOpenCapabilityRead(BaseModel):
    local_pdf_open_supported: bool


class InvoiceLocalOpenRead(BaseModel):
    opened: bool


class InvoiceRead(BaseModel):
    id: int
    report_id: int
    trip_id: int | None = None
    expense_category: str
    file_path: str
    file_type: InvoiceFileType
    invoice_type: InvoiceType = "unknown"
    invoice_no: str | None = None
    invoice_date: date | None = None
    amount: Decimal
    amount_confirmed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
