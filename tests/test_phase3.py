from datetime import date
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from backend.models.trip import Trip
from backend.schemas.report import ReportCreate, TripWrite
from backend.services.invoice_parser import parse_ofd_invoice, parse_pdf_invoice, parse_xml_invoice
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
