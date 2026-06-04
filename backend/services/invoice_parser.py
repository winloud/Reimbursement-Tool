import base64
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from backend.schemas.invoice import InvoiceParsedData


MONEY_QUANT = Decimal("0.01")
WECHAT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "wechat_qrcode"
WECHAT_MODEL_FILES = {
    "detect_prototxt": "detect.prototxt",
    "detect_model": "detect.caffemodel",
    "sr_prototxt": "sr.prototxt",
    "sr_model": "sr.caffemodel",
}

AMOUNT_PATTERNS = [
    (
        "tax_total_small",
        re.compile(
            r"(?:价税合计|税价合计)\s*[（(]\s*小写\s*[）)]\s*[:：]?\s*(?:人民币)?\s*[¥￥]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)"
        ),
    ),
    (
        "tax_total",
        re.compile(r"(?:价税合计|税价合计)\s*[:：]?\s*(?:人民币)?\s*[¥￥]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)"),
    ),
    ("generic_currency", re.compile(r"[¥￥]\s*([0-9][0-9,]*(?:\.\d{1,2})?)")),
]
UPPER_AMOUNT_PATTERN = re.compile(
    r"(?:价税合计|税价合计)\s*[（(]\s*大写\s*[）)]\s*[:：]?\s*(?:人民币)?\s*([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾百佰千仟万亿圆元角分整正]+)"
)
INVOICE_NO_PATTERNS = [
    re.compile(r"(?:发票号码|发票号)\s*[:：]?\s*([A-Z0-9]{6,30})", re.IGNORECASE),
    re.compile(r"(?<!机器)号码\s*[:：]?\s*([A-Z0-9]{6,30})", re.IGNORECASE),
]
DATE_PATTERN = re.compile(
    r"开票日期\s*[:：]?\s*([0-9]{4}(?:[年\-/\.]?[0-9]{1,2}[月\-/\.]?[0-9]{1,2}日?|[0-9]{4}))"
)

CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "壹": 1,
    "一": 1,
    "贰": 2,
    "二": 2,
    "叁": 3,
    "三": 3,
    "肆": 4,
    "四": 4,
    "伍": 5,
    "五": 5,
    "陆": 6,
    "六": 6,
    "柒": 7,
    "七": 7,
    "捌": 8,
    "八": 8,
    "玖": 9,
    "九": 9,
}
CHINESE_SMALL_UNITS = {"拾": 10, "十": 10, "佰": 100, "百": 100, "仟": 1000, "千": 1000}
CHINESE_SECTION_UNITS = {"万": 10_000, "亿": 100_000_000}

_WECHAT_DETECTOR: Any | None = None
_WECHAT_DETECTOR_READY = False


def parse_decimal(value: str | Decimal | int | float | None) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    normalized = str(value).replace(",", "").replace("¥", "").replace("￥", "").strip()
    try:
        amount = Decimal(normalized)
    except (InvalidOperation, ValueError):
        return Decimal("0.00")
    if amount < 0:
        return Decimal("0.00")
    return amount.quantize(MONEY_QUANT)


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    text = text.replace("年", "-").replace("月", "-").replace("日", "")
    text = text.replace("/", "-").replace(".", "-")
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def compact_text(text: str | None) -> str:
    return re.sub(r"\s+", "", text or "")


def parse_chinese_integer(text: str) -> int:
    total = 0
    section = 0
    number = 0
    for char in text:
        if char in CHINESE_DIGITS:
            number = CHINESE_DIGITS[char]
            continue
        if char in CHINESE_SMALL_UNITS:
            unit = CHINESE_SMALL_UNITS[char]
            section += (number or 1) * unit
            number = 0
            continue
        if char in CHINESE_SECTION_UNITS:
            unit = CHINESE_SECTION_UNITS[char]
            section += number
            total += section * unit
            section = 0
            number = 0
    return total + section + number


def parse_chinese_upper_amount(text: str | None) -> Decimal | None:
    if not text:
        return None
    normalized = text.strip().replace("人民币", "")
    normalized = normalized.replace("圆", "元").replace("正", "整")
    integer_text = normalized
    fraction_text = ""
    if "元" in normalized:
        integer_text, fraction_text = normalized.split("元", 1)
    elif "角" in normalized or "分" in normalized:
        integer_text = ""
        fraction_text = normalized

    yuan = parse_chinese_integer(integer_text) if integer_text else 0
    jiao_match = re.search(r"([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九])角", fraction_text)
    fen_match = re.search(r"([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九])分", fraction_text)
    jiao = CHINESE_DIGITS.get(jiao_match.group(1), 0) if jiao_match else 0
    fen = CHINESE_DIGITS.get(fen_match.group(1), 0) if fen_match else 0
    return (Decimal(yuan) + Decimal(jiao) / Decimal(10) + Decimal(fen) / Decimal(100)).quantize(MONEY_QUANT)


def extract_pdf_text_with_pypdf(file_path: Path) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(file_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def extract_pdf_page_artifacts(file_path: Path, zoom: int = 2) -> dict[str, Any]:
    try:
        import fitz
        import numpy as np
    except Exception as exc:
        return {
            "text": extract_pdf_text_with_pypdf(file_path),
            "preview_image": None,
            "image_bgr": None,
            "render_error": f"pymupdf_unavailable: {exc}",
        }

    try:
        with fitz.open(str(file_path)) as doc:
            if doc.page_count == 0:
                return {"text": "", "preview_image": None, "image_bgr": None, "render_error": "empty_pdf"}

            page = doc[0]
            text = page.get_text("text") or ""
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
            preview_image = "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode("ascii")

            image_bgr = None
            try:
                import cv2

                image_rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                if pix.n == 1:
                    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_GRAY2BGR)
                else:
                    image_bgr = cv2.cvtColor(image_rgb[:, :, :3], cv2.COLOR_RGB2BGR)
            except Exception:
                image_bgr = None

            return {"text": text, "preview_image": preview_image, "image_bgr": image_bgr, "render_error": None}
    except Exception as exc:
        return {
            "text": extract_pdf_text_with_pypdf(file_path),
            "preview_image": None,
            "image_bgr": None,
            "render_error": f"pymupdf_render_failed: {exc}",
        }


def get_wechat_detector(cv2_module: Any) -> Any | None:
    global _WECHAT_DETECTOR, _WECHAT_DETECTOR_READY
    if _WECHAT_DETECTOR_READY:
        return _WECHAT_DETECTOR

    _WECHAT_DETECTOR_READY = True
    if not hasattr(cv2_module, "wechat_qrcode_WeChatQRCode"):
        return None

    model_paths = {key: WECHAT_MODEL_DIR / filename for key, filename in WECHAT_MODEL_FILES.items()}
    if not all(path.exists() for path in model_paths.values()):
        return None

    def opencv_model_path(path: Path) -> str:
        try:
            return str(path.relative_to(Path.cwd()))
        except ValueError:
            return str(path)

    try:
        _WECHAT_DETECTOR = cv2_module.wechat_qrcode_WeChatQRCode(
            opencv_model_path(model_paths["detect_prototxt"]),
            opencv_model_path(model_paths["detect_model"]),
            opencv_model_path(model_paths["sr_prototxt"]),
            opencv_model_path(model_paths["sr_model"]),
        )
    except Exception:
        _WECHAT_DETECTOR = None
    return _WECHAT_DETECTOR


def _append_unique(target: list[str], values: Any) -> None:
    if isinstance(values, str):
        candidates = [values]
    else:
        candidates = list(values or [])
    for value in candidates:
        text = str(value).strip()
        if text and text not in target:
            target.append(text)


def decode_qr_payloads_from_image(image_bgr: Any | None, include_details: bool = False) -> list[str] | tuple[list[str], list[dict[str, Any]]]:
    details: list[dict[str, Any]] = []

    def finish(payloads: list[str]) -> list[str] | tuple[list[str], list[dict[str, Any]]]:
        return (payloads, details) if include_details else payloads

    if image_bgr is None:
        details.append({"method": "opencv_qrcode", "success": False, "message": "no_rendered_image"})
        return finish([])
    try:
        import cv2
    except Exception as exc:
        details.append({"method": "opencv_qrcode", "success": False, "message": f"opencv_unavailable: {exc}"})
        return finish([])

    payloads: list[str] = []

    detector = get_wechat_detector(cv2)
    if detector is not None:
        before_count = len(payloads)
        try:
            decoded, _points = detector.detectAndDecode(image_bgr)
            _append_unique(payloads, decoded)
            details.append(
                {
                    "method": "opencv_wechat_qrcode",
                    "success": len(payloads) > before_count,
                    "result": {"payloads": payloads[before_count:]},
                }
            )
        except Exception as exc:
            details.append({"method": "opencv_wechat_qrcode", "success": False, "message": str(exc)})
    else:
        details.append({"method": "opencv_wechat_qrcode", "success": False, "message": "not_available_or_missing_models"})

    try:
        before_count = len(payloads)
        basic_detector = cv2.QRCodeDetector()
        ok, decoded_info, _points, _straight = basic_detector.detectAndDecodeMulti(image_bgr)
        if ok:
            _append_unique(payloads, decoded_info)
        details.append(
            {
                "method": "opencv_qrcode_detector_multi",
                "success": len(payloads) > before_count,
                "result": {"payloads": payloads[before_count:]},
            }
        )
    except Exception as exc:
        details.append({"method": "opencv_qrcode_detector_multi", "success": False, "message": str(exc)})

    try:
        before_count = len(payloads)
        data, _points, _straight = cv2.QRCodeDetector().detectAndDecode(image_bgr)
        _append_unique(payloads, data)
        details.append(
            {
                "method": "opencv_qrcode_detector",
                "success": len(payloads) > before_count,
                "result": {"payloads": payloads[before_count:]},
            }
        )
    except Exception as exc:
        details.append({"method": "opencv_qrcode_detector", "success": False, "message": str(exc)})

    return finish(payloads)


def extract_invoice_no(text: str) -> str | None:
    compacted = compact_text(text)
    for pattern in INVOICE_NO_PATTERNS:
        match = pattern.search(compacted)
        if match:
            return match.group(1)
    return None


def extract_invoice_date(text: str) -> date | None:
    match = DATE_PATTERN.search(compact_text(text))
    return parse_date(match.group(1)) if match else None


def extract_amount_from_text(text: str) -> tuple[Decimal, str | None]:
    compacted = compact_text(text)
    for source, pattern in AMOUNT_PATTERNS:
        match = pattern.search(compacted)
        if match:
            return parse_decimal(match.group(1)), source
    return Decimal("0.00"), None


def extract_uppercase_amount(text: str) -> Decimal | None:
    match = UPPER_AMOUNT_PATTERN.search(compact_text(text))
    return parse_chinese_upper_amount(match.group(1)) if match else None


def extract_fields_from_text(text: str) -> dict[str, Any]:
    amount, amount_source = extract_amount_from_text(text)
    uppercase_amount = extract_uppercase_amount(text)
    validation = None
    if uppercase_amount is not None and amount > Decimal("0.00"):
        validation = "matched" if uppercase_amount == amount else "mismatched"

    return {
        "invoice_no": extract_invoice_no(text),
        "invoice_date": extract_invoice_date(text),
        "amount": amount,
        "amount_source": amount_source,
        "amount_uppercase": uppercase_amount,
        "amount_validation": validation,
    }


def parse_qr_payload(payload: str) -> dict[str, Any]:
    labeled = extract_fields_from_text(payload)
    if labeled["invoice_no"] or labeled["invoice_date"] or labeled["amount"] > Decimal("0.00"):
        labeled["amount_source"] = "qr"
        return labeled

    tokens = [token.strip() for token in re.split(r"[,，|;\s]+", payload) if token.strip()]
    result: dict[str, Any] = {"invoice_no": None, "invoice_date": None, "amount": Decimal("0.00"), "amount_source": None}

    def looks_like_invoice_no(token: str) -> bool:
        if not re.fullmatch(r"[A-Z0-9]{6,30}", token, flags=re.IGNORECASE):
            return False
        if "." in token:
            return False
        if parse_date(token):
            return False
        return True

    date_index = None
    for index, token in enumerate(tokens):
        parsed_date = parse_date(token)
        if parsed_date:
            result["invoice_date"] = parsed_date
            date_index = index
            break

    if date_index is not None:
        for token in reversed(tokens[:date_index]):
            amount = parse_decimal(token)
            if amount > Decimal("0.00") and "." in token:
                result["amount"] = amount
                result["amount_source"] = "qr"
                break
        for token in reversed(tokens[:date_index]):
            if looks_like_invoice_no(token):
                result["invoice_no"] = token
                break

    if not result["invoice_no"]:
        for token in tokens:
            if looks_like_invoice_no(token) and len(token) >= 8:
                result["invoice_no"] = token
                break

    if result["amount"] == Decimal("0.00"):
        for token in tokens:
            amount = parse_decimal(token)
            if amount > Decimal("0.00") and "." in token:
                result["amount"] = amount
                result["amount_source"] = "qr"
                break

    result["amount_uppercase"] = None
    result["amount_validation"] = None
    return result


def parse_pdf_invoice(file_path: Path) -> InvoiceParsedData:
    artifacts = extract_pdf_page_artifacts(file_path)
    text_fields = extract_fields_from_text(artifacts.get("text") or "")

    try:
        qr_payloads, qr_decode_details = decode_qr_payloads_from_image(artifacts.get("image_bgr"), include_details=True)
    except TypeError:
        qr_payloads = decode_qr_payloads_from_image(artifacts.get("image_bgr"))
        qr_decode_details = [
            {
                "method": "opencv_qrcode",
                "success": bool(qr_payloads),
                "result": {"payloads": qr_payloads},
            }
        ]
    qr_fields: dict[str, Any] = {}
    for payload in qr_payloads:
        parsed_payload = parse_qr_payload(payload)
        if parsed_payload["invoice_no"] or parsed_payload["invoice_date"] or parsed_payload["amount"] > Decimal("0.00"):
            qr_fields = parsed_payload
            break

    amount = qr_fields.get("amount") if qr_fields.get("amount", Decimal("0.00")) > Decimal("0.00") else text_fields["amount"]
    amount_source = qr_fields.get("amount_source") or text_fields["amount_source"]
    amount_uppercase = text_fields["amount_uppercase"]
    amount_validation = text_fields["amount_validation"]
    if qr_fields and amount_uppercase is not None and amount > Decimal("0.00"):
        amount_validation = "matched" if amount_uppercase == amount else "mismatched"

    invoice_no = qr_fields.get("invoice_no") or text_fields["invoice_no"]
    invoice_date = qr_fields.get("invoice_date") or text_fields["invoice_date"]
    normalized_amount = parse_decimal(amount)
    qr_success = bool(qr_fields)
    text_success = bool(
        text_fields["invoice_no"] or text_fields["invoice_date"] or text_fields["amount"] > Decimal("0.00")
    )
    parse_method = "qrcode" if qr_success else "text_regex" if text_success else "manual_required"
    parse_success = bool(invoice_no or invoice_date or normalized_amount > Decimal("0.00"))
    parsed_result = {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date.isoformat() if invoice_date else None,
        "amount": str(normalized_amount),
    }
    text_result = {
        "invoice_no": text_fields["invoice_no"],
        "invoice_date": text_fields["invoice_date"].isoformat() if text_fields["invoice_date"] else None,
        "amount": str(text_fields["amount"]),
        "amount_source": text_fields["amount_source"],
        "amount_uppercase": str(amount_uppercase) if amount_uppercase is not None else None,
        "amount_validation": amount_validation,
    }
    parse_attempts = [
        {
            "method": "pymupdf_render",
            "success": artifacts.get("preview_image") is not None and artifacts.get("render_error") is None,
            "result": {
                "preview_image": artifacts.get("preview_image") is not None,
                "opencv_image": artifacts.get("image_bgr") is not None,
                "text_chars": len(artifacts.get("text") or ""),
            },
            "message": artifacts.get("render_error"),
        },
        *qr_decode_details,
        {
            "method": "pymupdf_text_regex",
            "success": text_success,
            "result": text_result,
        },
    ]

    raw = {
        "source": "pdf",
        "parser": "pymupdf_opencv_wechat",
        "parse_method": parse_method,
        "parse_success": parse_success,
        "parsed_result": parsed_result,
        "parse_attempts": parse_attempts,
        "qr_payloads": qr_payloads,
        "amount_source": amount_source,
        "amount_uppercase": str(amount_uppercase) if amount_uppercase is not None else None,
        "amount_validation": amount_validation,
        "render_error": artifacts.get("render_error"),
    }

    return InvoiceParsedData(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        amount=normalized_amount,
        preview_image=artifacts.get("preview_image"),
        raw=raw,
    )


def parse_invoice_file(file_path: Path, file_type: str) -> InvoiceParsedData:
    if file_type == "pdf":
        return parse_pdf_invoice(file_path)
    return InvoiceParsedData(raw={"source": file_type})
