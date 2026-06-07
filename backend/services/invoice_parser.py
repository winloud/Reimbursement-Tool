import base64
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from backend.schemas.invoice import InvoiceParsedData


MONEY_QUANT = Decimal("0.01")
INVOICE_TYPE_UNKNOWN = "unknown"
INVOICE_TYPE_NORMAL = "normal"
INVOICE_TYPE_VAT_SPECIAL = "vat_special"
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
TAX_TOTAL_AMOUNT_SOURCES = {
    "tax_total_small",
    "tax_total",
    "tax_total_small_line",
    "tax_total_nearby",
    "currency_sum",
}
COMMON_TAX_RATES = (Decimal("0.01"), Decimal("0.03"), Decimal("0.06"), Decimal("0.09"), Decimal("0.13"))
MONEY_TOKEN_PATTERN = re.compile(r"[¥￥]\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
SMALL_AMOUNT_PATTERN = re.compile(
    r"[（(]\s*小写\s*[）)]\s*[:：]?\s*(?:人民币)?\s*[¥￥]\s*([0-9][0-9,]*(?:\.\d{1,2})?)"
)
MONEY_VALUE_PATTERN = re.compile(r"[¥￥]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*[¥￥]?")
WORD_AMOUNT_PATTERN = re.compile(r"[¥￥]?\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
UPPER_AMOUNT_PATTERN = re.compile(
    r"(?:价税合计|税价合计)\s*[（(]\s*[大⼤]\s*写\s*[）)]\s*[:：]?\s*(?:人民币)?\s*([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾百佰千仟万亿圆元角分整正]+)"
)
STANDALONE_UPPER_AMOUNT_PATTERN = re.compile(
    r"(?:人民币)?([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾百佰千仟万亿圆元角分整正]+)"
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


def normalize_text(text: str | None) -> str:
    return (text or "").replace("⼤", "大").replace("\u00a0", " ")


def compact_text(text: str | None) -> str:
    return re.sub(r"\s+", "", normalize_text(text))


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


def extract_pdf_text(file_path: Path) -> str:
    try:
        import fitz

        with fitz.open(str(file_path)) as doc:
            return "\n".join(page.get_text("text") or "" for page in doc)
    except Exception:
        return extract_pdf_text_with_pypdf(file_path)


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
            words = [
                {"x0": item[0], "y0": item[1], "x1": item[2], "y1": item[3], "text": item[4]}
                for item in (page.get_text("words") or [])
                if len(item) >= 5 and str(item[4]).strip()
            ]
            page_rect = page.rect
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

            return {
                "text": text,
                "preview_image": preview_image,
                "image_bgr": image_bgr,
                "page_size": {"width": float(page_rect.width), "height": float(page_rect.height)},
                "words": words,
                "render_error": None,
            }
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


def extract_invoice_type(text: str) -> str:
    compacted = compact_text(text)
    if not compacted:
        return INVOICE_TYPE_UNKNOWN
    if "增值税专用发票" in compacted or "电子专用发票" in compacted:
        return INVOICE_TYPE_VAT_SPECIAL
    if "专用发票" in compacted and "增值税" in compacted:
        return INVOICE_TYPE_VAT_SPECIAL
    if "普通发票" in compacted or "旅客运输服务" in compacted or "增值税" in compacted or "发票" in compacted:
        return INVOICE_TYPE_NORMAL
    return INVOICE_TYPE_UNKNOWN


def detect_invoice_type_from_file(file_path: Path, file_type: str) -> str:
    if file_type != "pdf":
        return INVOICE_TYPE_UNKNOWN
    return extract_invoice_type(extract_pdf_text(file_path))


def extract_tax_total_small_line_amount(text: str) -> Decimal | None:
    for line in normalize_text(text).splitlines():
        compacted_line = compact_text(line)
        if "小写" not in compacted_line:
            continue
        match = SMALL_AMOUNT_PATTERN.search(compacted_line)
        if match:
            return parse_decimal(match.group(1))
    return None


def extract_tax_total_nearby_amount(text: str) -> Decimal | None:
    lines = normalize_text(text).splitlines()
    uppercase_amount = extract_uppercase_amount(text)
    for index, line in enumerate(lines):
        compacted_line = compact_text(line)
        if "小写" not in compacted_line:
            continue
        nearby_label = compact_text("".join(lines[max(0, index - 4) : index + 1]))
        if "价税合计" not in nearby_label and "税价合计" not in nearby_label:
            continue
        for offset in range(0, 4):
            candidate_line = compact_text(lines[index + offset]) if index + offset < len(lines) else ""
            candidate_line = candidate_line.replace("小写", "").replace("(", "").replace(")", "")
            candidate_line = candidate_line.replace("（", "").replace("）", "")
            if not candidate_line or "%" in candidate_line:
                continue
            match = MONEY_VALUE_PATTERN.fullmatch(candidate_line)
            if match:
                amount = parse_decimal(match.group(1))
                if amount > Decimal("0.00"):
                    if uppercase_amount is not None and amount != uppercase_amount:
                        continue
                    return amount
    return None


def currency_amount_candidates(text: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for line_no, line in enumerate(normalize_text(text).splitlines()):
        for match in MONEY_TOKEN_PATTERN.finditer(line):
            candidates.append(
                {
                    "amount": parse_decimal(match.group(1)),
                    "line_no": line_no,
                    "line": line.strip(),
                    "start": match.start(),
                }
            )
    return [candidate for candidate in candidates if candidate["amount"] > Decimal("0.00")]


def tax_rate_score(base: Decimal, tax: Decimal) -> int:
    if base <= Decimal("0.00") or tax <= Decimal("0.00"):
        return 0
    rate = (tax / base).quantize(Decimal("0.0001"))
    if rate > Decimal("0.30"):
        return 0
    score = 5
    if any(abs(rate - common_rate) <= Decimal("0.003") for common_rate in COMMON_TAX_RATES):
        score += 15
    return score


def nearby_tax_total_label(lines: list[str], line_no: int) -> bool:
    start = max(0, line_no - 4)
    end = min(len(lines), line_no + 5)
    nearby = compact_text("".join(lines[start:end]))
    return "价税合计" in nearby or "税价合计" in nearby or "小写" in nearby


def extract_currency_sum_amount(text: str) -> Decimal | None:
    candidates = currency_amount_candidates(text)
    if len(candidates) < 3:
        return None

    lines = normalize_text(text).splitlines()
    best: tuple[int, Decimal] | None = None
    for total_index, total_candidate in enumerate(candidates):
        total = total_candidate["amount"]
        for base_index, base_candidate in enumerate(candidates):
            if base_index == total_index:
                continue
            base = base_candidate["amount"]
            for tax_index, tax_candidate in enumerate(candidates):
                if tax_index in {total_index, base_index}:
                    continue
                tax = tax_candidate["amount"]
                if base < tax:
                    continue
                if (base + tax).quantize(MONEY_QUANT) != total:
                    continue

                score = tax_rate_score(base, tax)
                if score == 0:
                    continue
                if total == max(candidate["amount"] for candidate in candidates):
                    score += 4
                if total_candidate["line_no"] > max(base_candidate["line_no"], tax_candidate["line_no"]):
                    score += 3
                if nearby_tax_total_label(lines, total_candidate["line_no"]):
                    score += 8
                if "小写" in compact_text(total_candidate["line"]):
                    score += 8

                if best is None or score > best[0]:
                    best = (score, total)

    return best[1] if best is not None else None


def extract_amount_from_text(text: str) -> tuple[Decimal, str | None]:
    compacted = compact_text(text)
    for source, pattern in AMOUNT_PATTERNS:
        if source == "generic_currency":
            continue
        match = pattern.search(compacted)
        if match:
            return parse_decimal(match.group(1)), source

    line_amount = extract_tax_total_small_line_amount(text)
    if line_amount is not None:
        return line_amount, "tax_total_small_line"

    nearby_amount = extract_tax_total_nearby_amount(text)
    if nearby_amount is not None:
        return nearby_amount, "tax_total_nearby"

    currency_sum_amount = extract_currency_sum_amount(text)
    if currency_sum_amount is not None:
        return currency_sum_amount, "currency_sum"

    for source, pattern in AMOUNT_PATTERNS:
        if source != "generic_currency":
            continue
        match = pattern.search(compacted)
        if match:
            return parse_decimal(match.group(1)), source
    return Decimal("0.00"), None


def extract_uppercase_amount(text: str) -> Decimal | None:
    normalized = normalize_text(text)
    match = UPPER_AMOUNT_PATTERN.search(compact_text(normalized))
    if match:
        return parse_chinese_upper_amount(match.group(1))

    for line in normalized.splitlines():
        compacted_line = compact_text(line)
        if not 2 <= len(compacted_line) <= 40:
            continue
        if "元" not in compacted_line and "圆" not in compacted_line:
            continue
        match = STANDALONE_UPPER_AMOUNT_PATTERN.fullmatch(compacted_line)
        if match:
            return parse_chinese_upper_amount(match.group(1))
    return None


def split_qr_tokens(payload: str, keep_empty: bool = False) -> list[str]:
    tokens = [token.strip() for token in re.split(r"[,，|;]", payload)]
    if keep_empty:
        return tokens
    return [token for token in tokens if token]


def parse_standard_qr_payload(payload: str) -> dict[str, Any] | None:
    tokens = split_qr_tokens(payload, keep_empty=True)
    if len(tokens) < 6:
        return None
    if tokens[0] != "01":
        return None

    amount = parse_decimal(tokens[4])
    invoice_date = parse_date(tokens[5])
    invoice_no = tokens[3].strip()
    if amount <= Decimal("0.00") or invoice_date is None or not invoice_no:
        return None
    if invoice_date.year < 2000 or invoice_date.year > 2100:
        return None
    if not re.fullmatch(r"[A-Z0-9]{6,30}", invoice_no, flags=re.IGNORECASE):
        return None

    return {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date,
        "invoice_type": INVOICE_TYPE_UNKNOWN,
        "amount": amount,
        "amount_source": "qr",
        "amount_uppercase": None,
        "amount_validation": None,
        "invoice_code": tokens[2].strip() or None,
        "qr_payload_format": "standard",
    }


def extract_fields_from_text(text: str) -> dict[str, Any]:
    amount, amount_source = extract_amount_from_text(text)
    uppercase_amount = extract_uppercase_amount(text)
    validation = None
    if uppercase_amount is not None and amount > Decimal("0.00"):
        validation = "matched" if uppercase_amount == amount else "mismatched"

    return {
        "invoice_no": extract_invoice_no(text),
        "invoice_date": extract_invoice_date(text),
        "invoice_type": extract_invoice_type(text),
        "amount": amount,
        "amount_source": amount_source,
        "amount_uppercase": uppercase_amount,
        "amount_validation": validation,
    }


def parse_qr_payload(payload: str) -> dict[str, Any]:
    standard = parse_standard_qr_payload(payload)
    if standard is not None:
        return standard

    labeled = extract_fields_from_text(payload)
    if labeled["invoice_no"] or labeled["invoice_date"] or labeled["amount"] > Decimal("0.00"):
        labeled["amount_source"] = "qr"
        labeled["qr_payload_format"] = "labeled"
        return labeled

    tokens = [token.strip() for token in re.split(r"[,，|;\s]+", payload) if token.strip()]
    result: dict[str, Any] = {
        "invoice_no": None,
        "invoice_date": None,
        "invoice_type": INVOICE_TYPE_UNKNOWN,
        "amount": Decimal("0.00"),
        "amount_source": None,
        "qr_payload_format": "fallback",
    }

    def looks_like_invoice_no(token: str) -> bool:
        if not re.fullmatch(r"[A-Z0-9]{6,30}", token, flags=re.IGNORECASE):
            return False
        if "." in token:
            return False
        parsed = parse_date(token)
        if parsed and 2000 <= parsed.year <= 2100:
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


def should_prefer_text_amount(qr_fields: dict[str, Any], text_fields: dict[str, Any]) -> bool:
    qr_amount = parse_decimal(qr_fields.get("amount"))
    text_amount = parse_decimal(text_fields.get("amount"))
    if qr_amount <= Decimal("0.00") or text_amount <= Decimal("0.00") or qr_amount == text_amount:
        return False
    if text_amount < qr_amount:
        return False
    if qr_fields.get("qr_payload_format") != "standard":
        return False
    if text_fields.get("amount_source") in TAX_TOTAL_AMOUNT_SOURCES:
        return True
    if text_fields.get("amount_uppercase") == text_amount:
        return True
    return False


def select_amount(qr_fields: dict[str, Any], text_fields: dict[str, Any]) -> tuple[Decimal, str | None, str]:
    qr_amount = parse_decimal(qr_fields.get("amount"))
    text_amount = parse_decimal(text_fields.get("amount"))

    if should_prefer_text_amount(qr_fields, text_fields):
        return text_amount, text_fields.get("amount_source"), "text_tax_total_over_standard_qr"
    if qr_amount > Decimal("0.00"):
        return qr_amount, qr_fields.get("amount_source"), "qr"
    if text_amount > Decimal("0.00"):
        return text_amount, text_fields.get("amount_source"), "text"
    return Decimal("0.00"), None, "none"


def word_amount(word_text: str) -> Decimal:
    match = WORD_AMOUNT_PATTERN.search(str(word_text or ""))
    return parse_decimal(match.group(1)) if match else Decimal("0.00")


def word_center_y(word: dict[str, Any]) -> float:
    return (float(word["y0"]) + float(word["y1"])) / 2


def words_on_same_line(words: list[dict[str, Any]], target: dict[str, Any], tolerance: float = 6.0) -> list[dict[str, Any]]:
    center_y = word_center_y(target)
    return [word for word in words if abs(word_center_y(word) - center_y) <= tolerance]


def nearby_words(words: list[dict[str, Any]], target: dict[str, Any], tolerance: float = 24.0) -> list[dict[str, Any]]:
    center_y = word_center_y(target)
    return [word for word in words if abs(word_center_y(word) - center_y) <= tolerance]


def union_word_bbox(words: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "x0": min(float(word["x0"]) for word in words),
        "y0": min(float(word["y0"]) for word in words),
        "x1": max(float(word["x1"]) for word in words),
        "y1": max(float(word["y1"]) for word in words),
    }


def amount_highlight_words(words: list[dict[str, Any]], amount_word: dict[str, Any]) -> list[dict[str, Any]]:
    line_words = words_on_same_line(words, amount_word)
    highlight_words = [amount_word]
    amount_x0 = float(amount_word["x0"])
    for word in line_words:
        text = compact_text(str(word.get("text") or ""))
        if text not in {"¥", "￥"}:
            continue
        if 0 <= amount_x0 - float(word["x1"]) <= 10:
            highlight_words.append(word)
    return highlight_words


def score_amount_word(words: list[dict[str, Any]], word: dict[str, Any], page_width: float, page_height: float) -> int:
    context = compact_text("".join(str(item.get("text") or "") for item in nearby_words(words, word)))
    score = 10
    if "价税合计" in context or "税价合计" in context:
        score += 60
    if "小写" in context:
        score += 30
    if float(word["x0"]) > page_width * 0.45:
        score += 5
    if float(word["y0"]) > page_height * 0.45:
        score += 3
    return score


def build_tax_total_amount_highlight(artifacts: dict[str, Any], amount: Decimal) -> dict[str, Any] | None:
    normalized_amount = parse_decimal(amount)
    if normalized_amount <= Decimal("0.00"):
        return None
    words = list(artifacts.get("words") or [])
    page_size = artifacts.get("page_size") or {}
    page_width = float(page_size.get("width") or 0)
    page_height = float(page_size.get("height") or 0)
    if not words or page_width <= 0 or page_height <= 0:
        return None

    candidates = [word for word in words if word_amount(str(word.get("text") or "")) == normalized_amount]
    if not candidates:
        return None
    best = max(candidates, key=lambda word: score_amount_word(words, word, page_width, page_height))
    bbox = union_word_bbox(amount_highlight_words(words, best))
    padding = 4.0
    x0 = max(0.0, bbox["x0"] - padding)
    y0 = max(0.0, bbox["y0"] - padding)
    x1 = min(page_width, bbox["x1"] + padding)
    y1 = min(page_height, bbox["y1"] + padding)
    return {
        "type": "tax_total_amount",
        "label": "价税合计金额",
        "amount": str(normalized_amount),
        "page": 1,
        "x": x0 / page_width,
        "y": y0 / page_height,
        "width": max((x1 - x0) / page_width, 0.001),
        "height": max((y1 - y0) / page_height, 0.001),
    }


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

    amount, amount_source, amount_selection_reason = select_amount(qr_fields, text_fields)
    amount_uppercase = text_fields["amount_uppercase"]
    amount_validation = text_fields["amount_validation"]
    if amount_uppercase is not None and amount > Decimal("0.00"):
        amount_validation = "matched" if amount_uppercase == amount else "mismatched"

    invoice_no = qr_fields.get("invoice_no") or text_fields["invoice_no"]
    invoice_date = qr_fields.get("invoice_date") or text_fields["invoice_date"]
    invoice_type = text_fields.get("invoice_type") or INVOICE_TYPE_UNKNOWN
    if invoice_type == INVOICE_TYPE_UNKNOWN:
        invoice_type = qr_fields.get("invoice_type") or INVOICE_TYPE_UNKNOWN
    normalized_amount = parse_decimal(amount)
    tax_total_highlight = build_tax_total_amount_highlight(artifacts, normalized_amount)
    preview_highlights = [tax_total_highlight] if tax_total_highlight is not None else []
    qr_success = bool(qr_fields)
    text_success = bool(
        text_fields["invoice_no"] or text_fields["invoice_date"] or text_fields["amount"] > Decimal("0.00")
    )
    parse_method = "qrcode" if qr_success else "text_regex" if text_success else "manual_required"
    parse_success = bool(invoice_no or invoice_date or normalized_amount > Decimal("0.00"))
    parsed_result = {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date.isoformat() if invoice_date else None,
        "invoice_type": invoice_type,
        "amount": str(normalized_amount),
    }
    text_result = {
        "invoice_no": text_fields["invoice_no"],
        "invoice_date": text_fields["invoice_date"].isoformat() if text_fields["invoice_date"] else None,
        "invoice_type": text_fields["invoice_type"],
        "amount": str(text_fields["amount"]),
        "amount_source": text_fields["amount_source"],
        "amount_uppercase": str(amount_uppercase) if amount_uppercase is not None else None,
        "amount_validation": text_fields["amount_validation"],
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
        "invoice_type": invoice_type,
        "parse_attempts": parse_attempts,
        "qr_payloads": qr_payloads,
        "amount_source": amount_source,
        "amount_selection_reason": amount_selection_reason,
        "amount_uppercase": str(amount_uppercase) if amount_uppercase is not None else None,
        "amount_validation": amount_validation,
        "preview_highlights": preview_highlights,
        "render_error": artifacts.get("render_error"),
    }

    return InvoiceParsedData(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        invoice_type=invoice_type,
        amount=normalized_amount,
        preview_image=artifacts.get("preview_image"),
        raw=raw,
    )


def parse_invoice_file(file_path: Path, file_type: str) -> InvoiceParsedData:
    if file_type == "pdf":
        return parse_pdf_invoice(file_path)
    return InvoiceParsedData(raw={"source": file_type})
