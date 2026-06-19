from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AUTOSAVE_DELAY_MIN_SECONDS = 3
AUTOSAVE_DELAY_MAX_SECONDS = 60
DEFAULT_AUTOSAVE_DELAY_SECONDS = 3


class SettingsRead(BaseModel):
    id: int
    department: str | None = None
    employee_name: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"))
    pdf_fill_font_key: str = "system:simsun"
    double_print_vat_special_invoices: bool = True
    invoice_qr_engine: Literal["zxing", "opencv_wechat"] = "zxing"
    autosave_delay_seconds: int = Field(
        default=DEFAULT_AUTOSAVE_DELAY_SECONDS,
        ge=AUTOSAVE_DELAY_MIN_SECONDS,
        le=AUTOSAVE_DELAY_MAX_SECONDS,
    )

    model_config = ConfigDict(from_attributes=True)


class SettingsUpdate(BaseModel):
    department: str | None = None
    employee_name: str | None = None
    daily_subsidy: Decimal = Field(default=Decimal("0.00"), ge=0)
    pdf_fill_font_key: str = "system:simsun"
    double_print_vat_special_invoices: bool = True
    invoice_qr_engine: Literal["zxing", "opencv_wechat"] = "zxing"
    autosave_delay_seconds: int = Field(
        default=DEFAULT_AUTOSAVE_DELAY_SECONDS,
        ge=AUTOSAVE_DELAY_MIN_SECONDS,
        le=AUTOSAVE_DELAY_MAX_SECONDS,
    )


class FontOptionRead(BaseModel):
    key: str
    name: str
    source: str
    source_label: str
