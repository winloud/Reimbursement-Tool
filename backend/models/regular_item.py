from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class RegularItem(Base):
    __tablename__ = "regular_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    manual_amount: Mapped[Decimal | None] = mapped_column("amount", Numeric(18, 2), nullable=True)
    remark: Mapped[str | None] = mapped_column(String, nullable=True)

    report = relationship("ExpenseReport", back_populates="regular_items")
    invoices = relationship("Invoice", back_populates="regular_item")
    attachments = relationship("ReportAttachment", back_populates="regular_item")

    @property
    def active_invoices(self):
        return sorted(
            (invoice for invoice in self.invoices if invoice.deleted_at is None),
            key=lambda invoice: (invoice.created_at, invoice.id),
        )

    @property
    def active_attachments(self):
        return sorted(
            (attachment for attachment in self.attachments if attachment.deleted_at is None),
            key=lambda attachment: (attachment.created_at, attachment.id),
        )

    @property
    def amount(self) -> Decimal:
        if self.report.regular_mode == "invoice":
            total = sum(
                (invoice.amount for invoice in self.active_invoices if invoice.amount_confirmed),
                Decimal("0.00"),
            )
            return total.quantize(Decimal("0.01"))
        return Decimal(self.manual_amount or 0).quantize(Decimal("0.01"))

    @property
    def document_count(self) -> int:
        if self.report.regular_mode == "invoice":
            return sum(invoice.page_count for invoice in self.active_invoices)
        return sum(int(attachment.page_count or 0) for attachment in self.active_attachments)
