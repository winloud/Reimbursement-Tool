from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ExpenseItem(Base):
    __tablename__ = "expense_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    remark: Mapped[str | None] = mapped_column(String, nullable=True)
    reimbursable_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    paper_invoice_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0.00"), nullable=False)
    paper_invoice_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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
        return len(self.active_confirmed_invoices) + int(self.paper_invoice_count or 0)

    @property
    def invoice_total(self) -> Decimal:
        electronic_total = sum((invoice.amount for invoice in self.active_confirmed_invoices), Decimal("0.00"))
        return (electronic_total + Decimal(self.paper_invoice_amount or 0)).quantize(Decimal("0.01"))

    @property
    def amount(self) -> Decimal:
        if self.category == "fuel_subsidy" and self.reimbursable_amount is not None:
            return Decimal(self.reimbursable_amount).quantize(Decimal("0.01"))
        return self.invoice_total
