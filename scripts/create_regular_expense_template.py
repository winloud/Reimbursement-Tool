from __future__ import annotations

import argparse
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DecodedStreamObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
)
from reportlab.lib.colors import Color, HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


PAGE_WIDTH, PAGE_HEIGHT = 595.0, 298.0
SCAN_WIDTH, SCAN_HEIGHT = 1350.0, 676.0
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
TEXT_FIELD_EXTRA_INSET = 10
AMOUNT_LABELS = ("百", "十", "万", "千", "百", "十", "元", "角", "分")
AMOUNT_TOOLTIPS = ("百万位", "十万位", "万位", "千位", "百位", "十位", "元位", "角位", "分位")
SCAN_CROP = (118 / 1489, 30 / 2105, 1468 / 1489, 706 / 2105)


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
    return value / SCAN_WIDTH * PAGE_WIDTH


def y_pt(value: float) -> float:
    return PAGE_HEIGHT - value / SCAN_HEIGHT * PAGE_HEIGHT


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
) -> None:
    for index, char in enumerate(text):
        char_width = pdfmetrics.stringWidth(char, STATIC_FONT, font_size)
        text_object = c.beginText(x_pt(x) - char_width / 2, y_pt(first_y + index * step))
        text_object.setFont(STATIC_FONT, font_size)
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
    c.setLineWidth(width)
    c.line(x_pt(x1), y_pt(y1), x_pt(x2), y_pt(y2))


def draw_logo(c: canvas.Canvas) -> None:
    center_x, center_y, radius = x_pt(72), y_pt(54), x_pt(31)
    c.setLineWidth(1.35)
    c.circle(center_x, center_y, radius, stroke=1, fill=0)
    c.setLineWidth(0.85)
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
    box_text(c, "127", 42, 84, 103, 111, font_size=8.2, char_space=1.8, stroke_width=0.18)


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
    c.setLineWidth(0.75)
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
        vertical_text(c, "青联纸品", 17, 450, 25, 8.5)
        vertical_text(c, "127", 17, 569, 18, 8.2, stroke_width=0.18)
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
    c.setSubject("普通报销单，595 x 298 pt")
    draw_background(c)
    if interactive:
        add_fields(c, fields(), calibration_style=False)
    c.showPage()
    c.save()


def draw_scan_background(c: canvas.Canvas, scan_source: Path) -> None:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("生成扫描对照版需要 PyMuPDF（fitz）") from exc

    with fitz.open(scan_source) as document:
        if not document.page_count:
            raise ValueError(f"扫描 PDF 没有页面: {scan_source}")
        page = document[0]
        page_rect = page.rect
        left, top, right, bottom = SCAN_CROP
        clip = fitz.Rect(
            page_rect.x0 + page_rect.width * left,
            page_rect.y0 + page_rect.height * top,
            page_rect.x0 + page_rect.width * right,
            page_rect.y0 + page_rect.height * bottom,
        )
        pixmap = page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=clip, alpha=False)
        image = ImageReader(BytesIO(pixmap.tobytes("png")))
        c.drawImage(image, 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT, preserveAspectRatio=False, mask="auto")


def write_comparison_pdf(scan_source: Path, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    c.setTitle("普通报销单-扫描矢量填表域对照")
    c.setAuthor("报销单工具")
    c.setSubject("扫描底图 + 半透明洋红矢量底稿 + 蓝色 AcroForm 填表域")
    draw_scan_background(c, scan_source)
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
