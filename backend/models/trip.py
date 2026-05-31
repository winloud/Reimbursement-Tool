from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    depart_month: Mapped[int] = mapped_column(Integer, nullable=False)
    depart_day: Mapped[int] = mapped_column(Integer, nullable=False)
    depart_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)
    depart_place: Mapped[str | None] = mapped_column(String, nullable=True)
    arrive_month: Mapped[int] = mapped_column(Integer, nullable=False)
    arrive_day: Mapped[int] = mapped_column(Integer, nullable=False)
    arrive_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)
    arrive_place: Mapped[str | None] = mapped_column(String, nullable=True)
    transport: Mapped[str | None] = mapped_column(String, nullable=True)

    report = relationship("ExpenseReport", back_populates="trips")
    invoices = relationship("Invoice", back_populates="trip")

    @property
    def active_confirmed_invoices(self):
        return [invoice for invoice in self.invoices if invoice.deleted_at is None and invoice.amount_confirmed]

    @property
    def invoice_count(self) -> int:
        return len(self.active_confirmed_invoices)

    @property
    def amount(self) -> Decimal:
        return sum((invoice.amount for invoice in self.active_confirmed_invoices), Decimal("0.00"))
