from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ExpenseReport(Base):
    __tablename__ = "expense_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_uid: Mapped[str] = mapped_column(String, default=lambda: uuid4().hex, nullable=False, unique=True)
    report_type: Mapped[str] = mapped_column(String, default="travel", nullable=False)
    regular_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=False)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    employee_name: Mapped[str | None] = mapped_column(String, nullable=True)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    daily_subsidy: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    subsidy_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subsidy_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    manual_subsidy_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    advance_date_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    advance_date_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    advance_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    shortfall: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    surplus: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    day_occupancy_refresh_pending: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    trips = relationship("Trip", back_populates="report", cascade="all, delete-orphan")
    expense_items = relationship("ExpenseItem", back_populates="report", cascade="all, delete-orphan")
    regular_items = relationship(
        "RegularItem",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="RegularItem.sort_order",
    )
    invoices = relationship("Invoice", back_populates="report", cascade="all, delete-orphan")
    attachments = relationship("ReportAttachment", back_populates="report", cascade="all, delete-orphan")
    day_occupancies = relationship(
        "ReportDayOccupancy",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="ReportDayOccupancy.occupied_on",
    )

    @property
    def active_invoices(self):
        return [invoice for invoice in self.invoices if invoice.deleted_at is None]

    @property
    def active_attachments(self):
        return sorted(
            (attachment for attachment in self.attachments if attachment.deleted_at is None),
            key=lambda attachment: (attachment.created_at, attachment.id),
        )

    @property
    def invoice_count(self) -> int:
        if self.report_type == "regular":
            return len(self.active_invoices) if self.regular_mode == "invoice" else 0
        paper_count = sum(int(trip.paper_invoice_count or 0) for trip in self.trips) + sum(
            int(item.paper_invoice_count or 0) for item in self.expense_items
        )
        return len(self.active_invoices) + paper_count

    @property
    def document_count(self) -> int:
        if self.report_type == "regular":
            return sum(item.document_count for item in self.regular_items)
        return self.invoice_count

    @property
    def regular_item_count(self) -> int:
        return len(self.regular_items) if self.report_type == "regular" else 0

    @property
    def regular_item_summary(self) -> str | None:
        if self.report_type != "regular":
            return None
        descriptions = [(item.description or "").strip() for item in self.regular_items]
        return "、".join(description for description in descriptions if description)

    @property
    def trip_start_date(self) -> date | None:
        from backend.services.report_service import report_trip_date_bounds

        return report_trip_date_bounds(self)[0]

    @property
    def trip_end_date(self) -> date | None:
        from backend.services.report_service import report_trip_date_bounds

        return report_trip_date_bounds(self)[1]

    @property
    def occupied_dates(self) -> list[date]:
        return sorted({occupancy.occupied_on for occupancy in self.day_occupancies})
