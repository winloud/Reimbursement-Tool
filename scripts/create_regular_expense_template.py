from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from pypdf import PageObject, PdfReader, PdfWriter, Transformation
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DecodedStreamObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    RectangleObject,
)
from reportlab.lib.colors import Color, HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = 595.0, 298.0
PT_PER_MM = 72.0 / 25.4
SCAN_CROP_HEIGHT_MM = 105.13

# The first calibration pass used a 1350 x 676 local crop cut from a
# 1489 x 2105 preview of the full A4 scan, then incorrectly stretched that
# crop to the output page. Keep the manually tuned local coordinates, but map
# them back through the original crop offset and the source PDF's physical
# page size. This is a translation/crop calibration only; the source scan is
# never scaled or rasterized when the comparison PDF is assembled.
SCAN_WIDTH, SCAN_HEIGHT = 1350.0, 676.0
SOURCE_RASTER_WIDTH, SOURCE_RASTER_HEIGHT = 1489.0, 2105.0
SOURCE_CROP_LEFT, SOURCE_CROP_TOP = 118.0, 30.0
SOURCE_PAGE_WIDTH_PT, SOURCE_PAGE_HEIGHT_PT = 595.2, 841.68
SOURCE_X_PT_PER_UNIT = SOURCE_PAGE_WIDTH_PT / SOURCE_RASTER_WIDTH
SOURCE_Y_PT_PER_UNIT = SOURCE_PAGE_HEIGHT_PT / SOURCE_RASTER_HEIGHT
LEGACY_X_PT_PER_UNIT = PAGE_WIDTH / SCAN_WIDTH
LEGACY_Y_PT_PER_UNIT = PAGE_HEIGHT / SCAN_HEIGHT
VECTOR_STYLE_SCALE = (
    SOURCE_X_PT_PER_UNIT / LEGACY_X_PT_PER_UNIT
    + SOURCE_Y_PT_PER_UNIT / LEGACY_Y_PT_PER_UNIT
) / 2
# The scan's printed grid is about 0.15 mm to the right of the exact preview
# crop mapping (well within the scanned stroke width). Keep that final manual
# calibration explicit and independent from the source-page crop operation.
VECTOR_X_OFFSET_MM = 0.15
FORM_GREEN = HexColor("#3f9265")
COMPARISON_MAGENTA = HexColor("#ed245f")
FIELD_BORDER = HexColor("#1d5eff")
FIELD_TEXT = HexColor("#003399")
FIELD_FILL = Color(0.92, 0.96, 1.0)
STATIC_FONT = "RegularExpenseKai"
TITLE_FONT = "RegularExpenseTitle"
FONT_CANDIDATES = (
    Path("C:/Windows/Fonts/simkai.ttf"),
    Path("C:/Windows/Fonts/kaiti.ttf"),
    Path("C:/Windows/Fonts/STKAITI.TTF"),
)
TITLE_FONT_CANDIDATES = (
    Path("C:/Windows/Fonts/simhei.ttf"),
    Path("C:/Windows/Fonts/SIMHEI.TTF"),
)
AMOUNT_BOUNDARIES = (860, 890, 920, 952, 981, 1012, 1043, 1072, 1102, 1133)
ROW_BOUNDARIES = (256, 315, 376, 436, 497)
TEXT_FIELD_EXTRA_INSET_MM = 1.5
TEXT_FIELD_EXTRA_INSET = TEXT_FIELD_EXTRA_INSET_MM * PT_PER_MM / SOURCE_X_PT_PER_UNIT
AMOUNT_LABELS = ("百", "十", "万", "千", "百", "十", "元", "角", "分")
AMOUNT_TOOLTIPS = ("百万位", "十万位", "万位", "千位", "百位", "十位", "元位", "角位", "分位")


@dataclass(frozen=True)
class FieldSpec:
    name: str
    left: float
    top: float
    right: float
    bottom: float
    tooltip: str
    font_size: float = 8.0
    maxlen: int = 100
    centered: bool = True


def x_pt(value: float) -> float:
    return (SOURCE_CROP_LEFT + value) * SOURCE_X_PT_PER_UNIT + VECTOR_X_OFFSET_MM * PT_PER_MM


def x_length_pt(value: float) -> float:
    return value * SOURCE_X_PT_PER_UNIT


def y_pt(value: float) -> float:
    return SCAN_CROP_HEIGHT_MM * PT_PER_MM - (
        SOURCE_CROP_TOP + value
    ) * SOURCE_Y_PT_PER_UNIT


def scan_rect(left: float, top: float, right: float, bottom: float) -> tuple[float, float, float, float]:
    return x_pt(left), y_pt(bottom), x_pt(right) - x_pt(left), y_pt(top) - y_pt(bottom)


def register_font() -> None:
    for path in FONT_CANDIDATES:
        if path.exists():
            pdfmetrics.registerFont(TTFont(STATIC_FONT, str(path)))
            break
    else:
        raise FileNotFoundError("未找到 simkai.ttf 或可用楷体字体")
    for path in TITLE_FONT_CANDIDATES:
        if path.exists():
            pdfmetrics.registerFont(TTFont(TITLE_FONT, str(path)))
            break
    else:
        raise FileNotFoundError("未找到 simhei.ttf 或可用黑体字体")


def baseline(y: float, height: float, font_size: float) -> float:
    ascent, descent = pdfmetrics.getAscentDescent(STATIC_FONT, font_size)
    return y + (height - (ascent - descent)) / 2 - descent


def box_text(
    c: canvas.Canvas,
    text: str,
    left: float,
    top: float,
    right: float,
    bottom: float,
    *,
    font_size: float = 8.5,
    char_space: float = 0.0,
    stroke_width: float = 0.22,
) -> None:
    font_size *= VECTOR_STYLE_SCALE
    char_space *= VECTOR_STYLE_SCALE
    stroke_width *= VECTOR_STYLE_SCALE
    x, y, width, height = scan_rect(left, top, right, bottom)
    text_width = sum(pdfmetrics.stringWidth(ch, STATIC_FONT, font_size) for ch in text)
    text_width += max(len(text) - 1, 0) * char_space
    text_object = c.beginText(x + (width - text_width) / 2, baseline(y, height, font_size))
    text_object.setFont(STATIC_FONT, font_size)
    text_object.setCharSpace(char_space)
    text_object.setTextRenderMode(2)
    c.saveState()
    c.setLineWidth(stroke_width)
    text_object.textOut(text)
    c.drawText(text_object)
    c.restoreState()


def vertical_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    first_y: float,
    step: float,
    font_size: float,
    stroke_width: float = 0.2,
    horizontal_scale: float = 100.0,
) -> None:
    font_size *= VECTOR_STYLE_SCALE
    stroke_width *= VECTOR_STYLE_SCALE
    for index, char in enumerate(text):
        char_width = pdfmetrics.stringWidth(char, STATIC_FONT, font_size) * horizontal_scale / 100
        text_object = c.beginText(x_pt(x) - char_width / 2, y_pt(first_y + index * step))
        text_object.setFont(STATIC_FONT, font_size)
        text_object.setHorizScale(horizontal_scale)
        text_object.setTextRenderMode(2)
        c.saveState()
        c.setLineWidth(stroke_width)
        text_object.textOut(char)
        c.drawText(text_object)
        c.restoreState()


def placed_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    baseline_from_top: float,
    *,
    font_name: str,
    font_size: float,
    char_space: float = 0.0,
    stroke_width: float = 0.22,
) -> None:
    font_size *= VECTOR_STYLE_SCALE
    char_space *= VECTOR_STYLE_SCALE
    stroke_width *= VECTOR_STYLE_SCALE
    text_object = c.beginText(x_pt(x), y_pt(baseline_from_top))
    text_object.setFont(font_name, font_size)
    text_object.setCharSpace(char_space)
    text_object.setTextRenderMode(2)
    c.saveState()
    c.setLineWidth(stroke_width)
    text_object.textOut(text)
    c.drawText(text_object)
    c.restoreState()


def line(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float, width: float = 0.65) -> None:
    c.setLineWidth(width * VECTOR_STYLE_SCALE)
    c.line(x_pt(x1), y_pt(y1), x_pt(x2), y_pt(y2))


def draw_logo(c: canvas.Canvas) -> None:
    center_x, center_y, radius = x_pt(68.5), y_pt(52), x_length_pt(38.5)
    c.setLineWidth(1.35 * VECTOR_STYLE_SCALE)
    c.circle(center_x, center_y, radius, stroke=1, fill=0)
    c.setLineWidth(0.85 * VECTOR_STYLE_SCALE)
    c.arc(center_x - radius * 0.72, center_y - radius * 0.32, center_x + radius * 0.72, center_y + radius * 0.55, 195, 205)
    c.bezier(
        center_x - radius * 0.62,
        center_y - radius * 0.12,
        center_x - radius * 0.05,
        center_y - radius * 0.62,
        center_x + radius * 0.18,
        center_y + radius * 0.58,
        center_x + radius * 0.64,
        center_y + radius * 0.12,
    )
    box_text(c, "青", 43, 36, 70, 63, font_size=6.5)
    box_text(c, "联", 75, 36, 102, 63, font_size=6.5)
    box_text(c, "127", 38, 94.2, 99, 121.2, font_size=9.2, char_space=1.8, stroke_width=0.18)


def draw_background(
    c: canvas.Canvas,
    *,
    clear_page: bool = True,
    color=FORM_GREEN,
    alpha: float = 1.0,
    include_branding_overlay: bool = True,
) -> None:
    if clear_page:
        c.setFillColor(white)
        c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    if alpha < 1:
        c.setStrokeAlpha(alpha)
        c.setFillAlpha(alpha)
    c.setLineCap(0)
    c.setLineJoin(0)
    if include_branding_overlay:
        draw_logo(c)
    placed_text(
        c,
        "报   销   单",
        486.009,
        59.415,
        font_name=TITLE_FONT,
        font_size=26,
        char_space=1.0,
        stroke_width=0.48,
    )
    line(c, 450, 70, 895, 70, 1.1)
    box_text(c, "年", 609, 88, 654, 134, font_size=12.5, stroke_width=0.26)
    box_text(c, "月", 712, 88, 759, 134, font_size=12.5, stroke_width=0.26)
    box_text(c, "日", 814, 88, 862, 134, font_size=12.5, stroke_width=0.26)
    x, y, width, height = scan_rect(1110, 76, 1303, 116)
    c.setLineWidth(0.75 * VECTOR_STYLE_SCALE)
    c.rect(x, y, width, height, stroke=1, fill=0)
    placed_text(
        c,
        "记账凭证附件",
        1121.757,
        104.580,
        font_name=STATIC_FONT,
        font_size=11.5,
        char_space=1.725,
        stroke_width=0.22,
    )

    line(c, 35, 136, 1303, 136, 0.9)
    for horizontal in (256, 315, 376, 436, 497, 557, 619):
        line(c, 35, horizontal, 1303, horizontal, 0.75)
    line(c, 35, 136, 35, 619, 0.9)
    line(c, 1303, 136, 1303, 619, 0.9)
    line(c, 35, 198, 163, 198)
    line(c, 858, 198, 1137, 198)
    line(c, 96, 198, 96, 497)
    line(c, 163, 136, 163, 497)
    for vertical in (746, 750, 857, 860, 1133, 1137):
        line(c, vertical, 136, vertical, 619, 0.55)
    for vertical in AMOUNT_BOUNDARIES[1:-1]:
        line(c, vertical, 198, vertical, 557, 0.55)
    line(c, 233, 557, 233, 619, 0.55)

    box_text(c, "发生日期", 35, 140, 163, 202, font_size=11.5, char_space=0.5)
    box_text(c, "月", 39, 196, 100, 254, font_size=11.5)
    box_text(c, "日", 99, 196, 166, 254, font_size=11.5)
    box_text(c, "报销内容", 165, 142, 748, 258, font_size=12.5, char_space=36.5, stroke_width=0.26)
    box_text(c, "单据", 752, 155, 861, 211, font_size=11.5, char_space=9.5)
    box_text(c, "张数", 752, 197, 861, 250, font_size=11.5, char_space=9.5)
    box_text(c, "金额", 865, 142, 1137, 200, font_size=12, char_space=44)
    for label, left, right in zip(AMOUNT_LABELS, AMOUNT_BOUNDARIES[:-1], AMOUNT_BOUNDARIES[1:], strict=True):
        box_text(c, label, left, 196, right, 256, font_size=10.2)
    box_text(c, "备注", 1145, 140, 1305, 258, font_size=13, char_space=18)
    box_text(c, "合计人民币（大写）", 59, 498, 274, 556, font_size=11.5, char_space=-0.5)
    box_text(c, "主管意见", 33, 557, 231, 619, font_size=11, char_space=6)
    box_text(c, "报销人签章", 870, 557, 1150, 619, font_size=11, char_space=7.5)
    box_text(c, "复核", 129, 620, 259, 676, font_size=11, char_space=1.5)
    box_text(c, "出纳", 430, 620, 585, 676, font_size=11, char_space=1)
    box_text(c, "报销人", 782, 620, 932, 676, font_size=11, char_space=1.2)
    if include_branding_overlay:
        vertical_text(c, "青联纸品", 17, 487, 25, 8.5, horizontal_scale=118)
        vertical_text(c, "127", 17, 596, 11.5, 8.2, stroke_width=0.18, horizontal_scale=160)
    vertical_text(c, "附件", 1328.269, 229.130, 30, 10.5)
    vertical_text(c, "张", 1328.269, 416.611, 30, 10.5)
    c.restoreState()


def fields() -> list[FieldSpec]:
    result = [
        FieldSpec("report_date_year", 550, 97.463, 615, 127.463, "报销日期-年", 8, 4),
        FieldSpec("report_date_month", 665, 97.463, 715, 127.463, "报销日期-月", 8, 2),
        FieldSpec("report_date_day", 770, 97.463, 820, 127.463, "报销日期-日", 8, 2),
        FieldSpec("attachment_count", 1308, 298, 1347, 356, "附件张数", 8, 4),
    ]
    for row_no, (top, bottom) in enumerate(zip(ROW_BOUNDARIES[:-1], ROW_BOUNDARIES[1:], strict=True), 1):
        top, bottom = top + 2, bottom - 2
        result.extend(
            (
                FieldSpec(f"occurred_month_{row_no}", 38, top, 94, bottom, f"第{row_no}行 发生月", 8, 2),
                FieldSpec(f"occurred_day_{row_no}", 98, top, 161, bottom, f"第{row_no}行 发生日", 8, 2),
                FieldSpec(
                    f"description_{row_no}",
                    163 + TEXT_FIELD_EXTRA_INSET,
                    top,
                    746 - TEXT_FIELD_EXTRA_INSET,
                    bottom,
                    f"第{row_no}行 报销内容",
                    8,
                    100,
                    False,
                ),
                FieldSpec(f"document_count_{row_no}", 752, top, 855, bottom, f"第{row_no}行 单据张数", 8, 4),
            )
        )
        for digit_no, (left, right, tooltip) in enumerate(
            zip(AMOUNT_BOUNDARIES[:-1], AMOUNT_BOUNDARIES[1:], AMOUNT_TOOLTIPS, strict=True), 1
        ):
            result.append(FieldSpec(f"amount_digit_{row_no}_{digit_no}", left + 2, top, right - 2, bottom, f"第{row_no}行 金额{tooltip}", 8, 1))
        result.append(
            FieldSpec(
                f"remark_{row_no}",
                1137 + TEXT_FIELD_EXTRA_INSET,
                top,
                1303 - TEXT_FIELD_EXTRA_INSET,
                bottom,
                f"第{row_no}行 备注",
                8,
                60,
                False,
            )
        )

    result.append(FieldSpec("total_amount_cn", 278.808, 499, 855, 555, "合计人民币大写", 8.5, 50, False))
    for digit_no, (left, right, tooltip) in enumerate(
        zip(AMOUNT_BOUNDARIES[:-1], AMOUNT_BOUNDARIES[1:], AMOUNT_TOOLTIPS, strict=True), 1
    ):
        result.append(FieldSpec(f"total_amount_digit_{digit_no}", left + 2, 499, right - 2, 555, f"合计金额{tooltip}", 8, 1))
    result.extend(
        (
            FieldSpec("supervisor_opinion", 236, 559, 854, 617, "主管意见", 8.5, 100, False),
            FieldSpec("claimant_signature", 1139, 559, 1301, 617, "报销人签章", 8.5, 40),
            FieldSpec("reviewer_signature", 224.538, 625, 449.538, 670, "复核", 8.5, 40),
            FieldSpec("cashier_signature", 539.538, 625, 774.538, 670, "出纳", 8.5, 40),
            FieldSpec("claimant_name", 904.132, 625, 1112.269, 670, "报销人", 8.5, 40),
        )
    )
    return result


def add_fields(c: canvas.Canvas, specs: list[FieldSpec], *, calibration_style: bool) -> None:
    for spec in specs:
        x, y, width, height = scan_rect(spec.left, spec.top, spec.right, spec.bottom)
        c.acroForm.textfield(
            name=spec.name,
            tooltip=spec.tooltip,
            x=x,
            y=y,
            width=width,
            height=height,
            borderStyle="solid",
            borderWidth=0.75 if calibration_style else 0,
            borderColor=FIELD_BORDER if calibration_style else None,
            fillColor=FIELD_FILL if calibration_style else None,
            textColor=FIELD_TEXT,
            fontName="Helvetica",
            fontSize=spec.font_size,
            maxlen=spec.maxlen,
            forceBorder=calibration_style,
            annotationFlags="print",
        )


def write_pdf(path: Path, interactive: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    c.setTitle("普通报销单" + ("-可填写" if interactive else "-矢量模板"))
    c.setAuthor("报销单工具")
    c.setSubject("普通报销单，按原扫描件顶部 105.13 mm 原尺寸校准")
    draw_background(c)
    if interactive:
        add_fields(c, fields(), calibration_style=False)
    c.showPage()
    c.save()


def crop_scan_top_page(scan_source: Path) -> tuple[PageObject, tuple[float, float]]:
    reader = PdfReader(str(scan_source))
    if not reader.pages:
        raise ValueError(f"扫描 PDF 没有页面: {scan_source}")

    page = copy.deepcopy(reader.pages[0])
    page.transfer_rotation_to_content()
    page_left = float(page.mediabox.left)
    page_top = float(page.mediabox.top)
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    crop_height = SCAN_CROP_HEIGHT_MM * PT_PER_MM
    if crop_height > page_height:
        raise ValueError(
            f"扫描 PDF 页面高度不足 {SCAN_CROP_HEIGHT_MM:.2f} mm: "
            f"{page_height / PT_PER_MM:.2f} mm"
        )

    crop_bottom = page_top - crop_height
    page.add_transformation(
        Transformation().translate(tx=-page_left, ty=-crop_bottom)
    )
    box_values = [0, 0, page_width, crop_height]
    page.mediabox = RectangleObject(box_values)
    page.cropbox = RectangleObject(box_values)
    page.trimbox = RectangleObject(box_values)
    page.bleedbox = RectangleObject(box_values)
    page.artbox = RectangleObject(box_values)
    return page, (page_width, crop_height)


def build_comparison_overlay(page_size: tuple[float, float]) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=page_size, pageCompression=1)
    c.setTitle("普通报销单-扫描矢量填表域对照")
    c.setAuthor("报销单工具")
    c.setSubject("原尺寸扫描裁切 + 半透明洋红矢量底稿 + 蓝色 AcroForm 填表域")
    draw_background(
        c,
        clear_page=False,
        color=COMPARISON_MAGENTA,
        alpha=0.72,
        include_branding_overlay=False,
    )
    add_fields(c, fields(), calibration_style=True)
    c.showPage()
    c.save()
    return buffer.getvalue()


def write_comparison_pdf(scan_source: Path, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scan_page, page_size = crop_scan_top_page(scan_source)
    overlay_reader = PdfReader(BytesIO(build_comparison_overlay(page_size)))
    writer = PdfWriter(clone_from=overlay_reader)
    writer.pages[0].merge_page(scan_page, over=False)
    with path.open("wb") as stream:
        writer.write(stream)
    normalize_acroform(path, fields())


def normalize_acroform(path: Path, specs: list[FieldSpec], *, transparent_widgets: bool = False) -> None:
    reader = PdfReader(str(path))
    writer = PdfWriter(clone_from=reader)
    acroform = writer.root_object["/AcroForm"].get_object()
    acroform[NameObject("/NeedAppearances")] = BooleanObject(True)
    alignment = {spec.name: spec.centered for spec in specs}
    for field_ref in acroform["/Fields"]:
        field = field_ref.get_object()
        field[NameObject("/Q")] = NumberObject(1 if alignment.get(str(field.get("/T", "")), True) else 0)
    if transparent_widgets:
        for page in writer.pages:
            for annot_ref in page.get("/Annots", []) or []:
                annot = annot_ref.get_object()
                if annot.get("/Subtype") != "/Widget":
                    continue
                mk = annot.get("/MK")
                if mk:
                    mk = mk.get_object()
                    mk.pop(NameObject("/BG"), None)
                    mk.pop(NameObject("/BC"), None)
                    if not mk:
                        annot.pop(NameObject("/MK"), None)
                annot[NameObject("/Border")] = ArrayObject([NumberObject(0), NumberObject(0), NumberObject(0)])
                border_style = annot.get("/BS")
                if border_style:
                    border_style.get_object()[NameObject("/W")] = FloatObject(0)
                rect = [float(value) for value in annot["/Rect"]]
                appearance = DecodedStreamObject()
                appearance.set_data(b"q Q")
                appearance.update(
                    {
                        NameObject("/Type"): NameObject("/XObject"),
                        NameObject("/Subtype"): NameObject("/Form"),
                        NameObject("/FormType"): NumberObject(1),
                        NameObject("/BBox"): ArrayObject(
                            [
                                FloatObject(0),
                                FloatObject(0),
                                FloatObject(rect[2] - rect[0]),
                                FloatObject(rect[3] - rect[1]),
                            ]
                        ),
                        NameObject("/Resources"): DictionaryObject(),
                    }
                )
                annot[NameObject("/AP")] = DictionaryObject(
                    {NameObject("/N"): writer._add_object(appearance)}
                )
    normalized = path.with_suffix(".normalized.pdf")
    with normalized.open("wb") as stream:
        writer.write(stream)
    normalized.replace(path)


def build(clean_output: Path, interactive_output: Path) -> None:
    register_font()
    write_pdf(clean_output, False)
    write_pdf(interactive_output, True)
    normalize_acroform(interactive_output, fields(), transparent_widgets=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="创建普通报销单矢量模板与 AcroForm 版本")
    parser.add_argument("--clean-output", type=Path, default=Path("backend/templates/regular_expense_template.pdf"))
    parser.add_argument("--interactive-output", type=Path, default=Path("output/pdf/普通报销单_ReportLab_填表域_v1_0_0.pdf"))
    parser.add_argument("--scan-source", type=Path)
    parser.add_argument("--comparison-output", type=Path)
    args = parser.parse_args()
    build(args.clean_output, args.interactive_output)
    if bool(args.scan_source) != bool(args.comparison_output):
        parser.error("--scan-source 和 --comparison-output 必须同时提供")
    if args.scan_source and args.comparison_output:
        write_comparison_pdf(args.scan_source, args.comparison_output)
    print(f"clean={args.clean_output}")
    print(f"interactive={args.interactive_output}")
    if args.comparison_output:
        print(f"comparison={args.comparison_output}")
    print(f"fields={len(fields())}")
    print(f"page_size={PAGE_WIDTH}x{PAGE_HEIGHT} pt")


if __name__ == "__main__":
    main()
