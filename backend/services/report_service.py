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
from backend.models.report_attachment import ReportAttachment
from backend.models.regular_item import RegularItem
from backend.models.trip import Trip
from backend.schemas.report import (
    ExpenseItemWrite,
    RegularItemWrite,
    ReportCreate,
    ReportInvoiceState,
    RegularMode,
    ReportStatus,
    ReportType,
    ReportUpdate,
    TripWrite,
)
from backend.services.maintenance_service import create_safety_snapshot
from backend.services.settings_service import get_or_create_settings

ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"checked"},
    "checked": {"draft", "printed"},
    "printed": {"checked", "reimbursed"},
    "reimbursed": {"printed"},
}
REPORT_STATUS_ORDER = {
    "draft": 0,
    "checked": 1,
    "printed": 2,
    "reimbursed": 3,
}
REPORT_STATUS_LABELS = {
    "draft": "草稿",
    "checked": "已核对",
    "printed": "已提交",
    "reimbursed": "已报销",
}

FUEL_SUBSIDY_CATEGORY = "fuel_subsidy"
REGULAR_EXPENSE_CATEGORY = "regular"
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
    "toll": "通行费",
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
    report_ids: set[int] | None = None
    report_type: ReportType | None = "travel"
    regular_mode: RegularMode | None = None
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
            detail=(
                f"不允许从{REPORT_STATUS_LABELS.get(current_status, current_status)}"
                f"流转到{REPORT_STATUS_LABELS.get(target_status, target_status)}"
            ),
        )


def ensure_report_writable(report: ExpenseReport) -> None:
    if report.status != "draft":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有草稿状态可以修改报销单内容、发票和车票")


def ensure_report_deletable(report: ExpenseReport) -> None:
    if report.status != "draft":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有草稿状态的报销单可以删除")


def quantize_amount(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def confirmed_transport_invoice_total(report: ExpenseReport) -> Decimal:
    electronic_total = sum(
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
    paper_total = sum((Decimal(trip.paper_invoice_amount or 0) for trip in report.trips), Decimal("0.00"))
    return quantize_amount(electronic_total + paper_total)


def confirmed_invoice_total_for_category(report: ExpenseReport, category: str) -> Decimal:
    electronic_total = sum(
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
    paper_total = sum(
        (Decimal(item.paper_invoice_amount or 0) for item in report.expense_items if item.category == category),
        Decimal("0.00"),
    )
    return quantize_amount(electronic_total + paper_total)


def fuel_subsidy_invoice_shortfall(report: ExpenseReport) -> Decimal:
    for item in report.expense_items:
        if item.category != FUEL_SUBSIDY_CATEGORY or item.reimbursable_amount is None:
            continue
        invoice_total = confirmed_invoice_total_for_category(report, FUEL_SUBSIDY_CATEGORY)
        return quantize_amount(max(Decimal("0.00"), Decimal(item.reimbursable_amount) - invoice_total))
    return Decimal("0.00")


def ensure_fuel_subsidy_printable(report: ExpenseReport) -> None:
    if report.report_type == "regular":
        ensure_regular_report_complete(report, action="下载")
        return
    shortfall = fuel_subsidy_invoice_shortfall(report)
    if shortfall > Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"燃油补助发票金额不足，还差 ¥{shortfall:.2f}，请补充足额发票后再下载或提交",
        )


def ensure_report_ready_to_leave_draft(report: ExpenseReport) -> None:
    if report.report_type == "regular":
        ensure_regular_report_complete(report, action="修改状态")
        return
    if not (report.purpose or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差事由不能为空，请填写后再修改状态")

    shortfall = fuel_subsidy_invoice_shortfall(report)
    if shortfall > Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"燃油补助发票金额不足，还差 ¥{shortfall:.2f}，请补充足额发票后再修改状态",
        )


def ensure_regular_invoice_files_confirmed(report: ExpenseReport) -> None:
    if report.report_type != "regular" or report.regular_mode != "invoice":
        return
    if any(not invoice.amount_confirmed for invoice in active_invoices(report)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="有票常规报销单存在未确认发票，请确认金额后再预览或下载",
        )


def ensure_regular_report_complete(report: ExpenseReport, *, action: str) -> None:
    if report.report_type != "regular":
        return
    if report.report_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"请填写报销日期后再{action}")
    if not (report.employee_name or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"请填写报销人后再{action}")
    if not report.regular_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"请至少添加一个报销项目后再{action}")

    for index, item in enumerate(sorted(report.regular_items, key=lambda value: value.sort_order), start=1):
        if item.occurred_on is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"第 {index} 个报销项目缺少发生日期")
        if not (item.description or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"第 {index} 个报销项目名称不能为空")
        if report.regular_mode == "no_invoice":
            if item.amount <= Decimal("0.00"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"第 {index} 个无票报销项目金额必须大于 0")
            continue

        invoices = item.active_invoices
        if not invoices:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"第 {index} 个有票报销项目至少需要上传一张发票")
        if any(not invoice.amount_confirmed for invoice in invoices):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"第 {index} 个有票报销项目存在未确认发票")


def ensure_report_previewable(report: ExpenseReport) -> None:
    ensure_regular_invoice_files_confirmed(report)


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
    trip_ranges = infer_trip_date_ranges(report_reference, sorted_trips)
    intervals = build_subsidy_intervals(subsidy_trips_with_implicit_bounds(trip_ranges))
    return count_merged_interval_days(intervals)


def subsidy_trips_with_implicit_bounds(trip_ranges: list[TripDateRange]) -> list[SubsidyTrip]:
    """将行程日期区间转为带 effective 起止的 SubsidyTrip。

    模型：第 1 段隐含「起」、最后 1 段隐含「止」，中间叠加用户显式标记。
    默认（无显式标记）即「第 1 段出发 → 最后 1 段到达」一个连续区间；
    用户仅在一次出差中途回家/去别处、需要排除某段间隙时，手动标「止」「起」切分。
    不再依赖出发地/到达地字符串匹配，也没有「全手动/全自动」模式切换。
    """
    ranges = list(trip_ranges)
    last_index = len(ranges) - 1
    return [
        SubsidyTrip(
            trip=trip_range.trip,
            depart=trip_range.depart,
            arrive=trip_range.arrive,
            subsidy_start=index == 0 or bool(trip_range.trip.subsidy_start),
            subsidy_end=index == last_index or bool(trip_range.trip.subsidy_end),
        )
        for index, trip_range in enumerate(ranges)
    ]


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
    if report.report_type == "regular":
        report.daily_subsidy = Decimal("0.00")
        report.subsidy_days = 0
        report.subsidy_total = Decimal("0.00")
        report.manual_subsidy_total = None
        report.advance_date_month = None
        report.advance_date_day = None
        report.advance_amount = Decimal("0.00")
        for item in report.regular_items:
            if item.manual_amount is not None:
                item.manual_amount = quantize_amount(item.manual_amount)
        report.total_amount = quantize_amount(sum((item.amount for item in report.regular_items), Decimal("0.00")))
        report.shortfall = Decimal("0.00")
        report.surplus = Decimal("0.00")
        return

    report.daily_subsidy = quantize_amount(report.daily_subsidy or Decimal("0.00"))
    report.advance_amount = quantize_amount(report.advance_amount or Decimal("0.00"))

    report_reference = report.report_date or date.today()
    try:
        calculated_subsidy_days = calculate_subsidy_days(report_reference, list(report.trips))
    except TripDateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if report.manual_subsidy_total is not None:
        report.manual_subsidy_total = quantize_amount(report.manual_subsidy_total)
        report.subsidy_days = 0
        report.subsidy_total = report.manual_subsidy_total
    else:
        report.subsidy_days = calculated_subsidy_days
        report.subsidy_total = quantize_amount(Decimal(report.subsidy_days) * report.daily_subsidy)
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
        data = payload.model_dump(exclude={"id"}, exclude_none=True)
        data["sort_order"] = index
        if payload.id is not None and payload.id in by_id:
            trip = by_id[payload.id]
            for key, value in data.items():
                setattr(trip, key, value)
        else:
            report.trips.append(Trip(**data))


def get_regular_item_target(report: ExpenseReport, regular_item_id: int) -> RegularItem:
    item = next((item for item in report.regular_items if item.id == regular_item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销项目不存在或不属于当前报销单")
    return item


def replace_regular_items(report: ExpenseReport, item_payloads: list[RegularItemWrite]) -> None:
    payload_ids = [item.id for item in item_payloads if item.id is not None]
    if len(payload_ids) != len(set(payload_ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销项目 ID 不能重复")

    by_id = {item.id: item for item in report.regular_items if item.id is not None}
    unknown_ids = set(payload_ids) - set(by_id)
    if unknown_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销项目不存在或不属于当前报销单")

    keep_ids = set(payload_ids)
    for item in list(report.regular_items):
        if item.id in keep_ids:
            continue
        if item.active_invoices or item.active_attachments:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该报销项目已有发票或凭据，请先清空关联文件再删除项目")
        report.regular_items.remove(item)

    for index, payload in enumerate(item_payloads, start=1):
        if report.regular_mode == "invoice" and payload.amount is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="有票常规报销项目金额由已确认发票自动汇总，不能手工填写")
        item = by_id.get(payload.id) if payload.id is not None else None
        if item is None:
            item = RegularItem()
            report.regular_items.append(item)
        item.sort_order = index
        item.occurred_on = payload.occurred_on
        item.description = payload.description
        item.remark = payload.remark
        item.manual_amount = quantize_amount(payload.amount) if payload.amount is not None else None


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
        if payload.paper_invoice_amount is not None:
            item.paper_invoice_amount = quantize_amount(payload.paper_invoice_amount)
            item.paper_invoice_count = payload.paper_invoice_count

    for item in list(report.expense_items):
        if not is_custom_category(item.category) or item.category in requested_custom_categories:
            continue
        if active_invoices_for_category(report, item.category) or item.paper_invoice_count > 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该自定义费用类别已有发票，请先清空纸质发票或删除上传发票后再删除类别")
        report.expense_items.remove(item)
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


def report_trip_date_bounds(report: ExpenseReport) -> tuple[date | None, date | None]:
    if not report.trips:
        return None, None

    report_reference = report.report_date or date.today()
    try:
        trip_ranges = infer_trip_date_ranges(report_reference, list(report.trips))
    except TripDateError:
        # 非法行程时序属于脏数据，只读的列表排序/序列化不应整页崩溃，降级为无日期边界
        return None, None
    if not trip_ranges:
        return None, None
    return min(item.depart for item in trip_ranges), max(item.arrive for item in trip_ranges)


def report_has_trip_overlap(report: ExpenseReport, trip_start: date | None, trip_end: date | None) -> bool:
    if trip_start is None and trip_end is None:
        return True
    if not report.trips:
        return False

    start = trip_start or date.min
    end = trip_end or date.max
    report_reference = report.report_date or date.today()
    try:
        trip_ranges = infer_trip_date_ranges(report_reference, list(report.trips))
    except TripDateError:
        # 脏数据无法推断行程日期，按不匹配日期筛选处理，避免整列表崩溃
        return False
    return any(
        trip_range.depart <= end and trip_range.arrive >= start
        for trip_range in trip_ranges
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
    if report.report_type == "regular":
        values.extend(item.description or "" for item in report.regular_items)
        values.extend(item.remark or "" for item in report.regular_items)
    return any(normalized in value.lower() for value in values)


def active_invoices(report: ExpenseReport, include_deleted: bool = False) -> list[Invoice]:
    if include_deleted:
        return list(report.invoices)
    return [invoice for invoice in report.invoices if invoice.deleted_at is None]


def active_report_attachments(
    report: ExpenseReport,
    include_deleted: bool = False,
) -> list[ReportAttachment]:
    if include_deleted:
        return list(report.attachments)
    return [attachment for attachment in report.attachments if attachment.deleted_at is None]


def paper_invoice_count(report: ExpenseReport) -> int:
    return sum(int(trip.paper_invoice_count or 0) for trip in report.trips) + sum(
        int(item.paper_invoice_count or 0) for item in report.expense_items
    )


def has_paper_invoice_for_category(report: ExpenseReport, category: str) -> bool:
    if category == "transport_fare":
        return any(trip.paper_invoice_count > 0 for trip in report.trips)
    return any(item.category == category and item.paper_invoice_count > 0 for item in report.expense_items)


def report_matches_invoice_state(
    report: ExpenseReport,
    invoice_state: ReportInvoiceState,
    include_deleted_invoices: bool = False,
) -> bool:
    invoices = active_invoices(report, include_deleted=include_deleted_invoices)
    paper_count = paper_invoice_count(report)
    if invoice_state == "all":
        return True
    if invoice_state == "no_invoice":
        return not invoices and paper_count == 0
    if invoice_state == "has_unconfirmed":
        return any(not invoice.amount_confirmed for invoice in invoices)
    if invoice_state == "all_confirmed":
        return bool(invoices or paper_count) and all(invoice.amount_confirmed for invoice in invoices)
    return True


def report_matches_category(report: ExpenseReport, category: str | None, include_deleted_invoices: bool = False) -> bool:
    normalized = (category or "").strip()
    if not normalized:
        return True
    if report.report_type == "regular":
        return False
    category_key = validate_expense_category(normalized)
    return has_paper_invoice_for_category(report, category_key) or any(
        invoice.expense_category == category_key for invoice in active_invoices(report, include_deleted=include_deleted_invoices)
    )


def report_matches_filters(report: ExpenseReport, filters: ReportFilters, include_deleted_invoices: bool = False) -> bool:
    if filters.report_type is not None and report.report_type != filters.report_type:
        return False
    if filters.regular_mode is not None and report.regular_mode != filters.regular_mode:
        return False
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
    has_file_attachment = bool(
        active_invoices(report, include_deleted=include_deleted_invoices)
        or active_report_attachments(report, include_deleted=include_deleted_invoices)
    )
    if filters.has_attachment is not None and has_file_attachment != filters.has_attachment:
        return False
    has_subsidy_days_filter = filters.subsidy_days_min is not None or filters.subsidy_days_max is not None
    if has_subsidy_days_filter and report.manual_subsidy_total is not None:
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


def _date_sort_value(value: date | None) -> int:
    return value.toordinal() if value else -1


def _datetime_sort_value(value: datetime | None) -> float:
    return value.timestamp() if value else -1


def _report_trip_start_desc_key(report: ExpenseReport) -> tuple[int, int, float]:
    return (
        _date_sort_value(report.trip_start_date),
        _date_sort_value(report.report_date),
        _datetime_sort_value(report.created_at),
    )


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

    if filters.report_type is not None:
        statement = statement.where(ExpenseReport.report_type == filters.report_type)
    if filters.report_ids:
        statement = statement.where(ExpenseReport.id.in_(filters.report_ids))
    if filters.regular_mode is not None:
        statement = statement.where(ExpenseReport.regular_mode == filters.regular_mode)

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
    if not deleted_only:
        all_items.sort(key=_report_trip_start_desc_key, reverse=True)
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


def regular_payload_has_travel_values(payload: ReportCreate | ReportUpdate) -> bool:
    return bool(
        (payload.department or "").strip()
        or (payload.purpose or "").strip()
        or Decimal(payload.daily_subsidy or 0) != Decimal("0.00")
        or payload.subsidy_days != 0
        or Decimal(payload.subsidy_total or 0) != Decimal("0.00")
        or payload.manual_subsidy_total is not None
        or payload.advance_date_month is not None
        or payload.advance_date_day is not None
        or Decimal(payload.advance_amount or 0) != Decimal("0.00")
        or Decimal(payload.shortfall or 0) != Decimal("0.00")
        or Decimal(payload.surplus or 0) != Decimal("0.00")
    )


def create_report(db: Session, payload: ReportCreate) -> ExpenseReport:
    settings = get_or_create_settings(db)
    data = payload.model_dump(exclude={"trips", "expense_items", "regular_items"})
    if data.get("employee_name") is None:
        data["employee_name"] = settings.employee_name
    if payload.report_type == "regular":
        if payload.regular_mode is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销单必须选择有票或无票模式")
        if payload.trips or payload.expense_items or regular_payload_has_travel_values(payload):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销单不能包含差旅行程、补贴或预支数据")
        data.update(
            department=None,
            purpose=None,
            daily_subsidy=Decimal("0.00"),
            subsidy_days=0,
            subsidy_total=Decimal("0.00"),
            manual_subsidy_total=None,
            advance_date_month=None,
            advance_date_day=None,
            advance_amount=Decimal("0.00"),
            shortfall=Decimal("0.00"),
            surplus=Decimal("0.00"),
        )
    else:
        if payload.regular_mode is not None or payload.regular_items:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差报销单不能包含常规报销模式或项目")
        if data.get("department") is None:
            data["department"] = settings.department
        if data.get("daily_subsidy") == Decimal("0.00") and settings.daily_subsidy is not None:
            data["daily_subsidy"] = settings.daily_subsidy

    try:
        report = ExpenseReport(**data)
        db.add(report)
        db.flush()
        if report.report_type == "regular":
            replace_regular_items(report, payload.regular_items)
        else:
            ensure_expense_items(report)
            if payload.trips:
                replace_trips(report, payload.trips)
            if payload.expense_items:
                update_expense_items(report, payload.expense_items)
        db.flush()
        recalculate_report_totals(report)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(report)
    return report


def update_report(db: Session, report_id: int, payload: ReportUpdate) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)

    try:
        fields_set = payload.model_fields_set
        if "report_type" in fields_set and payload.report_type != report.report_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="报销单类型创建后不能修改")
        if "regular_mode" in fields_set and payload.regular_mode != report.regular_mode:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销模式创建后不能修改")

        if report.report_type == "regular":
            if payload.trips or payload.expense_items or regular_payload_has_travel_values(payload):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销单不能包含差旅行程、补贴或预支数据")
            for key in ("report_date", "employee_name"):
                if key in fields_set:
                    setattr(report, key, getattr(payload, key))
            if payload.regular_items is not None:
                replace_regular_items(report, payload.regular_items)
        else:
            if payload.regular_items is not None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差报销单不能包含常规报销项目")
            data = payload.model_dump(exclude={"trips", "expense_items", "regular_items", "report_type", "regular_mode"})
            for key, value in data.items():
                setattr(report, key, value)
            if payload.trips is not None:
                replace_trips(report, payload.trips)
            if payload.expense_items is not None:
                update_expense_items(report, payload.expense_items)
        db.flush()
        recalculate_report_totals(report)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(report)
    return report


def soft_delete_report(db: Session, report_id: int) -> None:
    report = get_report_or_404(db, report_id)
    ensure_report_deletable(report)
    report.deleted_at = datetime.utcnow()
    for invoice in report.invoices:
        if invoice.deleted_at is None:
            invoice.deleted_at = report.deleted_at
    for attachment in report.attachments:
        if attachment.deleted_at is None:
            attachment.deleted_at = report.deleted_at
    db.commit()


def restore_deleted_report(db: Session, report_id: int) -> ExpenseReport:
    report = get_deleted_report_or_404(db, report_id)
    ensure_report_deletable(report)
    report_deleted_at = report.deleted_at
    report.deleted_at = None
    for invoice in report.invoices:
        if invoice.deleted_at == report_deleted_at:
            invoice.deleted_at = None
    for attachment in report.attachments:
        if attachment.deleted_at == report_deleted_at:
            attachment.deleted_at = None
    db.commit()
    db.refresh(report)
    return report


def _safe_report_file_paths(report: ExpenseReport) -> list[Path]:
    upload_root = UPLOAD_ROOT.resolve()
    paths: list[Path] = []
    seen: set[Path] = set()
    stored_files = [
        (invoice.file_path, "发票附件") for invoice in report.invoices
    ] + [
        (attachment.file_path, "非发票附件") for attachment in report.attachments
    ]
    for file_path, label in stored_files:
        path = _invoice_file_path(file_path).resolve()
        if not path.is_relative_to(upload_root):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label}路径不安全，无法彻底删除")
        if path not in seen:
            paths.append(path)
            seen.add(path)
    return paths


def purge_report(db: Session, report_id: int) -> int:
    report = get_report_any_state_or_404(db, report_id)
    ensure_report_deletable(report)
    file_paths = _safe_report_file_paths(report)
    db.delete(report)
    db.commit()

    deleted_files = 0
    for path in file_paths:
        if not path.exists():
            continue
        path.unlink()
        deleted_files += 1
    return deleted_files


def apply_report_status(
    report: ExpenseReport,
    target_status: ReportStatus,
    *,
    submitted_on: date | None = None,
) -> None:
    report.status = target_status
    if target_status == "printed":
        report.report_date = submitted_on or date.today()


def update_report_status(db: Session, report_id: int, target_status: ReportStatus) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    validate_status_transition(report.status, target_status)
    if report.status == "draft" and target_status != "draft":
        ensure_report_ready_to_leave_draft(report)
    if REPORT_STATUS_ORDER.get(target_status, 0) < REPORT_STATUS_ORDER.get(report.status, 0):
        create_safety_snapshot(db, reason="pre_status_rollback")
    apply_report_status(report, target_status)
    db.commit()
    db.refresh(report)
    return report


def recalculate_report_by_id(db: Session, report_id: int) -> ExpenseReport:
    report = get_report_or_404(db, report_id)
    recalculate_report_totals(report)
    db.commit()
    db.refresh(report)
    return report
