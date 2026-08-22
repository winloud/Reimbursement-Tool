"""Dashboard statistics and calendar aggregation tests."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.models.invoice import Invoice
from backend.models.report_day_occupancy import ReportDayOccupancy
from backend.schemas.report import RegularItemWrite, ReportCreate, TripWrite
from backend.services.report_service import create_report, recalculate_report_totals
from backend.services.stats_service import get_stats_calendar, get_stats_category, get_stats_summary


def add_invoice(db, report, category: str, amount: str, confirmed: bool = True) -> None:
    db.add(
        Invoice(
            report_id=report.id,
            expense_category=category,
            file_path=f"uploads/{report.id}/{category}.pdf",
            file_type="pdf",
            amount=Decimal(amount),
            amount_confirmed=confirmed,
        )
    )


def make_report(
    db,
    *,
    report_date: date,
    status: str,
    employee_name: str | None = None,
    amount: str = "0.00",
    category: str = "luggage",
    daily_subsidy: str = "0.00",
    manual_subsidy_total: str | None = None,
    trips: list[TripWrite] | None = None,
):
    report = create_report(
        db,
        ReportCreate(
            report_date=report_date,
            employee_name=employee_name,
            purpose=f"{status}-{report_date}",
            daily_subsidy=Decimal(daily_subsidy),
            manual_subsidy_total=(
                Decimal(manual_subsidy_total)
                if manual_subsidy_total is not None
                else None
            ),
            trips=trips or [],
        ),
    )
    report.daily_subsidy = Decimal(daily_subsidy)
    if amount != "0.00":
        add_invoice(db, report, category, amount)
    db.flush()
    recalculate_report_totals(report)
    report.status = status
    db.commit()
    db.refresh(report)
    return report


def test_stats_summary_includes_drafts_in_pending_and_splits_reimbursed_amounts(db):
    make_report(db, report_date=date(2026, 6, 1), status="draft", amount="999.00")
    make_report(db, report_date=date(2026, 6, 2), status="printed", amount="120.00")
    make_report(db, report_date=date(2026, 6, 3), status="reimbursed", amount="300.00")
    make_report(db, report_date=date(2026, 6, 4), status="checked", amount="70.00")
    make_report(db, report_date=date(2026, 1, 5), status="printed", amount="80.00")
    make_report(db, report_date=date(2026, 2, 6), status="reimbursed", amount="50.00")
    make_report(db, report_date=date(2026, 3, 7), status="checked", amount="90.00")

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-01", end_month="2026-06")

    assert summary.selected_period.pending_amount == Decimal("1359.00")
    assert summary.selected_period.pending_count == 5
    assert summary.selected_period.reimbursed_amount == Decimal("350.00")
    assert summary.selected_period.reimbursed_count == 2
    assert summary.selected_period.total_amount == Decimal("1709.00")
    assert summary.selected_period.total_count == 7
    assert summary.current_month.pending_amount == Decimal("1189.00")
    assert summary.current_month.pending_count == 3
    assert summary.current_month.reimbursed_amount == Decimal("300.00")
    assert summary.current_month.reimbursed_count == 1
    assert summary.current_month.total_amount == Decimal("1489.00")
    assert summary.current_month.total_count == 4
    assert summary.current_year.pending_amount == Decimal("1359.00")
    assert summary.current_year.pending_count == 5
    assert summary.current_year.reimbursed_amount == Decimal("350.00")
    assert summary.current_year.reimbursed_count == 2
    assert summary.current_year.total_amount == Decimal("1709.00")
    assert summary.current_year.total_count == 7


def test_stats_summary_counts_occupied_person_days_for_active_reports_including_drafts(db):
    make_report(
        db,
        report_date=date(2026, 6, 1),
        status="printed",
        trips=[
            TripWrite(sort_order=1, depart_month=6, depart_day=1, arrive_month=6, arrive_day=2),
        ],
    )
    make_report(
        db,
        report_date=date(2026, 6, 5),
        status="reimbursed",
        trips=[
            TripWrite(sort_order=1, depart_month=6, depart_day=5, arrive_month=6, arrive_day=7),
        ],
    )
    make_report(
        db,
        report_date=date(2026, 6, 10),
        status="checked",
        trips=[
            TripWrite(sort_order=1, depart_month=6, depart_day=10, arrive_month=6, arrive_day=11),
        ],
    )
    make_report(
        db,
        report_date=date(2026, 6, 12),
        status="draft",
        trips=[
            TripWrite(sort_order=1, depart_month=6, depart_day=12, arrive_month=6, arrive_day=15),
        ],
    )

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-06", end_month="2026-06")

    assert summary.selected_period.trip_days == 11


def test_stats_trend_includes_draft_financials_and_occupancies(db):
    make_report(
        db,
        report_date=date(2026, 5, 4),
        status="printed",
        amount="999.00",
        trips=[TripWrite(sort_order=1, depart_month=5, depart_day=4, arrive_month=5, arrive_day=8)],
    )
    make_report(
        db,
        report_date=date(2026, 5, 10),
        status="reimbursed",
        amount="180.00",
        trips=[TripWrite(sort_order=1, depart_month=5, depart_day=10, arrive_month=5, arrive_day=12)],
    )
    make_report(
        db,
        report_date=date(2026, 5, 15),
        status="checked",
        amount="200.00",
        trips=[TripWrite(sort_order=1, depart_month=5, depart_day=15, arrive_month=5, arrive_day=16)],
    )
    make_report(
        db,
        report_date=date(2026, 5, 20),
        status="draft",
        amount="888.00",
        trips=[TripWrite(sort_order=1, depart_month=5, depart_day=20, arrive_month=5, arrive_day=21)],
    )

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-05", end_month="2026-06")

    assert [item.month for item in summary.monthly_trend] == ["2026-05", "2026-06"]
    may = next(item for item in summary.monthly_trend if item.month == "2026-05")
    assert may.pending_amount == Decimal("2087.00")
    assert may.reimbursed_amount == Decimal("180.00")
    assert may.total_amount == Decimal("2267.00")
    assert may.total_count == 4
    assert may.trip_days == 12


def test_stats_category_includes_drafts_and_keeps_confirmed_invoice_rules(db):
    reimbursed = make_report(
        db,
        report_date=date(2026, 6, 3),
        status="reimbursed",
        amount="100.00",
        category="luggage",
        daily_subsidy="50.00",
        trips=[TripWrite(sort_order=1, depart_month=6, depart_day=3, arrive_month=6, arrive_day=4)],
    )
    add_invoice(db, reimbursed, "accommodation", "300.00")
    add_invoice(db, reimbursed, "city_transport", "999.00", confirmed=False)
    make_report(db, report_date=date(2026, 6, 5), status="printed", amount="200.00", category="luggage")
    make_report(db, report_date=date(2026, 6, 6), status="checked", amount="80.00", category="postal")
    make_report(db, report_date=date(2026, 6, 7), status="draft", amount="900.00", category="city_transport")
    db.commit()

    make_report(db, report_date=date(2026, 7, 5), status="reimbursed", amount="700.00", category="postal")

    category = get_stats_category(db, reference_date=date(2026, 6, 15), start_month="2026-06", end_month="2026-06")

    amounts = {item.category: item.amount for item in category.items}
    assert amounts == {
        "luggage": Decimal("300.00"),
        "accommodation": Decimal("300.00"),
        "subsidy": Decimal("100.00"),
        "postal": Decimal("80.00"),
        "city_transport": Decimal("900.00"),
    }


def test_stats_calendar_uses_unique_occupied_dates_including_drafts(db):
    make_report(
        db,
        report_date=date(2026, 5, 31),
        status="printed",
        trips=[TripWrite(sort_order=1, depart_month=5, depart_day=31, arrive_month=6, arrive_day=2)],
    )
    make_report(
        db,
        report_date=date(2026, 6, 10),
        status="reimbursed",
        trips=[
            TripWrite(sort_order=1, depart_month=6, depart_day=10, arrive_month=6, arrive_day=12),
            TripWrite(sort_order=2, depart_month=6, depart_day=11, arrive_month=6, arrive_day=13),
        ],
    )
    make_report(
        db,
        report_date=date(2026, 6, 20),
        status="checked",
        trips=[TripWrite(sort_order=1, depart_month=6, depart_day=20, arrive_month=6, arrive_day=21)],
    )
    make_report(
        db,
        report_date=date(2026, 6, 22),
        status="draft",
        trips=[TripWrite(sort_order=1, depart_month=6, depart_day=22, arrive_month=6, arrive_day=24)],
    )

    calendar = get_stats_calendar(db, year=2026, month=6, start_month="2026-06", end_month="2026-06")

    assert calendar.year == 2026
    assert calendar.month == 6
    assert calendar.total_days == 11
    assert calendar.year_dates == [
        date(2026, 6, 1),
        date(2026, 6, 2),
        date(2026, 6, 10),
        date(2026, 6, 11),
        date(2026, 6, 12),
        date(2026, 6, 13),
        date(2026, 6, 20),
        date(2026, 6, 21),
        date(2026, 6, 22),
        date(2026, 6, 23),
        date(2026, 6, 24),
    ]
    assert calendar.month_dates == [
        date(2026, 6, 1),
        date(2026, 6, 2),
        date(2026, 6, 10),
        date(2026, 6, 11),
        date(2026, 6, 12),
        date(2026, 6, 13),
        date(2026, 6, 20),
        date(2026, 6, 21),
        date(2026, 6, 22),
        date(2026, 6, 23),
        date(2026, 6, 24),
    ]
    assert [(item.month, item.days) for item in calendar.months] == [("2026-06", 11)]


def test_stats_reads_persisted_occupancies_without_traversing_trips(db):
    report = make_report(
        db,
        report_date=date(2026, 6, 8),
        status="draft",
        employee_name="员工甲",
    )
    db.add(
        ReportDayOccupancy(
            report_id=report.id,
            employee_key="员工甲",
            occupied_on=date(2026, 6, 9),
        )
    )
    db.commit()

    summary = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        start_month="2026-06",
        end_month="2026-06",
    )
    calendar = get_stats_calendar(
        db,
        year=2026,
        month=6,
        start_month="2026-06",
        end_month="2026-06",
    )

    assert summary.selected_period.trip_days == 1
    assert calendar.month_dates == [date(2026, 6, 9)]


def test_stats_counts_same_date_for_different_employees_as_two_person_days_but_one_calendar_day(db):
    make_report(
        db,
        report_date=date(2026, 6, 10),
        status="draft",
        employee_name="员工甲",
        trips=[TripWrite(sort_order=1, depart_date=date(2026, 6, 10), arrive_date=date(2026, 6, 10))],
    )
    make_report(
        db,
        report_date=date(2026, 6, 10),
        status="printed",
        employee_name="员工乙",
        manual_subsidy_total="80.00",
        trips=[TripWrite(sort_order=1, depart_date=date(2026, 6, 10), arrive_date=date(2026, 6, 10))],
    )

    summary = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        start_month="2026-06",
        end_month="2026-06",
    )
    calendar = get_stats_calendar(
        db,
        year=2026,
        month=6,
        start_month="2026-06",
        end_month="2026-06",
    )

    assert summary.selected_period.trip_days == 2
    assert summary.selected_period.total_count == 2
    assert summary.selected_period.total_amount == Decimal("80.00")
    assert summary.selected_period.pending_count == 2
    assert summary.selected_period.pending_amount == Decimal("80.00")
    assert summary.monthly_trend[0].trip_days == 2
    assert calendar.total_days == 1
    assert calendar.month_dates == [date(2026, 6, 10)]


def test_stats_month_range_supports_cross_year_trend_and_trip_days(db):
    make_report(
        db,
        report_date=date(2025, 12, 31),
        status="reimbursed",
        amount="500.00",
        trips=[TripWrite(sort_order=1, depart_month=12, depart_day=31, arrive_month=1, arrive_day=2)],
    )
    make_report(db, report_date=date(2026, 1, 5), status="printed", amount="200.00")

    summary = get_stats_summary(db, reference_date=date(2026, 1, 15), start_month="2025-12", end_month="2026-01")

    assert summary.selected_period.reimbursed_amount == Decimal("500.00")
    assert summary.selected_period.pending_amount == Decimal("200.00")
    assert summary.selected_period.total_amount == Decimal("700.00")
    assert summary.selected_period.trip_days == 3
    assert [item.month for item in summary.monthly_trend] == ["2025-12", "2026-01"]
    assert [item.trip_days for item in summary.monthly_trend] == [1, 2]


def test_stats_calendar_places_january_report_december_trip_in_previous_year(db):
    make_report(
        db,
        report_date=date(2026, 1, 5),
        status="printed",
        trips=[
            TripWrite(sort_order=1, depart_month=12, depart_day=30, arrive_month=12, arrive_day=31),
            TripWrite(sort_order=2, depart_month=1, depart_day=2, arrive_month=1, arrive_day=2),
        ],
    )

    calendar = get_stats_calendar(db, year=2025, month=12, start_month="2025-12", end_month="2026-01")

    assert calendar.total_days == 4
    assert calendar.month_dates == [date(2025, 12, 30), date(2025, 12, 31)]
    assert [(item.month, item.dates) for item in calendar.months] == [
        ("2025-12", [date(2025, 12, 30), date(2025, 12, 31)]),
        ("2026-01", [date(2026, 1, 1), date(2026, 1, 2)]),
    ]


def test_stats_calendar_returns_continuous_month_cards_for_cross_year_range(db):
    make_report(
        db,
        report_date=date(2024, 6, 1),
        status="reimbursed",
        trips=[TripWrite(sort_order=1, depart_month=6, depart_day=1, arrive_month=6, arrive_day=2)],
    )

    calendar = get_stats_calendar(db, year=2024, month=6, start_month="2023-01", end_month="2025-05")

    assert len(calendar.months) == 29
    assert calendar.months[0].month == "2023-01"
    assert calendar.months[-1].month == "2025-05"
    june = next(item for item in calendar.months if item.month == "2024-06")
    assert june.dates == [date(2024, 6, 1), date(2024, 6, 2)]
    assert june.days == 2


def make_regular_report(
    db,
    *,
    report_date: date,
    status: str,
    mode: str,
    amount: str,
):
    report = create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode=mode,
            report_date=report_date,
            employee_name="常规报销人",
            regular_items=[
                RegularItemWrite(
                    sort_order=1,
                    occurred_on=report_date,
                    description=f"{mode}-{report_date}",
                    amount=Decimal(amount) if mode == "no_invoice" else None,
                )
            ],
        ),
    )
    if mode == "invoice":
        item = report.regular_items[0]
        db.add(
            Invoice(
                report_id=report.id,
                regular_item_id=item.id,
                expense_category="regular",
                file_path=f"uploads/{report.id}/regular.pdf",
                file_type="pdf",
                amount=Decimal(amount),
                amount_confirmed=True,
            )
        )
        db.flush()
        recalculate_report_totals(report)
    report.status = status
    db.commit()
    db.refresh(report)
    return report


def test_stats_summary_defaults_to_travel_and_regular_uses_exact_date_and_mode_filters(db):
    make_report(db, report_date=date(2026, 6, 10), status="checked", amount="50.00")
    make_regular_report(
        db,
        report_date=date(2026, 6, 10),
        status="checked",
        mode="no_invoice",
        amount="120.00",
    )
    make_regular_report(
        db,
        report_date=date(2026, 6, 11),
        status="printed",
        mode="invoice",
        amount="80.00",
    )
    make_regular_report(
        db,
        report_date=date(2026, 6, 12),
        status="reimbursed",
        mode="no_invoice",
        amount="300.00",
    )
    make_regular_report(
        db,
        report_date=date(2026, 6, 11),
        status="draft",
        mode="invoice",
        amount="999.00",
    )

    travel = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        report_start=date(2026, 6, 10),
        report_end=date(2026, 6, 12),
    )
    regular = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        report_type="regular",
        report_start=date(2026, 6, 10),
        report_end=date(2026, 6, 11),
    )
    invoice_only = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        report_type="regular",
        regular_mode="invoice",
        report_start=date(2026, 6, 10),
        report_end=date(2026, 6, 12),
    )

    assert travel.selected_period.total_amount == Decimal("50.00")
    assert travel.selected_period.total_count == 1
    assert regular.selected_period.total_amount == Decimal("1199.00")
    assert regular.selected_period.pending_amount == Decimal("1199.00")
    assert regular.selected_period.total_count == 3
    assert regular.selected_period.trip_days == 0
    assert regular.monthly_trend[0].total_amount == Decimal("1199.00")
    assert invoice_only.selected_period.total_amount == Decimal("1079.00")
    assert invoice_only.selected_period.total_count == 2


def test_stats_summary_rejects_regular_mode_for_travel(db):
    with pytest.raises(HTTPException) as exc:
        get_stats_summary(db, report_type="travel", regular_mode="invoice")

    assert exc.value.status_code == 400
    assert "仅适用于常规报销单" in exc.value.detail


def test_regular_stats_one_sided_date_filters_match_open_list_semantics(db):
    make_regular_report(
        db,
        report_date=date(2025, 12, 31),
        status="reimbursed",
        mode="no_invoice",
        amount="40.00",
    )
    make_regular_report(
        db,
        report_date=date(2027, 1, 2),
        status="checked",
        mode="no_invoice",
        amount="60.00",
    )

    through_2025 = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        report_type="regular",
        report_end=date(2025, 12, 31),
    )
    from_2027 = get_stats_summary(
        db,
        reference_date=date(2026, 6, 15),
        report_type="regular",
        report_start=date(2027, 1, 1),
    )

    assert through_2025.selected_period.total_amount == Decimal("40.00")
    assert through_2025.selected_period.total_count == 1
    assert from_2027.selected_period.total_amount == Decimal("60.00")
    assert from_2027.selected_period.total_count == 1
    assert [item.month for item in from_2027.monthly_trend] == [
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]
