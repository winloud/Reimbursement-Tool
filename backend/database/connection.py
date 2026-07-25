from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase

from backend.data_schema import DATA_SCHEMA_VERSION
from backend.runtime_paths import DATA_DIR, DATABASE_PATH, PROJECT_ROOT

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
    normalize_subsidy_markers()
    recalculate_existing_reports()


def migrate_sqlite_schema() -> None:
    with engine.begin() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
        trip_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(trips)")).fetchall()}
        if "subsidy_start" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN subsidy_start BOOLEAN NOT NULL DEFAULT 0"))
        if "subsidy_end" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN subsidy_end BOOLEAN NOT NULL DEFAULT 0"))
        if "paper_invoice_amount" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN paper_invoice_amount NUMERIC(18, 2) NOT NULL DEFAULT 0"))
        if "paper_invoice_count" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN paper_invoice_count INTEGER NOT NULL DEFAULT 0"))
        settings_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(settings)")).fetchall()}
        if "pdf_fill_font_key" not in settings_columns:
            connection.execute(text("ALTER TABLE settings ADD COLUMN pdf_fill_font_key VARCHAR DEFAULT 'system:simsun'"))
        if "double_print_vat_special_invoices" not in settings_columns:
            connection.execute(text("ALTER TABLE settings ADD COLUMN double_print_vat_special_invoices BOOLEAN NOT NULL DEFAULT 1"))
        if "invoice_qr_engine" not in settings_columns:
            connection.execute(text("ALTER TABLE settings ADD COLUMN invoice_qr_engine VARCHAR NOT NULL DEFAULT 'zxing'"))
        if "autosave_delay_seconds" not in settings_columns:
            connection.execute(text("ALTER TABLE settings ADD COLUMN autosave_delay_seconds INTEGER NOT NULL DEFAULT 3"))
        if "expense_reports" in tables:
            report_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(expense_reports)")).fetchall()}
            if "report_uid" not in report_columns:
                connection.execute(text("ALTER TABLE expense_reports ADD COLUMN report_uid VARCHAR"))
            if "manual_subsidy_total" not in report_columns:
                connection.execute(text("ALTER TABLE expense_reports ADD COLUMN manual_subsidy_total NUMERIC(18, 2)"))
            backfill_unique_uid(connection, "expense_reports", "report_uid")
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_expense_reports_report_uid ON expense_reports(report_uid)"))
        if "invoices" in tables:
            invoice_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(invoices)")).fetchall()}
            if "invoice_uid" not in invoice_columns:
                connection.execute(text("ALTER TABLE invoices ADD COLUMN invoice_uid VARCHAR"))
            if "invoice_type" not in invoice_columns:
                connection.execute(text("ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR NOT NULL DEFAULT 'unknown'"))
            backfill_unique_uid(connection, "invoices", "invoice_uid")
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_invoices_invoice_uid ON invoices(invoice_uid)"))
        if "expense_items" in tables:
            expense_item_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(expense_items)")).fetchall()}
            if "reimbursable_amount" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN reimbursable_amount NUMERIC(18, 2)"))
            if "paper_invoice_amount" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN paper_invoice_amount NUMERIC(18, 2) NOT NULL DEFAULT 0"))
            if "paper_invoice_count" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN paper_invoice_count INTEGER NOT NULL DEFAULT 0"))
        connection.execute(text(f"PRAGMA user_version = {DATA_SCHEMA_VERSION}"))


def backfill_unique_uid(connection, table_name: str, column_name: str) -> None:
    rows = connection.execute(text(f"SELECT id, {column_name} FROM {table_name} ORDER BY id")).fetchall()
    seen: set[str] = set()
    for row_id, current_uid in rows:
        uid = (current_uid or "").strip()
        if not uid or uid in seen:
            uid = uuid4().hex
            while uid in seen:
                uid = uuid4().hex
            connection.execute(
                text(f"UPDATE {table_name} SET {column_name} = :uid WHERE id = :id"),
                {"uid": uid, "id": row_id},
            )
        seen.add(uid)


def normalize_subsidy_markers() -> None:
    """一次性幂等清洗：清掉每张报销单首段、末段的全部显式起止标记。

    新模型下第 1 段隐含「起」、最后 1 段隐含「止」，首末段不应携带显式标记——
    它们多为历史 bug（如「生成返程」继承源段标记）或旧地名自动推断的冗余。残留的
    首末显式标记会在增减行程后位置漂移成中间段时，把补贴区间错误截断。清洗后由
    recalculate_existing_reports 用新逻辑重算。中间段的切分标记保留。幂等。
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE trips SET subsidy_start = 0, subsidy_end = 0 "
                "WHERE sort_order = (SELECT MIN(t2.sort_order) FROM trips t2 WHERE t2.report_id = trips.report_id)"
            )
        )
        connection.execute(
            text(
                "UPDATE trips SET subsidy_start = 0, subsidy_end = 0 "
                "WHERE sort_order = (SELECT MAX(t2.sort_order) FROM trips t2 WHERE t2.report_id = trips.report_id)"
            )
        )


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
