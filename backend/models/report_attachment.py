from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


class ReportAttachment(Base):
    __tablename__ = "report_attachments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    attachment_uid: Mapped[str] = mapped_column(String, default=lambda: uuid4().hex, nullable=False, unique=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("expense_reports.id"), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    file_type: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    report = relationship("ExpenseReport", back_populates="attachments")
