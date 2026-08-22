from datetime import date, timedelta
from decimal import Decimal
import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.report import ExpenseReport
from backend.models.report_day_occupancy import ReportDayOccupancy
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
    custom_category_name,
    is_custom_category,
    quantize_amount,
)

DRAFT_STATUS = "draft"
CHECKED_STATUS = "checked"
SUBMITTED_STATUS = "printed"
PENDING_STATUSES = {DRAFT_STATUS, CHECKED_STATUS, SUBMITTED_STATUS}
REIMBURSED_STATUS = "reimbursed"
SUBSIDY_CATEGORY = "subsidy"
SUBSIDY_LABEL = "途中补贴"
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def get_stats_summary(
    db: Session,
    reference_date: date | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
    report_type: str = "travel",
    regular_mode: str | None = None,
    report_start: date | None = None,
    report_end: date | None = None,
) -> StatsSummaryRead:
    today = reference_date or date.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    next_month = add_months(month_start, 1)
    next_year = date(today.year + 1, 1, 1)
    month_period_start, month_period_end = parse_month_range(start_month, end_month, today)
    period_start, period_end = parse_summary_period(
        start_month,
        end_month,
        report_start,
        report_end,
        today,
    )
    reports = list_stats_reports(db, report_type=report_type, regular_mode=regular_mode)
    occupancy_dates = (
        list_active_travel_occupancy_dates(db)
        if report_type in {None, "travel"}
        else []
    )

    return StatsSummaryRead(
        selected_period=summarize_period(reports, occupancy_dates, period_start, period_end),
        current_month=summarize_period(reports, occupancy_dates, month_start, next_month),
        current_year=summarize_period(reports, occupancy_dates, year_start, next_year),
        monthly_trend=build_monthly_trend(
            reports,
            occupancy_dates,
            period_start if report_start is not None and report_end is not None else month_period_start,
            period_end if report_start is not None and report_end is not None else month_period_end,
        ),
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
    reports = [
        report
        for report in list_stats_reports(db)
        if report.report_date is not None
        and period_start <= report.report_date < period_end
    ]
    for report in reports:
        for trip in report.trips:
            if trip.amount:
                amounts["transport_fare"] = quantize_amount(amounts.get("transport_fare", Decimal("0.00")) + trip.amount)
        for item in report.expense_items:
            if item.category == "transport_fare" or not item.amount:
                continue
            amounts[item.category] = quantize_amount(amounts.get(item.category, Decimal("0.00")) + item.amount)

    subsidy_total = sum((report.subsidy_total for report in reports), Decimal("0.00"))
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
    dates = set(list_active_travel_occupancy_dates(db, period_start, period_end))

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


def list_active_travel_occupancy_dates(
    db: Session,
    start: date | None = None,
    end: date | None = None,
) -> list[date]:
    conditions = [
        ExpenseReport.deleted_at.is_(None),
        ExpenseReport.report_type == "travel",
    ]
    if start is not None:
        conditions.append(ReportDayOccupancy.occupied_on >= start)
    if end is not None:
        conditions.append(ReportDayOccupancy.occupied_on < end)
    return list(
        db.scalars(
            select(ReportDayOccupancy.occupied_on)
            .join(ExpenseReport, ReportDayOccupancy.report_id == ExpenseReport.id)
            .where(*conditions)
        ).all()
    )


def list_stats_reports(
    db: Session,
    report_type: str | None = "travel",
    regular_mode: str | None = None,
) -> list[ExpenseReport]:
    if report_type not in {None, "travel", "regular"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效报销单类型")
    if regular_mode not in {None, "no_invoice", "invoice"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效常规报销模式")
    if regular_mode is not None and report_type != "regular":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销模式筛选仅适用于常规报销单")
    conditions = [
        ExpenseReport.deleted_at.is_(None),
    ]
    if report_type is not None:
        conditions.append(ExpenseReport.report_type == report_type)
    if regular_mode is not None:
        conditions.append(ExpenseReport.regular_mode == regular_mode)
    return list(
        db.scalars(
            select(ExpenseReport).where(*conditions)
        ).all()
    )


def summarize_period(
    reports: list[ExpenseReport],
    occupancy_dates: list[date],
    start: date,
    end: date,
) -> StatsPeriodSummary:
    summary = StatsPeriodSummary(
        trip_days=sum(1 for occupied_on in occupancy_dates if start <= occupied_on < end)
    )
    for report in reports:
        if report.deleted_at is not None or report.report_date is None:
            continue
        if not start <= report.report_date < end:
            continue
        summary.total_amount = quantize_amount(summary.total_amount + report.total_amount)
        summary.total_count += 1
        if report.status in PENDING_STATUSES:
            summary.pending_amount = quantize_amount(summary.pending_amount + report.total_amount)
            summary.pending_count += 1
        elif report.status == REIMBURSED_STATUS:
            summary.reimbursed_amount = quantize_amount(summary.reimbursed_amount + report.total_amount)
            summary.reimbursed_count += 1
    return summary


def build_monthly_trend(
    reports: list[ExpenseReport],
    occupancy_dates: list[date],
    start: date,
    end: date,
) -> list[MonthlyTrendItem]:
    items: list[MonthlyTrendItem] = []
    month_start = start
    while month_start < end:
        month_end = min(add_months(month_start, 1), end)
        pending_amount = Decimal("0.00")
        reimbursed_amount = Decimal("0.00")
        pending_count = 0
        reimbursed_count = 0
        total_amount = Decimal("0.00")
        total_count = 0
        trip_days = sum(1 for occupied_on in occupancy_dates if month_start <= occupied_on < month_end)
        for report in reports:
            if report.report_date is None:
                continue
            if month_start <= report.report_date < month_end:
                total_amount += report.total_amount
                total_count += 1
                if report.status in PENDING_STATUSES:
                    pending_amount += report.total_amount
                    pending_count += 1
                elif report.status == REIMBURSED_STATUS:
                    reimbursed_amount += report.total_amount
                    reimbursed_count += 1
        items.append(
            MonthlyTrendItem(
                month=month_start.strftime("%Y-%m"),
                pending_amount=quantize_amount(pending_amount),
                reimbursed_amount=quantize_amount(reimbursed_amount),
                total_amount=quantize_amount(total_amount),
                pending_count=pending_count,
                reimbursed_count=reimbursed_count,
                total_count=total_count,
                trip_days=trip_days,
            )
        )
        month_start = month_end
    return items


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


def parse_summary_period(
    start_month: str | None,
    end_month: str | None,
    report_start: date | None,
    report_end: date | None,
    reference_date: date,
) -> tuple[date, date]:
    month_start, month_end = parse_month_range(start_month, end_month, reference_date)
    if report_start is None and report_end is None:
        return month_start, month_end
    start = report_start or date.min
    if report_end == date.max:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束日期超出支持范围")
    end = report_end + timedelta(days=1) if report_end is not None else date.max
    if start >= end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="开始日期不能晚于结束日期")
    return start, end


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
