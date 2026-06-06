from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.trip import Trip
from backend.schemas.stats import (
    MonthlyTrendItem,
    StatsCalendarRead,
    StatsCategoryItem,
    StatsCategoryRead,
    StatsPeriodSummary,
    StatsSummaryRead,
)
from backend.services.report_service import (
    FIXED_CATEGORY_LABELS,
    SubsidyTrip,
    build_subsidy_intervals,
    build_trip_date,
    custom_category_name,
    derive_default_subsidy_markers,
    is_custom_category,
    quantize_amount,
    validate_trip_chronology,
)

PENDING_STATUS = "printed"
REIMBURSED_STATUS = "reimbursed"
STATS_STATUSES = {PENDING_STATUS, REIMBURSED_STATUS}
SUBSIDY_CATEGORY = "subsidy"
SUBSIDY_LABEL = "途中补贴"


def get_stats_summary(db: Session, reference_date: date | None = None) -> StatsSummaryRead:
    today = reference_date or date.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    next_month = add_months(month_start, 1)
    next_year = date(today.year + 1, 1, 1)
    reports = list_stats_reports(db)

    return StatsSummaryRead(
        current_month=summarize_period(reports, month_start, next_month),
        current_year=summarize_period(reports, year_start, next_year),
        monthly_trend=build_monthly_trend(reports, today),
    )


def get_stats_category(db: Session) -> StatsCategoryRead:
    amounts: dict[str, Decimal] = {}
    reimbursed_reports = [
        report
        for report in list_stats_reports(db)
        if report.status == REIMBURSED_STATUS
    ]
    report_ids = {report.id for report in reimbursed_reports}
    if report_ids:
        invoices = db.scalars(
            select(Invoice).where(
                Invoice.report_id.in_(report_ids),
                Invoice.deleted_at.is_(None),
                Invoice.amount_confirmed.is_(True),
            )
        ).all()
        for invoice in invoices:
            amounts[invoice.expense_category] = quantize_amount(
                amounts.get(invoice.expense_category, Decimal("0.00")) + invoice.amount
            )

    subsidy_total = sum((report.subsidy_total for report in reimbursed_reports), Decimal("0.00"))
    if subsidy_total:
        amounts[SUBSIDY_CATEGORY] = quantize_amount(subsidy_total)

    items = [
        StatsCategoryItem(category=category, label=category_label(category), amount=amount)
        for category, amount in amounts.items()
        if amount != Decimal("0.00")
    ]
    items.sort(key=lambda item: category_sort_key(item.category))
    return StatsCategoryRead(items=items)


def get_stats_calendar(db: Session, year: int, month: int | None = None) -> StatsCalendarRead:
    selected_month = month or date.today().month
    reports = list_stats_reports(db)
    dates: set[date] = set()
    for report in reports:
        if report.status not in STATS_STATUSES:
            continue
        dates.update(report_trip_dates_for_year(report, year))

    year_dates = sorted(dates)
    month_dates = [item for item in year_dates if item.month == selected_month]
    return StatsCalendarRead(
        year=year,
        month=selected_month,
        total_days=len(year_dates),
        year_dates=year_dates,
        month_dates=month_dates,
    )


def list_stats_reports(db: Session) -> list[ExpenseReport]:
    return list(
        db.scalars(
            select(ExpenseReport).where(
                ExpenseReport.deleted_at.is_(None),
                ExpenseReport.status.in_(STATS_STATUSES | {"draft"}),
            )
        ).all()
    )


def summarize_period(reports: list[ExpenseReport], start: date, end: date) -> StatsPeriodSummary:
    summary = StatsPeriodSummary()
    for report in reports:
        if report.deleted_at is not None or report.report_date is None:
            continue
        if not (start <= report.report_date < end):
            continue
        if report.status == PENDING_STATUS:
            summary.pending_amount = quantize_amount(summary.pending_amount + report.total_amount)
            summary.pending_count += 1
        elif report.status == REIMBURSED_STATUS:
            summary.reimbursed_amount = quantize_amount(summary.reimbursed_amount + report.total_amount)
            summary.reimbursed_count += 1
        else:
            continue
        summary.trip_days += count_report_trip_days_in_period(report, start, end)
    return summary


def build_monthly_trend(reports: list[ExpenseReport], reference_date: date) -> list[MonthlyTrendItem]:
    first_month = add_months(reference_date.replace(day=1), -5)
    items: list[MonthlyTrendItem] = []
    for index in range(6):
        month_start = add_months(first_month, index)
        month_end = add_months(month_start, 1)
        amount = Decimal("0.00")
        trip_days = 0
        for report in reports:
            if report.status != REIMBURSED_STATUS or report.report_date is None:
                continue
            if not (month_start <= report.report_date < month_end):
                continue
            amount += report.total_amount
            trip_days += count_report_trip_days_in_period(report, month_start, month_end)
        items.append(
            MonthlyTrendItem(
                month=month_start.strftime("%Y-%m"),
                reimbursed_amount=quantize_amount(amount),
                trip_days=trip_days,
            )
        )
    return items


def count_report_trip_days_in_period(report: ExpenseReport, start: date, end: date) -> int:
    days: set[date] = set()
    for interval_start, interval_end in report_trip_intervals(report):
        current = max(interval_start, start)
        last = min(interval_end, end - timedelta(days=1))
        while current <= last:
            days.add(current)
            current += timedelta(days=1)
    return len(days)


def report_trip_dates_for_year(report: ExpenseReport, year: int) -> set[date]:
    start = date(year, 1, 1)
    end = date(year + 1, 1, 1)
    dates: set[date] = set()
    for interval_start, interval_end in report_trip_intervals(report):
        current = max(interval_start, start)
        last = min(interval_end, end - timedelta(days=1))
        while current <= last:
            dates.add(current)
            current += timedelta(days=1)
    return dates


def report_trip_intervals(report: ExpenseReport) -> list[tuple[date, date]]:
    if report.report_date is None or not report.trips:
        return []

    report_year = report.report_date.year
    sorted_trips = sorted(report.trips, key=lambda trip: trip.sort_order)
    has_manual_markers = any(trip.subsidy_start or trip.subsidy_end for trip in sorted_trips)
    default_markers = derive_default_subsidy_markers(sorted_trips) if not has_manual_markers else {}
    subsidy_trips: list[SubsidyTrip] = []

    for trip in sorted_trips:
        depart, arrive = trip_dates(report_year, trip)
        validate_trip_chronology(trip, depart, arrive)
        default_start, default_end = default_markers.get(id(trip), (False, False))
        subsidy_trips.append(
            SubsidyTrip(
                trip=trip,
                depart=depart,
                arrive=arrive,
                subsidy_start=trip.subsidy_start if has_manual_markers else default_start,
                subsidy_end=trip.subsidy_end if has_manual_markers else default_end,
            )
        )
    return build_subsidy_intervals(subsidy_trips)


def trip_dates(report_year: int, trip: Trip) -> tuple[date, date]:
    depart = build_trip_date(report_year, trip.depart_month, trip.depart_day)
    arrive_year = report_year + 1 if (trip.arrive_month, trip.arrive_day) < (trip.depart_month, trip.depart_day) else report_year
    arrive = build_trip_date(arrive_year, trip.arrive_month, trip.arrive_day)
    return depart, arrive


def add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def category_label(category: str) -> str:
    if category == SUBSIDY_CATEGORY:
        return SUBSIDY_LABEL
    if is_custom_category(category):
        return custom_category_name(category)
    return FIXED_CATEGORY_LABELS.get(category, category)


def category_sort_key(category: str) -> tuple[int, str]:
    if category == SUBSIDY_CATEGORY:
        return (1, category)
    fixed_order = list(FIXED_CATEGORY_LABELS)
    if category in fixed_order:
        return (0, f"{fixed_order.index(category):02d}")
    return (2, category)
