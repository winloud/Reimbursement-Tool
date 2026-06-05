from __future__ import annotations

import base64
import copy
import re
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import fitz
from fastapi import HTTPException, status
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.trip import Trip
from backend.services.amount_converter import amount_to_chinese_upper, quantize_currency
from backend.services.report_service import FIXED_CATEGORY_LABELS, custom_category_name, is_custom_category

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_CANDIDATES = [
    PROJECT_ROOT / "backend" / "templates" / "expense_template.pdf",
    PROJECT_ROOT / "backend" / "templates" / "报销单.pdf",
]
PT_PER_MM = 72.0 / 25.4
FONT_NAME = "SimSun"
ITEM_LABEL_FONT_NAME = "KaiTi"
FALLBACK_FONT_NAME = "STSong-Light"
MIN_FIELD_FONT_SIZE = 4.5
ILLEGAL_FILENAME_CHARS = re.compile(r'[\/\\:\*\?"<>\|\x00-\x1f]')


def _register_ttf_font(font_name: str, candidates: list[Path]) -> str | None:
    for path in candidates:
        if not path.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, str(path), subfontIndex=0))
            return font_name
        except TypeError:
            pdfmetrics.registerFont(TTFont(font_name, str(path)))
            return font_name
    return None


def _register_fill_font() -> str:
    font_candidates = [
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("C:/Windows/Fonts/simsun.ttf"),
        Path("C:/Windows/Fonts/SIMSUN.TTC"),
    ]
    registered = _register_ttf_font(FONT_NAME, font_candidates)
    if registered:
        return registered
    pdfmetrics.registerFont(UnicodeCIDFont(FALLBACK_FONT_NAME))
    return FALLBACK_FONT_NAME


FILL_FONT_NAME = _register_fill_font()
ITEM_FILL_FONT_NAME = _register_ttf_font(
    ITEM_LABEL_FONT_NAME,
    [
        Path("C:/Windows/Fonts/simkai.ttf"),
        Path("C:/Windows/Fonts/kaiti.ttf"),
        Path("C:/Windows/Fonts/STKAITI.TTF"),
    ],
) or FILL_FONT_NAME


@dataclass(frozen=True)
class TextField:
    name: str
    x_mm: float
    y_mm: float
    width_mm: float
    height_mm: float
    font_size: float = 8
    align: str = "center"
    font_name: str | None = None


ROW_RECTS = [
    (1, 70.754, 6.000),
    (2, 64.754, 6.006),
    (3, 58.748, 6.006),
    (4, 52.742, 6.006),
    (5, 46.736, 6.006),
    (6, 40.730, 6.001),
    (7, 34.729, 6.006),
]
TRIP_COLUMNS = [
    (24.188, 4.805, "depart_month", 7),
    (28.993, 4.403, "depart_day", 7),
    (33.396, 4.603, "depart_hour", 7),
    (37.999, 11.314, "depart_place", 8),
    (49.911, 4.408, "arrive_month", 7),
    (54.319, 4.403, "arrive_day", 7),
    (58.722, 4.402, "arrive_hour", 7),
    (63.124, 11.811, "arrive_place", 8),
    (75.539, 10.810, "transport", 8),
    (86.349, 9.409, "invoice_count", 8),
    (95.758, 12.409, "transport_fare", 8),
]
OTHER_EXPENSE_CATEGORIES = [
    "luggage",
    "city_transport",
    "accommodation",
    "postal",
    "no_sleeper_subsidy",
    "toll",
    "fuel_subsidy",
]
OTHER_PROJECT_X = 164.95
OTHER_PROJECT_WIDTH = 15.0
OTHER_COUNT_X = 180.038
OTHER_COUNT_WIDTH = 8.107
OTHER_AMOUNT_X = 188.145
OTHER_AMOUNT_WIDTH = 11.367


@dataclass(frozen=True)
class ExpenseRow:
    category: str
    label: str
    count: int
    amount: Decimal


def _field_rect(field: TextField) -> tuple[float, float, float, float]:
    x = field.x_mm * PT_PER_MM
    y = (field.y_mm - field.height_mm) * PT_PER_MM
    w = field.width_mm * PT_PER_MM
    h = field.height_mm * PT_PER_MM
    return x, y, w, h


def _draw_field(c: canvas.Canvas, field: TextField, value: object) -> None:
    text = "" if value is None else str(value)
    if not text:
        return

    x, y, w, h = _field_rect(field)
    font_name = field.font_name or FILL_FONT_NAME
    available_width = max(w - 3, 1)
    font_size = field.font_size
    while font_size > MIN_FIELD_FONT_SIZE and pdfmetrics.stringWidth(text, font_name, font_size) > available_width:
        font_size -= 0.5
    c.setFont(font_name, font_size)
    baseline = y + max((h - font_size) / 2, 0) + 1.5
    if field.align == "left":
        c.drawString(x + 1.5, baseline, text)
    elif field.align == "right":
        c.drawRightString(x + w - 1.5, baseline, text)
    else:
        c.drawCentredString(x + w / 2, baseline, text)


def _money(value: Decimal | int | str | None) -> str:
    return f"{quantize_currency(Decimal(value or '0.00')):.2f}"


def _int_or_blank(value: int | None) -> str:
    return "" if value is None else str(value)


def _active_invoices(report: ExpenseReport) -> list[Invoice]:
    return [invoice for invoice in report.invoices if invoice.deleted_at is None]


def _confirmed_invoices(report: ExpenseReport) -> list[Invoice]:
    return [invoice for invoice in _active_invoices(report) if invoice.amount_confirmed]


def ensure_pdf_exportable(report: ExpenseReport) -> None:
    if any(not invoice.amount_confirmed for invoice in _active_invoices(report)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="存在未确认发票，请先确认发票金额")
    _get_template_path()


def _get_template_path() -> Path:
    for path in TEMPLATE_CANDIDATES:
        if path.exists():
            return path
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF 模板文件不存在")


def _chunks(items: list[Trip], size: int) -> list[list[Trip]]:
    return [items[index : index + size] for index in range(0, len(items), size)] or [[]]


def _report_date_parts(report: ExpenseReport) -> tuple[str, str, str]:
    if report.report_date is None:
        return "", "", ""
    return str(report.report_date.year), str(report.report_date.month), str(report.report_date.day)


def _header_fields(report: ExpenseReport) -> dict[str, object]:
    year, month, day = _report_date_parts(report)
    return {
        "department": report.department or "",
        "employee_name": report.employee_name or "",
        "purpose": report.purpose or "",
        "report_date_year": year,
        "report_date_month": month,
        "report_date_day": day,
    }


def _trip_values(trip: Trip) -> dict[str, object]:
    return {
        "depart_month": trip.depart_month,
        "depart_day": trip.depart_day,
        "depart_hour": _int_or_blank(trip.depart_hour),
        "depart_place": trip.depart_place or "",
        "arrive_month": trip.arrive_month,
        "arrive_day": trip.arrive_day,
        "arrive_hour": _int_or_blank(trip.arrive_hour),
        "arrive_place": trip.arrive_place or "",
        "transport": trip.transport or "",
        "invoice_count": trip.invoice_count or "",
        "transport_fare": _money(trip.amount) if trip.amount else "",
    }


def _ordered_other_categories(report: ExpenseReport) -> list[str]:
    categories = list(OTHER_EXPENSE_CATEGORIES)
    seen = set(categories)
    for item in report.expense_items:
        if not is_custom_category(item.category) or item.category in seen:
            continue
        categories.append(item.category)
        seen.add(item.category)
    return categories


def _expense_label(category: str) -> str:
    if is_custom_category(category):
        return custom_category_name(category)
    return FIXED_CATEGORY_LABELS.get(category, category)


def _other_expense_rows(report: ExpenseReport) -> list[ExpenseRow]:
    rows: list[ExpenseRow] = []
    for category in _ordered_other_categories(report):
        invoices = [
            invoice
            for invoice in _confirmed_invoices(report)
            if invoice.expense_category == category and invoice.trip_id is None
        ]
        amount = sum((invoice.amount for invoice in invoices), Decimal("0.00"))
        amount = quantize_currency(amount)
        if amount == Decimal("0.00"):
            continue
        rows.append(ExpenseRow(category=category, label=_expense_label(category), count=len(invoices), amount=amount))
    return rows


def _build_overlay(
    report: ExpenseReport,
    trips: list[Trip],
    expense_rows: list[ExpenseRow],
    all_expense_rows: list[ExpenseRow],
    is_last_page: bool,
    page_size: tuple[float, float],
    page_label: str = "",
) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=page_size)

    header_fields = [
        TextField("department", 38.142, 85.672, 31.491, 6.503, 9),
        TextField("employee_name", 86.349, 85.672, 41.434, 6.503, 9),
        TextField("purpose", 147.950, 85.672, 51.562, 6.503, 9),
        TextField("report_date_year", 161.000, 90.300, 11, 4, 8),
        TextField("report_date_month", 177.200, 90.300, 6, 4, 8),
        TextField("report_date_day", 188.000, 90.300, 6, 4, 8),
    ]
    header_values = _header_fields(report)
    for field in header_fields:
        _draw_field(c, field, header_values[field.name])

    _draw_field(c, TextField("page_label", 201, 4, 8, 3, 6), page_label)

    for row_index, (row_no, y_mm, height_mm) in enumerate(ROW_RECTS):
        if row_index >= len(trips):
            continue
        values = _trip_values(trips[row_index])
        for x_mm, width_mm, key, font_size in TRIP_COLUMNS:
            _draw_field(c, TextField(key, x_mm, y_mm, width_mm, height_mm, font_size), values[key])

    for row_index, (_row_no, y_mm, height_mm) in enumerate(ROW_RECTS):
        if row_index >= len(expense_rows):
            continue
        row = expense_rows[row_index]
        _draw_field(
            c,
            TextField(
                f"{row.category}_label",
                OTHER_PROJECT_X,
                y_mm,
                OTHER_PROJECT_WIDTH,
                height_mm,
                font_size=10.2,
                font_name=ITEM_FILL_FONT_NAME,
            ),
            row.label,
        )
        _draw_field(c, TextField(f"{row.category}_count", OTHER_COUNT_X, y_mm, OTHER_COUNT_WIDTH, height_mm), row.count)
        _draw_field(c, TextField(f"{row.category}_amount", OTHER_AMOUNT_X, y_mm, OTHER_AMOUNT_WIDTH, height_mm), _money(row.amount))

    if is_last_page:
        total_transport = sum((trip.amount for trip in report.trips), Decimal("0.00"))
        total_other_count = sum(row.count for row in all_expense_rows)
        total_other_amount = sum((row.amount for row in all_expense_rows), Decimal("0.00"))
        total_invoice_count = sum(trip.invoice_count for trip in report.trips) + total_other_count
        total_fields = {
            "total_invoice_count": total_invoice_count or "",
            "total_transport_fare": _money(total_transport) if total_transport else "",
            "subsidy_days": f"{report.subsidy_days}天" if report.subsidy_days else "",
            "subsidy_amount": _money(report.subsidy_total) if report.subsidy_total else "",
            "total_other_count": total_other_count or "",
            "total_other_amount": _money(total_other_amount) if total_other_amount else "",
            "total_amount": _money(report.total_amount),
            "total_amount_cn": amount_to_chinese_upper(report.total_amount),
            "advance_amount": _money(report.advance_amount) if report.advance_amount else "",
            "advance_month": report.advance_date_month or "",
            "advance_day": report.advance_date_day or "",
            "shortfall": _money(report.shortfall) if report.shortfall else "",
            "surplus": _money(report.surplus) if report.surplus else "",
        }
        for field in [
            TextField("total_invoice_count", 86.349, 28.723, 9.409, 6.249),
            TextField("total_transport_fare", 95.758, 28.723, 12.409, 6.249),
            TextField("subsidy_days", 122.280, 28.723, 8.112, 6.249),
            TextField("subsidy_amount", 130.392, 28.723, 10.610, 6.249),
            TextField("total_other_count", 180.038, 28.723, 8.107, 6.249),
            TextField("total_other_amount", 188.145, 28.723, 11.367, 6.249),
            TextField("total_amount", 121.55, 21.92, 15.31, 5.72),
            TextField("total_amount_cn", 46.964, 22.474, 70, 8.012, align="left"),
            TextField("advance_amount", 146.7, 18.24, 19, 2.9),
            TextField("advance_month", 146.55, 22.57, 7.059, 3.8, 7),
            TextField("advance_day", 156.55, 22.57, 7.607, 3.8, 7),
            TextField("shortfall", 183.25, 22.57, 16.27, 4.154),
            TextField("surplus", 183.25, 18.62, 16.27, 4.154),
        ]:
            _draw_field(c, field, total_fields[field.name])

    c.save()
    return buffer.getvalue()


def build_report_pdf(report: ExpenseReport) -> bytes:
    ensure_pdf_exportable(report)
    template_path = _get_template_path()
    template_reader = PdfReader(str(template_path))
    template_page = template_reader.pages[0]
    page_size = (float(template_page.mediabox.width), float(template_page.mediabox.height))
    trips = sorted(report.trips, key=lambda trip: trip.sort_order)
    trip_pages = _chunks(trips, 7)
    all_expense_rows = _other_expense_rows(report)
    expense_pages = _chunks(all_expense_rows, 7)
    page_count = max(len(trip_pages), len(expense_pages), 1)
    writer = PdfWriter()

    for page_index in range(page_count):
        page_trips = trip_pages[page_index] if page_index < len(trip_pages) else []
        page_expense_rows = expense_pages[page_index] if page_index < len(expense_pages) else []
        page = copy.deepcopy(PdfReader(str(template_path)).pages[0])
        overlay_bytes = _build_overlay(
            report,
            page_trips,
            page_expense_rows,
            all_expense_rows,
            page_index == page_count - 1,
            page_size,
            f"{page_index + 1}/{page_count}" if page_count > 1 else "",
        )
        overlay_page = PdfReader(BytesIO(overlay_bytes)).pages[0]
        page.merge_page(overlay_page)
        writer.add_page(page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _build_image_attachment_pdf(path: Path) -> bytes:
    image = ImageReader(str(path))
    image_width, image_height = image.getSize()
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=(image_width, image_height))
    c.drawImage(image, 0, 0, width=image_width, height=image_height)
    c.showPage()
    c.save()
    return buffer.getvalue()


def _append_invoice_attachments(writer: PdfWriter, report: ExpenseReport) -> None:
    for invoice in _active_invoices(report):
        path = PROJECT_ROOT / "backend" / invoice.file_path
        if not path.exists():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"发票文件不存在：{invoice.file_path}")
        if invoice.file_type == "pdf":
            reader = PdfReader(str(path))
            for page in reader.pages:
                writer.add_page(page)
        else:
            reader = PdfReader(BytesIO(_build_image_attachment_pdf(path)))
            writer.add_page(reader.pages[0])


def build_merged_report_pdf(report: ExpenseReport) -> bytes:
    report_pdf = build_report_pdf(report)
    writer = PdfWriter()

    for page in PdfReader(BytesIO(report_pdf)).pages:
        writer.add_page(page)
    _append_invoice_attachments(writer, report)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def render_report_preview_pages(report: ExpenseReport) -> list[dict[str, object]]:
    report_pdf = build_report_pdf(report)
    pages: list[dict[str, object]] = []
    document = fitz.open(stream=report_pdf, filetype="pdf")
    try:
        for index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = base64.b64encode(pixmap.tobytes("png")).decode("ascii")
            pages.append({"page": index, "image_url": f"data:image/png;base64,{image}"})
    finally:
        document.close()
    return pages


def build_pdf_filename(report: ExpenseReport) -> str:
    report_date = report.report_date.isoformat() if report.report_date else "未填日期"
    purpose = (report.purpose or "未填事由").strip() or "未填事由"
    amount = _money(report.total_amount)
    filename = f"{report_date}-{purpose}-￥{amount}.pdf"
    return ILLEGAL_FILENAME_CHARS.sub("_", filename)


def content_disposition_for_filename(filename: str) -> str:
    return f'attachment; filename="expense-report.pdf"; filename*=UTF-8\'\'{quote(filename)}'
