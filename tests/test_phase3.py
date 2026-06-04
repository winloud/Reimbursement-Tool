from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from backend.models.invoice import Invoice
from backend.models.trip import Trip
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.schemas.report import ReportCreate, TripWrite
from backend.services.invoice_parser import parse_pdf_invoice, parse_qr_payload
from backend.services.invoice_service import detect_file_type, save_upload_file, update_invoice, upload_invoice
from backend.services.report_service import calculate_subsidy_days, create_report


def test_parse_pdf_invoice_reads_text_amount_number_and_date(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "发票号码: 987654321\n开票日期: 2026年5月31日\n价税合计（小写） ￥266.50",
            "preview_image": "data:image/png;base64,abc",
            "image_bgr": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", lambda _image: [])

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "987654321"
    assert parsed.invoice_date == date(2026, 5, 31)
    assert parsed.amount == Decimal("266.50")
    assert parsed.preview_image == "data:image/png;base64,abc"
    assert parsed.raw["parse_method"] == "text_regex"
    assert parsed.raw["parse_success"] is True
    assert parsed.raw["amount_source"] == "tax_total_small"


def test_parse_pdf_invoice_cross_validates_uppercase_amount(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "\n".join(
                [
                    "发票号码：1234567890",
                    "开票日期：2026-06-03",
                    "价税合计（大写）人民币贰佰陆拾陆元伍角",
                    "价税合计（小写）¥266.50",
                ]
            ),
            "preview_image": None,
            "image_bgr": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", lambda _image: [])

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.amount == Decimal("266.50")
    assert parsed.raw["amount_uppercase"] == "266.50"
    assert parsed.raw["amount_validation"] == "matched"


def test_parse_pdf_invoice_prefers_qr_payload(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "发票号码：11111111\n开票日期：2026年5月31日\n价税合计（小写）¥1.00",
            "preview_image": None,
            "image_bgr": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr(
        "backend.services.invoice_parser.decode_qr_payloads_from_image",
        lambda _image: ["发票号码：9876543210，开票日期：20260603，价税合计（小写）¥388.80"],
    )

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "9876543210"
    assert parsed.invoice_date == date(2026, 6, 3)
    assert parsed.amount == Decimal("388.80")
    assert parsed.raw["parse_method"] == "qrcode"
    assert parsed.raw["qr_payloads"]


def test_parse_qr_payload_supports_comma_separated_invoice_tokens():
    parsed = parse_qr_payload("01,10,044001800111,28104068,181.52,20260603,checksum")

    assert parsed["invoice_no"] == "28104068"
    assert parsed["invoice_date"] == date(2026, 6, 3)
    assert parsed["amount"] == Decimal("181.52")


def test_invoice_upload_rejects_xml_and_ofd():
    with pytest.raises(HTTPException) as xml_error:
        detect_file_type("invoice.xml")
    with pytest.raises(HTTPException) as ofd_error:
        detect_file_type("invoice.ofd")

    assert xml_error.value.status_code == 400
    assert ofd_error.value.status_code == 400
    assert "PDF" in xml_error.value.detail


def test_save_upload_file_uses_expense_category_prefix(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("backend.services.invoice_service.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "backend" / "uploads")
    upload = UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4"))

    relative_path = save_upload_file(upload, report_id=9, expense_category="luggage", file_type="pdf")

    assert relative_path.startswith("uploads/9/luggage_invoice_")
    assert relative_path.endswith(".pdf")
    assert (tmp_path / "backend" / relative_path).exists()


def test_calculate_subsidy_days_across_month():
    trips = [
        Trip(depart_month=5, depart_day=30, arrive_month=6, arrive_day=2, sort_order=1),
    ]

    assert calculate_subsidy_days(2026, trips) == 4


def test_calculate_subsidy_days_across_year():
    trips = [
        Trip(depart_month=12, depart_day=30, arrive_month=1, arrive_day=2, sort_order=1),
    ]

    assert calculate_subsidy_days(2026, trips) == 4


def test_report_recalculation_uses_cross_month_trip_days(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 31),
            daily_subsidy=Decimal("120.00"),
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=5,
                    depart_day=31,
                    arrive_month=6,
                    arrive_day=2,
                )
            ],
        ),
    )

    assert report.subsidy_days == 3
    assert report.subsidy_total == Decimal("360.00")


def test_upload_invoice_requires_manual_amount_confirmation(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    parsed_amount = Decimal("266.50")

    monkeypatch.setattr(
        "backend.services.invoice_service.save_upload_file",
        lambda _upload_file, report_id, _expense_category, _file_type: f"uploads/{report_id}/invoice_test.pdf",
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="987654321", amount=parsed_amount),
    )

    invoice, parsed = upload_invoice(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4")),
    )

    assert parsed.amount == parsed_amount
    assert invoice.amount == parsed_amount
    assert invoice.amount_confirmed is False
    db.refresh(report)
    assert report.total_amount == Decimal("0.00")


def test_confirming_invoice_updates_report_totals(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    monkeypatch.setattr(
        "backend.services.invoice_service.save_upload_file",
        lambda _upload_file, report_id, _expense_category, _file_type: f"uploads/{report_id}/invoice_test.pdf",
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="987654321", amount=Decimal("266.50")),
    )

    invoice, _ = upload_invoice(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4")),
    )

    confirmed = update_invoice(
        db,
        invoice.id,
        InvoiceUpdate(amount=Decimal("266.50"), amount_confirmed=True),
    )
    db.refresh(report)

    assert confirmed.amount_confirmed is True
    assert confirmed.amount == Decimal("266.50")
    assert report.total_amount == Decimal("266.50")
    assert report.shortfall == Decimal("266.50")


def test_upload_invoice_rejects_duplicate_file_in_same_report(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr("backend.services.invoice_service.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(amount=Decimal("10.00")),
    )
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    upload_invoice(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="invoice-a.pdf", file=BytesIO(b"same invoice bytes")),
    )

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=report.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="invoice-b.pdf", file=BytesIO(b"same invoice bytes")),
        )

    assert exc_info.value.status_code == 409
    assert "该发票文件已在本报销单中上传" in exc_info.value.detail
    with pytest.raises(HTTPException) as unsupported_error:
        upload_invoice(
            db,
            report_id=report.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="invoice.xml", file=BytesIO(b"same invoice bytes")),
        )
    assert unsupported_error.value.status_code == 400

    active_invoices = db.scalars(
        select(Invoice).where(Invoice.report_id == report.id, Invoice.deleted_at.is_(None)),
    ).all()
    assert len(active_invoices) == 1


def test_upload_invoice_rejects_duplicate_invoice_number_in_same_report(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr("backend.services.invoice_service.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="DUP-20260603", amount=Decimal("10.00")),
    )
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    upload_invoice(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="invoice-a.pdf", file=BytesIO(b"invoice bytes a")),
    )

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=report.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="invoice-b.pdf", file=BytesIO(b"invoice bytes b")),
        )

    assert exc_info.value.status_code == 409
    assert "识别到相同发票号 DUP-20260603" in exc_info.value.detail
    active_invoices = db.scalars(
        select(Invoice).where(Invoice.report_id == report.id, Invoice.deleted_at.is_(None)),
    ).all()
    assert len(active_invoices) == 1
