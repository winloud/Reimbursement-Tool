from decimal import Decimal
from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.database import connection
from backend.models.invoice import Invoice
from backend.models.settings import Settings
from backend.schemas.report import ExpenseItemWrite, ReportCreate, ReportRead, ReportUpdate, TripWrite
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    ReportFilters,
    backfill_report_trip_dates,
    create_report,
    list_report_category_options,
    list_reports,
    recalculate_report_totals,
    report_matches_category,
    report_matches_filters,
    report_matches_invoice_state,
    soft_delete_report,
    update_report,
    update_report_status,
)


def test_create_report_seeds_expense_items(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    assert {item.category for item in report.expense_items} == set(EXPENSE_CATEGORIES)


def test_draft_can_be_created_and_saved_without_a_purpose(db):
    report = create_report(db, ReportCreate(purpose=None))

    updated = update_report(db, report.id, ReportUpdate(purpose=None, department="研发部"))

    assert updated.status == "draft"
    assert updated.purpose is None
    assert updated.department == "研发部"


def test_paper_invoice_values_are_persisted_and_included_in_totals(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 7, 25),
            daily_subsidy=Decimal("0.00"),
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=7,
                    depart_day=25,
                    arrive_month=7,
                    arrive_day=25,
                    paper_invoice_amount=Decimal("12.50"),
                    paper_invoice_count=1,
                )
            ],
            expense_items=[ExpenseItemWrite(category="luggage", paper_invoice_amount=Decimal("25.00"), paper_invoice_count=2)],
        ),
    )
    report.daily_subsidy = Decimal("0.00")
    recalculate_report_totals(report)
    luggage = next(item for item in report.expense_items if item.category == "luggage")

    assert report.trips[0].amount == Decimal("12.50")
    assert report.trips[0].invoice_count == 1
    assert luggage.invoice_total == Decimal("25.00")
    assert luggage.invoice_count == 2
    assert report.total_amount == Decimal("37.50")
    assert report_matches_invoice_state(report, "all_confirmed")
    assert not report_matches_invoice_state(report, "no_invoice")
    assert report_matches_category(report, "transport_fare")
    assert report_matches_category(report, "luggage")
    assert not report_matches_filters(report, ReportFilters(has_attachment=True))
    assert report_matches_filters(report, ReportFilters(has_attachment=False))


def test_report_read_invoice_count_includes_electronic_and_paper_invoices(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 7, 25),
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=7,
                    depart_day=25,
                    arrive_month=7,
                    arrive_day=25,
                    paper_invoice_amount=Decimal("12.50"),
                    paper_invoice_count=1,
                )
            ],
        ),
    )
    report.invoices.append(
        Invoice(
            expense_category="luggage",
            file_path="uploads/1/invoice.pdf",
            file_type="application/pdf",
            amount=Decimal("10.00"),
            amount_confirmed=False,
        )
    )
    db.flush()
    assert report.invoice_count == 2
    assert ReportRead.model_validate(report).invoice_count == 2


def test_removing_trip_soft_deletes_its_invoices_and_keeps_other_trip_files(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 8, 19),
            daily_subsidy=Decimal("0.00"),
            trips=[
                TripWrite(sort_order=1, depart_date=date(2026, 8, 17), arrive_date=date(2026, 8, 17)),
                TripWrite(sort_order=2, depart_date=date(2026, 8, 18), arrive_date=date(2026, 8, 18)),
            ],
        ),
    )
    removed_trip, kept_trip = sorted(report.trips, key=lambda trip: trip.sort_order)
    removed_invoice = Invoice(
        report_id=report.id,
        trip_id=removed_trip.id,
        expense_category="transport_fare",
        file_path="uploads/removed-trip.pdf",
        file_type="pdf",
        amount=Decimal("34.50"),
        amount_confirmed=True,
    )
    kept_invoice = Invoice(
        report_id=report.id,
        trip_id=kept_trip.id,
        expense_category="transport_fare",
        file_path="uploads/kept-trip.pdf",
        file_type="pdf",
        amount=Decimal("184.00"),
        amount_confirmed=True,
    )
    db.add_all([removed_invoice, kept_invoice])
    db.commit()

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 8, 19),
            daily_subsidy=Decimal("0.00"),
            trips=[
                TripWrite(
                    id=kept_trip.id,
                    sort_order=1,
                    depart_date=kept_trip.depart_date,
                    arrive_date=kept_trip.arrive_date,
                )
            ],
        ),
    )
    db.refresh(removed_invoice)
    db.refresh(kept_invoice)

    assert [trip.id for trip in updated.trips] == [kept_trip.id]
    assert removed_invoice.deleted_at is not None
    assert removed_invoice.trip_id is None
    assert kept_invoice.deleted_at is None
    assert kept_invoice.trip_id == kept_trip.id
    assert [invoice.id for invoice in updated.active_invoices] == [kept_invoice.id]
    assert updated.total_amount == Decimal("184.00")


def test_trip_write_derives_month_and_day_from_dates():
    trip = TripWrite(sort_order=1, depart_date=date(2025, 12, 30), arrive_date=date(2026, 1, 2))

    assert (trip.depart_month, trip.depart_day) == (12, 30)
    assert (trip.arrive_month, trip.arrive_day) == (1, 2)


def test_trip_write_requires_a_date_or_month_day_pair():
    with pytest.raises(ValidationError, match="行程缺少出发日期"):
        TripWrite(sort_order=1, arrive_date=date(2026, 1, 2))

    with pytest.raises(ValidationError, match="行程缺少到达日期"):
        TripWrite(sort_order=1, depart_date=date(2026, 1, 2))


def test_create_report_stores_trip_dates_and_counts_cross_year_subsidy(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 1, 6),
            daily_subsidy=Decimal("100.00"),
            trips=[TripWrite(sort_order=1, depart_date=date(2025, 12, 30), arrive_date=date(2026, 1, 2))],
        ),
    )

    trip = report.trips[0]
    assert (trip.depart_date, trip.arrive_date) == (date(2025, 12, 30), date(2026, 1, 2))
    assert (trip.depart_month, trip.depart_day) == (12, 30)
    assert report.subsidy_days == 4


def test_backfill_report_trip_dates_fills_inferred_years_for_legacy_trips(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 1, 5),
            trips=[
                TripWrite(sort_order=1, depart_month=12, depart_day=30, arrive_month=12, arrive_day=31),
                TripWrite(sort_order=2, depart_month=1, depart_day=2, arrive_month=1, arrive_day=2),
            ],
        ),
    )
    assert all(trip.depart_date is None for trip in report.trips)

    assert backfill_report_trip_dates(report) is True
    db.commit()

    trips = sorted(report.trips, key=lambda item: item.sort_order)
    assert (trips[0].depart_date, trips[0].arrive_date) == (date(2025, 12, 30), date(2025, 12, 31))
    assert (trips[1].depart_date, trips[1].arrive_date) == (date(2026, 1, 2), date(2026, 1, 2))
    # 幂等：日期补齐后再跑一次不应该改动任何东西
    assert backfill_report_trip_dates(report) is False


def test_backfill_report_trip_dates_keeps_existing_dates(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 5),
            trips=[TripWrite(sort_order=1, depart_date=date(2025, 6, 1), arrive_date=date(2025, 6, 2))],
        ),
    )

    assert backfill_report_trip_dates(report) is False
    assert report.trips[0].depart_date == date(2025, 6, 1)


def test_paper_invoice_amount_and_count_must_be_filled_together():
    with pytest.raises(ValidationError, match="纸质发票金额和张数需同时填写"):
        TripWrite(sort_order=1, depart_month=7, depart_day=25, arrive_month=7, arrive_day=25, paper_invoice_amount=Decimal("10.00"))

    with pytest.raises(ValidationError, match="纸质发票金额和张数需同时填写"):
        ExpenseItemWrite(category="luggage", paper_invoice_count=1)


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


def test_manual_subsidy_total_overrides_days_and_switches_back_to_automatic(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 7, 25),
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("75.555"),
            trips=[TripWrite(sort_order=1, depart_month=7, depart_day=20, arrive_month=7, arrive_day=22)],
        ),
    )

    assert report.manual_subsidy_total == Decimal("75.56")
    assert report.subsidy_days == 0
    assert report.subsidy_total == Decimal("75.56")
    assert report.total_amount == Decimal("75.56")
    assert ReportRead.model_validate(report).manual_subsidy_total == Decimal("75.56")

    report.daily_subsidy = Decimal("200.00")
    report.trips[0].arrive_day = 23
    recalculate_report_totals(report)
    assert report.subsidy_days == 0
    assert report.subsidy_total == Decimal("75.56")

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 7, 25),
            daily_subsidy=Decimal("200.00"),
            manual_subsidy_total=None,
            trips=[TripWrite(sort_order=1, depart_month=7, depart_day=20, arrive_month=7, arrive_day=23)],
        ),
    )
    assert updated.manual_subsidy_total is None
    assert updated.subsidy_days == 4
    assert updated.subsidy_total == Decimal("800.00")


def test_zero_manual_subsidy_is_not_treated_as_automatic(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 7, 25),
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("0.00"),
            trips=[TripWrite(sort_order=1, depart_month=7, depart_day=20, arrive_month=7, arrive_day=22)],
        ),
    )

    assert report.manual_subsidy_total == Decimal("0.00")
    assert report.subsidy_days == 0
    assert report.subsidy_total == Decimal("0.00")
    assert report.total_amount == Decimal("0.00")


def test_startup_recalculation_preserves_zero_manual_subsidy(db, monkeypatch):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 7, 25),
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("0.00"),
            trips=[TripWrite(sort_order=1, depart_month=7, depart_day=20, arrive_month=7, arrive_day=22)],
        ),
    )
    report.subsidy_days = 99
    report.subsidy_total = Decimal("999.00")
    report.total_amount = Decimal("999.00")
    db.commit()

    monkeypatch.setattr(connection, "engine", db.get_bind())
    connection.recalculate_existing_reports()
    db.expire_all()
    reloaded = db.get(type(report), report.id)

    assert reloaded.manual_subsidy_total == Decimal("0.00")
    assert reloaded.subsidy_days == 0
    assert reloaded.subsidy_total == Decimal("0.00")
    assert reloaded.total_amount == Decimal("0.00")


def test_manual_subsidy_still_validates_trip_chronology(db):
    with pytest.raises(HTTPException, match="同日行程到达时间不能早于出发时间"):
        create_report(
            db,
            ReportCreate(
                report_date=date(2026, 7, 25),
                manual_subsidy_total=Decimal("20.00"),
                trips=[
                    TripWrite(
                        sort_order=1,
                        depart_month=7,
                        depart_day=20,
                        depart_hour=12,
                        arrive_month=7,
                        arrive_day=20,
                        arrive_hour=10,
                    )
                ],
            ),
        )


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


def test_subsidy_days_filter_excludes_manual_subsidy_reports(db):
    automatic = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            daily_subsidy=Decimal("100.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=2)],
        ),
    )
    manual = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("0.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=2)],
        ),
    )

    items, total = list_reports(
        db,
        filters=ReportFilters(subsidy_days_min=0, subsidy_days_max=10),
    )

    assert total == 1
    assert items == [automatic]
    assert manual not in items


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
    update_report_status(db, report.id, "checked")
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


@pytest.mark.parametrize("locked_status", ["checked", "printed", "reimbursed"])
def test_non_draft_report_is_read_only(db, locked_status):
    report = create_report(db, ReportCreate(purpose="出差"))
    update_report_status(db, report.id, "checked")
    if locked_status in {"printed", "reimbursed"}:
        update_report_status(db, report.id, "printed")
    if locked_status == "reimbursed":
        update_report_status(db, report.id, "reimbursed")
    with pytest.raises(HTTPException) as exc:
        update_report(db, report.id, ReportUpdate(purpose="改"))
    assert exc.value.status_code == 403


def test_returning_to_draft_restores_editability(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    update_report_status(db, report.id, "checked")
    update_report_status(db, report.id, "draft")

    updated = update_report(db, report.id, ReportUpdate(purpose="改后继续编辑"))

    assert updated.purpose == "改后继续编辑"


def test_reimbursed_report_can_return_to_submitted(db):
    report = create_report(db, ReportCreate(purpose="出差"))
    update_report_status(db, report.id, "checked")
    update_report_status(db, report.id, "printed")
    update_report_status(db, report.id, "reimbursed")

    updated = update_report_status(db, report.id, "printed")

    assert updated.status == "printed"


def test_list_reports_tolerates_invalid_trip_chronology(db):
    """历史脏数据：同日行程到达时间早于出发时间。只读列表不应整页崩溃，而是降级。"""
    from backend.models.report import ExpenseReport
    from backend.models.trip import Trip

    # 直接 ORM 插入非法行程，绕过 create_report 的保存校验，模拟旧版本遗留的脏数据
    report = ExpenseReport(status="draft", report_date=date(2026, 6, 26), purpose="脏数据")
    report.trips.append(
        Trip(
            sort_order=1,
            depart_month=6, depart_day=7, depart_hour=3, depart_place="上海",
            arrive_month=6, arrive_day=7, arrive_hour=2, arrive_place="北京",
        )
    )
    db.add(report)
    db.commit()

    # 排序/序列化路径：不抛 TripDateError，行程日期边界降级为 None
    items, total = list_reports(db, page=1, page_size=20)
    assert total == 1
    assert items[0].id == report.id
    assert items[0].trip_start_date is None
    assert items[0].trip_end_date is None

    # 序列化为前端读取模型也不应崩
    read_model = ReportRead.model_validate(report)
    assert read_model.trip_start_date is None
    assert read_model.trip_end_date is None

    # 筛选路径：带行程日期筛选不应崩，脏数据按不匹配处理
    items, total = list_reports(
        db,
        filters=ReportFilters(trip_start=date(2026, 1, 1), trip_end=date(2026, 12, 31)),
    )
    assert total == 0
