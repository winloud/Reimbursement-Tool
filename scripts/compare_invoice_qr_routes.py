import csv
import shutil
import sys
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.invoice_parser import (
    extract_fields_from_text,
    parse_qr_payload,
    select_amount,
)


SAMPLE_DIR = ROOT / "test example"
MODEL_DIR = ROOT / "assets" / "opencv-wechat-qrcode"
REPORT_MD = ROOT / "docs" / "testing" / "invoice_qr_route_comparison_2026-06-09.md"
REPORT_CSV = ROOT / "docs" / "testing" / "invoice_qr_route_comparison_2026-06-09.csv"


def render_pdf_first_page(path: Path) -> dict[str, Any]:
    import fitz
    from PIL import Image

    with fitz.open(str(path)) as doc:
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csRGB, alpha=False)
        return {
            "text": page.get_text("text") or "",
            "rgb": Image.frombytes("RGB", (pix.w, pix.h), pix.samples),
        }


def decode_zxing(rgb_image: Any) -> list[str]:
    import zxingcpp

    return [
        barcode.text
        for barcode in zxingcpp.read_barcodes(rgb_image, formats=zxingcpp.BarcodeFormat.QRCode)
        if getattr(barcode, "text", "")
    ]


def decode_opencv(rgb_image: Any) -> tuple[list[str], list[str]]:
    import cv2
    import numpy as np

    def append_unique(values: list[str], candidates: Any, source: str) -> None:
        if isinstance(candidates, str):
            candidates = [candidates]
        for candidate in candidates or []:
            text = str(candidate).strip()
            if text and text not in values:
                values.append(text)
                sources.append(source)

    bgr = cv2.cvtColor(np.array(rgb_image), cv2.COLOR_RGB2BGR)
    payloads: list[str] = []
    sources: list[str] = []
    safe_model_dir = Path(tempfile.gettempdir()) / "reimbursement-opencv-wechat-models-compare"
    safe_model_dir.mkdir(parents=True, exist_ok=True)
    for name in ("detect.prototxt", "detect.caffemodel", "sr.prototxt", "sr.caffemodel"):
        source = MODEL_DIR / name
        target = safe_model_dir / name
        if not target.exists() or target.stat().st_size != source.stat().st_size:
            shutil.copy2(source, target)

    detector = cv2.wechat_qrcode.WeChatQRCode(
        str(safe_model_dir / "detect.prototxt"),
        str(safe_model_dir / "detect.caffemodel"),
        str(safe_model_dir / "sr.prototxt"),
        str(safe_model_dir / "sr.caffemodel"),
    )
    decoded, _points = detector.detectAndDecode(bgr)
    append_unique(payloads, decoded, "wechat")
    qrcode = cv2.QRCodeDetector()
    try:
        success, decoded_info, _points, _straight = qrcode.detectAndDecodeMulti(bgr)
        if success:
            append_unique(payloads, decoded_info, "detector_multi")
    except Exception:
        pass
    if not payloads:
        decoded, _points, _straight = qrcode.detectAndDecode(bgr)
        append_unique(payloads, decoded, "detector_single")
    return payloads, sources


def final_result(payloads: list[str], text: str) -> dict[str, str | None]:
    text_fields = extract_fields_from_text(text)
    qr_fields: dict[str, Any] = {}
    for payload in payloads:
        parsed = parse_qr_payload(payload)
        if parsed["invoice_no"] or parsed["invoice_date"] or parsed["amount"] > Decimal("0.00"):
            qr_fields = parsed
            break
    amount, _source, _reason = select_amount(qr_fields, text_fields)
    invoice_date = qr_fields.get("invoice_date") or text_fields.get("invoice_date")
    return {
        "invoice_no": qr_fields.get("invoice_no") or text_fields.get("invoice_no"),
        "invoice_date": invoice_date.isoformat() if isinstance(invoice_date, date) else None,
        "amount": str(amount),
    }


def compare_one(path: Path) -> dict[str, Any]:
    rendered = render_pdf_first_page(path)
    zxing_payloads = decode_zxing(rendered["rgb"])
    opencv_payloads, opencv_sources = decode_opencv(rendered["rgb"])
    zxing_result = final_result(zxing_payloads, rendered["text"])
    opencv_result = final_result(opencv_payloads, rendered["text"])
    return {
        "file": path.name,
        "status": "ok",
        "zxing_payload_count": len(zxing_payloads),
        "opencv_payload_count": len(opencv_payloads),
        "zxing_payload": "\n".join(zxing_payloads),
        "opencv_payload": "\n".join(opencv_payloads),
        "opencv_sources": "|".join(opencv_sources),
        "zxing_invoice_no": zxing_result["invoice_no"],
        "opencv_invoice_no": opencv_result["invoice_no"],
        "zxing_invoice_date": zxing_result["invoice_date"],
        "opencv_invoice_date": opencv_result["invoice_date"],
        "zxing_amount": zxing_result["amount"],
        "opencv_amount": opencv_result["amount"],
        "same_final_result": zxing_result == opencv_result,
        "same_payload_set": set(zxing_payloads) == set(opencv_payloads),
        "zxing_method": "qrcode" if zxing_payloads else "none",
        "opencv_method": "qrcode" if opencv_payloads else "none",
        "error": "",
    }


def write_reports(rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "file",
        "status",
        "zxing_payload_count",
        "opencv_payload_count",
        "zxing_payload",
        "opencv_payload",
        "opencv_sources",
        "zxing_invoice_no",
        "opencv_invoice_no",
        "zxing_invoice_date",
        "opencv_invoice_date",
        "zxing_amount",
        "opencv_amount",
        "same_final_result",
        "same_payload_set",
        "zxing_method",
        "opencv_method",
        "error",
    ]
    defaults = {
        "status": "error",
        "zxing_payload_count": 0,
        "opencv_payload_count": 0,
        "zxing_payload": "",
        "opencv_payload": "",
        "opencv_sources": "",
        "zxing_invoice_no": None,
        "opencv_invoice_no": None,
        "zxing_invoice_date": None,
        "opencv_invoice_date": None,
        "zxing_amount": "0.00",
        "opencv_amount": "0.00",
        "same_final_result": False,
        "same_payload_set": False,
        "zxing_method": "none",
        "opencv_method": "none",
        "error": "",
    }
    rows = [{**defaults, **row} for row in rows]
    REPORT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_CSV.open("w", encoding="utf-8-sig", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    total = len(rows)
    render_success = sum(1 for row in rows if row["status"] == "ok")
    zxing_success = sum(1 for row in rows if row["zxing_payload_count"])
    opencv_success = sum(1 for row in rows if row["opencv_payload_count"])
    same_payload = sum(1 for row in rows if row["same_payload_set"])
    same_final = sum(1 for row in rows if row["same_final_result"])
    errors = sum(1 for row in rows if row["status"] != "ok")
    denominator = total or 1
    REPORT_MD.write_text(
        "\n".join(
            [
                "# 发票二维码识别路线对照测试",
                "",
                "- 样本目录：`test example/`",
                f"- PDF 样本数：{total}",
                "- 输入处理：PyMuPDF 渲染首页，zoom=2，RGB 图像给 zxing-cpp，BGR 图像给 OpenCV",
                "- OpenCV 路线：WeChatQRCode 模型 + QRCodeDetector multi/single",
                "- zxing 路线：zxing-cpp QRCode",
                "",
                "## 汇总",
                "",
                f"- 渲染成功：{render_success}/{total}",
                f"- zxing-cpp 二维码解码成功：{zxing_success}/{total} ({zxing_success / denominator:.2%})",
                f"- OpenCV 二维码解码成功：{opencv_success}/{total} ({opencv_success / denominator:.2%})",
                f"- 二维码 payload 完全一致：{same_payload}/{total} ({same_payload / denominator:.2%})",
                f"- 最终解析结果一致：{same_final}/{total} ({same_final / denominator:.2%})",
                f"- 处理异常：{errors}",
                "",
                "> 最终解析结果一致仅表示两条路线在“二维码 + 同一文本兜底逻辑”下得出的发票号、日期、金额一致；不是人工标注准确率。",
            ]
        )
        + "\n",
        encoding="utf-8-sig",
    )


def main() -> None:
    rows: list[dict[str, Any]] = []
    for path in sorted(SAMPLE_DIR.glob("*.pdf")):
        try:
            rows.append(compare_one(path))
        except Exception as exc:
            rows.append({"file": path.name, "status": "error", "error": str(exc)})
    write_reports(rows)
    print(f"wrote {REPORT_MD}")
    print(f"wrote {REPORT_CSV}")


if __name__ == "__main__":
    main()
