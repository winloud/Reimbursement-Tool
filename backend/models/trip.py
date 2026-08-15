from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # depart_date/arrive_date 是行程日期的真源（含年份，跨年不再依赖推断）。
    # depart_month/day 等列保留为派生值，写入时由日期拆出，供 PDF 表单、导出和历史数据沿用。
    depart_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    depart_month: Mapped[int] = mapped_column(Integer, nullable=False)
    depart_day: Mapped[int] = mapped_column(Integer, nullable=False)
    depart_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)
    depart_place: Mapped[str | None] = mapped_column(String, nullable=True)
    arrive_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    arrive_month: Mapped[int] = mapped_column(Integer, nullable=False)
    arrive_day: Mapped[int] = mapped_column(Integer, nullable=False)
    arrive_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)
    arrive_place: Mapped[str | None] = mapped_column(String, nullable=True)
    transport: Mapped[str | None] = mapped_column(String, nullable=True)
    subsidy_start: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    subsidy_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paper_invoice_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    paper_invoice_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("ExpenseReport", back_populates="trips")
    invoices = relationship("Invoice", back_populates="trip")

    @property
    def active_confirmed_invoices(self):
        return [invoice for invoice in self.invoices if invoice.deleted_at is None and invoice.amount_confirmed]

    @property
    def invoice_count(self) -> int:
        return len(self.active_confirmed_invoices) + int(self.paper_invoice_count or 0)

    @property
    def amount(self) -> Decimal:
        electronic_total = sum((invoice.amount for invoice in self.active_confirmed_invoices), Decimal("0.00"))
        return (electronic_total + Decimal(self.paper_invoice_amount or 0)).quantize(Decimal("0.01"))
