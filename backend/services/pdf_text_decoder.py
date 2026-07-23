from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf._cmap import _parse_encoding, _parse_to_unicode
from pypdf.generic import ByteStringObject, ContentStream, DictionaryObject, TextStringObject


_IDENTITY_MATRIX = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
_NAMED_ENCODINGS = {
    "/GBK-EUC-H": "gbk",
    "/GBK-EUC-V": "gbk",
    "/GB-EUC-H": "gbk",
    "/GB-EUC-V": "gbk",
    "/GBK2K-H": "gb18030",
    "/GBK2K-V": "gb18030",
    "/GBpc-EUC-H": "gb2312",
    "/GBpc-EUC-V": "gb2312",
    "/UniGB-UCS2-H": "utf-16-be",
    "/UniGB-UCS2-V": "utf-16-be",
    "/UniGB-UTF16-H": "utf-16-be",
    "/UniGB-UTF16-V": "utf-16-be",
    "/Identity-H": "utf-16-be",
    "/Identity-V": "utf-16-be",
    "/ETen-B5-H": "cp950",
    "/ETen-B5-V": "cp950",
    "/ETenms-B5-H": "cp950",
    "/ETenms-B5-V": "cp950",
    "/UniCNS-UCS2-H": "utf-16-be",
    "/UniCNS-UCS2-V": "utf-16-be",
    "/UniCNS-UTF16-H": "utf-16-be",
    "/UniCNS-UTF16-V": "utf-16-be",
}


@dataclass(frozen=True)
class PdfTextRun:
    text: str
    x: float
    y: float
    font_name: str | None
    font_size: float
    order: int


@dataclass
class PdfTextExtraction:
    runs: list[PdfTextRun] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    page_width: float = 0.0
    page_height: float = 0.0

    @property
    def text(self) -> str:
        return "\n".join(run.text for run in self.runs if run.text)


def _get_object(value: Any) -> Any:
    return value.get_object() if hasattr(value, "get_object") else value


def _font_encoding_name(font: DictionaryObject) -> str | None:
    encoding = _get_object(font.get("/Encoding"))
    if isinstance(encoding, str):
        return encoding
    if isinstance(encoding, DictionaryObject):
        base_encoding = _get_object(encoding.get("/BaseEncoding"))
        return base_encoding if isinstance(base_encoding, str) else None
    return None


def _decode_to_unicode(raw: bytes, font: DictionaryObject) -> tuple[str, str | None]:
    try:
        mapping, _entries = _parse_to_unicode(font)
    except Exception as exc:
        return "", f"字体 ToUnicode 映射无法读取：{exc}"
    code_size = mapping.get(-1)
    if not isinstance(code_size, int) or code_size <= 0:
        return "", "字体 ToUnicode 映射缺少有效字符宽度"

    decoded: list[str] = []
    missing = False
    for offset in range(0, len(raw), code_size):
        chunk = raw[offset : offset + code_size]
        if len(chunk) != code_size:
            missing = True
            continue
        try:
            key = chunk.decode("charmap" if code_size == 1 else "utf-16-be", "surrogatepass")
        except UnicodeDecodeError:
            missing = True
            continue
        value = mapping.get(key)
        if isinstance(value, str):
            decoded.append(value)
        else:
            missing = True
    warning = "字体 ToUnicode 映射不完整，部分文字无法解码" if missing else None
    return "".join(decoded), warning


def _decode_single_byte_mapping(raw: bytes, mapping: dict[int, str]) -> tuple[str, str | None]:
    decoded: list[str] = []
    missing = False
    for value in raw:
        char = mapping.get(value)
        if isinstance(char, str):
            decoded.append(char)
        else:
            missing = True
    warning = "字体单字节映射不完整，部分文字无法解码" if missing else None
    return "".join(decoded), warning


def decode_font_bytes(raw: bytes, font: DictionaryObject) -> tuple[str, str | None]:
    """Decode a PDF string with the font that was active for its text operator."""
    resolved_font = _get_object(font)
    if not isinstance(resolved_font, DictionaryObject):
        return "", "文字所用字体字典无效"

    if "/ToUnicode" in resolved_font:
        return _decode_to_unicode(raw, resolved_font)

    encoding_name = _font_encoding_name(resolved_font)
    codec = _NAMED_ENCODINGS.get(encoding_name or "")
    if codec:
        try:
            return raw.decode(codec), None
        except UnicodeDecodeError:
            return "", f"字体编码 {encoding_name} 与文字字节不匹配"

    try:
        encoding = _parse_encoding(resolved_font)
    except Exception as exc:
        return "", f"字体编码 {encoding_name or '未知'} 无法读取：{exc}"
    if isinstance(encoding, dict):
        return _decode_single_byte_mapping(raw, encoding)
    if isinstance(encoding, str) and encoding not in {"", "charmap", encoding_name}:
        try:
            return raw.decode(encoding), None
        except (LookupError, UnicodeDecodeError):
            pass
    return "", f"字体使用未知编码 {encoding_name or '未声明'}，相关文字无法解码"


def _matrix_multiply(left: list[float], right: list[float]) -> list[float]:
    return [
        left[0] * right[0] + left[1] * right[2],
        left[0] * right[1] + left[1] * right[3],
        left[2] * right[0] + left[3] * right[2],
        left[2] * right[1] + left[3] * right[3],
        left[4] * right[0] + left[5] * right[2] + right[4],
        left[4] * right[1] + left[5] * right[3] + right[5],
    ]


def _raw_bytes(value: Any) -> bytes | None:
    if isinstance(value, (TextStringObject, ByteStringObject)):
        return value.original_bytes
    if isinstance(value, bytes):
        return value
    return None


def _estimated_text_advance(text: str, font_size: float) -> float:
    units = sum(1.0 if "\u2e80" <= char <= "\uffff" else 0.55 for char in text)
    return units * font_size


def _resolve_resources(container: Any, fallback: DictionaryObject | None = None) -> DictionaryObject:
    resources = _get_object(container.get("/Resources")) if hasattr(container, "get") else None
    return resources if isinstance(resources, DictionaryObject) else (fallback or DictionaryObject())


def _extract_stream_runs(
    stream: Any,
    *,
    pdf: Any,
    resources: DictionaryObject,
    base_matrix: list[float],
    extraction: PdfTextExtraction,
    depth: int = 0,
) -> None:
    if depth > 5:
        extraction.warnings.append("PDF 表单对象嵌套过深，部分文字未读取")
        return
    try:
        operations = ContentStream(stream, pdf, "bytes").operations
    except Exception as exc:
        extraction.warnings.append(f"PDF 内容流无法读取：{exc}")
        return

    fonts = _get_object(resources.get("/Font"))
    xobjects = _get_object(resources.get("/XObject"))
    fonts = fonts if isinstance(fonts, DictionaryObject) else DictionaryObject()
    xobjects = xobjects if isinstance(xobjects, DictionaryObject) else DictionaryObject()

    current_matrix = base_matrix.copy()
    text_matrix = _IDENTITY_MATRIX.copy()
    line_matrix = _IDENTITY_MATRIX.copy()
    current_font_name: str | None = None
    current_font: DictionaryObject | None = None
    font_size = 12.0
    leading = 0.0
    graphics_stack: list[tuple[list[float], str | None, DictionaryObject | None, float]] = []

    def move_text(tx: float, ty: float) -> None:
        nonlocal text_matrix, line_matrix
        line_matrix[4] += tx * line_matrix[0] + ty * line_matrix[2]
        line_matrix[5] += tx * line_matrix[1] + ty * line_matrix[3]
        text_matrix = line_matrix.copy()

    def show_text(value: Any) -> None:
        nonlocal text_matrix
        raw = _raw_bytes(value)
        if raw is None or current_font is None:
            return
        text, warning = decode_font_bytes(raw, current_font)
        if warning and warning not in extraction.warnings:
            extraction.warnings.append(warning)
        if not text:
            return
        position = _matrix_multiply(text_matrix, current_matrix)
        extraction.runs.append(
            PdfTextRun(
                text=text,
                x=float(position[4]),
                y=float(position[5]),
                font_name=current_font_name,
                font_size=font_size,
                order=len(extraction.runs),
            )
        )
        text_matrix[4] += _estimated_text_advance(text, font_size)

    for operands, operator in operations:
        if operator == b"q":
            graphics_stack.append((current_matrix.copy(), current_font_name, current_font, font_size))
        elif operator == b"Q":
            if graphics_stack:
                current_matrix, current_font_name, current_font, font_size = graphics_stack.pop()
        elif operator == b"cm" and len(operands) >= 6:
            matrix = [float(value) for value in operands[:6]]
            current_matrix = _matrix_multiply(matrix, current_matrix)
        elif operator == b"BT":
            text_matrix = _IDENTITY_MATRIX.copy()
            line_matrix = _IDENTITY_MATRIX.copy()
        elif operator == b"Tf" and len(operands) >= 2:
            current_font_name = str(operands[0])
            font_value = _get_object(fonts.get(current_font_name))
            current_font = font_value if isinstance(font_value, DictionaryObject) else None
            font_size = float(operands[1])
        elif operator == b"Tm" and len(operands) >= 6:
            text_matrix = [float(value) for value in operands[:6]]
            line_matrix = text_matrix.copy()
        elif operator == b"Td" and len(operands) >= 2:
            move_text(float(operands[0]), float(operands[1]))
        elif operator == b"TD" and len(operands) >= 2:
            leading = -float(operands[1])
            move_text(float(operands[0]), float(operands[1]))
        elif operator == b"TL" and operands:
            leading = float(operands[0])
        elif operator == b"T*":
            move_text(0.0, -leading)
        elif operator == b"Tj" and operands:
            show_text(operands[0])
        elif operator == b"TJ" and operands:
            for item in operands[0]:
                raw = _raw_bytes(item)
                if raw is not None:
                    show_text(item)
                elif isinstance(item, (int, float)):
                    text_matrix[4] -= float(item) * font_size / 1000.0
        elif operator == b"'" and operands:
            move_text(0.0, -leading)
            show_text(operands[0])
        elif operator == b'"' and len(operands) >= 3:
            move_text(0.0, -leading)
            show_text(operands[2])
        elif operator == b"Do" and operands:
            xobject = _get_object(xobjects.get(str(operands[0])))
            if not isinstance(xobject, DictionaryObject) or str(xobject.get("/Subtype")) != "/Form":
                continue
            form_matrix_value = _get_object(xobject.get("/Matrix"))
            form_matrix = (
                [float(value) for value in form_matrix_value]
                if isinstance(form_matrix_value, (list, tuple)) and len(form_matrix_value) == 6
                else _IDENTITY_MATRIX.copy()
            )
            _extract_stream_runs(
                xobject,
                pdf=pdf,
                resources=_resolve_resources(xobject, resources),
                base_matrix=_matrix_multiply(form_matrix, current_matrix),
                extraction=extraction,
                depth=depth + 1,
            )


def extract_pdf_text_runs(path: Path, page_index: int = 0) -> PdfTextExtraction:
    reader = PdfReader(str(path))
    if page_index < 0 or page_index >= len(reader.pages):
        raise IndexError("PDF 页码超出范围")
    page = reader.pages[page_index]
    extraction = PdfTextExtraction(
        page_width=float(page.mediabox.width),
        page_height=float(page.mediabox.height),
    )
    contents = page.get_contents()
    if contents is None:
        return extraction
    _extract_stream_runs(
        contents,
        pdf=reader,
        resources=_resolve_resources(page),
        base_matrix=_IDENTITY_MATRIX.copy(),
        extraction=extraction,
    )
    return extraction
