from decimal import Decimal
from datetime import date

import pytest
from fastapi import HTTPException

from backend.models.invoice import Invoice
from backend.models.settings import Settings
from backend.schemas.report import ExpenseItemWrite, ReportCreate, ReportRead, ReportUpdate, TripWrite
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    ReportFilters,
    create_report,
    list_report_category_options,
    list_reports,
    recalculate_report_totals,
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


def test_list_reports_filters_by_trip_date_overlap(db):
    may_report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            purpose="五月出差",
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=5,
                    depart_day=1,
                    arrive_month=5,
                    arrive_day=3,
                )
            ],
        ),
    )
    create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 10),
            purpose="六月出差",
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=6,
                    depart_day=1,
                    arrive_month=6,
                    arrive_day=2,
                )
            ],
        ),
    )
    create_report(db, ReportCreate(report_date=date(2026, 5, 10), purpose="无行程"))

    items, total = list_reports(
        db,
        filters=ReportFilters(trip_start=date(2026, 5, 2), trip_end=date(2026, 5, 2)),
    )

    assert total == 1
    assert [item.id for item in items] == [may_report.id]


def test_report_read_includes_trip_date_bounds(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 10),
            purpose="多段出差",
            trips=[
                TripWrite(sort_order=1, depart_month=6, depart_day=2, arrive_month=6, arrive_day=3),
                TripWrite(sort_order=2, depart_month=6, depart_day=5, arrive_month=6, arrive_day=7),
            ],
        ),
    )

    read_model = ReportRead.model_validate(report)

    assert read_model.trip_start_date == date(2026, 6, 2)
    assert read_model.trip_end_date == date(2026, 6, 7)


def test_list_reports_defaults_to_trip_start_date_desc(db):
    early_trip = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 30),
            purpose="较早出差",
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=2, arrive_month=5, arrive_day=3)],
        ),
    )
    no_trip = create_report(db, ReportCreate(report_date=date(2026, 7, 1), purpose="无行程"))
    late_trip = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 1),
            purpose="较晚出差",
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=20, arrive_month=6, arrive_day=21)],
        ),
    )

    items, total = list_reports(db, page=1, page_size=10)

    assert total == 3
    assert [item.id for item in items] == [late_trip.id, early_trip.id, no_trip.id]


def test_list_reports_filters_previous_year_december_trip_from_january_report(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 1, 5),
            purpose="上年十二月出差",
            trips=[
                TripWrite(sort_order=1, depart_month=12, depart_day=30, arrive_month=12, arrive_day=31),
                TripWrite(sort_order=2, depart_month=1, depart_day=2, arrive_month=1, arrive_day=2),
            ],
        ),
    )

    items, total = list_reports(
        db,
        filters=ReportFilters(trip_start=date(2025, 12, 1), trip_end=date(2025, 12, 31)),
    )

    assert total == 1
    assert [item.id for item in items] == [report.id]


def test_list_reports_filters_by_keyword_amount_and_subsidy_days(db):
    matched = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            department="市场部",
            employee_name="张三",
            purpose="客户拜访",
            daily_subsidy=Decimal("100.00"),
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=5,
                    depart_day=1,
                    arrive_month=5,
                    arrive_day=3,
                    depart_place="北京",
                    arrive_place="北京",
                    subsidy_start=True,
                    subsidy_end=True,
                )
            ],
        ),
    )
    create_report(db, ReportCreate(report_date=date(2026, 5, 10), department="研发部", purpose="内部会议"))

    items, total = list_reports(
        db,
        filters=ReportFilters(
            keyword="客户",
            amount_min=Decimal("200.00"),
            amount_max=Decimal("400.00"),
            subsidy_days_min=3,
            subsidy_days_max=3,
        ),
    )

    assert total == 1
    assert items == [matched]


def test_list_reports_filters_by_invoice_state_category_and_attachment(db):
    unconfirmed = create_report(db, ReportCreate(report_date=date(2026, 5, 10), purpose="未确认发票"))
    confirmed = create_report(db, ReportCreate(report_date=date(2026, 5, 11), purpose="已确认发票"))
    no_invoice = create_report(db, ReportCreate(report_date=date(2026, 5, 12), purpose="无发票"))

    db.add(
        Invoice(
            report_id=unconfirmed.id,
            expense_category="accommodation",
            file_path="uploads/unconfirmed.pdf",
            file_type="pdf",
            amount=Decimal("120.00"),
            amount_confirmed=False,
        )
    )
    db.add(
        Invoice(
            report_id=confirmed.id,
            expense_category="city_transport",
            file_path="uploads/confirmed.pdf",
            file_type="pdf",
            amount=Decimal("80.00"),
            amount_confirmed=True,
        )
    )
    db.flush()
    recalculate_report_totals(unconfirmed)
    recalculate_report_totals(confirmed)
    db.commit()

    items, total = list_reports(db, filters=ReportFilters(invoice_state="has_unconfirmed"))
    assert total == 1
    assert items == [unconfirmed]

    items, total = list_reports(db, filters=ReportFilters(invoice_state="all_confirmed"))
    assert total == 1
    assert items == [confirmed]

    items, total = list_reports(db, filters=ReportFilters(invoice_state="no_invoice"))
    assert total == 1
    assert items == [no_invoice]

    items, total = list_reports(db, filters=ReportFilters(category="city_transport", has_attachment=True))
    assert total == 1
    assert items == [confirmed]


def test_report_category_options_include_custom_categories(db):
    report = create_report(
        db,
        ReportCreate(
            purpose="含自定义类别",
            expense_items=[ExpenseItemWrite(category="custom:宴请费")],
        ),
    )
    deleted = create_report(
        db,
        ReportCreate(
            purpose="删除类别来源",
            expense_items=[ExpenseItemWrite(category="custom:不应出现")],
        ),
    )
    soft_delete_report(db, deleted.id)

    options = list_report_category_options(db)

    assert {"value": "custom:宴请费", "label": "宴请费"} in options
    assert {"value": "custom:不应出现", "label": "不应出现"} not in options
    assert options[0] == {"value": "transport_fare", "label": "车船费"}
    assert report.deleted_at is None


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
