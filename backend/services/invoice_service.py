import ipaddress
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from hashlib import sha1
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.runtime_paths import PROJECT_ROOT, UPLOAD_ROOT, uploaded_path
from backend.models.invoice import Invoice
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.services.invoice_parser import parse_invoice_file, parse_invoice_file_many, pdf_page_count
from backend.services.settings_service import get_or_create_settings
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    CUSTOM_CATEGORY_PREFIX,
    REGULAR_EXPENSE_CATEGORY,
    ensure_report_writable,
    get_regular_item_target,
    get_report_or_404,
    is_custom_category,
    recalculate_report_totals,
    validate_expense_category,
)
from backend.services.invoice_duplicate_service import (
    InvoiceDuplicateIndex,
    calculate_path_hash,
    format_duplicate_sources,
    has_current_report_match,
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}
UPLOAD_WARNINGS_RAW_KEY = "upload_warnings"
UNCLEAR_PDF_GROUPING_WARNING = (
    "该多页 PDF 无法按发票号明确分组，已将完整 PDF 作为一张待确认发票上传；"
    "如文件包含多张发票，请先拆分 PDF 后重新上传。"
)
NONCONTIGUOUS_PDF_GROUPING_WARNING = (
    "检测到同一发票号的页面不连续，未自动重排或合并，已将完整 PDF 作为一张待确认发票上传；"
    "建议先拆分 PDF。"
)


@dataclass(frozen=True)
class ParsedInvoiceGroup:
    parsed: InvoiceParsedData
    page_indices: tuple[int, ...]


def _invoice_file_path(relative_path: str | Path) -> Path:
    return uploaded_path(relative_path, UPLOAD_ROOT)


def _is_loopback_host(host: str | None) -> bool:
    normalized = (host or "").strip().lower().rstrip(".")
    if normalized == "localhost":
        return True
    try:
        address = ipaddress.ip_address(normalized.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_loopback


def local_pdf_open_supported(client_host: str | None, request_host: str | None) -> bool:
    return sys.platform == "win32" and _is_loopback_host(client_host) and _is_loopback_host(request_host)


def detect_file_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的发票文件类型，请上传 PDF 发票或图片")


def parse_invoice_file_with_engine(absolute_path: Path, file_type: str, invoice_qr_engine: str) -> InvoiceParsedData:
    try:
        return parse_invoice_file(absolute_path, file_type, invoice_qr_engine=invoice_qr_engine)
    except TypeError:
        return parse_invoice_file(absolute_path, file_type)


def parse_invoice_files_with_engine(absolute_path: Path, file_type: str, invoice_qr_engine: str) -> list[InvoiceParsedData]:
    if not absolute_path.exists():
        return [parse_invoice_file_with_engine(absolute_path, file_type, invoice_qr_engine)]
    try:
        parsed_items = parse_invoice_file_many(absolute_path, file_type, invoice_qr_engine=invoice_qr_engine)
    except TypeError:
        return [parse_invoice_file(absolute_path, file_type)]
    if file_type == "pdf":
        if pdf_page_count(absolute_path) > 1:
            return parsed_items
        if not parsed_items or all(not item.raw.get("parse_success") for item in parsed_items):
            fallback = parse_invoice_file_with_engine(absolute_path, file_type, invoice_qr_engine)
            if fallback.invoice_no or fallback.invoice_date or fallback.amount > Decimal("0.00"):
                return [fallback]
        return parsed_items
    if not parsed_items or all(not item.raw.get("parse_success") for item in parsed_items):
        fallback = parse_invoice_file_with_engine(absolute_path, file_type, invoice_qr_engine)
        if fallback.invoice_no or fallback.invoice_date or fallback.amount > Decimal("0.00"):
            return [fallback]
    return parsed_items


def validate_invoice_target(
    report,
    expense_category: str | None,
    trip_id: int | None,
    regular_item_id: int | None = None,
) -> str:
    if report.report_type == "regular":
        if report.regular_mode != "invoice":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无票常规报销单不能上传发票")
        if regular_item_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销发票必须关联报销项目")
        if trip_id is not None or (expense_category or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销发票不能关联差旅行程或费用类别")
        get_regular_item_target(report, regular_item_id)
        return REGULAR_EXPENSE_CATEGORY

    if regular_item_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差报销发票不能关联常规报销项目")
    if not (expense_category or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差报销发票必须指定费用类别")
    expense_category = validate_expense_category(expense_category)
    if expense_category == "transport_fare":
        if trip_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="车船费发票必须关联行程")
        if all(trip.id != trip_id for trip in report.trips):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="行程不存在")
        return expense_category
    if trip_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非车船费发票不能关联行程")
    if is_custom_category(expense_category):
        if all(item.category != expense_category for item in report.expense_items):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义费用类别不存在，请先在当前报销单中添加")
        return expense_category
    if expense_category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效费用类别")
    return expense_category


def calculate_file_hash(file_path: Path) -> str | None:
    return calculate_path_hash(file_path)


def calculate_upload_fingerprint(upload_file: UploadFile) -> tuple[int, str]:
    digest = sha256()
    file_size = 0
    upload_file.file.seek(0)
    for chunk in iter(lambda: upload_file.file.read(1024 * 1024), b""):
        file_size += len(chunk)
        digest.update(chunk)
    upload_file.file.seek(0)
    return file_size, digest.hexdigest()


def calculate_upload_hash(upload_file: UploadFile) -> str:
    return calculate_upload_fingerprint(upload_file)[1]


def ensure_no_duplicate_invoice_file(
    duplicate_index: InvoiceDuplicateIndex,
    report_id: int,
    upload_size: int,
    upload_hash: str,
    subject: str = "该发票文件",
) -> None:
    matches = duplicate_index.find_file_matches(upload_size, upload_hash)
    if not matches:
        return
    scope = "本报销单" if has_current_report_match(matches, report_id) else "其他报销单"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"{subject}已在{scope}中上传，请删除重复发票后再上传。"
            f"{format_duplicate_sources(matches, report_id)}"
        ),
    )


def ensure_no_duplicate_invoice_no(
    duplicate_index: InvoiceDuplicateIndex,
    report_id: int,
    invoice_no: str | None,
) -> None:
    normalized = (invoice_no or "").strip()
    if not normalized:
        return
    matches = duplicate_index.find_invoice_no_matches(normalized)
    if not matches:
        return
    scope = "本报销单" if has_current_report_match(matches, report_id) else "其他报销单"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"识别到相同发票号 {normalized} 已在{scope}中上传，请删除重复发票后再上传。"
            f"{format_duplicate_sources(matches, report_id)}"
        ),
    )


def safe_category_filename_prefix(expense_category: str) -> str:
    if expense_category.startswith(CUSTOM_CATEGORY_PREFIX):
        digest = sha1(expense_category.encode("utf-8")).hexdigest()[:8]
        return f"custom_{digest}"
    return expense_category


def save_upload_file(upload_file: UploadFile, report_id: int, expense_category: str, file_type: str) -> str:
    ext = Path(upload_file.filename or "").suffix.lower() or f".{file_type}"
    upload_dir = UPLOAD_ROOT / str(report_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename_prefix = safe_category_filename_prefix(expense_category)
    relative_path = Path("uploads") / str(report_id) / f"{filename_prefix}_invoice_{uuid4().hex}{ext}"
    absolute_path = _invoice_file_path(relative_path)
    with absolute_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)
    return relative_path.as_posix()


def build_invoice_storage_path(report_id: int, invoice_id: int, expense_category: str, file_hash: str, ext: str) -> Path:
    filename_prefix = safe_category_filename_prefix(expense_category)
    safe_ext = ext.lower() if ext.startswith(".") else f".{ext.lower()}"
    return Path("uploads") / str(report_id) / f"{invoice_id}_{filename_prefix}_{file_hash[:8]}_{uuid4().hex}{safe_ext}"


def relocate_invoice_file(invoice: Invoice, file_hash: str) -> None:
    current_relative = Path(invoice.file_path)
    source = _invoice_file_path(current_relative)
    if not source.exists():
        return
    final_relative = build_invoice_storage_path(
        report_id=invoice.report_id,
        invoice_id=invoice.id,
        expense_category=invoice.expense_category,
        file_hash=file_hash,
        ext=source.suffix or invoice.file_type,
    )
    target = _invoice_file_path(final_relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    source.replace(target)
    invoice.file_path = final_relative.as_posix()


def split_pdf_pages_to_upload_file(
    source_path: Path,
    report_id: int,
    expense_category: str,
    page_indices: tuple[int, ...],
) -> str:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(source_path))
    if not page_indices:
        raise ValueError("PDF 分组不能为空")
    writer = PdfWriter()
    for page_index in page_indices:
        if page_index < 0 or page_index >= len(reader.pages):
            raise ValueError("PDF 页码超出范围")
        writer.add_page(reader.pages[page_index])

    upload_dir = UPLOAD_ROOT / str(report_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename_prefix = safe_category_filename_prefix(expense_category)
    start_page = page_indices[0] + 1
    end_page = page_indices[-1] + 1
    page_label = f"page{start_page}" if start_page == end_page else f"pages{start_page}-{end_page}"
    relative_path = Path("uploads") / str(report_id) / f"{filename_prefix}_invoice_{page_label}_{uuid4().hex}.pdf"
    absolute_path = _invoice_file_path(relative_path)
    with absolute_path.open("wb") as target:
        writer.write(target)
    return relative_path.as_posix()


def _parsed_with_group_metadata(
    parsed: InvoiceParsedData,
    page_indices: tuple[int, ...],
    source_page_count: int,
    warning: str | None = None,
) -> InvoiceParsedData:
    raw = dict(parsed.raw or {})
    normalized_invoice_no = (parsed.invoice_no or "").strip() or None
    raw.update(
        {
            "group_page_numbers": [page_index + 1 for page_index in page_indices],
            "group_page_count": len(page_indices),
            "source_page_count": source_page_count,
        }
    )
    if warning:
        raw[UPLOAD_WARNINGS_RAW_KEY] = [warning]
    return parsed.model_copy(update={"invoice_no": normalized_invoice_no, "raw": raw})


def build_invoice_page_groups(
    parsed_items: list[InvoiceParsedData],
    source_page_count: int,
) -> list[ParsedInvoiceGroup]:
    if not parsed_items:
        parsed_items = [InvoiceParsedData(raw={"source": "pdf"})]

    actual_page_count = max(source_page_count, len(parsed_items), 1)
    if actual_page_count <= 1:
        parsed = _parsed_with_group_metadata(parsed_items[-1], (0,), actual_page_count)
        return [ParsedInvoiceGroup(parsed=parsed, page_indices=(0,))]

    all_page_indices = tuple(range(actual_page_count))
    if len(parsed_items) != actual_page_count:
        parsed = _parsed_with_group_metadata(
            parsed_items[-1],
            all_page_indices,
            actual_page_count,
            UNCLEAR_PDF_GROUPING_WARNING,
        )
        return [ParsedInvoiceGroup(parsed=parsed, page_indices=all_page_indices)]

    normalized_numbers = [(parsed.invoice_no or "").strip() for parsed in parsed_items]
    if any(not invoice_no for invoice_no in normalized_numbers):
        parsed = _parsed_with_group_metadata(
            parsed_items[-1],
            all_page_indices,
            actual_page_count,
            UNCLEAR_PDF_GROUPING_WARNING,
        )
        return [ParsedInvoiceGroup(parsed=parsed, page_indices=all_page_indices)]

    groups: list[tuple[str, list[int]]] = []
    seen_numbers: set[str] = set()
    for page_index, invoice_no in enumerate(normalized_numbers):
        if groups and groups[-1][0] == invoice_no:
            groups[-1][1].append(page_index)
            continue
        if invoice_no in seen_numbers:
            parsed = _parsed_with_group_metadata(
                parsed_items[-1],
                all_page_indices,
                actual_page_count,
                NONCONTIGUOUS_PDF_GROUPING_WARNING,
            )
            return [ParsedInvoiceGroup(parsed=parsed, page_indices=all_page_indices)]
        seen_numbers.add(invoice_no)
        groups.append((invoice_no, [page_index]))

    parsed_groups: list[ParsedInvoiceGroup] = []
    for _invoice_no, group_page_indices in groups:
        page_indices = tuple(group_page_indices)
        representative = _parsed_with_group_metadata(
            parsed_items[page_indices[-1]],
            page_indices,
            actual_page_count,
        )
        parsed_groups.append(ParsedInvoiceGroup(parsed=representative, page_indices=page_indices))
    return parsed_groups


def _pdf_group_subject(page_indices: tuple[int, ...]) -> str:
    start_page = page_indices[0] + 1
    end_page = page_indices[-1] + 1
    if start_page == end_page:
        return f"该发票文件中的第 {start_page} 页"
    return f"该发票文件中的第 {start_page}-{end_page} 页"


def upload_invoices(
    db: Session,
    report_id: int,
    expense_category: str | None,
    upload_file: UploadFile,
    trip_id: int | None = None,
    regular_item_id: int | None = None,
) -> list[tuple[Invoice, InvoiceParsedData]]:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    expense_category = validate_invoice_target(report, expense_category, trip_id, regular_item_id)
    regular_item = get_regular_item_target(report, regular_item_id) if regular_item_id is not None else None

    file_type = detect_file_type(upload_file.filename or "")
    duplicate_index = InvoiceDuplicateIndex(db, resolve_path=_invoice_file_path)
    upload_size, upload_hash = calculate_upload_fingerprint(upload_file)
    ensure_no_duplicate_invoice_file(duplicate_index, report_id, upload_size, upload_hash)

    relative_path = save_upload_file(upload_file, report_id, expense_category, file_type)
    absolute_path = _invoice_file_path(relative_path)
    try:
        settings = get_or_create_settings(db)
        parsed_items = parse_invoice_files_with_engine(absolute_path, file_type, settings.invoice_qr_engine)
    except Exception as exc:
        parsed_items = [InvoiceParsedData(raw={"source": file_type, "parse_error": str(exc)})]

    if not parsed_items:
        parsed_items = [InvoiceParsedData(raw={"source": file_type})]

    if file_type == "pdf":
        parsed_groups = build_invoice_page_groups(parsed_items, pdf_page_count(absolute_path))
    else:
        parsed_groups = [ParsedInvoiceGroup(parsed=parsed_items[-1], page_indices=())]

    created: list[tuple[Invoice, InvoiceParsedData]] = []
    created_paths: list[Path] = []
    seen_group_hashes: set[str] = set()
    should_split_pdf = file_type == "pdf" and len(parsed_groups) > 1

    try:
        for parsed_group in parsed_groups:
            parsed = parsed_group.parsed
            ensure_no_duplicate_invoice_no(duplicate_index, report_id, parsed.invoice_no)

            item_relative_path = relative_path
            if should_split_pdf:
                item_relative_path = split_pdf_pages_to_upload_file(
                    absolute_path,
                    report_id,
                    expense_category,
                    parsed_group.page_indices,
                )
                created_paths.append(_invoice_file_path(item_relative_path))

            item_path = _invoice_file_path(item_relative_path)
            calculated_item_hash = calculate_file_hash(item_path)
            item_hash = calculated_item_hash or upload_hash
            if should_split_pdf and calculated_item_hash is not None:
                ensure_no_duplicate_invoice_file(
                    duplicate_index,
                    report_id,
                    item_path.stat().st_size,
                    calculated_item_hash,
                    subject=_pdf_group_subject(parsed_group.page_indices),
                )
                if calculated_item_hash in seen_group_hashes:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"{_pdf_group_subject(parsed_group.page_indices)}"
                            "与本文件中的其他发票分组内容完全相同，请拆分并删除重复内容后再上传"
                        ),
                    )
                seen_group_hashes.add(calculated_item_hash)

            invoice = Invoice(
                report_id=report_id,
                trip_id=trip_id,
                regular_item=regular_item,
                expense_category=expense_category,
                file_path=item_relative_path,
                file_type=file_type,
                invoice_type=parsed.invoice_type,
                invoice_no=parsed.invoice_no,
                invoice_date=parsed.invoice_date,
                amount=parsed.amount,
                amount_confirmed=False,
            )
            db.add(invoice)
            db.flush()
            relocate_invoice_file(invoice, item_hash)
            created_paths.append(_invoice_file_path(invoice.file_path))
            created.append((invoice, parsed))

        if should_split_pdf:
            absolute_path.unlink(missing_ok=True)
        recalculate_report_totals(report)
        db.commit()
        for invoice, _parsed in created:
            db.refresh(invoice)
        return created
    except Exception:
        db.rollback()
        absolute_path.unlink(missing_ok=True)
        for path in created_paths:
            path.unlink(missing_ok=True)
        raise


def upload_invoice(
    db: Session,
    report_id: int,
    expense_category: str | None,
    upload_file: UploadFile,
    trip_id: int | None = None,
    regular_item_id: int | None = None,
) -> tuple[Invoice, InvoiceParsedData]:
    return upload_invoices(db, report_id, expense_category, upload_file, trip_id, regular_item_id)[0]


def get_invoice_or_404(db: Session, invoice_id: int) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None or invoice.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="发票不存在")
    return invoice


def open_invoice_pdf_locally(db: Session, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, invoice_id)
    if invoice.file_type != "pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅 PDF 发票可使用系统默认程序打开")

    file_path = _invoice_file_path(invoice.file_path)
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="发票原始文件不存在")

    try:
        startfile = getattr(os, "startfile")
        startfile(str(file_path))
    except (AttributeError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="无法调用系统默认 PDF 程序，请检查 Windows 的 PDF 文件关联设置",
        ) from exc


def update_invoice(db: Session, invoice_id: int, payload: InvoiceUpdate) -> Invoice:
    invoice = get_invoice_or_404(db, invoice_id)
    report = get_report_or_404(db, invoice.report_id)
    ensure_report_writable(report)
    try:
        invoice.amount = payload.amount.quantize(Decimal("0.01"))
        invoice.amount_confirmed = payload.amount_confirmed
        if payload.invoice_type is not None:
            invoice.invoice_type = payload.invoice_type
        recalculate_report_totals(report)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(invoice)
    return invoice


def parse_existing_invoice(db: Session, invoice_id: int) -> InvoiceParsedData:
    invoice = get_invoice_or_404(db, invoice_id)
    absolute_path = _invoice_file_path(invoice.file_path)
    try:
        settings = get_or_create_settings(db)
        return parse_invoice_file_with_engine(absolute_path, invoice.file_type, settings.invoice_qr_engine)
    except Exception as exc:
        return InvoiceParsedData(raw={"source": invoice.file_type, "parse_error": str(exc)})


def soft_delete_invoice(db: Session, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, invoice_id)
    report = get_report_or_404(db, invoice.report_id)
    ensure_report_writable(report)
    try:
        invoice.deleted_at = datetime.utcnow()
        recalculate_report_totals(report)
        db.commit()
    except Exception:
        db.rollback()
        raise
