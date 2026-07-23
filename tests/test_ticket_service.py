import json
import shutil
from datetime import date, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import select

from backend.models.invoice import Invoice
from backend.models.trip import Trip
from backend.schemas.invoice import InvoiceParsedData
from backend.schemas.report import ReportCreate
from backend.schemas.ticket import (
    RailTicketCandidate,
    RailTicketImportCandidate,
    RailTicketImportGroup,
    RailTicketImportRequest,
    RailTicketPreview,
)
from backend.services import ticket_service
from backend.services.pdf_text_decoder import PdfTextExtraction, PdfTextRun, decode_font_bytes, extract_pdf_text_runs
from backend.services.report_service import create_report


def candidate(
    ticket_id: str,
    *,
    travel_date: date = date(2026, 7, 10),
    depart_station: str = "杭州",
    arrive_station: str = "南京南",
    amount: str = "100.00",
    duplicate: bool = False,
) -> RailTicketCandidate:
    return RailTicketCandidate(
        id=ticket_id,
        file_name=f"{ticket_id}.pdf",
        travel_date=travel_date,
        depart_station=depart_station,
        arrive_station=arrive_station,
        amount=Decimal(amount),
        duplicate=duplicate,
    )


def import_candidate(
    ticket_id: str,
    *,
    travel_date: date = date(2026, 7, 10),
    depart_station: str = "杭州",
    arrive_station: str = "南京南",
    amount: str = "100.00",
    invoice_no: str | None = None,
) -> RailTicketImportCandidate:
    return RailTicketImportCandidate(
        id=ticket_id,
        travel_date=travel_date,
        depart_station=depart_station,
        arrive_station=arrive_station,
        amount=Decimal(amount),
        invoice_no=invoice_no or f"INV-{ticket_id}",
        invoice_date=date(2026, 7, 11),
    )


def configure_ticket_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    upload_root = tmp_path / "uploads"
    temp_root = upload_root / ".ticket-import"
    upload_root.mkdir(parents=True)
    monkeypatch.setattr(ticket_service, "TEMP_ROOT", temp_root)

    def test_uploaded_path(relative_path: str | Path) -> Path:
        path = Path(relative_path)
        if path.parts and path.parts[0] == "uploads":
            return upload_root.joinpath(*path.parts[1:])
        return upload_root / path

    monkeypatch.setattr(ticket_service, "uploaded_path", test_uploaded_path)
    return upload_root, temp_root


def test_discard_ticket_preview_removes_only_matching_token(monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    token = "a" * 32
    other_token = "b" * 32
    token_dir = temp_root / token
    other_dir = temp_root / other_token
    token_dir.mkdir(parents=True)
    other_dir.mkdir(parents=True)
    expires_at = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    (token_dir / "metadata.json").write_text(
        json.dumps({"report_id": 7, "expires_at": expires_at, "files": []}),
        encoding="utf-8",
    )
    (other_dir / "metadata.json").write_text(
        json.dumps({"report_id": 8, "expires_at": expires_at, "files": []}),
        encoding="utf-8",
    )

    ticket_service.discard_ticket_preview(token, 7)

    assert not token_dir.exists()
    assert other_dir.exists()


def write_preview_token(
    temp_root: Path,
    report_id: int,
    file_specs: list[tuple[str, bytes]],
    *,
    token: str = "a" * 32,
) -> tuple[str, Path]:
    token_dir = temp_root / token
    token_dir.mkdir(parents=True)
    files = []
    for ticket_id, content in file_specs:
        stored_name = f"{ticket_id}.pdf"
        (token_dir / stored_name).write_bytes(content)
        files.append(
            {
                "id": ticket_id,
                "file_name": stored_name,
                "stored_name": stored_name,
                "file_hash": sha256(content).hexdigest(),
            }
        )
    metadata = {
        "report_id": report_id,
        "expires_at": (datetime.utcnow() + timedelta(hours=1)).isoformat(),
        "files": files,
    }
    (token_dir / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return token, token_dir


def test_normalize_station_is_conservative():
    assert ticket_service.normalize_station(" 南京 南 站 ") == "南京南"
    assert ticket_service.normalize_station("南京站") != ticket_service.normalize_station("南京南站")


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        (candidate("a"), candidate("b", depart_station="南京南站"), (True, False)),
        (
            candidate("a", travel_date=date(2026, 7, 10)),
            candidate("b", travel_date=date(2026, 7, 11), depart_station="南京南"),
            (True, True),
        ),
        (
            candidate("a", travel_date=date(2026, 7, 10)),
            candidate("b", travel_date=date(2026, 7, 12), depart_station="南京南"),
            (False, False),
        ),
        (
            candidate("a", travel_date=date(2026, 7, 10)),
            candidate("b", travel_date=date(2026, 7, 9), depart_station="南京南"),
            (False, False),
        ),
        (candidate("a"), candidate("b", depart_station="南京站"), (False, False)),
    ],
)
def test_transfer_kind_date_and_station_rules(left, right, expected):
    assert ticket_service.transfer_kind(left, right) == expected


def test_ticket_candidate_schema_no_longer_exposes_depart_time():
    assert "depart_time" not in RailTicketCandidate.model_fields
    assert "depart_time" not in RailTicketImportCandidate.model_fields


def test_group_ticket_candidates_builds_three_ticket_transfer_chain():
    tickets = [
        candidate("a", depart_station="杭州", arrive_station="南京南", amount="100"),
        candidate("b", depart_station="南京南站", arrive_station="芜湖站", amount="50"),
        candidate("c", depart_station="芜湖", arrive_station="合肥南", amount="60"),
    ]

    groups = ticket_service.group_ticket_candidates(tickets)

    assert len(groups) == 1
    assert groups[0].ticket_ids == ["a", "b", "c"]
    assert groups[0].path == ["杭州", "南京南", "芜湖站", "合肥南"]
    assert groups[0].suggested_merge is True
    assert groups[0].total_amount == Decimal("210.00")


def test_group_ticket_candidates_merges_next_day_transfer_by_default():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", travel_date=date(2026, 12, 31), depart_station="杭州", arrive_station="南京南"),
            candidate("b", travel_date=date(2027, 1, 1), depart_station="南京南", arrive_station="芜湖"),
        ]
    )

    assert len(groups) == 1
    assert groups[0].ticket_ids == ["a", "b"]
    assert groups[0].cross_day is True
    assert groups[0].suggested_merge is True


def test_group_ticket_candidates_sorts_disconnected_components_by_date():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("later", travel_date=date(2026, 7, 11), depart_station="芜湖", arrive_station="合肥南"),
            candidate("earlier", travel_date=date(2026, 7, 10), depart_station="杭州", arrive_station="南京南"),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["earlier"], ["later"]]


def test_group_ticket_candidates_reorders_user_three_ticket_case_by_unique_route():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate(
                "changshu-taizhou",
                travel_date=date(2026, 3, 18),
                depart_station="常熟",
                arrive_station="泰州",
            ),
            candidate(
                "taizhou-hangzhoudong",
                travel_date=date(2026, 3, 20),
                depart_station="泰州",
                arrive_station="杭州东",
            ),
            candidate(
                "hangzhouxi-changshu",
                travel_date=date(2026, 3, 18),
                depart_station="杭州西",
                arrive_station="常熟",
            ),
        ]
    )

    assert [group.ticket_ids for group in groups] == [
        ["hangzhouxi-changshu", "changshu-taizhou"],
        ["taizhou-hangzhoudong"],
    ]
    assert groups[0].path == ["杭州西", "常熟", "泰州"]
    assert groups[0].suggested_merge is True


def test_sort_ticket_candidates_reorders_scrambled_cross_day_chain():
    tickets = [
        candidate("last", travel_date=date(2026, 7, 12), depart_station="芜湖", arrive_station="合肥南"),
        candidate("first", travel_date=date(2026, 7, 10), depart_station="杭州", arrive_station="南京南"),
        candidate("middle", travel_date=date(2026, 7, 11), depart_station="南京南", arrive_station="芜湖"),
    ]

    ordered = ticket_service.sort_ticket_candidates(tickets)
    groups = ticket_service.group_ticket_candidates(tickets)

    assert [ticket.id for ticket in ordered] == ["first", "middle", "last"]
    assert [group.ticket_ids for group in groups] == [["first", "middle", "last"]]
    assert groups[0].cross_day is True


def test_sort_ticket_candidates_does_not_guess_branch_order():
    tickets = [
        candidate("branch-right", depart_station="南京南", arrive_station="合肥南"),
        candidate("stem", depart_station="杭州", arrive_station="南京南"),
        candidate("branch-left", depart_station="南京南", arrive_station="芜湖"),
    ]

    ordered = ticket_service.sort_ticket_candidates(tickets)

    assert [ticket.id for ticket in ordered] == ["branch-right", "stem", "branch-left"]


def test_sort_ticket_candidates_does_not_guess_multiple_predecessor_order():
    tickets = [
        candidate("from-shanghai", depart_station="上海", arrive_station="南京南"),
        candidate("tail", depart_station="南京南", arrive_station="芜湖"),
        candidate("from-hangzhou", depart_station="杭州", arrive_station="南京南"),
    ]

    ordered = ticket_service.sort_ticket_candidates(tickets)

    assert [ticket.id for ticket in ordered] == ["from-shanghai", "tail", "from-hangzhou"]


def test_sort_ticket_candidates_does_not_use_duplicates_as_route_connections():
    tickets = [
        candidate("next", depart_station="南京南", arrive_station="芜湖"),
        candidate("duplicate", depart_station="杭州", arrive_station="南京南", duplicate=True),
    ]

    ordered = ticket_service.sort_ticket_candidates(tickets)

    assert [ticket.id for ticket in ordered] == ["next", "duplicate"]


def test_group_ticket_candidates_splits_round_trip_before_return_ticket():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", depart_station="杭州", arrive_station="南京南"),
            candidate("b", depart_station="南京南", arrive_station="杭州站"),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["a"], ["b"]]
    assert all(group.suggested_merge is False for group in groups)
    assert any("返程" in (group.warning or "") or "回环" in (group.warning or "") for group in groups)


def test_group_ticket_candidates_does_not_merge_trip_after_return_boundary():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", depart_station="甲", arrive_station="乙"),
            candidate("b", depart_station="乙", arrive_station="甲"),
            candidate("c", depart_station="甲", arrive_station="丙"),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["a"], ["b"], ["c"]]
    assert groups[0].route_loop is False
    assert groups[1].route_loop is True
    assert groups[2].route_loop is False
    assert all(group.suggested_merge is False for group in groups)


@pytest.mark.parametrize("return_station", ["杭州", "南京南"])
def test_group_ticket_candidates_splits_three_ticket_route_loop(return_station):
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", depart_station="杭州", arrive_station="南京南"),
            candidate("b", depart_station="南京南", arrive_station="芜湖"),
            candidate("c", depart_station="芜湖", arrive_station=return_station),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["a", "b"], ["c"]]
    assert groups[0].suggested_merge is True
    assert groups[1].suggested_merge is False


def test_group_ticket_candidates_does_not_merge_duplicate_ticket():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", depart_station="杭州", arrive_station="南京南", duplicate=True),
            candidate("b", depart_station="南京南", arrive_station="芜湖"),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["a"], ["b"]]
    assert all(group.suggested_merge is False for group in groups)


def test_group_ticket_candidates_requires_manual_station_correction_before_merge():
    groups = ticket_service.group_ticket_candidates(
        [
            candidate("a", depart_station="杭州", arrive_station=""),
            candidate("b", depart_station="南京南", arrive_station="芜湖"),
        ]
    )

    assert [group.ticket_ids for group in groups] == [["a"], ["b"]]
    assert all(group.suggested_merge is False for group in groups)


def font_with_encoding(encoding: str) -> DictionaryObject:
    return DictionaryObject({NameObject("/Encoding"): NameObject(encoding)})


@pytest.mark.parametrize(
    ("encoding", "codec", "text"),
    [
        ("/GBK-EUC-H", "gbk", "杭州西站"),
        ("/GBK2K-H", "gb18030", "𠀀站"),
        ("/GBpc-EUC-H", "gb2312", "南京南站"),
        ("/UniGB-UCS2-H", "utf-16-be", "芜湖站"),
    ],
)
def test_decode_font_bytes_supports_common_rail_ticket_encodings(encoding, codec, text):
    decoded, warning = decode_font_bytes(text.encode(codec), font_with_encoding(encoding))

    assert decoded == text
    assert warning is None


def test_decode_font_bytes_prefers_embedded_to_unicode_cmap():
    cmap = DecodedStreamObject()
    cmap.set_data(
        b"""
        /CIDInit /ProcSet findresource begin
        12 dict begin begincmap
        1 begincodespacerange
        <01> <02>
        endcodespacerange
        2 beginbfchar
        <01> <676D>
        <02> <5DDE>
        endbfchar
        endcmap CMapName currentdict /CMap defineresource pop end end
        """
    )
    font = font_with_encoding("/Unknown-H")
    font[NameObject("/ToUnicode")] = cmap

    decoded, warning = decode_font_bytes(b"\x01\x02", font)

    assert decoded == "杭州"
    assert warning is None


def test_decode_font_bytes_does_not_guess_unknown_encoding():
    decoded, warning = decode_font_bytes(b"\x81\x82", font_with_encoding("/Unknown-H"))

    assert decoded == ""
    assert warning


def test_extract_pdf_text_runs_decodes_original_content_stream_bytes(tmp_path):
    path = tmp_path / "gbk-content-stream.pdf"
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = font_with_encoding("/GBK-EUC-H")
    font[NameObject("/Type")] = NameObject("/Font")
    font[NameObject("/Subtype")] = NameObject("/Type0")
    font[NameObject("/BaseFont")] = NameObject("/SyntheticRailTicketFont")
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    expected = "杭州西站"
    encoded_hex = expected.encode("gbk").hex().upper()
    content = DecodedStreamObject()
    content.set_data(f"BT /F1 12 Tf 1 0 0 1 72 700 Tm <{encoded_hex}> Tj ET".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(content)
    with path.open("wb") as target:
        writer.write(target)

    extraction = extract_pdf_text_runs(path)

    assert [run.text for run in extraction.runs] == [expected]
    assert (extraction.runs[0].x, extraction.runs[0].y) == (72.0, 700.0)
    assert extraction.warnings == []


def test_parser_locates_chinese_route_and_date_from_decoded_runs(monkeypatch, tmp_path):
    path = tmp_path / "gbk-rail-ticket.pdf"
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = font_with_encoding("/GBK-EUC-H")
    font[NameObject("/Type")] = NameObject("/Font")
    font[NameObject("/Subtype")] = NameObject("/Type0")
    font[NameObject("/BaseFont")] = NameObject("/SyntheticRailTicketFont")
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )

    def hex_text(value: str) -> str:
        return value.encode("gbk").hex().upper()

    content = DecodedStreamObject()
    content.set_data(
        (
            "BT /F1 18 Tf "
            f"1 0 0 1 72 700 Tm <{hex_text('杭州西站')}> Tj "
            f"1 0 0 1 280 700 Tm <{hex_text('G7428')}> Tj "
            f"1 0 0 1 450 700 Tm <{hex_text('芜湖站')}> Tj "
            f"1 0 0 1 72 650 Tm <{hex_text('2026年07月10日')}> Tj ET"
        ).encode("ascii")
    )
    page[NameObject("/Contents")] = writer._add_object(content)
    with path.open("wb") as target:
        writer.write(target)

    monkeypatch.setattr(
        ticket_service,
        "extract_pdf_page_artifacts",
        lambda _path: {"text": "", "words": [], "preview_image": None, "qr_image": None},
    )
    monkeypatch.setattr(
        ticket_service,
        "parse_invoice_artifacts",
        lambda *_args, **_kwargs: InvoiceParsedData(amount=Decimal("125.00")),
    )

    parsed = ticket_service.parse_rail_ticket(path, "ticket", "ticket.pdf", "zxing")

    assert parsed.depart_station == "杭州西"
    assert parsed.arrive_station == "芜湖"
    assert parsed.travel_date == date(2026, 7, 10)


def test_decoded_route_joins_adjacent_station_suffix_runs_with_mixed_fonts():
    runs = [
        PdfTextRun(text="常熟", x=72, y=700, font_name="/FLeftName", font_size=18, order=0),
        PdfTextRun(text="站", x=109, y=700.5, font_name="/FLeftSuffix", font_size=10, order=1),
        PdfTextRun(text="G7586", x=280, y=700, font_name="/FTrain", font_size=12, order=2),
        PdfTextRun(text="泰州", x=450, y=699, font_name="/FRightName", font_size=14, order=3),
        PdfTextRun(text="站", x=479, y=699, font_name="/FRightSuffix", font_size=9, order=4),
    ]

    depart_station, arrive_station, train_run = ticket_service._decoded_route(
        PdfTextExtraction(runs=runs, page_width=595, page_height=842)
    )

    assert depart_station == "常熟"
    assert arrive_station == "泰州"
    assert train_run == runs[2]


def test_decoded_route_joins_suffix_runs_when_form_matrix_scales_coordinates():
    runs = [
        PdfTextRun(text="G3754", x=264.878, y=298.464, font_name="/F4", font_size=5.6444, order=28),
        PdfTextRun(text="常熟", x=412.151, y=297.831, font_name="/F5", font_size=7.0, order=62),
        PdfTextRun(text="站", x=451.835, y=297.831, font_name="/F2", font_size=4.2, order=63),
        PdfTextRun(text="杭州西", x=96.093, y=297.831, font_name="/F5", font_size=7.0, order=64),
        PdfTextRun(text="站", x=155.620, y=297.831, font_name="/F2", font_size=4.2, order=65),
    ]

    depart_station, arrive_station, train_run = ticket_service._decoded_route(
        PdfTextExtraction(runs=runs, page_width=595.276, page_height=841.890)
    )

    assert depart_station == "杭州西"
    assert arrive_station == "常熟"
    assert train_run == runs[0]


def test_decoded_route_does_not_join_station_suffix_across_large_horizontal_gap():
    runs = [
        PdfTextRun(text="常熟", x=72, y=700, font_name="/FLeft", font_size=18, order=0),
        PdfTextRun(text="站", x=180, y=700, font_name="/FSuffix", font_size=10, order=1),
        PdfTextRun(text="G7586", x=280, y=700, font_name="/FTrain", font_size=12, order=2),
        PdfTextRun(text="泰州站", x=450, y=700, font_name="/FRight", font_size=14, order=3),
    ]

    depart_station, arrive_station, train_run = ticket_service._decoded_route(
        PdfTextExtraction(runs=runs, page_width=595, page_height=842)
    )

    assert depart_station is None
    assert arrive_station is None
    assert train_run == runs[2]


def test_parser_does_not_fallback_to_english_station_names(monkeypatch, tmp_path):
    artifacts = {
        "text": "Hangzhouxi G7428 Wuhu 2026-07-10",
        "words": [
            {"x0": 60, "y0": 110, "text": "Hangzhouxi"},
            {"x0": 460, "y0": 110, "text": "Wuhu"},
            {"x0": 60, "y0": 135, "text": "2026-07-10"},
        ],
        "preview_image": None,
        "qr_image": None,
    }
    monkeypatch.setattr(ticket_service, "extract_pdf_page_artifacts", lambda _path: artifacts)
    monkeypatch.setattr(
        ticket_service,
        "parse_invoice_artifacts",
        lambda *_args, **_kwargs: InvoiceParsedData(amount=Decimal("125.00")),
    )
    monkeypatch.setattr(
        ticket_service,
        "extract_pdf_text_runs",
        lambda _path: PdfTextExtraction(warnings=["字体使用未知编码，相关文字无法解码"]),
    )

    parsed = ticket_service.parse_rail_ticket(tmp_path / "ticket.pdf", "ticket", "ticket.pdf", "zxing")

    assert parsed.travel_date == date(2026, 7, 10)
    assert parsed.depart_station is None
    assert parsed.arrive_station is None
    assert "未识别出发站，请手动补充" in parsed.parse_warnings
    assert "未识别到达站，请手动补充" in parsed.parse_warnings


@pytest.mark.parametrize(
    ("filename", "depart_station", "arrive_station"),
    [
        ("26339166279001372569.pdf", "杭州西", "芜湖"),
        ("26349130926001290552.pdf", "芜湖", "杭州西"),
    ],
)
def test_parser_reads_optional_local_rail_ticket_samples(filename, depart_station, arrive_station):
    path = Path.home() / "Desktop" / filename
    if not path.exists():
        pytest.skip(f"local rail ticket sample {filename} is not present")

    parsed = ticket_service.parse_rail_ticket(path, filename, filename, "zxing")

    assert parsed.travel_date == date(2026, 7, 10)
    assert parsed.depart_station == depart_station
    assert parsed.arrive_station == arrive_station


def test_create_ticket_preview_returns_tickets_in_grouping_order(db, monkeypatch, tmp_path):
    _upload_root, _temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="乱序车票预览"))
    parsed_by_file = {
        "changshu-taizhou.pdf": (date(2026, 3, 18), "常熟", "泰州"),
        "taizhou-hangzhoudong.pdf": (date(2026, 3, 20), "泰州", "杭州东"),
        "hangzhouxi-changshu.pdf": (date(2026, 3, 18), "杭州西", "常熟"),
    }

    def parse_ticket(_path, ticket_id, file_name, _invoice_qr_engine):
        travel_date, depart_station, arrive_station = parsed_by_file[file_name]
        return RailTicketCandidate(
            id=ticket_id,
            file_name=file_name,
            travel_date=travel_date,
            depart_station=depart_station,
            arrive_station=arrive_station,
            amount=Decimal("10.00"),
        )

    monkeypatch.setattr(ticket_service, "parse_rail_ticket", parse_ticket)
    preview = ticket_service.create_ticket_preview(
        db,
        report.id,
        [
            UploadFile(file=BytesIO(b"ticket-a"), filename="changshu-taizhou.pdf"),
            UploadFile(file=BytesIO(b"ticket-b"), filename="taizhou-hangzhoudong.pdf"),
            UploadFile(file=BytesIO(b"ticket-c"), filename="hangzhouxi-changshu.pdf"),
        ],
    )

    assert [ticket.file_name for ticket in preview.tickets] == [
        "hangzhouxi-changshu.pdf",
        "changshu-taizhou.pdf",
        "taizhou-hangzhoudong.pdf",
    ]
    assert "groups" not in RailTicketPreview.model_fields
    assert "唯一连续路线自动排序" in preview.warnings[0]


def test_import_merged_transfer_creates_one_trip_with_two_invoices(db, monkeypatch, tmp_path):
    upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="中转导入"))
    token, token_dir = write_preview_token(temp_root, report.id, [("a", b"ticket-a"), ("b", b"ticket-b")])
    payload = RailTicketImportRequest(
        token=token,
        tickets=[
            import_candidate("a", depart_station="杭州", arrive_station="南京南", amount="100"),
            import_candidate("b", depart_station="南京南站", arrive_station="芜湖", amount="50"),
        ],
        groups=[RailTicketImportGroup(ticket_ids=["a", "b"], merge=True)],
    )

    result = ticket_service.import_ticket_preview(db, report.id, payload)

    trips = db.scalars(select(Trip).where(Trip.report_id == report.id)).all()
    invoices = db.scalars(select(Invoice).where(Invoice.report_id == report.id)).all()
    assert result.trip_ids == [trips[0].id]
    assert len(trips) == 1
    assert (trips[0].depart_month, trips[0].depart_day, trips[0].depart_hour) == (7, 10, None)
    assert (trips[0].depart_place, trips[0].arrive_place, trips[0].arrive_hour) == ("杭州", "芜湖", None)
    assert trips[0].transport == "高铁"
    assert len(invoices) == 2
    assert {invoice.trip_id for invoice in invoices} == {trips[0].id}
    assert {invoice.amount for invoice in invoices} == {Decimal("100.00"), Decimal("50.00")}
    assert all(invoice.amount_confirmed is False for invoice in invoices)
    assert all((upload_root / Path(invoice.file_path).relative_to("uploads")).is_file() for invoice in invoices)
    assert not token_dir.exists()


def test_import_without_merge_creates_one_trip_per_ticket(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="分段导入"))
    token, _token_dir = write_preview_token(temp_root, report.id, [("a", b"ticket-a"), ("b", b"ticket-b")])
    payload = RailTicketImportRequest(
        token=token,
        tickets=[
            import_candidate("a", depart_station="杭州", arrive_station="南京南"),
            import_candidate("b", depart_station="南京南", arrive_station="芜湖"),
        ],
        groups=[RailTicketImportGroup(ticket_ids=["a", "b"], merge=False)],
    )

    result = ticket_service.import_ticket_preview(db, report.id, payload)

    trips = db.scalars(select(Trip).where(Trip.report_id == report.id).order_by(Trip.sort_order)).all()
    invoices = db.scalars(select(Invoice).where(Invoice.report_id == report.id).order_by(Invoice.id)).all()
    assert len(result.trip_ids) == len(trips) == 2
    assert [(trip.depart_place, trip.arrive_place) for trip in trips] == [("杭州", "南京南"), ("南京南", "芜湖")]
    assert all(trip.depart_hour is None and trip.arrive_hour is None for trip in trips)
    assert [invoice.trip_id for invoice in invoices] == [trip.id for trip in trips]


def test_import_rejects_merging_route_that_returns_to_visited_station(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="返程拆分"))
    token, _token_dir = write_preview_token(
        temp_root,
        report.id,
        [("a", b"ticket-a"), ("b", b"ticket-b"), ("c", b"ticket-c")],
    )
    payload = RailTicketImportRequest(
        token=token,
        tickets=[
            import_candidate("a", depart_station="杭州", arrive_station="南京南"),
            import_candidate("b", depart_station="南京南", arrive_station="芜湖"),
            import_candidate("c", depart_station="芜湖", arrive_station="南京南"),
        ],
        groups=[RailTicketImportGroup(ticket_ids=["a", "b", "c"], merge=True)],
    )

    with pytest.raises(HTTPException) as exc:
        ticket_service.import_ticket_preview(db, report.id, payload)

    assert exc.value.status_code == 400
    assert db.scalars(select(Trip).where(Trip.report_id == report.id)).all() == []
    assert db.scalars(select(Invoice).where(Invoice.report_id == report.id)).all() == []


def test_import_failure_rolls_back_database_and_removes_created_files(db, monkeypatch, tmp_path):
    upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="回滚验证"))
    token, token_dir = write_preview_token(temp_root, report.id, [("a", b"ticket-a"), ("b", b"ticket-b")])
    payload = RailTicketImportRequest(
        token=token,
        tickets=[import_candidate("a"), import_candidate("b", depart_station="南京南", arrive_station="芜湖")],
        groups=[RailTicketImportGroup(ticket_ids=["a", "b"], merge=True)],
    )
    real_copy2 = shutil.copy2
    calls = 0

    def fail_second_copy(source, target):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated copy failure")
        return real_copy2(source, target)

    monkeypatch.setattr(ticket_service.shutil, "copy2", fail_second_copy)

    with pytest.raises(OSError, match="simulated copy failure"):
        ticket_service.import_ticket_preview(db, report.id, payload)

    assert db.scalars(select(Trip).where(Trip.report_id == report.id)).all() == []
    assert db.scalars(select(Invoice).where(Invoice.report_id == report.id)).all() == []
    assert list((upload_root / str(report.id)).glob("*.pdf")) == []
    assert not token_dir.exists()


def test_import_rejects_duplicate_file_hash_within_batch(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="重复文件"))
    token, _token_dir = write_preview_token(temp_root, report.id, [("a", b"same-ticket"), ("b", b"same-ticket")])
    payload = RailTicketImportRequest(
        token=token,
        tickets=[import_candidate("a"), import_candidate("b", depart_station="南京南", arrive_station="芜湖")],
        groups=[RailTicketImportGroup(ticket_ids=["a", "b"], merge=True)],
    )

    with pytest.raises(HTTPException) as exc:
        ticket_service.import_ticket_preview(db, report.id, payload)

    assert exc.value.status_code == 409


def test_create_ticket_preview_skips_unparseable_file_and_keeps_others(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="部分解析失败"))

    def parse_ticket(_path, ticket_id, file_name, _invoice_qr_engine):
        if file_name == "broken.pdf":
            raise ValueError("损坏的 PDF")
        return RailTicketCandidate(
            id=ticket_id,
            file_name=file_name,
            travel_date=date(2026, 7, 10),
            depart_station="杭州",
            arrive_station="南京南",
            amount=Decimal("100.00"),
        )

    monkeypatch.setattr(ticket_service, "parse_rail_ticket", parse_ticket)
    preview = ticket_service.create_ticket_preview(
        db,
        report.id,
        [
            UploadFile(file=BytesIO(b"ok-1"), filename="good-1.pdf"),
            UploadFile(file=BytesIO(b"broken-bytes"), filename="broken.pdf"),
            UploadFile(file=BytesIO(b"ok-2"), filename="good-2.pdf"),
        ],
    )

    assert {ticket.file_name for ticket in preview.tickets} == {"good-1.pdf", "good-2.pdf"}
    assert any("broken.pdf" in warning for warning in preview.warnings)
    # 被跳过文件的临时件不得残留在令牌目录中。
    token_dir = temp_root / preview.token
    assert len(list(token_dir.glob("*.pdf"))) == 2


def test_create_ticket_preview_rejects_and_cleans_up_when_all_files_unparseable(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="全部解析失败"))

    def parse_ticket(_path, _ticket_id, _file_name, _invoice_qr_engine):
        raise ValueError("损坏的 PDF")

    monkeypatch.setattr(ticket_service, "parse_rail_ticket", parse_ticket)
    with pytest.raises(HTTPException) as exc:
        ticket_service.create_ticket_preview(
            db,
            report.id,
            [UploadFile(file=BytesIO(b"broken"), filename="broken.pdf")],
        )

    assert exc.value.status_code == 400
    # 令牌目录必须被清理，不残留孤立的临时目录。
    assert list(temp_root.glob("*")) == []


def test_import_allows_subset_after_user_removes_a_ticket(db, monkeypatch, tmp_path):
    _upload_root, temp_root = configure_ticket_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="删除单张后导入"))
    token, token_dir = write_preview_token(
        temp_root, report.id, [("a", b"ticket-a"), ("b", b"ticket-b"), ("c", b"ticket-c")]
    )
    # 用户在预览中删除了车票 "b"，仅提交 "a" 与 "c"。
    payload = RailTicketImportRequest(
        token=token,
        tickets=[
            import_candidate("a", depart_station="杭州", arrive_station="南京南"),
            import_candidate("c", depart_station="上海", arrive_station="苏州"),
        ],
        groups=[
            RailTicketImportGroup(ticket_ids=["a"], merge=False),
            RailTicketImportGroup(ticket_ids=["c"], merge=False),
        ],
    )

    result = ticket_service.import_ticket_preview(db, report.id, payload)

    invoices = db.scalars(select(Invoice).where(Invoice.report_id == report.id)).all()
    assert len(result.trip_ids) == 2
    assert len(invoices) == 2
    assert {invoice.invoice_no for invoice in invoices} == {"INV-a", "INV-c"}
    assert not token_dir.exists()
