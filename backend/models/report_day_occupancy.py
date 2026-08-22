from datetime import date

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ReportDayOccupancy(Base):
    __tablename__ = "report_day_occupancies"
    __table_args__ = (
        UniqueConstraint("employee_key", "occupied_on", name="uq_report_day_occupancies_employee_date"),
        UniqueConstraint("report_id", "occupied_on", name="uq_report_day_occupancies_report_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("expense_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_key: Mapped[str] = mapped_column(String, nullable=False)
    occupied_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    report = relationship("ExpenseReport", back_populates="day_occupancies")
