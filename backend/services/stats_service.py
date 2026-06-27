from datetime import date, timedelta
from decimal import Decimal
import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.report import ExpenseReport
from backend.schemas.stats import (
    MonthlyTrendItem,
    StatsCalendarMonth,
    StatsCalendarRead,
    StatsCategoryItem,
    StatsCategoryRead,
    StatsPeriodSummary,
    StatsSummaryRead,
)
from backend.services.report_service import (
    FIXED_CATEGORY_LABELS,
    build_subsidy_intervals,
    custom_category_name,
    infer_trip_date_ranges,
    is_custom_category,
    quantize_amount,
    subsidy_trips_with_implicit_bounds,
)

PENDING_STATUS = "printed"
REIMBURSED_STATUS = "reimbursed"
STATS_STATUSES = {PENDING_STATUS, REIMBURSED_STATUS}
SUBSIDY_CATEGORY = "subsidy"
SUBSIDY_LABEL = "途中补贴"
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def get_stats_summary(
    db: Session,
    reference_date: date | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
) -> StatsSummaryRead:
    today = reference_date or date.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    next_month = add_months(month_start, 1)
    next_year = date(today.year + 1, 1, 1)
    period_start, period_end = parse_month_range(start_month, end_month, today)
    reports = list_stats_reports(db)

    return StatsSummaryRead(
        selected_period=summarize_period(reports, period_start, period_end),
        current_month=summarize_period(reports, month_start, next_month),
        current_year=summarize_period(reports, year_start, next_year),
        monthly_trend=build_monthly_trend(reports, period_start, period_end),
    )


def get_stats_category(
    db: Session,
    reference_date: date | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
) -> StatsCategoryRead:
    today = reference_date or date.today()
    period_start, period_end = parse_month_range(start_month, end_month, today)
    amounts: dict[str, Decimal] = {}
    reimbursed_reports = [
        report
        for report in list_stats_reports(db)
        if report.status == REIMBURSED_STATUS
        and report.report_date is not None
        and period_start <= report.report_date < period_end
    ]
    for report in reimbursed_reports:
        for trip in report.trips:
            if trip.amount:
                amounts["transport_fare"] = quantize_amount(amounts.get("transport_fare", Decimal("0.00")) + trip.amount)
        for item in report.expense_items:
            if item.category == "transport_fare" or not item.amount:
                continue
            amounts[item.category] = quantize_amount(amounts.get(item.category, Decimal("0.00")) + item.amount)

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


def get_stats_calendar(
    db: Session,
    year: int,
    month: int | None = None,
    reference_date: date | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
) -> StatsCalendarRead:
    today = reference_date or date.today()
    period_start, period_end = parse_month_range(start_month, end_month, today)
    selected_month = month or date.today().month
    reports = list_stats_reports(db)
    dates: set[date] = set()
    for report in reports:
        if report.status not in STATS_STATUSES:
            continue
        dates.update(report_trip_dates_for_period(report, period_start, period_end))

    months = build_calendar_months(period_start, period_end, dates)
    year_dates = [item for item in sorted(dates) if item.year == year]
    month_dates = [item for item in year_dates if item.month == selected_month]
    return StatsCalendarRead(
        year=year,
        month=selected_month,
        total_days=len(dates),
        year_dates=year_dates,
        month_dates=month_dates,
        months=months,
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
        if report.status == PENDING_STATUS:
            if start <= report.report_date < end:
                summary.pending_amount = quantize_amount(summary.pending_amount + report.total_amount)
                summary.pending_count += 1
        elif report.status == REIMBURSED_STATUS:
            if start <= report.report_date < end:
                summary.reimbursed_amount = quantize_amount(summary.reimbursed_amount + report.total_amount)
                summary.reimbursed_count += 1
        else:
            continue
        summary.trip_days += count_report_trip_days_in_period(report, start, end)
    summary.total_amount = quantize_amount(summary.pending_amount + summary.reimbursed_amount)
    summary.total_count = summary.pending_count + summary.reimbursed_count
    return summary


def build_monthly_trend(reports: list[ExpenseReport], start: date, end: date) -> list[MonthlyTrendItem]:
    items: list[MonthlyTrendItem] = []
    month_start = start
    while month_start < end:
        month_end = add_months(month_start, 1)
        pending_amount = Decimal("0.00")
        reimbursed_amount = Decimal("0.00")
        pending_count = 0
        reimbursed_count = 0
        trip_days = 0
        for report in reports:
            if report.status not in STATS_STATUSES or report.report_date is None:
                continue
            if month_start <= report.report_date < month_end:
                if report.status == PENDING_STATUS:
                    pending_amount += report.total_amount
                    pending_count += 1
                elif report.status == REIMBURSED_STATUS:
                    reimbursed_amount += report.total_amount
                    reimbursed_count += 1
            trip_days += count_report_trip_days_in_period(report, month_start, month_end)
        total_amount = quantize_amount(pending_amount + reimbursed_amount)
        items.append(
            MonthlyTrendItem(
                month=month_start.strftime("%Y-%m"),
                pending_amount=quantize_amount(pending_amount),
                reimbursed_amount=quantize_amount(reimbursed_amount),
                total_amount=total_amount,
                pending_count=pending_count,
                reimbursed_count=reimbursed_count,
                total_count=pending_count + reimbursed_count,
                trip_days=trip_days,
            )
        )
        month_start = month_end
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
    return report_trip_dates_for_period(report, start, end)


def report_trip_dates_for_period(report: ExpenseReport, start: date, end: date) -> set[date]:
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

    sorted_trips = sorted(report.trips, key=lambda trip: trip.sort_order)
    trip_ranges = infer_trip_date_ranges(report.report_date, sorted_trips)
    return build_subsidy_intervals(subsidy_trips_with_implicit_bounds(trip_ranges))


def add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def parse_month_range(start_month: str | None, end_month: str | None, reference_date: date) -> tuple[date, date]:
    default_start = date(reference_date.year, 1, 1)
    default_end_month = reference_date.replace(day=1)
    start = parse_month_value(start_month, default_start)
    end_month_date = parse_month_value(end_month, default_end_month)
    if start > end_month_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="开始月份不能晚于结束月份")
    return start, add_months(end_month_date, 1)


def parse_month_value(value: str | None, default: date) -> date:
    if value is None or not value.strip():
        return default
    normalized = value.strip()
    if not MONTH_PATTERN.match(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="月份格式应为 YYYY-MM")
    year, month = normalized.split("-")
    return date(int(year), int(month), 1)


def build_calendar_months(start: date, end: date, dates: set[date]) -> list[StatsCalendarMonth]:
    items: list[StatsCalendarMonth] = []
    current = start
    while current < end:
        next_month = add_months(current, 1)
        month_dates = sorted(item for item in dates if current <= item < next_month)
        items.append(
            StatsCalendarMonth(
                month=current.strftime("%Y-%m"),
                dates=month_dates,
                days=len(month_dates),
            )
        )
        current = next_month
    return items


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
