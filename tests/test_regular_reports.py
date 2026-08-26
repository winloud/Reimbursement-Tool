from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, text

from backend.database import connection
from backend.models.invoice import Invoice
from backend.schemas.report import ReportCreate, ReportDetailRead, ReportUpdate, RegularItemWrite
from backend.services.report_service import (
    ReportFilters,
    create_report,
    ensure_reimbursable_expenses_printable,
    ensure_report_previewable,
    list_reports,
    recalculate_report_totals,
    update_report,
    update_report_status,
)


def regular_item(
    *,
    item_id: int | None = None,
    sort_order: int = 1,
    description: str | None = "办公用品",
    amount: Decimal | None = Decimal("25.60"),
) -> RegularItemWrite:
    return RegularItemWrite(
        id=item_id,
        sort_order=sort_order,
        occurred_on=date(2026, 8, 10),
        description=description,
        amount=amount,
    )


def test_regular_no_invoice_report_uses_stable_items_and_manual_totals(db):
    report = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="no_invoice",
            report_date=date(2026, 8, 11),
            employee_name="张三",
            regular_items=[regular_item(), regular_item(sort_order=2, description="快递费", amount=Decimal("10.40"))],
        ),
    )

    assert report.report_type == "regular"
    assert report.regular_mode == "no_invoice"
    assert report.trips == []
    assert report.expense_items == []
    assert report.total_amount == Decimal("36.00")
    assert report.document_count == 0
    first_id, second_id = [item.id for item in report.regular_items]

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_type="regular",
            regular_mode="no_invoice",
            report_date=report.report_date,
            employee_name=report.employee_name,
            regular_items=[
                regular_item(item_id=second_id, description="快递及邮寄", amount=Decimal("12.00")),
                regular_item(item_id=first_id, sort_order=2, amount=Decimal("30.00")),
            ],
        ),
    )

    assert [item.id for item in updated.regular_items] == [second_id, first_id]
    assert [item.sort_order for item in updated.regular_items] == [1, 2]
    assert updated.total_amount == Decimal("42.00")
    detail = ReportDetailRead.model_validate(updated)
    assert detail.regular_item_summary == "快递及邮寄、办公用品"
    assert [item.amount for item in detail.regular_items] == [Decimal("12.00"), Decimal("30.00")]


def test_regular_invoice_item_amount_and_document_count_are_derived(db):
    report = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="invoice",
            regular_items=[regular_item(amount=None)],
        ),
    )
    item = report.regular_items[0]
    report.invoices.extend(
        [
            Invoice(
                regular_item_id=item.id,
                expense_category="regular",
                file_path="uploads/a.pdf",
                file_type="pdf",
                amount=Decimal("88.00"),
                amount_confirmed=True,
            ),
            Invoice(
                regular_item_id=item.id,
                expense_category="regular",
                file_path="uploads/b.pdf",
                file_type="pdf",
                amount=Decimal("20.00"),
                amount_confirmed=False,
            ),
        ]
    )
    db.flush()
    recalculate_report_totals(report)

    assert item.amount == Decimal("88.00")
    assert item.document_count == 2
    assert report.total_amount == Decimal("88.00")
    assert report.document_count == 2


def test_regular_status_validation_is_mode_specific(db):
    no_invoice = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="no_invoice",
            report_date=date(2026, 8, 11),
            employee_name="无票报销人",
            regular_items=[regular_item(amount=Decimal("0.00"))],
        ),
    )
    with pytest.raises(HTTPException, match="金额必须大于 0"):
        update_report_status(db, no_invoice.id, "checked")
    with pytest.raises(HTTPException, match="金额必须大于 0"):
        ensure_reimbursable_expenses_printable(no_invoice)

    invoice = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="invoice",
            report_date=date(2026, 8, 11),
            employee_name="有票报销人",
            regular_items=[regular_item(amount=None)],
        ),
    )
    with pytest.raises(HTTPException, match="至少需要上传一张发票"):
        update_report_status(db, invoice.id, "checked")

    invoice.regular_items[0].invoices.append(
        Invoice(
            report_id=invoice.id,
            expense_category="regular",
            file_path="uploads/unconfirmed.pdf",
            file_type="pdf",
            amount=Decimal("20.00"),
            amount_confirmed=False,
        )
    )
    db.flush()
    with pytest.raises(HTTPException, match="未确认发票"):
        ensure_report_previewable(invoice)
    with pytest.raises(HTTPException, match="未确认发票"):
        ensure_reimbursable_expenses_printable(invoice)


def test_regular_formal_actions_allow_blank_report_date_before_submission_but_require_claimant(db):
    report = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="no_invoice",
            regular_items=[regular_item(amount=Decimal("10.00"))],
        ),
    )

    ensure_report_previewable(report)
    with pytest.raises(HTTPException, match="请填写报销人"):
        ensure_reimbursable_expenses_printable(report)

    report.employee_name = "张三"
    db.commit()
    checked = update_report_status(db, report.id, "checked")
    assert checked.report_date is None


def test_regular_kind_is_immutable_and_cross_kind_payloads_are_rejected(db):
    report = create_report(
        db,
        ReportCreate(report_type="regular", regular_mode="no_invoice", regular_items=[regular_item()]),
    )
    with pytest.raises(HTTPException, match="类型创建后不能修改"):
        update_report(db, report.id, ReportUpdate(report_type="travel"))
    with pytest.raises(HTTPException, match="模式创建后不能修改"):
        update_report(db, report.id, ReportUpdate(report_type="regular", regular_mode="invoice"))
    with pytest.raises(ValidationError, match="出差报销单不能包含常规报销"):
        ReportCreate(report_type="travel", regular_mode="no_invoice")

    travel = create_report(db, ReportCreate(purpose="出差"))
    with pytest.raises(HTTPException, match="出差报销单不能包含常规报销项目"):
        update_report(db, travel.id, ReportUpdate(report_type="travel", regular_items=[regular_item()]))


def test_report_filters_default_to_travel_and_can_select_regular_mode(db):
    travel = create_report(db, ReportCreate(purpose="差旅"))
    regular = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode="no_invoice",
            regular_items=[regular_item(description="搜索项目")],
        ),
    )

    default_items, default_total = list_reports(db)
    regular_items, regular_total = list_reports(
        db,
        filters=ReportFilters(report_type="regular", regular_mode="no_invoice", keyword="搜索"),
    )
    all_items, all_total = list_reports(db, filters=ReportFilters(report_type=None))

    assert default_items == [travel]
    assert default_total == 1
    assert regular_items == [regular]
    assert regular_total == 1
    assert set(all_items) == {travel, regular}
    assert all_total == 2


def test_current_schema_migration_backfills_travel_and_adds_regular_link_columns(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as database:
        database.execute(text("CREATE TABLE trips (id INTEGER PRIMARY KEY)"))
        database.execute(text("CREATE TABLE expense_items (id INTEGER PRIMARY KEY)"))
        database.execute(text("CREATE TABLE settings (id INTEGER PRIMARY KEY)"))
        database.execute(text("CREATE TABLE expense_reports (id INTEGER PRIMARY KEY, report_uid VARCHAR)"))
        database.execute(text("INSERT INTO expense_reports (id, report_uid) VALUES (1, 'legacy')"))
        database.execute(text("CREATE TABLE regular_items (id INTEGER PRIMARY KEY, report_id INTEGER, amount NUMERIC(18, 2))"))
        database.execute(text("CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_uid VARCHAR)"))
        database.execute(text("CREATE TABLE report_attachments (id INTEGER PRIMARY KEY)"))
    monkeypatch.setattr(connection, "engine", engine)

    connection.migrate_sqlite_schema()

    with engine.begin() as database:
        report_columns = {row[1] for row in database.execute(text("PRAGMA table_info(expense_reports)"))}
        invoice_columns = {row[1] for row in database.execute(text("PRAGMA table_info(invoices)"))}
        attachment_columns = {row[1] for row in database.execute(text("PRAGMA table_info(report_attachments)"))}
        legacy_type = database.execute(text("SELECT report_type FROM expense_reports WHERE id = 1")).scalar_one()
        schema_version = database.execute(text("PRAGMA user_version")).scalar_one()

    assert {"report_type", "regular_mode"}.issubset(report_columns)
    assert "regular_item_id" in invoice_columns
    assert {"regular_item_id", "page_count"}.issubset(attachment_columns)
    assert legacy_type == "travel"
    assert schema_version == 7
