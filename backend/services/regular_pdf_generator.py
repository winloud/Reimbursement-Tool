from __future__ import annotations

import copy
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, status
from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from backend.models.report import ExpenseReport
from backend.runtime_paths import resource_path
from backend.services.amount_converter import amount_to_chinese_upper, quantize_currency
from backend.services.pdf_generator import (
    MIN_FIELD_FONT_SIZE,
    PT_PER_MM,
    TextField,
    _draw_field,
    _fill_field,
)


REGULAR_TEMPLATE_CANDIDATES = [
    resource_path("backend", "templates", "regular_expense_template.pdf"),
    resource_path("backend", "templates", "常规报销单.pdf"),
]
REGULAR_TEMPLATE_BLOCKER = "常规报销单正式 PDF 模板尚未提供，请提供完整空白扫描件并完成坐标校准"
REGULAR_ITEMS_PER_PAGE = 4

# Logical field mapping calibrated against the formal blank scan at its original
# physical size. The comparison source is cropped to the visible top 105.13 mm
# without scaling; these millimetre coordinates use the same lower-left origin
# as the runtime overlay.
REGULAR_TEMPLATE_FIELDS = {
    "report_date_year": (94.348916, 87.150390, 9.166062, 4.231724),
    "report_date_month": (110.565796, 87.150390, 7.050817, 4.231724),
    "report_date_day": (125.372512, 87.150390, 7.050817, 4.231724),
    "attachment_count": (201.239304, 58.863146, 5.499637, 8.181334),
    "total_amount_cn": (56.106413, 30.510592, 81.252488, 7.899219),
    "claimant_name": (144.287316, 12.737349, 29.350718, 6.347587),
}
REGULAR_ROW_FIELDS = {
    "occurred_month": (21.866517, 8.460981),
    "occurred_day": (30.327497, 9.448095),
    "description": (39.775592, 82.494560),
    "document_count": (122.552185, 15.229765),
    "remark": (177.125509, 23.408713),
}
REGULAR_ROW_RECTS_MM = (
    (64.787560, 8.322391),
    (56.465169, 8.604506),
    (47.860662, 8.463449),
    (39.397213, 8.604506),
)
REGULAR_AMOUNT_GRID_RECTS_MM = (
    (138.063983, 4.230490),
    (142.294473, 4.230490),
    (146.524963, 4.512523),
    (151.037486, 4.089474),
    (155.126960, 4.371507),
    (159.498467, 4.371507),
    (163.869973, 4.089474),
    (167.959447, 4.230490),
    (172.189937, 4.371507),
)
REGULAR_TOTAL_ROW_TOP_MM = 30.792707
REGULAR_TOTAL_ROW_HEIGHT_MM = 8.463449
REGULAR_TEXT_FIELD_EXTRA_INSET_MM = 1.5

# These fields intentionally have no writable mapping. The paper form keeps
# them blank for handwritten approval/signature steps.
REGULAR_HANDWRITTEN_FIELDS = (
    "supervisor_opinion",
    "claimant_signature",
    "reviewer_signature",
    "cashier_signature",
)


def get_regular_template_path() -> Path:
    for path in REGULAR_TEMPLATE_CANDIDATES:
        if path.exists():
            return path
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=REGULAR_TEMPLATE_BLOCKER)


def ensure_regular_template_available() -> None:
    get_regular_template_path()


def _chunks(items: list[object], size: int) -> list[list[object]]:
    return [items[index : index + size] for index in range(0, len(items), size)] or [[]]


def _active_item_invoices(report: ExpenseReport, item_id: int | None) -> list[object]:
    return [
        invoice
        for invoice in report.invoices
        if invoice.deleted_at is None and invoice.regular_item_id == item_id
    ]


def _active_item_attachments(report: ExpenseReport, item_id: int | None) -> list[object]:
    return [
        attachment
        for attachment in report.attachments
        if attachment.deleted_at is None and attachment.regular_item_id == item_id
    ]


def regular_item_document_count(report: ExpenseReport, item: object) -> int:
    if report.regular_mode == "invoice":
        return len(_active_item_invoices(report, item.id))
    return sum(max(int(attachment.page_count or 1), 1) for attachment in _active_item_attachments(report, item.id))


def regular_report_document_count(report: ExpenseReport) -> int:
    return sum(regular_item_document_count(report, item) for item in report.regular_items)


def _money_grid_digits(value: Decimal | int | str | None) -> list[str]:
    amount = quantize_currency(Decimal(value or "0.00"))
    compact = f"{amount:.2f}".replace(".", "")
    if len(compact) > len(REGULAR_AMOUNT_GRID_RECTS_MM):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销金额超出 PDF 金额格容量")
    values = [""] * (len(REGULAR_AMOUNT_GRID_RECTS_MM) - len(compact)) + list(compact)
    currency_index = len(REGULAR_AMOUNT_GRID_RECTS_MM) - len(compact) - 1
    if currency_index >= 0:
        values[currency_index] = "￥"
    return values


def _fit_single_line(value: object, width_mm: float, font_name: str) -> str:
    text = "" if value is None else str(value)
    if not text:
        return ""
    available_width = max(width_mm * PT_PER_MM - 3, 1)
    try:
        if pdfmetrics.stringWidth(text, font_name, MIN_FIELD_FONT_SIZE) <= available_width:
            return text
        suffix = "..."
        while text and pdfmetrics.stringWidth(f"{text}{suffix}", font_name, MIN_FIELD_FONT_SIZE) > available_width:
            text = text[:-1]
        return f"{text}{suffix}" if text else suffix
    except Exception:
        # The runtime registers the selected fill font before rendering. Keeping
        # the original text here makes isolated calibration probes resilient to
        # a deliberately mocked or not-yet-registered font name.
        return text


def _draw_money_grid(
    c: canvas.Canvas,
    name: str,
    value: Decimal | int | str | None,
    top_mm: float,
    height_mm: float,
    fill_font_name: str,
) -> None:
    for index, ((x_mm, width_mm), digit) in enumerate(
        zip(REGULAR_AMOUNT_GRID_RECTS_MM, _money_grid_digits(value), strict=True)
    ):
        _draw_field(
            c,
            _fill_field(
                f"{name}_{index}",
                x_mm,
                top_mm,
                width_mm,
                height_mm,
                fill_font_name,
                8,
            ),
            digit,
        )


def _draw_logical_field(
    c: canvas.Canvas,
    name: str,
    value: object,
    fill_font_name: str,
    *,
    font_size: float = 8,
    align: str = "center",
) -> None:
    x_mm, y_mm, width_mm, height_mm = REGULAR_TEMPLATE_FIELDS[name]
    _draw_field(
        c,
        _fill_field(name, x_mm, y_mm, width_mm, height_mm, fill_font_name, font_size, align),
        value,
    )


def _draw_regular_row(
    c: canvas.Canvas,
    report: ExpenseReport,
    item: object,
    row_index: int,
    fill_font_name: str,
) -> None:
    top_mm, height_mm = REGULAR_ROW_RECTS_MM[row_index]
    occurred_on = item.occurred_on
    values = {
        "occurred_month": occurred_on.month if occurred_on else "",
        "occurred_day": occurred_on.day if occurred_on else "",
        "description": item.description or "",
        "document_count": regular_item_document_count(report, item),
        "remark": item.remark or "",
    }
    for name, (x_mm, width_mm) in REGULAR_ROW_FIELDS.items():
        value = values[name]
        if name in {"description", "remark"}:
            x_mm += REGULAR_TEXT_FIELD_EXTRA_INSET_MM
            width_mm -= REGULAR_TEXT_FIELD_EXTRA_INSET_MM * 2
            value = _fit_single_line(value, width_mm, fill_font_name)
        _draw_field(
            c,
            _fill_field(
                f"item_{item.id}_{name}",
                x_mm,
                top_mm,
                width_mm,
                height_mm,
                fill_font_name,
                8,
                "left" if name in {"description", "remark"} else "center",
            ),
            value,
        )
    _draw_money_grid(
        c,
        f"item_{item.id}_amount",
        item.amount,
        top_mm,
        height_mm,
        fill_font_name,
    )


def _build_regular_overlay(
    report: ExpenseReport,
    items: list[object],
    *,
    is_last_page: bool,
    page_size: tuple[float, float],
    fill_font_name: str,
) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=page_size)
    report_date = report.report_date
    _draw_logical_field(c, "report_date_year", report_date.year if report_date else "", fill_font_name)
    _draw_logical_field(c, "report_date_month", report_date.month if report_date else "", fill_font_name)
    _draw_logical_field(c, "report_date_day", report_date.day if report_date else "", fill_font_name)
    _draw_logical_field(c, "attachment_count", regular_report_document_count(report), fill_font_name)
    _draw_logical_field(c, "claimant_name", report.employee_name or "", fill_font_name, font_size=9)

    for row_index, item in enumerate(items):
        _draw_regular_row(c, report, item, row_index, fill_font_name)

    if is_last_page:
        _draw_logical_field(
            c,
            "total_amount_cn",
            amount_to_chinese_upper(report.total_amount),
            fill_font_name,
            font_size=9,
            align="left",
        )
        _draw_money_grid(
            c,
            "total_amount",
            report.total_amount,
            REGULAR_TOTAL_ROW_TOP_MM,
            REGULAR_TOTAL_ROW_HEIGHT_MM,
            fill_font_name,
        )

    c.save()
    return buffer.getvalue()


def build_regular_report_pdf(report: ExpenseReport, fill_font_name: str) -> bytes:
    template_path = get_regular_template_path()
    template_page = PdfReader(str(template_path)).pages[0]
    page_size = (float(template_page.mediabox.width), float(template_page.mediabox.height))
    items = sorted(report.regular_items, key=lambda item: (item.sort_order, item.id or 0))
    item_pages = _chunks(items, REGULAR_ITEMS_PER_PAGE)
    page_count = len(item_pages)
    writer = PdfWriter()

    for page_index, page_items in enumerate(item_pages):
        page = copy.deepcopy(PdfReader(str(template_path)).pages[0])
        overlay = _build_regular_overlay(
            report,
            page_items,
            is_last_page=page_index == page_count - 1,
            page_size=page_size,
            fill_font_name=fill_font_name,
        )
        page.merge_page(PdfReader(BytesIO(overlay)).pages[0])
        writer.add_page(page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()
