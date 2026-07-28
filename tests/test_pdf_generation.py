"""PDF generation, preview, download, and attachment merge tests."""

from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from backend.models.invoice import Invoice
from backend.models.settings import Settings
from backend.routers.reports import get_report_pdf, get_report_pdf_preview
from backend.schemas.report import ExpenseItemWrite, ReportCreate, ReportUpdate, TripWrite
from backend.services.amount_converter import amount_to_chinese_upper
from backend.services.pdf_generator import (
    ITEM_FILL_FONT_NAME,
    _other_expense_rows,
    _build_overlay,
    _item_label_font_candidates,
    _trip_values,
    build_merged_report_pdf,
    build_pdf_filename,
    build_report_pdf,
    ensure_pdf_exportable,
)
from backend.services.report_service import create_report, update_report


def write_blank_pdf(path: Path, pages: int = 1, pagesize: tuple[int, int] = (595, 298)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=pagesize)
    for page in range(pages):
        c.drawString(40, 260, f"page {page + 1}")
        c.showPage()
    c.save()


def configure_pdf_paths(monkeypatch, tmp_path: Path) -> Path:
    template = tmp_path / "backend" / "templates" / "expense_template.pdf"
    write_blank_pdf(template)
    monkeypatch.setattr("backend.services.pdf_generator.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("backend.services.pdf_generator.TEMPLATE_CANDIDATES", [template])
    return template


def add_confirmed_invoice(db, report, category: str, amount: str, index: int = 1, trip_id: int | None = None) -> None:
    db.add(
        Invoice(
            report_id=report.id,
            trip_id=trip_id,
            expense_category=category,
            file_path=f"uploads/{report.id}/{index}.pdf",
            file_type="pdf",
            amount=Decimal(amount),
            amount_confirmed=True,
        )
    )


def test_amount_to_chinese_upper_handles_common_currency_cases():
    assert amount_to_chinese_upper(Decimal("0")) == "零元整"
    assert amount_to_chinese_upper(Decimal("1.01")) == "壹元零壹分"
    assert amount_to_chinese_upper(Decimal("1001.10")) == "壹仟零壹元壹角"
    assert amount_to_chinese_upper(Decimal("100000001.02")) == "壹亿零壹元零贰分"


def test_amount_to_chinese_upper_rejects_negative_amount():
    with pytest.raises(HTTPException) as exc:
        amount_to_chinese_upper(Decimal("-0.01"))
    assert exc.value.status_code == 400


def test_report_pdf_paginates_trips(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            purpose="成都出差",
            trips=[
                TripWrite(sort_order=index, depart_month=6, depart_day=index, arrive_month=6, arrive_day=index)
                for index in range(1, 9)
            ],
        ),
    )

    pdf_bytes = build_report_pdf(report)
    reader = PdfReader(BytesIO(pdf_bytes))

    assert len(reader.pages) == 2
    assert "1/2" in (reader.pages[0].extract_text() or "")
    assert "2/2" in (reader.pages[1].extract_text() or "")


def test_other_expense_rows_skip_zero_amount_and_keep_dynamic_order(db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            expense_items=[ExpenseItemWrite(category="custom:宴请")],
        ),
    )
    add_confirmed_invoice(db, report, "luggage", "0.00", 1)
    add_confirmed_invoice(db, report, "city_transport", "12.00", 2)
    add_confirmed_invoice(db, report, "accommodation", "30.00", 3)
    add_confirmed_invoice(db, report, "custom:宴请", "20.00", 4)
    db.commit()
    db.refresh(report)

    rows = _other_expense_rows(report)

    assert [row.label for row in rows] == ["市内交通费", "住宿费", "宴请"]
    assert [row.amount for row in rows] == [Decimal("12.00"), Decimal("30.00"), Decimal("20.00")]


def test_other_expense_rows_use_fuel_subsidy_reimbursable_amount(db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
        ),
    )
    add_confirmed_invoice(db, report, "fuel_subsidy", "300.00", 1)
    db.commit()
    db.refresh(report)
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date="2026-06-04",
            expense_items=[ExpenseItemWrite(category="fuel_subsidy", reimbursable_amount=Decimal("180.00"))],
        ),
    )

    rows = _other_expense_rows(report)

    assert [(row.label, row.count, row.amount) for row in rows] == [("燃油补助", 1, Decimal("180.00"))]


def test_report_pdf_paginates_other_expenses_from_first_page(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            expense_items=[ExpenseItemWrite(category="custom:宴请")],
        ),
    )
    categories = [
        "luggage",
        "city_transport",
        "accommodation",
        "postal",
        "no_sleeper_subsidy",
        "toll",
        "fuel_subsidy",
        "custom:宴请",
    ]
    for index, category in enumerate(categories, start=1):
        add_confirmed_invoice(db, report, category, f"{index}.00", index)
    db.commit()
    db.refresh(report)

    pdf_bytes = build_report_pdf(report)

    assert [row.label for row in _other_expense_rows(report)] == [
        "行李费",
        "市内交通费",
        "住宿费",
        "邮电费",
        "未乘卧铺补助",
        "过路费",
        "燃油补助",
        "宴请",
    ]
    assert len(PdfReader(BytesIO(pdf_bytes)).pages) == 2


def test_pdf_export_rejects_unconfirmed_invoice(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="luggage",
            file_path="uploads/1/invoice.pdf",
            file_type="pdf",
            amount=Decimal("10.00"),
            amount_confirmed=False,
        )
    )
    db.commit()
    db.refresh(report)

    with pytest.raises(HTTPException) as exc:
        ensure_pdf_exportable(report)

    assert exc.value.status_code == 400
    assert "未确认发票" in exc.value.detail


def test_pdf_preview_allows_insufficient_fuel_subsidy_but_download_rejects_it(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    add_confirmed_invoice(db, report, "fuel_subsidy", "100.00")
    db.commit()
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date="2026-06-04",
            expense_items=[ExpenseItemWrite(category="fuel_subsidy", reimbursable_amount=Decimal("180.00"))],
        ),
    )
    monkeypatch.setattr(
        "backend.routers.reports.render_report_preview_pages",
        lambda _report, _fill_font_key: [{"page": 1, "image_url": "data:image/png;base64,abc"}],
    )

    preview = get_report_pdf_preview(report.id, db)
    assert preview.data.pages[0].page == 1

    with pytest.raises(HTTPException, match="发票金额不足"):
        get_report_pdf(report.id, db)
    db.refresh(report)
    assert report.status == "draft"


def test_merged_pdf_appends_all_invoice_pdf_pages(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    invoice_path = tmp_path / "backend" / "uploads" / "1" / "invoice.pdf"
    write_blank_pdf(invoice_path, pages=2, pagesize=(333, 444))
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="luggage",
            file_path="uploads/1/invoice.pdf",
            file_type="pdf",
            amount=Decimal("10.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    pdf_bytes = build_merged_report_pdf(report)

    reader = PdfReader(BytesIO(pdf_bytes))
    assert len(reader.pages) == 3
    assert float(reader.pages[1].mediabox.width) == 333
    assert float(reader.pages[1].mediabox.height) == 444


def test_merged_pdf_appends_vat_special_invoice_pdf_twice(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    invoice_path = tmp_path / "backend" / "uploads" / "1" / "special.pdf"
    write_blank_pdf(invoice_path, pages=2, pagesize=(333, 444))
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="luggage",
            file_path="uploads/1/special.pdf",
            file_type="pdf",
            invoice_type="vat_special",
            amount=Decimal("10.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    pdf_bytes = build_merged_report_pdf(report)

    reader = PdfReader(BytesIO(pdf_bytes))
    assert len(reader.pages) == 5
    assert float(reader.pages[1].mediabox.width) == 333
    assert float(reader.pages[4].mediabox.height) == 444


def test_merged_pdf_respects_disabled_vat_special_double_print(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    invoice_path = tmp_path / "backend" / "uploads" / "1" / "special.pdf"
    write_blank_pdf(invoice_path, pages=2, pagesize=(333, 444))
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="luggage",
            file_path="uploads/1/special.pdf",
            file_type="pdf",
            invoice_type="vat_special",
            amount=Decimal("10.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    pdf_bytes = build_merged_report_pdf(report, double_print_vat_special_invoices=False)

    assert len(PdfReader(BytesIO(pdf_bytes)).pages) == 3


def test_download_route_preserves_draft_status_and_report_date(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    captured = {}

    def build_pdf(report_arg, _fill_font_key, _double_print_vat_special_invoices):
        captured["report_date"] = report_arg.report_date
        return b"%PDF-1.4\n%%EOF"

    monkeypatch.setattr("backend.routers.reports.build_merged_report_pdf", build_pdf)

    response = get_report_pdf(report.id, db)

    db.refresh(report)
    assert response.media_type == "application/pdf"
    assert report.status == "draft"
    assert report.report_date == date(2026, 6, 4)
    assert captured["report_date"] == date(2026, 6, 4)
    assert "2026-06-04" in response.headers["Content-Disposition"]


def test_download_route_preserves_printed_report_date(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    report.status = "printed"
    db.commit()
    db.refresh(report)
    captured = {}

    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 24)

    def build_pdf(report_arg, _fill_font_key, _double_print_vat_special_invoices):
        captured["report_date"] = report_arg.report_date
        return b"%PDF-1.4\n%%EOF"

    monkeypatch.setattr("backend.routers.reports.date", FixedDate)
    monkeypatch.setattr("backend.routers.reports.build_merged_report_pdf", build_pdf)

    response = get_report_pdf(report.id, db)

    db.refresh(report)
    assert response.media_type == "application/pdf"
    assert report.status == "printed"
    assert report.report_date == date(2026, 6, 4)
    assert captured["report_date"] == date(2026, 6, 4)
    assert "2026-06-04" in response.headers["Content-Disposition"]


def test_preview_route_preserves_draft_status_and_report_date(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    captured = {}

    def render_pages(report_arg, _fill_font_key):
        captured["report_date"] = report_arg.report_date
        return [{"page": 1, "image_url": "data:image/png;base64,abc"}]

    monkeypatch.setattr("backend.routers.reports.render_report_preview_pages", render_pages)

    response = get_report_pdf_preview(report.id, db)

    db.refresh(report)
    assert response.data.pages[0].page == 1
    assert report.status == "draft"
    assert report.report_date == date(2026, 6, 4)
    assert captured["report_date"] == date(2026, 6, 4)


def test_preview_route_preserves_printed_report_date(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    report.status = "printed"
    db.commit()
    db.refresh(report)
    captured = {}

    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 24)

    def render_pages(report_arg, _fill_font_key):
        captured["report_date"] = report_arg.report_date
        return [{"page": 1, "image_url": "data:image/png;base64,abc"}]

    monkeypatch.setattr("backend.routers.reports.date", FixedDate)
    monkeypatch.setattr("backend.routers.reports.render_report_preview_pages", render_pages)

    response = get_report_pdf_preview(report.id, db)

    db.refresh(report)
    assert response.data.pages[0].page == 1
    assert report.status == "printed"
    assert report.report_date == date(2026, 6, 4)
    assert captured["report_date"] == date(2026, 6, 4)


@pytest.mark.parametrize("report_status", ["checked", "reimbursed"])
def test_pdf_routes_allow_non_draft_workflow_statuses_without_mutation(monkeypatch, db, report_status):
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    report.status = report_status
    db.commit()
    db.refresh(report)

    monkeypatch.setattr(
        "backend.routers.reports.render_report_preview_pages",
        lambda _report, _fill_font_key: [{"page": 1, "image_url": "data:image/png;base64,abc"}],
    )
    monkeypatch.setattr(
        "backend.routers.reports.build_merged_report_pdf",
        lambda _report, _fill_font_key, _double_print_vat_special_invoices: b"%PDF-1.4\n%%EOF",
    )

    preview = get_report_pdf_preview(report.id, db)
    download = get_report_pdf(report.id, db)

    db.refresh(report)
    assert preview.data.pages[0].page == 1
    assert download.media_type == "application/pdf"
    assert report.status == report_status
    assert report.report_date == date(2026, 6, 4)


def test_download_route_uses_vat_special_double_print_setting(monkeypatch, db):
    db.add(
        Settings(
            id=1,
            daily_subsidy=Decimal("80.00"),
            pdf_fill_font_key="system:simsun",
            double_print_vat_special_invoices=False,
        )
    )
    db.commit()
    report = create_report(db, ReportCreate(report_date="2026-06-04", purpose="成都出差"))
    calls = {}

    def build_pdf(_report, fill_font_key, double_print_vat_special_invoices):
        calls["fill_font_key"] = fill_font_key
        calls["double_print_vat_special_invoices"] = double_print_vat_special_invoices
        return b"%PDF-1.4\n%%EOF"

    monkeypatch.setattr("backend.routers.reports.build_merged_report_pdf", build_pdf)

    get_report_pdf(report.id, db)

    assert calls == {
        "fill_font_key": "system:simsun",
        "double_print_vat_special_invoices": False,
    }


def test_pdf_filename_uses_report_date_purpose_and_total(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(report_date="2026-06-04", purpose='成:都/出"差', daily_subsidy=Decimal("10.00")),
    )

    assert build_pdf_filename(report) == "2026-06-04-成_都_出_差-￥0.00.pdf"


def test_overlay_applies_configured_font_only_to_regular_fields(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            department="研发部",
            expense_items=[ExpenseItemWrite(category="custom:宴请")],
        ),
    )
    rows = [
        type(
            "ExpenseRowStub",
            (),
            {"category": "custom:宴请", "label": "宴请", "count": 1, "amount": Decimal("20.00")},
        )()
    ]
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, field.font_name, field.font_size, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, [], rows, rows, True, (595, 298), "1/2", fill_font_name="CustomFill")

    fonts_by_field = {name: font_name for name, font_name, _font_size, _value in calls}
    font_sizes_by_field = {name: font_size for name, _font_name, font_size, _value in calls}
    assert fonts_by_field["department"] == "CustomFill"
    assert fonts_by_field["total_amount"] == "CustomFill"
    assert fonts_by_field["custom:宴请_label"] == ITEM_FILL_FONT_NAME
    assert font_sizes_by_field["custom:宴请_label"] == 9.7
    assert fonts_by_field["page_label"] is None


def test_item_label_font_candidates_prefer_configured_kaiti(monkeypatch, tmp_path):
    deployed_kaiti = tmp_path / "fonts" / "simkai.ttf"
    deployed_kaiti.parent.mkdir()
    deployed_kaiti.write_bytes(b"not a real font")
    monkeypatch.setattr("backend.services.pdf_generator.resolve_font_file", lambda key: deployed_kaiti if key == "system:simkai" else None)

    candidates = _item_label_font_candidates()

    assert candidates[0] == deployed_kaiti
    assert Path("C:/Windows/Fonts/simkai.ttf") in candidates


def test_trip_values_fill_zero_when_trip_has_no_transport_invoice(db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )

    values = _trip_values(report.trips[0])

    assert values["invoice_count"] == 0
    assert values["transport_fare"] == "0"


def test_trip_values_keep_actual_transport_invoice_values(db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )
    add_confirmed_invoice(db, report, "transport_fare", "18.50", 1, trip_id=report.trips[0].id)
    db.commit()
    db.refresh(report)

    values = _trip_values(report.trips[0])

    assert values["invoice_count"] == 1
    assert values["transport_fare"] == "18.50"


def test_pdf_values_include_paper_invoices_without_attachment_pages(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=6,
                    depart_day=4,
                    arrive_month=6,
                    arrive_day=4,
                    paper_invoice_amount=Decimal("18.50"),
                    paper_invoice_count=1,
                )
            ],
            expense_items=[ExpenseItemWrite(category="luggage", paper_invoice_amount=Decimal("20.00"), paper_invoice_count=2)],
        ),
    )
    rows = _other_expense_rows(report)
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)
    _build_overlay(report, list(report.trips), rows, rows, True, (595, 298), fill_font_name="CustomFill")

    values = _trip_values(report.trips[0])
    values_by_field = {name: value for name, value in calls}
    assert values["invoice_count"] == 1
    assert values["transport_fare"] == "18.50"
    assert [(row.category, row.count, row.amount) for row in rows] == [("luggage", 2, Decimal("20.00"))]
    assert values_by_field["total_invoice_count"] == 1
    assert values_by_field["total_transport_fare"] == "18.50"
    assert values_by_field["total_other_count"] == 2
    assert values_by_field["total_other_amount"] == "20.00"


def test_overlay_total_invoice_count_only_counts_transport_invoices(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )
    add_confirmed_invoice(db, report, "transport_fare", "18.50", 1, trip_id=report.trips[0].id)
    add_confirmed_invoice(db, report, "luggage", "10.00", 2)
    add_confirmed_invoice(db, report, "luggage", "20.00", 3)
    add_confirmed_invoice(db, report, "luggage", "30.00", 4)
    db.commit()
    db.refresh(report)
    rows = _other_expense_rows(report)
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, list(report.trips), rows, rows, True, (595, 298), fill_font_name="CustomFill")

    values_by_field = {name: value for name, value in calls}
    assert values_by_field["total_invoice_count"] == 1
    assert values_by_field["total_transport_fare"] == "18.50"
    assert values_by_field["total_other_count"] == 3
    assert values_by_field["total_other_amount"] == "60.00"


def test_overlay_keeps_automatic_subsidy_days_and_amount(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            daily_subsidy=Decimal("80.00"),
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, [], [], [], True, (595, 298), fill_font_name="CustomFill")

    values_by_field = {name: value for name, value in calls}
    assert report.manual_subsidy_total is None
    assert values_by_field["subsidy_days"] == "1天"
    assert values_by_field["subsidy_amount"] == "80.00"


@pytest.mark.parametrize("manual_total", [Decimal("35.50"), Decimal("0.00")])
def test_overlay_hides_days_and_uses_final_total_for_manual_subsidy(
    monkeypatch, db, manual_total
):
    report = create_report(db, ReportCreate(report_date="2026-06-04"))
    report.manual_subsidy_total = manual_total
    report.subsidy_days = 3
    report.subsidy_total = manual_total
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, [], [], [], True, (595, 298), fill_font_name="CustomFill")

    values_by_field = {name: value for name, value in calls}
    assert values_by_field["subsidy_days"] == ""
    assert values_by_field["subsidy_amount"] == f"{manual_total:.2f}"


def test_overlay_leaves_shortfall_and_surplus_blank_without_advance(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            daily_subsidy=Decimal("80.00"),
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, [], [], [], True, (595, 298), fill_font_name="CustomFill")

    values_by_field = {name: value for name, value in calls}
    assert report.shortfall == Decimal("80.00")
    assert values_by_field["shortfall"] == ""
    assert values_by_field["surplus"] == ""


def test_overlay_fills_shortfall_when_advance_exists(monkeypatch, db):
    report = create_report(
        db,
        ReportCreate(
            report_date="2026-06-04",
            daily_subsidy=Decimal("80.00"),
            advance_amount=Decimal("50.00"),
            trips=[TripWrite(sort_order=1, depart_month=6, depart_day=4, arrive_month=6, arrive_day=4)],
        ),
    )
    calls = []

    def record_draw(_canvas, field, value):
        calls.append((field.name, value))

    monkeypatch.setattr("backend.services.pdf_generator._draw_field", record_draw)

    _build_overlay(report, [], [], [], True, (595, 298), fill_font_name="CustomFill")

    values_by_field = {name: value for name, value in calls}
    assert values_by_field["shortfall"] == "30.00"
    assert values_by_field["surplus"] == ""
