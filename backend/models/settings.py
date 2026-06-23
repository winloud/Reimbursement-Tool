from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.database.connection import Base
from backend.services.invoice_qr_runtime import INVOICE_QR_ENGINE_ZXING


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    employee_name: Mapped[str | None] = mapped_column(String, nullable=True)
    daily_subsidy: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    pdf_fill_font_key: Mapped[str] = mapped_column(String, default="system:simsun", nullable=False)
    double_print_vat_special_invoices: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    invoice_qr_engine: Mapped[str] = mapped_column(String, default=INVOICE_QR_ENGINE_ZXING, nullable=False)
    autosave_delay_seconds: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
