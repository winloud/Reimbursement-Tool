from uuid import uuid4

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session

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


@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.close()


def create_db_and_tables() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    previous_schema_version = sqlite_schema_version()
    needs_day_occupancy_initialization = 1 <= previous_schema_version < DATA_SCHEMA_VERSION
    if needs_day_occupancy_initialization:
        from backend.services.maintenance_service import create_safety_snapshot

        with Session(engine) as session:
            create_safety_snapshot(session, reason="pre_schema_v7")

    from backend.models import (  # noqa: F401
        expense_item,
        invoice,
        regular_item,
        report,
        report_attachment,
        report_day_occupancy,
        settings,
        trip,
    )

    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema(update_schema_version=not needs_day_occupancy_initialization)
    normalize_subsidy_markers()
    backfill_trip_dates()
    if needs_day_occupancy_initialization:
        initialize_report_day_occupancies()
        set_sqlite_schema_version(DATA_SCHEMA_VERSION)
    recalculate_existing_reports()


def sqlite_schema_version() -> int:
    with engine.connect() as connection:
        return int(connection.execute(text("PRAGMA user_version")).scalar_one())


def set_sqlite_schema_version(version: int) -> None:
    with engine.begin() as connection:
        connection.execute(text(f"PRAGMA user_version = {int(version)}"))


def migrate_sqlite_schema(*, update_schema_version: bool = True) -> None:
    with engine.begin() as connection:
        tables = {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
        trip_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(trips)")).fetchall()}
        if "depart_date" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN depart_date DATE"))
        if "arrive_date" not in trip_columns:
            connection.execute(text("ALTER TABLE trips ADD COLUMN arrive_date DATE"))
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
            if "report_type" not in report_columns:
                connection.execute(text("ALTER TABLE expense_reports ADD COLUMN report_type VARCHAR NOT NULL DEFAULT 'travel'"))
            if "regular_mode" not in report_columns:
                connection.execute(text("ALTER TABLE expense_reports ADD COLUMN regular_mode VARCHAR"))
            if "day_occupancy_refresh_pending" not in report_columns:
                connection.execute(
                    text(
                        "ALTER TABLE expense_reports ADD COLUMN "
                        "day_occupancy_refresh_pending BOOLEAN NOT NULL DEFAULT 0"
                    )
                )
            connection.execute(text("UPDATE expense_reports SET report_type = 'travel' WHERE report_type IS NULL OR TRIM(report_type) = ''"))
            backfill_unique_uid(connection, "expense_reports", "report_uid")
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_expense_reports_report_uid ON expense_reports(report_uid)"))
            if "report_day_occupancies" not in tables:
                connection.execute(
                    text(
                        "CREATE TABLE report_day_occupancies ("
                        "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "
                        "report_id INTEGER NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE, "
                        "employee_key VARCHAR NOT NULL, "
                        "occupied_on DATE NOT NULL, "
                        "CONSTRAINT uq_report_day_occupancies_employee_date UNIQUE (employee_key, occupied_on), "
                        "CONSTRAINT uq_report_day_occupancies_report_date UNIQUE (report_id, occupied_on)"
                        ")"
                    )
                )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_report_day_occupancies_report_id ON report_day_occupancies(report_id)")
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_report_day_occupancies_occupied_on ON report_day_occupancies(occupied_on)")
            )
        if "invoices" in tables:
            invoice_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(invoices)")).fetchall()}
            if "invoice_uid" not in invoice_columns:
                connection.execute(text("ALTER TABLE invoices ADD COLUMN invoice_uid VARCHAR"))
            if "invoice_type" not in invoice_columns:
                connection.execute(text("ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR NOT NULL DEFAULT 'unknown'"))
            if "regular_item_id" not in invoice_columns:
                connection.execute(text("ALTER TABLE invoices ADD COLUMN regular_item_id INTEGER REFERENCES regular_items(id)"))
            backfill_unique_uid(connection, "invoices", "invoice_uid")
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_invoices_invoice_uid ON invoices(invoice_uid)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_regular_item_id ON invoices(regular_item_id)"))
        if "expense_items" in tables:
            expense_item_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(expense_items)")).fetchall()}
            if "reimbursable_amount" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN reimbursable_amount NUMERIC(18, 2)"))
            if "paper_invoice_amount" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN paper_invoice_amount NUMERIC(18, 2) NOT NULL DEFAULT 0"))
            if "paper_invoice_count" not in expense_item_columns:
                connection.execute(text("ALTER TABLE expense_items ADD COLUMN paper_invoice_count INTEGER NOT NULL DEFAULT 0"))
        if "report_attachments" in tables:
            attachment_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(report_attachments)")).fetchall()}
            if "regular_item_id" not in attachment_columns:
                connection.execute(text("ALTER TABLE report_attachments ADD COLUMN regular_item_id INTEGER REFERENCES regular_items(id)"))
            if "page_count" not in attachment_columns:
                connection.execute(text("ALTER TABLE report_attachments ADD COLUMN page_count INTEGER NOT NULL DEFAULT 1"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_report_attachments_regular_item_id ON report_attachments(regular_item_id)"))
        if update_schema_version:
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


def backfill_trip_dates() -> None:
    """给历史行程补上含年份的 depart_date/arrive_date。

    旧数据只存月日，年份由 infer_trip_date_ranges 以报销单日期为锚点推断。这里把推断
    结果一次性落库，之后跨年就读实际日期而不再依赖推断。已有日期的行程不动；推断失败
    （无效日期或时序矛盾）的报销单整张跳过，留给用户在页面上修正。幂等。
    """
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from backend.models.report import ExpenseReport
    from backend.services.report_service import backfill_report_trip_dates

    with Session(engine) as session:
        # 含回收站里的报销单：恢复出来的单据也该带完整日期。
        reports = list(session.scalars(select(ExpenseReport)).all())
        changed = False
        for report in reports:
            if backfill_report_trip_dates(report):
                changed = True
        if changed:
            session.commit()


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


def initialize_report_day_occupancies() -> None:
    from backend.services.report_service import initialize_report_day_occupancies as initialize

    with Session(engine) as session:
        initialize(session)
        session.commit()
