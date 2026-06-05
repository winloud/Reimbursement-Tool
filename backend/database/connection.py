from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATABASE_PATH = DATA_DIR / "expense.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


def create_db_and_tables() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    from backend.models import expense_item, invoice, report, settings, trip  # noqa: F401

    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()
    recalculate_existing_reports()


def migrate_sqlite_schema() -> None:
    with engine.begin() as connection:
        trip_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(trips)")).fetchall()}
        if "subsidy_start" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN subsidy_start BOOLEAN NOT NULL DEFAULT 0"))
        if "subsidy_end" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN subsidy_end BOOLEAN NOT NULL DEFAULT 0"))


def recalculate_existing_reports() -> None:
    from fastapi import HTTPException
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from backend.models.report import ExpenseReport
    from backend.services.report_service import recalculate_report_totals

    with Session(engine) as session:
        reports = list(session.scalars(select(ExpenseReport).where(ExpenseReport.deleted_at.is_(None))).all())
        for report in reports:
            try:
                recalculate_report_totals(report)
            except HTTPException:
                continue
        session.commit()
