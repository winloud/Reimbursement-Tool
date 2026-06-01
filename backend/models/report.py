from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ExpenseReport(Base):
    __tablename__ = "expense_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    employee_name: Mapped[str | None] = mapped_column(String, nullable=True)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    daily_subsidy: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    subsidy_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subsidy_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    advance_date_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    advance_date_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    advance_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    shortfall: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    surplus: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    trips = relationship("Trip", back_populates="report", cascade="all, delete-orphan")
    expense_items = relationship("ExpenseItem", back_populates="report", cascade="all, delete-orphan")
    invoices = relationship("Invoice", back_populates="report", cascade="all, delete-orphan")

    @property
    def active_invoices(self):
        return [invoice for invoice in self.invoices if invoice.deleted_at is None]
