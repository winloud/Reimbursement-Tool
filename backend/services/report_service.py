from datetime import date, datetime
from decimal import Decimal
import re

from fastapi import HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from backend.models.expense_item import ExpenseItem
from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.trip import Trip
from backend.schemas.report import ExpenseItemWrite, ReportCreate, ReportStatus, ReportUpdate, TripWrite
from backend.services.settings_service import get_or_create_settings

ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"printed"},
    "printed": {"draft", "reimbursed"},
    "reimbursed": set(),
}

EXPENSE_CATEGORIES = [
    "transport_fare",
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    "fuel_subsidy",
]
FIXED_OTHER_EXPENSE_CATEGORIES = [
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    "fuel_subsidy",
]
FIXED_CATEGORY_LABELS = {
    "transport_fare": "车船费",
    "luggage": "行李费",
    "city_transport": "市内交通费",
    "accommodation": "住宿费",
    "postal": "邮电费",
    "no_sleeper_subsidy": "未乘卧铺补助",
    "toll": "过路费",
    "fuel_subsidy": "燃油补助",
}
FIXED_CATEGORY_LABEL_ALIASES = {
    "市内车费",
    "不买卧铺补贴",
    "油补",
}
CUSTOM_CATEGORY_PREFIX = "custom:"
CUSTOM_CATEGORY_FORBIDDEN_PATTERN = re.compile(r'[\/\\:\*\?"<>\|\x00-\x1f]')


class TripDateError(ValueError):
    pass


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


def build_trip_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError as exc:
        raise TripDateError(f"无效行程日期：{month}月{day}日") from exc


def calculate_subsidy_days(report_year: int, trips: list[Trip]) -> int:
    if not trips:
        return 0

    depart_dates: list[date] = []
    arrive_dates: list[date] = []
    for trip in trips:
        depart = build_trip_date(report_year, trip.depart_month, trip.depart_day)
        arrive_year = report_year + 1 if (trip.arrive_month, trip.arrive_day) < (trip.depart_month, trip.depart_day) else report_year
        arrive = build_trip_date(arrive_year, trip.arrive_month, trip.arrive_day)
        depart_dates.append(depart)
        arrive_dates.append(arrive)

    earliest = min(depart_dates)
    latest = max(arrive_dates)
    return (latest - earliest).days + 1


def recalculate_report_totals(report: ExpenseReport) -> None:
    report.daily_subsidy = quantize_amount(report.daily_subsidy or Decimal("0.00"))
    report.advance_amount = quantize_amount(report.advance_amount or Decimal("0.00"))

    report_year = report.report_date.year if report.report_date else date.today().year
    try:
        report.subsidy_days = calculate_subsidy_days(report_year, list(report.trips))
    except TripDateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    report.subsidy_total = quantize_amount(Decimal(report.subsidy_days) * report.daily_subsidy)
    invoices_total = sum(
        (
            invoice.amount
            for invoice in report.invoices
            if invoice.deleted_at is None and invoice.amount_confirmed
        ),
        Decimal("0.00"),
    )
    report.total_amount = quantize_amount(invoices_total + report.subsidy_total)
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

    for item in list(report.expense_items):
        if not is_custom_category(item.category) or item.category in requested_custom_categories:
            continue
        if active_invoices_for_category(report, item.category):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该自定义费用类别已有发票，请先删除发票后再删除类别")
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


def list_reports(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    report_status: ReportStatus | None = None,
) -> tuple[list[ExpenseReport], int]:
    statement: Select[tuple[ExpenseReport]] = select(ExpenseReport).where(ExpenseReport.deleted_at.is_(None))
    count_statement = select(func.count()).select_from(ExpenseReport).where(ExpenseReport.deleted_at.is_(None))

    if report_status is not None:
        statement = statement.where(ExpenseReport.status == report_status)
        count_statement = count_statement.where(ExpenseReport.status == report_status)

    statement = statement.order_by(
        ExpenseReport.report_date.is_(None),
        ExpenseReport.report_date.desc(),
        ExpenseReport.created_at.desc(),
    )
    statement = statement.offset((page - 1) * page_size).limit(page_size)

    items = list(db.scalars(statement).all())
    total = int(db.scalar(count_statement) or 0)
    return items, total


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
