from datetime import date
from decimal import Decimal

from backend.models.invoice import Invoice
from backend.schemas.report import ReportCreate, TripWrite
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
    amount: str = "0.00",
    category: str = "luggage",
    daily_subsidy: str = "0.00",
    trips: list[TripWrite] | None = None,
):
    report = create_report(
        db,
        ReportCreate(
            report_date=report_date,
            purpose=f"{status}-{report_date}",
            daily_subsidy=Decimal(daily_subsidy),
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


def test_stats_summary_excludes_drafts_and_splits_pending_reimbursed_amounts(db):
    make_report(db, report_date=date(2026, 6, 1), status="draft", amount="999.00")
    make_report(db, report_date=date(2026, 6, 2), status="printed", amount="120.00")
    make_report(db, report_date=date(2026, 6, 3), status="reimbursed", amount="300.00")
    make_report(db, report_date=date(2026, 1, 5), status="printed", amount="80.00")
    make_report(db, report_date=date(2026, 2, 6), status="reimbursed", amount="50.00")

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-01", end_month="2026-06")

    assert summary.selected_period.pending_amount == Decimal("200.00")
    assert summary.selected_period.pending_count == 2
    assert summary.selected_period.reimbursed_amount == Decimal("350.00")
    assert summary.selected_period.reimbursed_count == 2
    assert summary.selected_period.total_amount == Decimal("550.00")
    assert summary.selected_period.total_count == 4
    assert summary.current_month.pending_amount == Decimal("120.00")
    assert summary.current_month.pending_count == 1
    assert summary.current_month.reimbursed_amount == Decimal("300.00")
    assert summary.current_month.reimbursed_count == 1
    assert summary.current_year.pending_amount == Decimal("200.00")
    assert summary.current_year.pending_count == 2
    assert summary.current_year.reimbursed_amount == Decimal("350.00")
    assert summary.current_year.reimbursed_count == 2


def test_stats_summary_counts_trip_days_for_pending_and_reimbursed_cards(db):
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
        status="draft",
        trips=[
                TripWrite(sort_order=1, depart_month=6, depart_day=10, arrive_month=6, arrive_day=15),
        ],
    )

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-06", end_month="2026-06")

    assert summary.selected_period.trip_days == 5


def test_stats_trend_uses_reimbursed_amounts_and_trip_days_only(db):
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

    summary = get_stats_summary(db, reference_date=date(2026, 6, 15), start_month="2026-05", end_month="2026-06")

    assert [item.month for item in summary.monthly_trend] == ["2026-05", "2026-06"]
    may = next(item for item in summary.monthly_trend if item.month == "2026-05")
    assert may.pending_amount == Decimal("999.00")
    assert may.reimbursed_amount == Decimal("180.00")
    assert may.total_amount == Decimal("1179.00")
    assert may.trip_days == 8


def test_stats_category_includes_subsidy_and_confirmed_reimbursed_invoices_only(db):
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
    db.commit()

    make_report(db, report_date=date(2026, 7, 5), status="reimbursed", amount="700.00", category="postal")

    category = get_stats_category(db, reference_date=date(2026, 6, 15), start_month="2026-06", end_month="2026-06")

    amounts = {item.category: item.amount for item in category.items}
    assert amounts == {
        "luggage": Decimal("100.00"),
        "accommodation": Decimal("300.00"),
        "subsidy": Decimal("100.00"),
    }


def test_stats_calendar_uses_pending_and_reimbursed_trip_days_with_month_detail(db):
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
        status="draft",
        trips=[TripWrite(sort_order=1, depart_month=6, depart_day=20, arrive_month=6, arrive_day=22)],
    )

    calendar = get_stats_calendar(db, year=2026, month=6, start_month="2026-06", end_month="2026-06")

    assert calendar.year == 2026
    assert calendar.month == 6
    assert calendar.total_days == 6
    assert calendar.year_dates == [
        date(2026, 6, 1),
        date(2026, 6, 2),
        date(2026, 6, 10),
        date(2026, 6, 11),
        date(2026, 6, 12),
        date(2026, 6, 13),
    ]
    assert calendar.month_dates == [
        date(2026, 6, 1),
        date(2026, 6, 2),
        date(2026, 6, 10),
        date(2026, 6, 11),
        date(2026, 6, 12),
        date(2026, 6, 13),
    ]
    assert [(item.month, item.days) for item in calendar.months] == [("2026-06", 6)]


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
