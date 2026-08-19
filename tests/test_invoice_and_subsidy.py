"""Invoice parsing, upload, duplicate detection, and subsidy integration tests."""

from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from backend.models.invoice import Invoice
from backend.models.trip import Trip
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.schemas.report import ReportCreate, ReportUpdate, TripWrite
from backend.services import invoice_parser
from backend.services.invoice_parser import parse_pdf_invoice, parse_qr_payload
from backend.services.invoice_service import (
    detect_file_type,
    safe_category_filename_prefix,
    save_upload_file,
    soft_delete_invoice,
    update_invoice,
    upload_invoice,
    upload_invoices,
)
from backend.services import report_service
from backend.services.report_service import (
    TripDateError,
    calculate_subsidy_days,
    create_report,
    delete_expense_item,
    infer_trip_date_ranges,
    update_report,
    update_report_status,
)


def test_parse_pdf_invoice_reads_text_amount_number_and_date(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "发票号码: 987654321\n开票日期: 2026年5月31日\n价税合计（小写） ￥266.50",
            "preview_image": "data:image/png;base64,abc",
            "qr_image": object(),
            "page_size": {"width": 300, "height": 200},
            "words": [
                {"x0": 40, "y0": 150, "x1": 95, "y1": 162, "text": "价税合计"},
                {"x0": 100, "y0": 150, "x1": 135, "y1": 162, "text": "（小写）"},
                {"x0": 140, "y0": 150, "x1": 190, "y1": 162, "text": "￥266.50"},
            ],
            "render_error": None,
        },
    )
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", lambda _image: [])

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "987654321"
    assert parsed.invoice_date == date(2026, 5, 31)
    assert parsed.invoice_type == "normal"
    assert parsed.amount == Decimal("266.50")
    assert parsed.preview_image == "data:image/png;base64,abc"
    assert parsed.raw["parse_method"] == "text_regex"
    assert parsed.raw["parse_success"] is True
    assert parsed.raw["amount_source"] == "tax_total_small"
    assert parsed.raw["preview_highlights"][0]["type"] == "tax_total_amount"
    assert parsed.raw["preview_highlights"][0]["amount"] == "266.50"


def test_parse_image_invoice_reads_qr_payload(monkeypatch, tmp_path: Path):
    from PIL import Image

    image_path = tmp_path / "invoice.png"
    Image.new("RGB", (120, 80), color="white").save(image_path)

    def fake_decode(_image, include_details=False, engine="zxing"):
        payloads = ["01,10,044001800111,28104068,181.52,20260603,checksum"]
        details = [{"method": f"{engine}_qrcode", "success": True, "result": {"payloads": payloads}}]
        return (payloads, details) if include_details else payloads

    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", fake_decode)

    parsed = invoice_parser.parse_image_invoice(image_path)

    assert parsed.invoice_no == "28104068"
    assert parsed.invoice_date == date(2026, 6, 3)
    assert parsed.amount == Decimal("181.52")
    assert parsed.preview_image.startswith("data:image/png;base64,")
    assert parsed.raw["source"] == "image"
    assert parsed.raw["parse_method"] == "qrcode"


def test_parse_pdf_invoice_pages_returns_successful_pages(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("backend.services.invoice_parser.pdf_page_count", lambda _path: 2)

    def fake_artifacts(_path, zoom=2, page_index=0):
        invoice_no = "10000001" if page_index == 0 else "10000002"
        amount = "88.00" if page_index == 0 else "99.00"
        return {
            "text": f"发票号码: {invoice_no}\n开票日期: 2026年6月{page_index + 1}日\n价税合计（小写） ￥{amount}",
            "preview_image": "data:image/png;base64,abc",
            "qr_image": object(),
            "page_index": page_index,
            "page_number": page_index + 1,
            "page_count": 2,
            "render_error": None,
        }

    monkeypatch.setattr("backend.services.invoice_parser.extract_pdf_page_artifacts", fake_artifacts)
    monkeypatch.setattr(
        "backend.services.invoice_parser.decode_qr_payloads_from_image",
        lambda _image, include_details=False, engine="zxing": ([], []) if include_details else [],
    )

    parsed_pages = invoice_parser.parse_pdf_invoice_pages(tmp_path / "multi.pdf")

    assert [item.invoice_no for item in parsed_pages] == ["10000001", "10000002"]
    assert [item.amount for item in parsed_pages] == [Decimal("88.00"), Decimal("99.00")]
    assert [item.raw["page_number"] for item in parsed_pages] == [1, 2]


def test_parse_pdf_invoice_detects_vat_special_invoice(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "增值税专用发票\n发票号码: 12345678\n开票日期: 2026年6月8日\n价税合计（小写） ￥128.00",
            "preview_image": None,
            "qr_image": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", lambda _image: [])

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_type == "vat_special"
    assert parsed.raw["parsed_result"]["invoice_type"] == "vat_special"


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
            "qr_image": object(),
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
            "qr_image": object(),
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


def test_parse_pdf_invoice_uses_selected_opencv_engine(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "",
            "preview_image": None,
            "qr_image": object(),
            "render_error": None,
        },
    )

    calls = []

    def fake_decode(_image, include_details=False, engine="zxing"):
        calls.append(engine)
        payloads = ["01,10,044001800111,28104068,181.52,20260603,checksum"]
        details = [{"method": f"{engine}_qrcode", "success": True, "result": {"payloads": payloads}}]
        return (payloads, details) if include_details else payloads

    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", fake_decode)

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf", invoice_qr_engine="opencv_wechat")

    assert calls == ["opencv_wechat"]
    assert parsed.raw["parser"] == "pymupdf_opencv_wechat"
    assert parsed.invoice_no == "28104068"


def test_opencv_engine_falls_back_to_zxing_when_runtime_unavailable(monkeypatch):
    image = object()
    calls = []

    def fake_opencv(_image):
        calls.append("opencv")
        raise RuntimeError("OpenCV runtime 未安装")

    def fake_zxing(_image):
        calls.append("zxing")
        return ["01,10,044001800111,28104068,181.52,20260603,checksum"], [
            {"method": "zxing_qrcode", "success": True, "result": {"payloads": ["ok"]}}
        ]

    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_with_opencv", fake_opencv)
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_with_zxing", fake_zxing)

    payloads, details = invoice_parser.decode_qr_payloads_from_image(image, include_details=True, engine="opencv_wechat")

    assert calls == ["opencv", "zxing"]
    assert payloads
    assert details[0]["method"] == "opencv_wechat_runtime"
    assert details[0]["success"] is False
    assert details[1]["method"] == "zxing_qrcode"


def test_parse_pdf_invoice_highlights_split_qr_amount_words(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "\n".join(
                [
                    "电子发票（普通发票）",
                    "价税合计（大写）",
                    "（小写）",
                    "壹拾圆壹分",
                    "¥10. 01",
                ]
            ),
            "preview_image": "data:image/png;base64,abc",
            "qr_image": object(),
            "page_size": {"width": 500, "height": 300},
            "words": [
                {"x0": 40, "y0": 210, "x1": 105, "y1": 222, "text": "价税合计（大写）"},
                {"x0": 300, "y0": 210, "x1": 335, "y1": 222, "text": "（小写）"},
                {"x0": 340, "y0": 210, "x1": 365, "y1": 222, "text": "¥10."},
                {"x0": 365, "y0": 210, "x1": 376, "y1": 222, "text": "01"},
            ],
            "render_error": None,
        },
    )
    monkeypatch.setattr(
        "backend.services.invoice_parser.decode_qr_payloads_from_image",
        lambda _image, include_details=False: (
            ["01,32,,26337906210400590013,10.01,20260422,,349F"],
            [],
        )
        if include_details
        else ["01,32,,26337906210400590013,10.01,20260422,,349F"],
    )

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.amount == Decimal("10.01")
    assert parsed.raw["amount_source"] == "qr"
    assert parsed.raw["preview_highlights"][0]["type"] == "tax_total_amount"
    assert parsed.raw["preview_highlights"][0]["amount"] == "10.01"


def test_parse_pdf_invoice_uses_text_tax_total_over_standard_qr_untaxed_amount(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "\n".join(
                [
                    "价税合计（大写）",
                    "（小写）",
                    "￥34.43",
                    "￥1.03",
                    "叁拾伍圆肆角陆分",
                    "发票代码：033002300511",
                    "发票号码：03810961",
                    "开票日期：2024年03月29日",
                    "￥35.46",
                ]
            ),
            "preview_image": None,
            "qr_image": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr(
        "backend.services.invoice_parser.decode_qr_payloads_from_image",
        lambda _image, include_details=False: (
            ["01,10,033002300511,03810961,34.43,20240329,11299145375686719118,3488,"],
            [],
        )
        if include_details
        else ["01,10,033002300511,03810961,34.43,20240329,11299145375686719118,3488,"],
    )

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "03810961"
    assert parsed.invoice_date == date(2024, 3, 29)
    assert parsed.amount == Decimal("35.46")
    assert parsed.raw["amount_source"] == "currency_sum"
    assert parsed.raw["amount_selection_reason"] == "text_tax_total_over_standard_qr"


def test_parse_pdf_invoice_reads_tax_total_when_currency_symbol_follows_number(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "backend.services.invoice_parser.extract_pdf_page_artifacts",
        lambda _path: {
            "text": "\n".join(
                [
                    "电子发票（普通发票）",
                    "发票号码: 24337000000084378505",
                    "开票日期: 2024年06月24日",
                    "金额",
                    "税额",
                    "66.22",
                    "3%",
                    "1.99",
                    "合",
                    "计",
                    "66.22",
                    "¥",
                    "1.99",
                    "¥",
                    "价税合计（大写）",
                    "（小写）",
                    "68.21",
                    "¥",
                    "陆拾捌圆贰角壹分",
                ]
            ),
            "preview_image": None,
            "qr_image": object(),
            "render_error": None,
        },
    )
    monkeypatch.setattr("backend.services.invoice_parser.decode_qr_payloads_from_image", lambda _image: [])

    parsed = parse_pdf_invoice(tmp_path / "invoice.pdf")

    assert parsed.invoice_no == "24337000000084378505"
    assert parsed.invoice_date == date(2024, 6, 24)
    assert parsed.amount == Decimal("68.21")
    assert parsed.raw["amount_source"] == "tax_total_nearby"
    assert parsed.raw["amount_validation"] == "matched"


def test_parse_qr_payload_supports_comma_separated_invoice_tokens():
    parsed = parse_qr_payload("01,10,044001800111,28104068,181.52,20260603,checksum")

    assert parsed["invoice_no"] == "28104068"
    assert parsed["invoice_date"] == date(2026, 6, 3)
    assert parsed["amount"] == Decimal("181.52")


def test_parse_qr_payload_uses_standard_field_positions_for_eight_digit_invoice_no():
    parsed = parse_qr_payload("01,10,033002300511,03930130,65.33,20240410,03820321515066371103,044C,")

    assert parsed["invoice_no"] == "03930130"
    assert parsed["invoice_date"] == date(2024, 4, 10)
    assert parsed["amount"] == Decimal("65.33")
    assert parsed["invoice_code"] == "033002300511"


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


def test_custom_category_filename_uses_safe_hash_prefix():
    assert safe_category_filename_prefix("custom:宴请").startswith("custom_")
    assert safe_category_filename_prefix("custom:宴请") == safe_category_filename_prefix("custom:宴请")
    assert safe_category_filename_prefix("custom:宴请") != "custom:宴请"


def test_calculate_subsidy_days_uses_stored_trip_dates_across_year_end():
    trips = [
        Trip(
            depart_date=date(2025, 12, 30),
            depart_month=12,
            depart_day=30,
            arrive_date=date(2026, 1, 2),
            arrive_month=1,
            arrive_day=2,
            sort_order=1,
        ),
    ]

    # 锚点年份是 2026，靠月日推断会把出发算成 2026-12-30；存了日期就按日期算。
    assert calculate_subsidy_days(2026, trips) == 4
    ranges = infer_trip_date_ranges(2026, trips)
    assert (ranges[0].depart, ranges[0].arrive) == (date(2025, 12, 30), date(2026, 1, 2))


def test_infer_trip_date_ranges_realigns_inferred_year_to_stored_dates():
    trips = [
        Trip(
            depart_date=date(2025, 3, 1),
            depart_month=3,
            depart_day=1,
            arrive_date=date(2025, 3, 2),
            arrive_month=3,
            arrive_day=2,
            sort_order=1,
        ),
        # 历史行程只有月日，年份应接着上一段的 2025 走，而不是回到锚点年份。
        Trip(depart_month=3, depart_day=5, arrive_month=3, arrive_day=6, sort_order=2),
    ]

    ranges = infer_trip_date_ranges(2026, trips)

    assert [item.depart for item in ranges] == [date(2025, 3, 1), date(2025, 3, 5)]
    assert [item.arrive for item in ranges] == [date(2025, 3, 2), date(2025, 3, 6)]


def test_calculate_subsidy_days_across_month():
    trips = [
        Trip(depart_month=5, depart_day=30, arrive_month=6, arrive_day=2, sort_order=1),
    ]

    assert calculate_subsidy_days(2026, trips) == 4


def test_calculate_subsidy_days_allows_long_same_year_cross_month_trip():
    trips = [
        Trip(depart_month=5, depart_day=10, arrive_month=6, arrive_day=8, sort_order=1),
    ]

    assert calculate_subsidy_days(2026, trips) == 30


def test_calculate_subsidy_days_allows_short_cross_year_trip():
    trips = [
        Trip(depart_month=12, depart_day=30, arrive_month=1, arrive_day=2, sort_order=1),
    ]

    assert calculate_subsidy_days(2026, trips) == 4


def test_calculate_subsidy_days_infers_previous_year_for_january_report_date():
    trips = [
        Trip(depart_month=12, depart_day=30, arrive_month=12, arrive_day=31, sort_order=1),
        Trip(depart_month=1, depart_day=2, arrive_month=1, arrive_day=2, sort_order=2),
    ]

    assert calculate_subsidy_days(date(2026, 1, 5), trips) == 4


def test_calculate_subsidy_days_rejects_arrival_month_day_before_departure_in_same_year():
    trips = [
        Trip(depart_month=3, depart_day=10, arrive_month=3, arrive_day=9, sort_order=1),
    ]

    with pytest.raises(TripDateError):
        calculate_subsidy_days(2026, trips)


def test_calculate_subsidy_days_rejects_long_cross_year_trip():
    trips = [
        Trip(depart_month=12, depart_day=20, arrive_month=1, arrive_day=5, sort_order=1),
    ]

    with pytest.raises(TripDateError):
        calculate_subsidy_days(2026, trips)


def test_calculate_subsidy_days_rejects_arrival_hour_before_departure_hour():
    trips = [
        Trip(depart_month=6, depart_day=1, depart_hour=14, arrive_month=6, arrive_day=1, arrive_hour=9, sort_order=1),
    ]

    with pytest.raises(TripDateError):
        calculate_subsidy_days(2026, trips)


def test_calculate_subsidy_days_defaults_to_first_depart_last_arrive():
    # 新模型：无显式标记 → 补贴 = 第 1 段出发 → 最后 1 段到达，中间全算
    trips = [
        Trip(sort_order=1, depart_month=3, depart_day=4, depart_place="杭州", arrive_month=3, arrive_day=4, arrive_place="芜湖"),
        Trip(sort_order=2, depart_month=3, depart_day=4, depart_place="芜湖", arrive_month=3, arrive_day=4, arrive_place="杭州"),
        Trip(sort_order=3, depart_month=3, depart_day=12, depart_place="杭州", arrive_month=3, arrive_day=12, arrive_place="芜湖"),
        Trip(sort_order=4, depart_month=3, depart_day=15, depart_place="芜湖", arrive_month=3, arrive_day=15, arrive_place="杭州"),
    ]

    # 3/4 → 3/15 连续 = 12 天（回家不再自动切分，需手动标止/起）
    assert calculate_subsidy_days(2026, trips) == 12


def test_calculate_subsidy_days_manual_split_excludes_home_gap():
    # 中途回家：手动标「止」+「起」切分，在家间隙不计补贴
    trips = [
        Trip(sort_order=1, depart_month=6, depart_day=1, arrive_month=6, arrive_day=2, subsidy_end=True),
        Trip(sort_order=2, depart_month=6, depart_day=8, arrive_month=6, arrive_day=9, subsidy_start=True),
    ]

    # [6/1,6/2]=2 天 + [6/8,6/9]=2 天 = 4 天；中间 6/3-6/7 在家不算
    assert calculate_subsidy_days(2026, trips) == 4


def test_calculate_subsidy_days_uses_manual_start_end_markers():
    trips = [
        Trip(sort_order=1, depart_month=3, depart_day=4, arrive_month=3, arrive_day=4, subsidy_start=True),
        Trip(sort_order=2, depart_month=3, depart_day=4, arrive_month=3, arrive_day=4, subsidy_end=True),
        Trip(sort_order=3, depart_month=3, depart_day=12, arrive_month=3, arrive_day=12, subsidy_start=True),
        Trip(sort_order=4, depart_month=3, depart_day=15, arrive_month=3, arrive_day=15, subsidy_end=True),
    ]

    assert calculate_subsidy_days(2026, trips) == 5


def test_calculate_subsidy_days_rejects_consecutive_start_marker():
    # 中间段标「起」但上一段出差还没「止」→ 连续起点，报错
    trips = [
        Trip(sort_order=1, depart_month=3, depart_day=4, arrive_month=3, arrive_day=4),
        Trip(sort_order=2, depart_month=3, depart_day=6, arrive_month=3, arrive_day=6, subsidy_start=True),
        Trip(sort_order=3, depart_month=3, depart_day=8, arrive_month=3, arrive_day=8),
    ]

    with pytest.raises(TripDateError):
        calculate_subsidy_days(2026, trips)


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
        lambda _path, _file_type: InvoiceParsedData(
            invoice_no="987654321",
            invoice_type="vat_special",
            amount=parsed_amount,
        ),
    )

    invoice, parsed = upload_invoice(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4")),
    )

    assert parsed.amount == parsed_amount
    assert parsed.invoice_type == "vat_special"
    assert invoice.invoice_type == "vat_special"
    assert invoice.amount == parsed_amount
    assert invoice.amount_confirmed is False
    db.refresh(report)
    assert report.total_amount == Decimal("0.00")


def test_upload_multi_page_pdf_creates_split_invoice_records(monkeypatch, tmp_path: Path, db):
    from pypdf import PdfWriter

    upload_root = tmp_path / "uploads"
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", upload_root)

    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_blank_page(width=210, height=200)
    pdf_buffer = BytesIO()
    writer.write(pdf_buffer)
    pdf_buffer.seek(0)

    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_files_with_engine",
        lambda _path, _file_type, _engine: [
            InvoiceParsedData(
                invoice_no="10000001",
                invoice_date=date(2026, 6, 1),
                amount=Decimal("88.00"),
                raw={"source": "pdf", "page_index": 0, "page_number": 1, "page_count": 2, "parse_success": True},
            ),
            InvoiceParsedData(
                invoice_no="10000002",
                invoice_date=date(2026, 6, 2),
                amount=Decimal("99.00"),
                raw={"source": "pdf", "page_index": 1, "page_number": 2, "page_count": 2, "parse_success": True},
            ),
        ],
    )

    uploaded = upload_invoices(
        db,
        report_id=report.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="multi.pdf", file=pdf_buffer),
    )

    invoices = [invoice for invoice, _parsed in uploaded]
    assert len(invoices) == 2
    assert [invoice.invoice_no for invoice in invoices] == ["10000001", "10000002"]
    assert len({invoice.file_path for invoice in invoices}) == 2
    for invoice in invoices:
        assert invoice.file_type == "pdf"
        assert (upload_root / Path(invoice.file_path).relative_to("uploads")).exists()


def test_upload_multi_page_pdf_rejects_page_matching_existing_invoice(monkeypatch, tmp_path: Path, db):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", upload_root)
    source = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="单页来源"))
    source_relative = Path("uploads") / str(source.id) / "existing-page.pdf"
    source_path = upload_root.joinpath(*source_relative.parts[1:])
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"existing split page")
    db.add(
        Invoice(
            report_id=source.id,
            expense_category="luggage",
            file_path=source_relative.as_posix(),
            file_type="pdf",
            amount=Decimal("10.00"),
        )
    )
    db.commit()
    target = create_report(db, ReportCreate(report_date=date(2026, 6, 2), purpose="多页目标"))
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_files_with_engine",
        lambda _path, _file_type, _engine: [
            InvoiceParsedData(amount=Decimal("10.00"), raw={"page_index": 0}),
            InvoiceParsedData(amount=Decimal("20.00"), raw={"page_index": 1}),
        ],
    )

    def fake_split(_source_path, report_id, _category, page_index):
        relative = Path("uploads") / str(report_id) / f"page-{page_index}.pdf"
        path = upload_root.joinpath(*relative.parts[1:])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"existing split page" if page_index == 0 else b"unique split page")
        return relative.as_posix()

    monkeypatch.setattr("backend.services.invoice_service.split_pdf_page_to_upload_file", fake_split)

    with pytest.raises(HTTPException) as exc_info:
        upload_invoices(
            db,
            report_id=target.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="multi.pdf", file=BytesIO(b"different multi-page source")),
        )

    assert exc_info.value.status_code == 409
    assert "第 1 页" in exc_info.value.detail
    assert f"编号：{source.id}" in exc_info.value.detail
    assert db.scalars(select(Invoice).where(Invoice.report_id == target.id)).all() == []
    assert list((upload_root / str(target.id)).glob("*")) == []


def test_upload_multi_page_pdf_rejects_identical_pages_and_rolls_back(monkeypatch, tmp_path: Path, db):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", upload_root)
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_files_with_engine",
        lambda _path, _file_type, _engine: [
            InvoiceParsedData(amount=Decimal("10.00"), raw={"page_index": 0}),
            InvoiceParsedData(amount=Decimal("20.00"), raw={"page_index": 1}),
        ],
    )

    def fake_split(_source_path, report_id, _category, page_index):
        relative = Path("uploads") / str(report_id) / f"page-{page_index}.pdf"
        path = upload_root.joinpath(*relative.parts[1:])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"identical split page")
        return relative.as_posix()

    monkeypatch.setattr("backend.services.invoice_service.split_pdf_page_to_upload_file", fake_split)

    with pytest.raises(HTTPException) as exc_info:
        upload_invoices(
            db,
            report_id=report.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="multi.pdf", file=BytesIO(b"multi-page source")),
        )

    assert exc_info.value.status_code == 409
    assert "与本文件中的其他页面内容完全相同" in exc_info.value.detail
    assert db.scalars(select(Invoice).where(Invoice.report_id == report.id)).all() == []
    assert list((upload_root / str(report.id)).glob("*")) == []


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
        InvoiceUpdate(amount=Decimal("266.50"), amount_confirmed=True, invoice_type="vat_special"),
    )
    db.refresh(report)

    assert confirmed.amount_confirmed is True
    assert confirmed.amount == Decimal("266.50")
    assert confirmed.invoice_type == "vat_special"
    assert report.total_amount == Decimal("266.50")
    assert report.shortfall == Decimal("266.50")


def test_update_invoice_keeps_existing_invoice_type_when_omitted(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    invoice = Invoice(
        report_id=report.id,
        expense_category="luggage",
        file_path="uploads/1/invoice.pdf",
        file_type="pdf",
        invoice_type="vat_special",
        amount=Decimal("10.00"),
        amount_confirmed=False,
    )
    db.add(invoice)
    db.commit()

    updated = update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("20.00"), amount_confirmed=True))

    assert updated.invoice_type == "vat_special"
    assert updated.amount == Decimal("20.00")


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


@pytest.mark.parametrize(
    ("source_status", "status_label"),
    [
        ("draft", "草稿"),
        ("checked", "已核对"),
        ("printed", "已提交"),
        ("reimbursed", "已报销"),
    ],
)
def test_upload_invoice_rejects_duplicate_file_across_all_active_report_statuses(
    monkeypatch,
    tmp_path: Path,
    db,
    source_status: str,
    status_label: str,
):
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(amount=Decimal("10.00")),
    )
    source = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 3),
            employee_name="张三",
            purpose="来源出差",
        ),
    )
    upload_invoice(
        db,
        report_id=source.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="source.pdf", file=BytesIO(b"global duplicate invoice")),
    )
    source.status = source_status
    db.commit()
    target = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="目标出差"))

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=target.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="duplicate.pdf", file=BytesIO(b"global duplicate invoice")),
        )

    assert exc_info.value.status_code == 409
    assert "该发票文件已在其他报销单中上传" in exc_info.value.detail
    assert f"编号：{source.id}" in exc_info.value.detail
    assert "事由：来源出差" in exc_info.value.detail
    assert "人员：张三" in exc_info.value.detail
    assert f"状态：{status_label}" in exc_info.value.detail
    assert db.scalars(select(Invoice).where(Invoice.report_id == target.id)).all() == []


def test_upload_invoice_rejects_duplicate_number_across_reports_after_strip(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "uploads")
    parsed_numbers = iter([" GLOBAL-NO-001 ", "GLOBAL-NO-001"])
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no=next(parsed_numbers), amount=Decimal("10.00")),
    )
    source = create_report(db, ReportCreate(report_date=date(2026, 6, 3), purpose="号码来源"))
    upload_invoice(
        db,
        report_id=source.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="source.pdf", file=BytesIO(b"source invoice content")),
    )
    target = create_report(db, ReportCreate(report_date=date(2026, 6, 4)))

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=target.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="target.pdf", file=BytesIO(b"different target invoice content")),
        )

    assert exc_info.value.status_code == 409
    assert "识别到相同发票号 GLOBAL-NO-001 已在其他报销单中上传" in exc_info.value.detail
    assert f"编号：{source.id}" in exc_info.value.detail
    assert db.scalars(select(Invoice).where(Invoice.report_id == target.id)).all() == []


@pytest.mark.parametrize("deleted_owner", ["invoice", "report"])
def test_upload_invoice_ignores_soft_deleted_duplicate_sources(monkeypatch, tmp_path: Path, db, deleted_owner: str):
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(amount=Decimal("10.00")),
    )
    source = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    source_invoice, _parsed = upload_invoice(
        db,
        report_id=source.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="source.pdf", file=BytesIO(b"reusable deleted invoice")),
    )
    if deleted_owner == "invoice":
        source_invoice.deleted_at = datetime.utcnow()
    else:
        source.deleted_at = datetime.utcnow()
    db.commit()
    target = create_report(db, ReportCreate(report_date=date(2026, 6, 4)))

    uploaded, _parsed = upload_invoice(
        db,
        report_id=target.id,
        expense_category="luggage",
        upload_file=UploadFile(filename="target.pdf", file=BytesIO(b"reusable deleted invoice")),
    )

    assert uploaded.report_id == target.id


def test_upload_invoice_duplicate_message_limits_report_contexts(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr("backend.services.invoice_service.UPLOAD_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="MULTI-SOURCE", amount=Decimal("10.00")),
    )
    source_ids = []
    for index in range(4):
        source = create_report(db, ReportCreate(report_date=date(2026, 6, index + 1), purpose=f"来源 {index + 1}"))
        source_ids.append(source.id)
        db.add(
            Invoice(
                report_id=source.id,
                expense_category="luggage",
                file_path=f"uploads/{source.id}/missing.pdf",
                file_type="pdf",
                invoice_no="MULTI-SOURCE",
                amount=Decimal("10.00"),
            )
        )
    db.commit()
    target = create_report(db, ReportCreate(report_date=date(2026, 6, 5)))

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=target.id,
            expense_category="luggage",
            upload_file=UploadFile(filename="target.pdf", file=BytesIO(b"new content")),
        )

    assert exc_info.value.status_code == 409
    for source_id in source_ids[:3]:
        assert f"编号：{source_id}" in exc_info.value.detail
    assert f"编号：{source_ids[3]}" not in exc_info.value.detail
    assert "另有 1 张来源报销单" in exc_info.value.detail


def test_report_update_can_add_custom_expense_category_and_keeps_fixed_items(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "custom:宴请", "remark": "客户晚餐"}],
        ),
    )

    categories = {item.category for item in updated.expense_items}
    assert "custom:宴请" in categories
    assert {"luggage", "city_transport", "accommodation", "postal", "no_sleeper_subsidy", "toll", "fuel_subsidy"}.issubset(
        categories,
    )


@pytest.mark.parametrize("category", ["custom:", "custom:宴:请", "custom:行李费", "custom:宴请宴请宴请宴请宴请宴请宴请宴请宴请宴请宴"])
def test_report_update_rejects_invalid_custom_category_names(category, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    with pytest.raises(HTTPException) as exc_info:
        update_report(
            db,
            report.id,
            ReportUpdate(report_date=date(2026, 6, 3), expense_items=[{"category": category}]),
        )

    assert exc_info.value.status_code == 400


def test_report_update_rejects_duplicate_custom_category_names(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))

    with pytest.raises(HTTPException) as exc_info:
        update_report(
            db,
            report.id,
            ReportUpdate(
                report_date=date(2026, 6, 3),
                expense_items=[{"category": "custom:宴请"}, {"category": "custom:宴请"}],
            ),
        )

    assert exc_info.value.status_code == 400
    assert "不能重名" in exc_info.value.detail


def test_upload_invoice_to_existing_custom_category_succeeds_and_confirmed_amount_counts(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    update_report(
        db,
        report.id,
        ReportUpdate(report_date=date(2026, 6, 3), expense_items=[{"category": "custom:宴请"}]),
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.save_upload_file",
        lambda _upload_file, report_id, _expense_category, _file_type: f"uploads/{report_id}/custom_test.pdf",
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="CUSTOM-1", amount=Decimal("188.80")),
    )

    invoice, _ = upload_invoice(
        db,
        report_id=report.id,
        expense_category="custom:宴请",
        upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4 custom")),
    )
    update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("188.80"), amount_confirmed=True))
    db.refresh(report)

    assert invoice.expense_category == "custom:宴请"
    assert report.total_amount == Decimal("188.80")


def test_fuel_subsidy_reimbursable_amount_overrides_invoice_total(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="fuel_subsidy",
            file_path="uploads/fuel.pdf",
            file_type="pdf",
            amount=Decimal("300.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "fuel_subsidy", "reimbursable_amount": Decimal("180.00")}],
        ),
    )
    fuel_item = next(item for item in updated.expense_items if item.category == "fuel_subsidy")

    assert fuel_item.invoice_total == Decimal("300.00")
    assert fuel_item.amount == Decimal("180.00")
    assert updated.total_amount == Decimal("180.00")


def test_custom_expense_reimbursable_amount_overrides_total_and_requires_invoice_coverage(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 3),
            purpose="客户宴请",
            expense_items=[{"category": "custom:宴请"}],
        ),
    )
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="custom:宴请",
            file_path="uploads/custom.pdf",
            file_type="pdf",
            amount=Decimal("300.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            purpose="客户宴请",
            expense_items=[{"category": "custom:宴请", "reimbursable_amount": Decimal("180.00")}],
        ),
    )
    custom_item = next(item for item in updated.expense_items if item.category == "custom:宴请")

    assert custom_item.invoice_total == Decimal("300.00")
    assert custom_item.amount == Decimal("180.00")
    assert updated.total_amount == Decimal("180.00")

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            purpose="客户宴请",
            expense_items=[{"category": "custom:宴请", "reimbursable_amount": Decimal("301.00")}],
        ),
    )
    with pytest.raises(HTTPException, match="宴请发票金额不足"):
        report_service.ensure_reimbursable_expenses_printable(updated)
    with pytest.raises(HTTPException, match="宴请发票金额不足"):
        update_report_status(db, report.id, "checked")


def test_fuel_subsidy_reimbursable_amount_requires_sufficient_invoices_before_checking(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3), purpose="燃油补助"))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="fuel_subsidy",
            file_path="uploads/fuel.pdf",
            file_type="pdf",
            amount=Decimal("300.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            purpose="燃油补助",
            expense_items=[{"category": "fuel_subsidy", "reimbursable_amount": Decimal("301.00")}],
        ),
    )

    fuel_item = next(item for item in updated.expense_items if item.category == "fuel_subsidy")
    assert fuel_item.reimbursable_amount == Decimal("301.00")
    assert updated.total_amount == Decimal("301.00")
    with pytest.raises(HTTPException, match="发票金额不足"):
        update_report_status(db, report.id, "checked")


def test_fixed_non_manual_category_ignores_reimbursable_amount(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    db.add(
        Invoice(
            report_id=report.id,
            expense_category="luggage",
            file_path="uploads/luggage.pdf",
            file_type="pdf",
            amount=Decimal("300.00"),
            amount_confirmed=True,
        )
    )
    db.commit()
    db.refresh(report)

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "luggage", "reimbursable_amount": Decimal("180.00")}],
        ),
    )
    luggage_item = next(item for item in updated.expense_items if item.category == "luggage")

    assert luggage_item.reimbursable_amount is None
    assert luggage_item.amount == Decimal("300.00")
    assert updated.total_amount == Decimal("300.00")


def test_fuel_subsidy_reimbursable_amount_is_preserved_after_invoice_decrease(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    invoice = Invoice(
        report_id=report.id,
        expense_category="fuel_subsidy",
        file_path="uploads/fuel.pdf",
        file_type="pdf",
        amount=Decimal("300.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()
    db.refresh(report)
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "fuel_subsidy", "reimbursable_amount": Decimal("180.00")}],
        ),
    )

    update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("120.00"), amount_confirmed=True))
    db.refresh(report)
    fuel_item = next(item for item in report.expense_items if item.category == "fuel_subsidy")

    assert fuel_item.reimbursable_amount == Decimal("180.00")
    assert report.total_amount == Decimal("180.00")


def test_fuel_subsidy_manual_amount_is_preserved_after_invoice_deletion(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    invoice = Invoice(
        report_id=report.id,
        expense_category="fuel_subsidy",
        file_path="uploads/fuel.pdf",
        file_type="pdf",
        amount=Decimal("300.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "fuel_subsidy", "reimbursable_amount": Decimal("180.00")}],
        ),
    )

    soft_delete_invoice(db, invoice.id)
    db.refresh(report)
    fuel_item = next(item for item in report.expense_items if item.category == "fuel_subsidy")

    assert fuel_item.reimbursable_amount == Decimal("180.00")
    assert fuel_item.invoice_total == Decimal("0.00")
    assert report.total_amount == Decimal("180.00")


def test_submitted_report_fuel_invoice_is_locked(monkeypatch, db):
    snapshots = []
    monkeypatch.setattr(report_service, "create_safety_snapshot", lambda _db, reason: snapshots.append(reason))
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3), purpose="燃油补助"))
    invoice = Invoice(
        report_id=report.id,
        expense_category="fuel_subsidy",
        file_path="uploads/fuel.pdf",
        file_type="pdf",
        amount=Decimal("300.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            purpose="燃油补助",
            expense_items=[{"category": "fuel_subsidy", "reimbursable_amount": Decimal("180.00")}],
        ),
    )
    update_report_status(db, report.id, "checked")
    update_report_status(db, report.id, "printed")

    with pytest.raises(HTTPException) as exc:
        update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("120.00"), amount_confirmed=True))

    db.refresh(report)
    db.refresh(invoice)

    assert exc.value.status_code == 403
    assert report.status == "printed"
    assert invoice.amount == Decimal("300.00")
    assert snapshots == []


def test_checked_report_invoice_is_locked(db):
    report = create_report(db, ReportCreate(purpose="已核对发票"))
    invoice = Invoice(
        report_id=report.id,
        expense_category="luggage",
        file_path="uploads/luggage.pdf",
        file_type="pdf",
        amount=Decimal("20.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()
    update_report_status(db, report.id, "checked")

    with pytest.raises(HTTPException) as exc:
        update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("30.00"), amount_confirmed=True))

    assert exc.value.status_code == 403


def test_upload_invoice_to_missing_custom_category_is_rejected(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(amount=Decimal("10.00")),
    )

    with pytest.raises(HTTPException) as exc_info:
        upload_invoice(
            db,
            report_id=report.id,
            expense_category="custom:宴请",
            upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4 custom")),
        )

    assert exc_info.value.status_code == 400
    assert "自定义费用类别不存在" in exc_info.value.detail


def test_custom_category_with_active_invoice_is_deleted_with_its_invoice(monkeypatch, db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    update_report(
        db,
        report.id,
        ReportUpdate(report_date=date(2026, 6, 3), expense_items=[{"category": "custom:宴请"}]),
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.save_upload_file",
        lambda _upload_file, report_id, _expense_category, _file_type: f"uploads/{report_id}/custom_test.pdf",
    )
    monkeypatch.setattr(
        "backend.services.invoice_service.parse_invoice_file",
        lambda _path, _file_type: InvoiceParsedData(invoice_no="CUSTOM-DELETE", amount=Decimal("20.00")),
    )
    invoice, _ = upload_invoice(
        db,
        report_id=report.id,
        expense_category="custom:宴请",
        upload_file=UploadFile(filename="invoice.pdf", file=BytesIO(b"%PDF-1.4 custom delete")),
    )

    updated = update_report(db, report.id, ReportUpdate(report_date=date(2026, 6, 3), expense_items=[]))
    db.refresh(invoice)

    assert "custom:宴请" not in {item.category for item in updated.expense_items}
    assert invoice.deleted_at is not None
    assert updated.active_invoices == []


def test_custom_category_without_invoice_can_be_deleted(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    update_report(
        db,
        report.id,
        ReportUpdate(report_date=date(2026, 6, 3), expense_items=[{"category": "custom:宴请"}]),
    )

    updated = update_report(db, report.id, ReportUpdate(report_date=date(2026, 6, 3), expense_items=[]))

    assert "custom:宴请" not in {item.category for item in updated.expense_items}


def test_custom_category_with_paper_invoice_can_be_deleted(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 3)))
    update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 6, 3),
            expense_items=[{"category": "custom:宴请", "paper_invoice_amount": Decimal("20.00"), "paper_invoice_count": 1}],
        ),
    )

    updated = update_report(db, report.id, ReportUpdate(report_date=date(2026, 6, 3), expense_items=[]))

    assert "custom:宴请" not in {item.category for item in updated.expense_items}
    assert updated.total_amount == Decimal("0.00")


def test_delete_fixed_expense_item_clears_paper_values_and_soft_deletes_invoices(db):
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 6, 3),
            expense_items=[
                {
                    "category": "city_transport",
                    "remark": "市内打车",
                    "paper_invoice_amount": Decimal("20.00"),
                    "paper_invoice_count": 1,
                }
            ],
        ),
    )
    invoice = Invoice(
        report_id=report.id,
        expense_category="city_transport",
        file_path="uploads/city-transport.pdf",
        file_type="pdf",
        amount=Decimal("30.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()

    updated = delete_expense_item(db, report.id, "city_transport")
    db.refresh(invoice)
    item = next(item for item in updated.expense_items if item.category == "city_transport")

    assert invoice.deleted_at is not None
    assert item.remark is None
    assert item.paper_invoice_amount == Decimal("0.00")
    assert item.paper_invoice_count == 0
    assert updated.total_amount == Decimal("0.00")
