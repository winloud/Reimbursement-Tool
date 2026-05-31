from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ExpenseItem(Base):
    __tablename__ = "expense_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    remark: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    report = relationship("ExpenseReport", back_populates="expense_items")

    @property
    def active_confirmed_invoices(self):
        return [
            invoice
            for invoice in self.report.invoices
            if invoice.deleted_at is None and invoice.amount_confirmed and invoice.expense_category == self.category
        ]

    @property
    def invoice_count(self) -> int:
        return len(self.active_confirmed_invoices)

    @property
    def amount(self) -> Decimal:
        return sum((invoice.amount for invoice in self.active_confirmed_invoices), Decimal("0.00"))
