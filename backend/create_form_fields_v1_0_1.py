# -*- coding: utf-8 -*-
"""
为 报销单.pdf 叠加 AcroForm 填表文本框。V1.0.1

坐标约定：
- 全部字段使用 PDF 编辑器里容易核对的毫米坐标，格式统一为：
  X / Y / width / height。
- X：左距，单位 mm。
- Y：字段上边缘的 PDF Y 坐标，单位 mm。
  注意：PDF-XChange/Acrobat 在对象属性里看到的“顶部/Top”通常是 PDF 坐标，
  原点在页面左下角，所以页面上方字段的 Y 数值会比较大。
- width / height：宽度/高度，单位 mm。

本脚本只做“填表域位置”和“字段命名”这两件事：
- 不使用 DXF 坐标。
- 不修改底层 PDF 页面内容。
- 不添加 JS 计算。
- 不添加日期选择器。
- 不添加下拉框/复选框；交通工具、早中晚等都先作为普通文本框处理。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, DictionaryObject, NameObject

BASE = Path("templates/报销单.pdf")
OVERLAY = Path("outputs/报销单_reportlab_fields_overlay_v1_0_1.pdf")
OUT = Path("outputs/报销单_ReportLab_填表域_v1_0_1.pdf")

PT_PER_MM = 72.0 / 25.4

# 测试版保留蓝色边框，方便在 PDF 编辑器里核对位置。
FIELD_BORDER = HexColor("#1d5eff")
FIELD_TEXT = HexColor("#003399")
FIELD_FILL = Color(0.92, 0.96, 1.0, alpha=0.12)


@dataclass(frozen=True)
class Field:
    name: str
    x_mm: float
    y_mm: float
    width_mm: float
    height_mm: float
    tooltip: str = ""
    font_size: float = 8
    maxlen: int = 100


def rect_from_pdf_mm(x_mm: float, y_mm: float, width_mm: float, height_mm: float):
    """PDF 编辑器 mm 坐标 -> ReportLab pt 坐标。"""
    x = x_mm * PT_PER_MM
    y = (y_mm - height_mm) * PT_PER_MM
    w = width_mm * PT_PER_MM
    h = height_mm * PT_PER_MM
    return x, y, w, h


def add_text_field(c: canvas.Canvas, field: Field):
    x, y, w, h = rect_from_pdf_mm(
        field.x_mm,
        field.y_mm,
        field.width_mm,
        field.height_mm,
    )
    c.acroForm.textfield(
        name=field.name,
        tooltip=field.tooltip or field.name,
        x=x,
        y=y,
        width=w,
        height=h,
        borderStyle="solid",
        borderWidth=0.8,
        borderColor=FIELD_BORDER,
        fillColor=FIELD_FILL,
        textColor=FIELD_TEXT,
        fontName="Helvetica",
        fontSize=field.font_size,
        maxlen=field.maxlen,
        forceBorder=True,
    )


# 下面这些字段坐标从已手工校对的 create_form_fields.py 继承，单位 mm。
# 每个字段均使用 PDF 编辑器一致的格式：X, Y, width, height。
ROW_RECTS = [
    (1, 70.754, 6.000),
    (2, 64.754, 6.006),
    (3, 58.748, 6.006),
    (4, 52.742, 6.006),
    (5, 46.736, 6.006),
    (6, 40.730, 6.001),
    (7, 34.729, 6.006),
]

# 行程字段遵循 expense-reimbursement-plan.md：xxx_1 到 xxx_7。
# 额外保留模板中的补贴/住勤费明细格，使用 subsidy_*_{n} / lodging_*_{n} 扩展字段名。
TRIP_COLUMN_RECTS = [
    (24.188, 4.805, "depart_month", "出发月", 7),
    (28.993, 4.403, "depart_day", "出发日", 7),
    (33.396, 4.603, "depart_hour", "出发时", 7),
    (37.999, 11.314, "depart_place", "出发地点", 8),
    (49.911, 4.408, "arrive_month", "到达月", 7),
    (54.319, 4.403, "arrive_day", "到达日", 7),
    (58.722, 4.402, "arrive_hour", "到达时", 7),
    (63.124, 11.811, "arrive_place", "到达地点", 8),
    (75.539, 10.810, "transport", "交通工具", 8),
    (86.349, 9.409, "invoice_count", "单据张数", 8),
    (95.758, 12.409, "transport_fare", "车船费", 8),
    (108.770, 4.503, "subsidy_breakfast", "途中补贴-早", 7),
    (113.273, 4.504, "subsidy_lunch", "途中补贴-中", 7),
    (117.777, 4.503, "subsidy_dinner", "途中补贴-晚", 7),
    (122.280, 8.112, "subsidy_night", "途中补贴-夜间", 7),
    (130.392, 10.610, "subsidy_amount", "途中补贴金额", 8),
    (141.600, 4.005, "lodging_breakfast", "住勤费-早", 7),
    (145.605, 4.001, "lodging_lunch", "住勤费-中", 7),
    (149.606, 4.006, "lodging_dinner", "住勤费-晚", 7),
    (153.612, 10.610, "lodging_amount", "住勤费金额", 8),
]

# 其他费用是模板固定 7 行，对应规划文档中的 7 类费用。
OTHER_EXPENSE_CATEGORIES = [
    ("luggage", "行李费"),
    ("city_transport", "市内车费"),
    ("accommodation", "住宿费"),
    ("postal", "邮电费"),
    ("no_sleeper", "不买卧铺补贴"),
    ("toll", "过路费"),
    ("fuel_subsidy", "油补"),
]
OTHER_COUNT_X = 180.038
OTHER_COUNT_WIDTH = 8.107
OTHER_AMOUNT_X = 188.145
OTHER_AMOUNT_WIDTH = 11.367

# 合计行。规划文档只规定了 total_amount / total_amount_cn 等底部总额字段；
# 这里保留表格合计行中的分类小计，使用清晰的 total_* 扩展字段名。
TOTAL_FIELD_RECTS = [
    Field("total_invoice_count", 86.349, 28.723, 9.409, 6.249, "单据张数合计", 8),
    Field("total_transport_fare", 95.758, 28.723, 12.409, 6.249, "车船费合计", 8),
    Field("subsidy_days", 122.280, 28.723, 8.112, 6.249, "补贴天数", 8),
    Field("subsidy_amount", 130.392, 28.723, 10.610, 6.249, "途中补贴合计", 8),
    Field("total_lodging_amount", 153.612, 28.723, 10.610, 6.249, "住勤费合计", 8),
    Field("total_other_count", 180.038, 28.723, 8.107, 6.249, "其他费用单据合计", 8),
    Field("total_other_amount", 188.145, 28.723, 11.367, 6.249, "其他费用金额合计", 8),
]

BOTTOM_FIELD_RECTS = [
    Field("total_amount", 121.55, 21.92, 15.31, 5.72, "报销总额", 8),
    Field("total_amount_cn", 46.964, 22.474, 70, 8.012, "人民币大写", 8),
    Field("advance_amount", 146.7, 18.24, 19, 2.9, "预支旅费", 8),
    Field("advance_month", 146.55, 22.57, 7.059, 3.8, "预支旅费-月", 7, 10),
    Field("advance_day", 156.55, 22.57, 7.607, 3.8, "预支旅费-日", 7, 10),
    Field("shortfall", 183.25, 22.57, 16.27, 4.154, "补领不足", 8),
    Field("surplus", 183.25, 18.62, 16.27, 4.154, "归还多余", 8),
    Field("manager_signature", 44.78, 14.462, 30, 8.462, "主管签字", 8),
    Field("auditor_signature", 96.83, 14.462, 30, 8.462, "审核签字", 8),
    Field("applicant_signature", 160, 14.462, 30, 8.462, "报销人签字", 8),
]


def build_fields() -> list[Field]:
    fields: list[Field] = [
        # 页眉字段。格式：Field(name, X, Y, width, height, tooltip, font_size)
        Field("department", 38.142, 85.672, 31.491, 6.503, "部门", 9),
        Field("employee_name", 86.349, 85.672, 41.434, 6.503, "出差人", 9),
        Field("purpose", 147.950, 85.672, 51.562, 6.503, "出差事由", 9),
        # 报销日期区域没有完整表格线，这里按 PDF 上文字间距预留为普通文本框。
        Field("report_date_year", 161.000, 90.300, 11, 4, "报销日期-年", 8, 10),
        Field("report_date_month", 177.200, 90.300, 6, 4, "报销日期-月", 8, 10),
        Field("report_date_day", 188.000, 90.300, 6, 4, "报销日期-日", 8, 10),
    ]

    for row_no, y, height in ROW_RECTS:
        for x, width, key, label, font_size in TRIP_COLUMN_RECTS:
            fields.append(Field(f"{key}_{row_no}", x, y, width, height, f"第{row_no}行 {label}", font_size))

        category_key, category_label = OTHER_EXPENSE_CATEGORIES[row_no - 1]
        fields.append(
            Field(
                f"{category_key}_count",
                OTHER_COUNT_X,
                y,
                OTHER_COUNT_WIDTH,
                height,
                f"{category_label} 单据张数",
                8,
            )
        )
        fields.append(
            Field(
                f"{category_key}_amount",
                OTHER_AMOUNT_X,
                y,
                OTHER_AMOUNT_WIDTH,
                height,
                f"{category_label} 金额",
                8,
            )
        )

    fields.extend(TOTAL_FIELD_RECTS)
    fields.extend(BOTTOM_FIELD_RECTS)

    return fields


def build_overlay(path: Path, page_size: tuple[float, float]):
    c = canvas.Canvas(str(path), pagesize=page_size)
    for field in build_fields():
        add_text_field(c, field)
    c.save()


def merge_overlay(base: Path, overlay: Path, out: Path):
    base_reader = PdfReader(str(base))
    overlay_reader = PdfReader(str(overlay))
    writer = PdfWriter(clone_from=base_reader)

    base_page = writer.pages[0]
    overlay_page = overlay_reader.pages[0]

    annots = base_page.get("/Annots")
    if annots is None:
        annots = ArrayObject()
        base_page[NameObject("/Annots")] = annots

    acro = writer._root_object.get("/AcroForm")
    if acro is None:
        acro = DictionaryObject()
        writer._root_object[NameObject("/AcroForm")] = acro
    else:
        acro = acro.get_object()

    fields = acro.get("/Fields")
    if fields is None:
        fields = ArrayObject()
        acro[NameObject("/Fields")] = fields

    # 拷贝 ReportLab 默认资源，确保字段外观字体可用。
    overlay_acro = overlay_reader.trailer["/Root"].get("/AcroForm")
    if overlay_acro:
        overlay_acro = overlay_acro.get_object()
        if "/DR" in overlay_acro:
            acro[NameObject("/DR")] = overlay_acro["/DR"].clone(writer)
        if "/DA" in overlay_acro:
            acro[NameObject("/DA")] = overlay_acro["/DA"]

    for annot_ref in overlay_page["/Annots"]:
        annot_obj = annot_ref.get_object().clone(writer)
        annot_obj[NameObject("/P")] = base_page.indirect_reference
        new_ref = writer._add_object(annot_obj)
        annots.append(new_ref)
        fields.append(new_ref)

    acro[NameObject("/NeedAppearances")] = BooleanObject(True)

    with open(out, "wb") as f:
        writer.write(f)


def main():
    base_reader = PdfReader(str(BASE))
    page = base_reader.pages[0]
    page_size = (float(page.mediabox.width), float(page.mediabox.height))

    build_overlay(OVERLAY, page_size)
    merge_overlay(BASE, OVERLAY, OUT)

    reader = PdfReader(str(OUT))
    fields = reader.get_fields() or {}
    print(f"输出: {OUT}")
    print(f"叠加层: {OVERLAY}")
    print(f"字段数: {len(fields)}")
    print(f"页面尺寸: {reader.pages[0].mediabox}")
    print("department 字段坐标(mm): X=38.142, Y=85.672, width=31.491, height=6.503")


if __name__ == "__main__":
    main()
