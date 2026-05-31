from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.models.settings import Settings
from backend.schemas.report import ReportCreate, ReportUpdate, TripWrite
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    create_report,
    list_reports,
    soft_delete_report,
    update_report,
    update_report_status,
)


def test_create_report_seeds_expense_items(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    assert {item.category for item in report.expense_items} == set(EXPENSE_CATEGORIES)


def test_create_report_inherits_settings(db):
    db.add(Settings(id=1, department="研发部", employee_name="张三", daily_subsidy=Decimal("120.00")))
    db.commit()

    report = create_report(db, ReportCreate(purpose="出差"))
    assert report.department == "研发部"
    assert report.employee_name == "张三"
    assert report.daily_subsidy == Decimal("120.00")


def test_amount_normalization_keeps_two_decimals(db):
    report = create_report(
        db,
        ReportCreate(
            daily_subsidy=Decimal("100.005"),
            advance_amount=Decimal("80.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=1)],
        ),
    )
    # 价税合计 quantize 到两位小数
    assert report.total_amount == Decimal("100.00")
    assert report.shortfall == Decimal("20.00")
    assert report.surplus == Decimal("0.00")


def test_shortfall_and_surplus_are_decimal(db):
    report = create_report(
        db,
        ReportCreate(
            daily_subsidy=Decimal("50.00"),
            advance_amount=Decimal("80.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=1)],
        ),
    )
    assert isinstance(report.surplus, Decimal)
    assert report.surplus == Decimal("30.00")
    assert report.shortfall == Decimal("0.00")


def test_list_reports_pagination_and_filter(db):
    for i in range(3):
        create_report(db, ReportCreate(purpose=f"出差{i}"))
    items, total = list_reports(db, page=1, page_size=2)
    assert total == 3
    assert len(items) == 2

    # 状态筛选：全部为 draft
    items, total = list_reports(db, report_status="printed")
    assert total == 0


def test_soft_delete_only_draft(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    update_report_status(db, report.id, "printed")
    # printed 不可删除
    with pytest.raises(HTTPException) as exc:
        soft_delete_report(db, report.id)
    assert exc.value.status_code == 403


def test_soft_delete_hides_from_list(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    soft_delete_report(db, report.id)
    items, total = list_reports(db)
    assert total == 0
    assert items == []


def test_update_reimbursed_report_forbidden(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    update_report_status(db, report.id, "printed")
    update_report_status(db, report.id, "reimbursed")
    with pytest.raises(HTTPException) as exc:
        update_report(db, report.id, ReportUpdate(purpose="改"))
    assert exc.value.status_code == 403
