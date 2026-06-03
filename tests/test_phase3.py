from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from backend.models.invoice import Invoice
from backend.models.trip import Trip
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.schemas.report import ReportCreate, TripWrite
from backend.services.invoice_parser import parse_ofd_invoice, parse_pdf_invoice, parse_xml_invoice
from backend.services.invoice_service import update_invoice, upload_invoice
from backend.services.report_service import calculate_subsidy_days, create_report


def test_parse_xml_invoice_reads_amount_and_metadata(tmp_path: Path):
    xml_path = tmp_path / "invoice.xml"
    xml_path.write_text(
        """
        <Invoice>
          <FPH>12345678</FPH>
          <KPRQ>2026-05-30</KPRQ>
          <JSHJ>388.80</JSHJ>
          <XFMC>供应商</XFMC>
          <GFMC>购买方</GFMC>
        </Invoice>
        """,
        encoding="utf-8",
    )

    parsed = parse_xml_invoice(xml_path)

    assert parsed.invoice_no == "12345678"
    assert parsed.invoice_date == date(2026, 5, 30)
    assert parsed.amount == Decimal("388.80")
    assert parsed.seller_name == "供应商"
    assert parsed.buyer_name == "购买方"


def test_parse_pdf_invoice_reads_text_amount_and_number(monkeypatch, tmp_path: Path):
    class FakePage:
        def extract_text(self):
            return "发票号码: 987654321\n开票日期: 2026年5月31日\n价税合计（小写） ￥266.50"

    class FakeReader:
        def __init__(self, _path):
            self.pages = [FakePage()]

    monkeypatch.setattr("backend.services.invoice_parser.PdfReader", FakeReader)

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "987654321"
    assert parsed.invoice_date == date(2026, 5, 31)
    assert parsed.amount == Decimal("266.50")


def test_parse_ofd_invoice_finds_embedded_xml(tmp_path: Path):
    ofd_path = tmp_path / "invoice.ofd"
    with ZipFile(ofd_path, "w") as archive:
        archive.writestr(
            "Doc_0/Pages/invoice.xml",
            """
            <Invoice>
              <InvoiceNo>OFD20260531</InvoiceNo>
              <IssueDate>20260531</IssueDate>
              <TotalAmount>99.01</TotalAmount>
            </Invoice>
            """,
        )

    parsed = parse_ofd_invoice(ofd_path)

    assert parsed.invoice_no == "OFD20260531"
    assert parsed.invoice_date == date(2026, 5, 31)
    assert parsed.amount == Decimal("99.01")
    assert parsed.raw["source"] == "ofd"


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
        lambda _upload_file, report_id, _file_type: f"uploads/{report_id}/invoice_test.pdf",
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
        lambda _upload_file, report_id, _file_type: f"uploads/{report_id}/invoice_test.pdf",
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
