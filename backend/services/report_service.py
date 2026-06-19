from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
import re

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from backend.models.expense_item import ExpenseItem
from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.trip import Trip
from backend.schemas.report import (
    ExpenseItemWrite,
    ReportCreate,
    ReportInvoiceState,
    ReportStatus,
    ReportUpdate,
    TripWrite,
)
from backend.services.settings_service import get_or_create_settings

ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"printed"},
    "printed": {"draft", "reimbursed"},
    "reimbursed": set(),
}

FUEL_SUBSIDY_CATEGORY = "fuel_subsidy"
EXPENSE_CATEGORIES = [
    "transport_fare",
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    FUEL_SUBSIDY_CATEGORY,
]
FIXED_OTHER_EXPENSE_CATEGORIES = [
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    FUEL_SUBSIDY_CATEGORY,
]
FIXED_CATEGORY_LABELS = {
    "transport_fare": "车船费",
    "luggage": "行李费",
    "city_transport": "市内交通费",
    "accommodation": "住宿费",
    "postal": "邮电费",
    "no_sleeper_subsidy": "未乘卧铺补助",
    "toll": "过路费",
    FUEL_SUBSIDY_CATEGORY: "燃油补助",
}
FIXED_CATEGORY_LABEL_ALIASES = {
    "市内车费",
    "不买卧铺补贴",
    "油补",
}
CUSTOM_CATEGORY_PREFIX = "custom:"
CUSTOM_CATEGORY_FORBIDDEN_PATTERN = re.compile(r'[\/\\:\*\?"<>\|\x00-\x1f]')
MAX_TRIP_TRAVEL_DAYS = 7
from backend.runtime_paths import PROJECT_ROOT, UPLOAD_ROOT, uploaded_path


def _invoice_file_path(relative_path: str | Path) -> Path:
    return uploaded_path(relative_path, UPLOAD_ROOT)


class TripDateError(ValueError):
    pass


@dataclass(frozen=True)
class TripDateRange:
    trip: Trip
    depart: date
    arrive: date


@dataclass(frozen=True)
class SubsidyTrip:
    trip: Trip
    depart: date
    arrive: date
    subsidy_start: bool
    subsidy_end: bool


@dataclass(frozen=True)
class ReportFilters:
    report_status: ReportStatus | None = None
    report_statuses: set[ReportStatus] | None = None
    report_start: date | None = None
    report_end: date | None = None
    trip_start: date | None = None
    trip_end: date | None = None
    keyword: str | None = None
    amount_min: Decimal | None = None
    amount_max: Decimal | None = None
    invoice_state: ReportInvoiceState = "all"
    category: str | None = None
    has_attachment: bool | None = None
    subsidy_days_min: int | None = None
    subsidy_days_max: int | None = None


def validate_status_transition(current_status: str, target_status: str) -> None:
    if current_status == target_status:
        return
    if target_status not in ALLOWED_STATUS_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不允许从 {current_status} 流转到 {target_status}",
        )


def ensure_report_writable(report: ExpenseReport) -> None:
    if report.status == "reimbursed":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="已报销状态不可修改")


def ensure_report_deletable(report: ExpenseReport) -> None:
    if report.status != "draft":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有草稿状态的报销单可以删除")


def quantize_amount(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def confirmed_transport_invoice_total(report: ExpenseReport) -> Decimal:
    return quantize_amount(
        sum(
            (
                invoice.amount
                for invoice in report.invoices
                if invoice.deleted_at is None
                and invoice.amount_confirmed
                and invoice.trip_id is not None
                and invoice.expense_category == "transport_fare"
            ),
            Decimal("0.00"),
        )
    )


def confirmed_invoice_total_for_category(report: ExpenseReport, category: str) -> Decimal:
    return quantize_amount(
        sum(
            (
                invoice.amount
                for invoice in report.invoices
                if invoice.deleted_at is None
                and invoice.amount_confirmed
                and invoice.trip_id is None
                and invoice.expense_category == category
            ),
            Decimal("0.00"),
        )
    )


def clamp_fuel_subsidy_reimbursable_amount(report: ExpenseReport) -> None:
    for item in report.expense_items:
        if item.category != FUEL_SUBSIDY_CATEGORY or item.reimbursable_amount is None:
            continue
        invoice_total = confirmed_invoice_total_for_category(report, FUEL_SUBSIDY_CATEGORY)
        if item.reimbursable_amount > invoice_total:
            item.reimbursable_amount = invoice_total


def validate_fuel_subsidy_reimbursable_amount(report: ExpenseReport) -> None:
    for item in report.expense_items:
        if item.category != FUEL_SUBSIDY_CATEGORY or item.reimbursable_amount is None:
            continue
        invoice_total = confirmed_invoice_total_for_category(report, FUEL_SUBSIDY_CATEGORY)
        if item.reimbursable_amount > invoice_total:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="燃油补助报销金额不能大于已确认发票合计")


def build_trip_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError as exc:
        raise TripDateError(f"无效行程日期：{month}月{day}日") from exc


def trip_date_anchor(report_reference: date | int) -> date:
    if isinstance(report_reference, date):
        return report_reference
    return date(report_reference, 12, 31)


def infer_trip_date_ranges(report_reference: date | int, trips: list[Trip]) -> list[TripDateRange]:
    if not trips:
        return []

    sorted_trips = sorted(trips, key=lambda trip: trip.sort_order)
    anchor = trip_date_anchor(report_reference)
    current_year = anchor.year
    previous_depart_month_day: tuple[int, int] | None = None
    ranges: list[TripDateRange] = []

    for index, trip in enumerate(sorted_trips):
        depart_month_day = (trip.depart_month, trip.depart_day)
        if index == 0:
            depart = build_trip_date(current_year, trip.depart_month, trip.depart_day)
            if (depart - anchor).days > 180:
                current_year -= 1
                depart = build_trip_date(current_year, trip.depart_month, trip.depart_day)
        else:
            if previous_depart_month_day is not None and depart_month_day < previous_depart_month_day:
                current_year += 1
            depart = build_trip_date(current_year, trip.depart_month, trip.depart_day)

        arrive_year = current_year + 1 if (trip.arrive_month, trip.arrive_day) < depart_month_day else current_year
        arrive = build_trip_date(arrive_year, trip.arrive_month, trip.arrive_day)
        validate_trip_chronology(trip, depart, arrive, arrive_year > current_year)
        ranges.append(TripDateRange(trip=trip, depart=depart, arrive=arrive))
        previous_depart_month_day = depart_month_day

    return ranges


def calculate_subsidy_days(report_reference: date | int, trips: list[Trip]) -> int:
    if not trips:
        return 0

    sorted_trips = sorted(trips, key=lambda trip: trip.sort_order)
    has_manual_markers = any(trip.subsidy_start or trip.subsidy_end for trip in sorted_trips)
    default_markers = derive_default_subsidy_markers(sorted_trips) if not has_manual_markers else {}
    subsidy_trips: list[SubsidyTrip] = []
    for trip_range in infer_trip_date_ranges(report_reference, sorted_trips):
        default_start, default_end = default_markers.get(id(trip_range.trip), (False, False))
        subsidy_trips.append(
            SubsidyTrip(
                trip=trip_range.trip,
                depart=trip_range.depart,
                arrive=trip_range.arrive,
                subsidy_start=trip_range.trip.subsidy_start if has_manual_markers else default_start,
                subsidy_end=trip_range.trip.subsidy_end if has_manual_markers else default_end,
            )
        )

    intervals = build_subsidy_intervals(subsidy_trips)
    return count_merged_interval_days(intervals)


def derive_default_subsidy_markers(trips: list[Trip]) -> dict[int, tuple[bool, bool]]:
    if not trips:
        return {}

    home_place = (trips[0].depart_place or "").strip()
    markers = {id(trip): [False, False] for trip in trips}
    open_interval = False

    for index, trip in enumerate(trips):
        depart_place = (trip.depart_place or "").strip()
        arrive_place = (trip.arrive_place or "").strip()
        should_start = index == 0 or (not open_interval and home_place and depart_place == home_place)
        if should_start:
            markers[id(trip)][0] = True
            open_interval = True
        if open_interval and home_place and arrive_place == home_place:
            markers[id(trip)][1] = True
            open_interval = False

    if open_interval:
        markers[id(trips[-1])][1] = True

    return {key: (value[0], value[1]) for key, value in markers.items()}


def build_subsidy_intervals(trips: list[SubsidyTrip]) -> list[tuple[date, date]]:
    intervals: list[tuple[date, date]] = []
    active_start: date | None = None

    for trip in trips:
        if trip.subsidy_start:
            if active_start is not None:
                raise TripDateError("存在连续的出差起点标记，请先设置上一段出差的止点")
            active_start = trip.depart
        if trip.subsidy_end:
            if active_start is None:
                raise TripDateError("存在未匹配起点的出差止点标记")
            if trip.arrive < active_start:
                raise TripDateError("出差止点日期不能早于起点日期")
            intervals.append((active_start, trip.arrive))
            active_start = None

    if active_start is not None:
        raise TripDateError("存在未闭合的出差起点标记，请设置止点")
    return intervals


def count_merged_interval_days(intervals: list[tuple[date, date]]) -> int:
    if not intervals:
        return 0

    merged: list[tuple[date, date]] = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1] + timedelta(days=1):
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))

    return sum((end - start).days + 1 for start, end in merged)


def validate_trip_chronology(trip: Trip, depart: date, arrive: date, is_cross_year_arrival: bool) -> None:
    travel_days = (arrive - depart).days
    if travel_days < 0:
        raise TripDateError("行程到达日期不能早于出发日期")
    if is_cross_year_arrival and travel_days > MAX_TRIP_TRAVEL_DAYS:
        raise TripDateError("跨年到达的单段行程不能超过 7 天")
    if arrive == depart and trip.depart_hour is not None and trip.arrive_hour is not None and trip.arrive_hour < trip.depart_hour:
        raise TripDateError("同日行程到达时间不能早于出发时间")


def recalculate_report_totals(report: ExpenseReport) -> None:
    report.daily_subsidy = quantize_amount(report.daily_subsidy or Decimal("0.00"))
    report.advance_amount = quantize_amount(report.advance_amount or Decimal("0.00"))

    report_reference = report.report_date or date.today()
    try:
        report.subsidy_days = calculate_subsidy_days(report_reference, list(report.trips))
    except TripDateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    report.subsidy_total = quantize_amount(Decimal(report.subsidy_days) * report.daily_subsidy)
    clamp_fuel_subsidy_reimbursable_amount(report)
    transport_total = confirmed_transport_invoice_total(report)
    other_expense_total = sum((item.amount for item in report.expense_items if item.category != "transport_fare"), Decimal("0.00"))
    report.total_amount = quantize_amount(transport_total + other_expense_total + report.subsidy_total)
    report.shortfall = quantize_amount(max(Decimal("0.00"), report.total_amount - report.advance_amount))
    report.surplus = quantize_amount(max(Decimal("0.00"), report.advance_amount - report.total_amount))


def ensure_expense_items(report: ExpenseReport) -> None:
    existing = {item.category for item in report.expense_items}
    for category in EXPENSE_CATEGORIES:
        if category not in existing:
            report.expense_items.append(ExpenseItem(category=category))


def is_custom_category(category: str) -> bool:
    return category.startswith(CUSTOM_CATEGORY_PREFIX)


def custom_category_name(category: str) -> str:
    return category.removeprefix(CUSTOM_CATEGORY_PREFIX)


def build_custom_category(name: str) -> str:
    normalized = validate_custom_category_name(name)
    return f"{CUSTOM_CATEGORY_PREFIX}{normalized}"


def validate_custom_category_name(name: str) -> str:
    normalized = name.strip()
    if not 1 <= len(normalized) <= 20:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义费用名称需为 1-20 个字符")
    if CUSTOM_CATEGORY_FORBIDDEN_PATTERN.search(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='自定义费用名称不能包含 / \\ : * ? " < > | 或控制字符')
    fixed_labels = set(FIXED_CATEGORY_LABELS.values()) | FIXED_CATEGORY_LABEL_ALIASES
    if normalized in fixed_labels:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义费用名称不能与固定费用类别重名")
    return normalized


def validate_expense_category(category: str) -> str:
    normalized = category.strip()
    if normalized in EXPENSE_CATEGORIES:
        return normalized
    if is_custom_category(normalized):
        return build_custom_category(custom_category_name(normalized))
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效费用类别")


def active_invoices_for_category(report: ExpenseReport, category: str) -> list[Invoice]:
    return [
        invoice
        for invoice in report.invoices
        if invoice.deleted_at is None and invoice.expense_category == category
    ]


def replace_trips(report: ExpenseReport, trip_payloads: list[TripWrite]) -> None:
    keep_ids = {item.id for item in trip_payloads if item.id is not None}
    report.trips[:] = [trip for trip in report.trips if trip.id in keep_ids]
    by_id = {trip.id: trip for trip in report.trips if trip.id is not None}

    for index, payload in enumerate(trip_payloads, start=1):
        data = payload.model_dump(exclude={"id"})
        data["sort_order"] = index
        if payload.id is not None and payload.id in by_id:
            trip = by_id[payload.id]
            for key, value in data.items():
                setattr(trip, key, value)
        else:
            report.trips.append(Trip(**data))


def update_expense_items(report: ExpenseReport, item_payloads: list[ExpenseItemWrite]) -> None:
    ensure_expense_items(report)
    by_category = {item.category: item for item in report.expense_items}
    seen_custom_names: set[str] = set()
    requested_custom_categories: set[str] = set()
    for payload in item_payloads:
        category = validate_expense_category(payload.category)
        if category == "transport_fare":
            continue
        if is_custom_category(category):
            name = custom_category_name(category)
            if name in seen_custom_names:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="同一报销单内自定义费用类别不能重名")
            seen_custom_names.add(name)
            requested_custom_categories.add(category)
        item = by_category.get(category)
        if item is None:
            item = ExpenseItem(category=category, remark=payload.remark)
            report.expense_items.append(item)
            by_category[category] = item
        else:
            item.remark = payload.remark
        item.reimbursable_amount = (
            quantize_amount(payload.reimbursable_amount)
            if category == FUEL_SUBSIDY_CATEGORY and payload.reimbursable_amount is not None
            else None
        )

    for item in list(report.expense_items):
        if not is_custom_category(item.category) or item.category in requested_custom_categories:
            continue
        if active_invoices_for_category(report, item.category):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该自定义费用类别已有发票，请先删除发票后再删除类别")
        report.expense_items.remove(item)
    validate_fuel_subsidy_reimbursable_amount(report)


def get_report_or_404(db: Session, report_id: int) -> ExpenseReport:
    report = db.scalar(
        select(ExpenseReport).where(
            ExpenseReport.id == report_id,
            ExpenseReport.deleted_at.is_(None),
        )
    )
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报销单不存在")
    return report


def get_report_any_state_or_404(db: Session, report_id: int) -> ExpenseReport:
    report = db.scalar(select(ExpenseReport).where(ExpenseReport.id == report_id))
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报销单不存在")
    return report


def get_deleted_report_or_404(db: Session, report_id: int) -> ExpenseReport:
    report = db.scalar(
        select(ExpenseReport).where(
            ExpenseReport.id == report_id,
            ExpenseReport.deleted_at.is_not(None),
        )
    )
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="回收站中不存在该报销单")
    return report


def trip_date_range(report: ExpenseReport, trip: Trip) -> tuple[date, date]:
    report_reference = report.report_date or date.today()
    for trip_range in infer_trip_date_ranges(report_reference, list(report.trips)):
        same_persisted_trip = trip.id is not None and trip_range.trip.id == trip.id
        if same_persisted_trip or trip_range.trip is trip:
            return trip_range.depart, trip_range.arrive
    trip_range = infer_trip_date_ranges(report_reference, [trip])[0]
    return trip_range.depart, trip_range.arrive


def report_has_trip_overlap(report: ExpenseReport, trip_start: date | None, trip_end: date | None) -> bool:
    if trip_start is None and trip_end is None:
        return True
    if not report.trips:
        return False

    start = trip_start or date.min
    end = trip_end or date.max
    report_reference = report.report_date or date.today()
    return any(
        trip_range.depart <= end and trip_range.arrive >= start
        for trip_range in infer_trip_date_ranges(report_reference, list(report.trips))
    )


def report_matches_keyword(report: ExpenseReport, keyword: str | None) -> bool:
    normalized = (keyword or "").strip().lower()
    if not normalized:
        return True
    values = [
        str(report.id),
        report.purpose or "",
        report.employee_name or "",
        report.department or "",
    ]
    return any(normalized in value.lower() for value in values)


def active_invoices(report: ExpenseReport, include_deleted: bool = False) -> list[Invoice]:
    if include_deleted:
        return list(report.invoices)
    return [invoice for invoice in report.invoices if invoice.deleted_at is None]


def report_matches_invoice_state(
    report: ExpenseReport,
    invoice_state: ReportInvoiceState,
    include_deleted_invoices: bool = False,
) -> bool:
    invoices = active_invoices(report, include_deleted=include_deleted_invoices)
    if invoice_state == "all":
        return True
    if invoice_state == "no_invoice":
        return not invoices
    if invoice_state == "has_unconfirmed":
        return any(not invoice.amount_confirmed for invoice in invoices)
    if invoice_state == "all_confirmed":
        return bool(invoices) and all(invoice.amount_confirmed for invoice in invoices)
    return True


def report_matches_category(report: ExpenseReport, category: str | None, include_deleted_invoices: bool = False) -> bool:
    normalized = (category or "").strip()
    if not normalized:
        return True
    category_key = validate_expense_category(normalized)
    return any(invoice.expense_category == category_key for invoice in active_invoices(report, include_deleted=include_deleted_invoices))


def report_matches_filters(report: ExpenseReport, filters: ReportFilters, include_deleted_invoices: bool = False) -> bool:
    if filters.report_start is not None and (report.report_date is None or report.report_date < filters.report_start):
        return False
    if filters.report_end is not None and (report.report_date is None or report.report_date > filters.report_end):
        return False
    if not report_has_trip_overlap(report, filters.trip_start, filters.trip_end):
        return False
    if not report_matches_keyword(report, filters.keyword):
        return False
    if filters.amount_min is not None and report.total_amount < filters.amount_min:
        return False
    if filters.amount_max is not None and report.total_amount > filters.amount_max:
        return False
    if not report_matches_invoice_state(report, filters.invoice_state, include_deleted_invoices=include_deleted_invoices):
        return False
    if not report_matches_category(report, filters.category, include_deleted_invoices=include_deleted_invoices):
        return False
    if filters.has_attachment is not None and bool(active_invoices(report, include_deleted=include_deleted_invoices)) != filters.has_attachment:
        return False
    if filters.subsidy_days_min is not None and report.subsidy_days < filters.subsidy_days_min:
        return False
    if filters.subsidy_days_max is not None and report.subsidy_days > filters.subsidy_days_max:
        return False
    return True


def list_report_category_options(db: Session) -> list[dict[str, str]]:
    options = [{"value": category, "label": FIXED_CATEGORY_LABELS[category]} for category in EXPENSE_CATEGORIES]
    seen = set(EXPENSE_CATEGORIES)
    custom_items = db.scalars(
        select(ExpenseItem.category)
        .join(ExpenseReport, ExpenseItem.report_id == ExpenseReport.id)
        .where(
            ExpenseReport.deleted_at.is_(None),
            ExpenseItem.category.like(f"{CUSTOM_CATEGORY_PREFIX}%"),
        )
        .order_by(ExpenseItem.category.asc())
    ).all()

    for category in custom_items:
        if category in seen:
            continue
        options.append({"value": category, "label": custom_category_name(category)})
        seen.add(category)
    return options


def list_reports(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    report_status: ReportStatus | None = None,
    filters: ReportFilters | None = None,
    deleted_only: bool = False,
) -> tuple[list[ExpenseReport], int]:
    filters = filters or ReportFilters(report_status=report_status)
    report_status = filters.report_status if filters.report_status is not None else report_status
    statement: Select[tuple[ExpenseReport]] = select(ExpenseReport)
    if deleted_only:
        statement = statement.where(ExpenseReport.deleted_at.is_not(None))
    else:
        statement = statement.where(ExpenseReport.deleted_at.is_(None))

    if report_status is not None:
        statement = statement.where(ExpenseReport.status == report_status)
    elif filters.report_statuses:
        statement = statement.where(ExpenseReport.status.in_(filters.report_statuses))

    if deleted_only:
        statement = statement.order_by(ExpenseReport.deleted_at.desc(), ExpenseReport.created_at.desc())
    else:
        statement = statement.order_by(
            ExpenseReport.report_date.is_(None),
            ExpenseReport.report_date.desc(),
            ExpenseReport.created_at.desc(),
        )

    all_items = [
        report
        for report in db.scalars(statement).all()
        if report_matches_filters(report, filters, include_deleted_invoices=deleted_only)
    ]
    total = len(all_items)
    start = (page - 1) * page_size
    return all_items[start : start + page_size], total


def list_deleted_reports(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    filters: ReportFilters | None = None,
) -> tuple[list[ExpenseReport], int]:
    return list_reports(db, page=page, page_size=page_size, filters=filters, deleted_only=True)


def create_report(db: Session, payload: ReportCreate) -> ExpenseReport:
    settings = get_or_create_settings(db)
    data = payload.model_dump(exclude={"trips", "expense_items"})
    if data.get("department") is None:
        data["department"] = settings.department
    if data.get("employee_name") is None:
        data["employee_name"] = settings.employee_name
    if data.get("daily_subsidy") == Decimal("0.00") and settings.daily_subsidy is not None:
        data["daily_subsidy"] = settings.daily_subsidy

    report = ExpenseReport(**data)
    db.add(report)
    db.flush()
    ensure_expense_items(report)
    if payload.trips:
        replace_trips(report, payload.trips)
    if payload.expense_items:
        update_expense_items(report, payload.expense_items)
    db.flush()
    recalculate_report_totals(report)
    db.commit()
    db.refresh(report)
    return report


def update_report(db: Session, report_id: int, payload: ReportUpdate) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)

    data = payload.model_dump(exclude={"trips", "expense_items"})
    for key, value in data.items():
        setattr(report, key, value)
    if payload.trips is not None:
        replace_trips(report, payload.trips)
    if payload.expense_items is not None:
        update_expense_items(report, payload.expense_items)
    db.flush()
    recalculate_report_totals(report)
    db.commit()
    db.refresh(report)
    return report


def soft_delete_report(db: Session, report_id: int) -> None:
    report = get_report_or_404(db, report_id)
    ensure_report_deletable(report)
    report.deleted_at = datetime.utcnow()
    for invoice in report.invoices:
        invoice.deleted_at = report.deleted_at
    db.commit()


def restore_deleted_report(db: Session, report_id: int) -> ExpenseReport:
    report = get_deleted_report_or_404(db, report_id)
    ensure_report_deletable(report)
    report.deleted_at = None
    for invoice in report.invoices:
        invoice.deleted_at = None
    db.commit()
    db.refresh(report)
    return report


def _safe_invoice_file_paths(report: ExpenseReport) -> list[Path]:
    upload_root = UPLOAD_ROOT.resolve()
    paths: list[Path] = []
    seen: set[Path] = set()
    for invoice in report.invoices:
        path = _invoice_file_path(invoice.file_path).resolve()
        if not path.is_relative_to(upload_root):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="发票附件路径不安全，无法彻底删除")
        if path not in seen:
            paths.append(path)
            seen.add(path)
    return paths


def purge_report(db: Session, report_id: int) -> int:
    report = get_report_any_state_or_404(db, report_id)
    ensure_report_deletable(report)
    file_paths = _safe_invoice_file_paths(report)
    db.delete(report)
    db.commit()

    deleted_files = 0
    for path in file_paths:
        if not path.exists():
            continue
        path.unlink()
        deleted_files += 1
    return deleted_files


def update_report_status(db: Session, report_id: int, target_status: ReportStatus) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    validate_status_transition(report.status, target_status)
    report.status = target_status
    db.commit()
    db.refresh(report)
    return report


def recalculate_report_by_id(db: Session, report_id: int) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    recalculate_report_totals(report)
    db.commit()
    db.refresh(report)
    return report
