from __future__ import annotations

import hashlib
from pathlib import Path

import fitz
import pytest
from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from backend.services.regular_pdf_generator import (
    REGULAR_AMOUNT_GRID_RECTS_MM,
    REGULAR_ROW_FIELDS,
    REGULAR_ROW_RECTS_MM,
    REGULAR_TEMPLATE_FIELDS,
    REGULAR_TEXT_FIELD_EXTRA_INSET_MM,
    REGULAR_TOTAL_ROW_HEIGHT_MM,
    REGULAR_TOTAL_ROW_TOP_MM,
)
from scripts.create_regular_expense_template import (
    AMOUNT_BOUNDARIES,
    PT_PER_MM,
    ROW_BOUNDARIES,
    SCAN_CROP_HEIGHT_MM,
    SOURCE_CROP_LEFT,
    SOURCE_CROP_TOP,
    SOURCE_PAGE_HEIGHT_PT,
    SOURCE_PAGE_WIDTH_PT,
    SOURCE_RASTER_HEIGHT,
    SOURCE_RASTER_WIDTH,
    TEXT_FIELD_EXTRA_INSET_MM,
    crop_scan_top_page,
    fields,
    register_font,
    scan_rect,
    write_comparison_pdf,
)


def _image_stream_hashes(page) -> set[str]:
    resources = page.get("/Resources")
    if not resources:
        return set()
    xobjects = resources.get("/XObject")
    if not xobjects:
        return set()

    hashes: set[str] = set()
    for reference in xobjects.get_object().values():
        obj = reference.get_object()
        if obj.get("/Subtype") != "/Image":
            continue
        raw_data = getattr(obj, "_data", None) or obj.get_data()
        hashes.add(hashlib.sha256(raw_data).hexdigest())
    return hashes


def _write_rotated_scan(path: Path, image_path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=(841.68, 595.2))
    c.drawImage(str(image_path), 0, 0, width=841.68, height=595.2)
    c.showPage()
    c.save()

    reader = PdfReader(str(path))
    page = reader.pages[0]
    page.rotate(270)
    writer = PdfWriter()
    writer.add_page(page)
    with path.open("wb") as stream:
        writer.write(stream)


def _render_page(path: Path, *, clip: fitz.Rect | None = None) -> Image.Image:
    with fitz.open(path) as document:
        pixmap = document[0].get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _mapped_rect_mm(
    left: float,
    top: float,
    right: float,
    bottom: float,
) -> tuple[float, float, float, float]:
    x, y, width, height = scan_rect(left, top, right, bottom)
    return x / PT_PER_MM, (y + height) / PT_PER_MM, width / PT_PER_MM, height / PT_PER_MM


def test_scan_comparison_crops_visible_top_without_scaling_or_reencoding(tmp_path: Path):
    image_path = tmp_path / "scan.png"
    image = Image.new("RGB", (240, 160), color="white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 119, 79), fill="#d7263d")
    draw.rectangle((120, 0, 239, 79), fill="#1b998b")
    draw.rectangle((0, 80, 119, 159), fill="#2e294e")
    draw.rectangle((120, 80, 239, 159), fill="#f4d35e")
    draw.text((8, 8), "TL", fill="white")
    draw.text((205, 8), "TR", fill="black")
    draw.text((8, 140), "BL", fill="white")
    draw.text((205, 140), "BR", fill="black")
    image.save(image_path)
    source_path = tmp_path / "rotated-scan.pdf"
    _write_rotated_scan(source_path, image_path)

    source_reader = PdfReader(str(source_path))
    source_hashes = _image_stream_hashes(source_reader.pages[0])
    cropped_page, page_size = crop_scan_top_page(source_path)

    assert cropped_page.rotation == 0
    assert page_size[0] == pytest.approx(595.2)
    assert page_size[1] == pytest.approx(SCAN_CROP_HEIGHT_MM * PT_PER_MM)
    assert float(cropped_page.mediabox.width) == pytest.approx(595.2)
    assert float(cropped_page.mediabox.height) / PT_PER_MM == pytest.approx(SCAN_CROP_HEIGHT_MM)
    assert _image_stream_hashes(cropped_page) == source_hashes

    output_path = tmp_path / "cropped.pdf"
    writer = PdfWriter()
    writer.add_page(cropped_page)
    with output_path.open("wb") as stream:
        writer.write(stream)

    output_reader = PdfReader(str(output_path))
    output_page = output_reader.pages[0]
    assert float(output_page.mediabox.width) == pytest.approx(595.2)
    assert float(output_page.mediabox.height) / PT_PER_MM == pytest.approx(SCAN_CROP_HEIGHT_MM)
    assert _image_stream_hashes(output_page) == source_hashes

    with fitz.open(source_path) as source_document:
        source_page = source_document[0]
        visible_top = fitz.Rect(
            source_page.rect.x0,
            source_page.rect.y0,
            source_page.rect.x1,
            source_page.rect.y0 + SCAN_CROP_HEIGHT_MM * PT_PER_MM,
        )
    expected = _render_page(source_path, clip=visible_top)
    actual = _render_page(output_path)
    assert actual.size == expected.size
    difference = ImageChops.difference(actual, expected)
    assert max(channel[1] for channel in difference.getextrema()) <= 2


def test_final_comparison_preserves_scan_stream_and_acroform(tmp_path: Path):
    image_path = tmp_path / "scan.png"
    Image.new("RGB", (240, 160), color="#eeeeee").save(image_path)
    source_path = tmp_path / "rotated-scan.pdf"
    _write_rotated_scan(source_path, image_path)
    output_path = tmp_path / "comparison.pdf"

    register_font()
    write_comparison_pdf(source_path, output_path)

    source_page = PdfReader(str(source_path)).pages[0]
    reader = PdfReader(str(output_path))
    page = reader.pages[0]
    assert page.rotation == 0
    assert float(page.mediabox.width) == pytest.approx(595.2)
    assert float(page.mediabox.height) / PT_PER_MM == pytest.approx(SCAN_CROP_HEIGHT_MM)
    assert _image_stream_hashes(page) == _image_stream_hashes(source_page)

    field_map = reader.get_fields() or {}
    widgets = [
        reference.get_object()
        for reference in page.get("/Annots", []) or []
        if reference.get_object().get("/Subtype") == "/Widget"
    ]
    assert len(field_map) == len(fields()) == 75
    assert len(widgets) == 75
    assert len(set(field_map)) == 75
    for widget in widgets:
        appearance = widget.get("/AP")
        assert appearance is not None
        normal = appearance.get_object().get("/N")
        assert normal is not None
        assert normal.get_object().get_data()


def test_runtime_field_coordinates_use_the_same_original_size_mapping():
    assert SOURCE_CROP_LEFT == 118
    assert SOURCE_CROP_TOP == 30
    assert SOURCE_RASTER_WIDTH == 1489
    assert SOURCE_RASTER_HEIGHT == 2105
    assert SOURCE_PAGE_WIDTH_PT == pytest.approx(595.2)
    assert SOURCE_PAGE_HEIGHT_PT == pytest.approx(841.68)
    assert TEXT_FIELD_EXTRA_INSET_MM == REGULAR_TEXT_FIELD_EXTRA_INSET_MM

    spec_map = {spec.name: spec for spec in fields()}
    for name, runtime_rect in REGULAR_TEMPLATE_FIELDS.items():
        spec = spec_map[name]
        assert runtime_rect == pytest.approx(
            _mapped_rect_mm(spec.left, spec.top, spec.right, spec.bottom),
            abs=1e-6,
        )

    raw_row_columns = {
        "occurred_month": (36, 96),
        "occurred_day": (96, 163),
        "description": (163, 748),
        "document_count": (750, 858),
        "remark": (1137, 1303),
    }
    for name, (left, right) in raw_row_columns.items():
        mapped = _mapped_rect_mm(left, 0, right, 1)
        assert REGULAR_ROW_FIELDS[name] == pytest.approx((mapped[0], mapped[2]), abs=1e-6)

    for runtime_rect, (top, bottom) in zip(
        REGULAR_ROW_RECTS_MM,
        zip(ROW_BOUNDARIES[:-1], ROW_BOUNDARIES[1:], strict=True),
        strict=True,
    ):
        mapped = _mapped_rect_mm(0, top, 1, bottom)
        assert runtime_rect == pytest.approx((mapped[1], mapped[3]), abs=1e-6)

    for runtime_rect, (left, right) in zip(
        REGULAR_AMOUNT_GRID_RECTS_MM,
        zip(AMOUNT_BOUNDARIES[:-1], AMOUNT_BOUNDARIES[1:], strict=True),
        strict=True,
    ):
        mapped = _mapped_rect_mm(left, 0, right, 1)
        assert runtime_rect == pytest.approx((mapped[0], mapped[2]), abs=1e-6)

    total_mapped = _mapped_rect_mm(0, 497, 1, 557)
    assert REGULAR_TOTAL_ROW_TOP_MM == pytest.approx(total_mapped[1], abs=1e-6)
    assert REGULAR_TOTAL_ROW_HEIGHT_MM == pytest.approx(total_mapped[3], abs=1e-6)
