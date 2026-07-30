import ipaddress
import os
import shutil
import sys
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
from backend.services.invoice_parser import parse_invoice_file, parse_invoice_file_many
from backend.services.settings_service import get_or_create_settings
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    CUSTOM_CATEGORY_PREFIX,
    ensure_report_writable,
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
    if not parsed_items or all(not item.raw.get("parse_success") for item in parsed_items):
        fallback = parse_invoice_file_with_engine(absolute_path, file_type, invoice_qr_engine)
        if fallback.invoice_no or fallback.invoice_date or fallback.amount > Decimal("0.00"):
            return [fallback]
    return parsed_items


def validate_invoice_target(report, expense_category: str, trip_id: int | None) -> str:
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


def split_pdf_page_to_upload_file(source_path: Path, report_id: int, expense_category: str, page_index: int) -> str:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(source_path))
    if page_index < 0 or page_index >= len(reader.pages):
        raise ValueError("PDF 页码超出范围")
    writer = PdfWriter()
    writer.add_page(reader.pages[page_index])

    upload_dir = UPLOAD_ROOT / str(report_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename_prefix = safe_category_filename_prefix(expense_category)
    relative_path = Path("uploads") / str(report_id) / f"{filename_prefix}_invoice_page{page_index + 1}_{uuid4().hex}.pdf"
    absolute_path = _invoice_file_path(relative_path)
    with absolute_path.open("wb") as target:
        writer.write(target)
    return relative_path.as_posix()


def parsed_page_index(parsed: InvoiceParsedData) -> int | None:
    value = parsed.raw.get("page_index") if parsed.raw else None
    if isinstance(value, int) and value >= 0:
        return value
    return None


def upload_invoices(
    db: Session,
    report_id: int,
    expense_category: str,
    upload_file: UploadFile,
    trip_id: int | None = None,
) -> list[tuple[Invoice, InvoiceParsedData]]:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    expense_category = validate_invoice_target(report, expense_category, trip_id)

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

    created: list[tuple[Invoice, InvoiceParsedData]] = []
    created_paths: list[Path] = []
    seen_invoice_nos: set[str] = set()
    seen_page_hashes: set[str] = set()
    should_split_pdf = file_type == "pdf" and len(parsed_items) > 1

    try:
        for parsed in parsed_items:
            normalized_invoice_no = (parsed.invoice_no or "").strip()
            if normalized_invoice_no:
                if normalized_invoice_no in seen_invoice_nos:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"识别到相同发票号 {normalized_invoice_no} 在本文件中重复，请拆分后再上传",
                    )
                seen_invoice_nos.add(normalized_invoice_no)
            ensure_no_duplicate_invoice_no(duplicate_index, report_id, parsed.invoice_no)

            item_relative_path = relative_path
            page_number: int | None = None
            if should_split_pdf:
                page_index = parsed_page_index(parsed)
                if page_index is None:
                    page_index = len(created)
                page_number = page_index + 1
                item_relative_path = split_pdf_page_to_upload_file(absolute_path, report_id, expense_category, page_index)
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
                    subject=f"该发票文件中的第 {page_number} 页",
                )
                if calculated_item_hash in seen_page_hashes:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"该发票文件中的第 {page_number} 页与本文件中的其他页面内容完全相同，请删除重复页后再上传",
                    )
                seen_page_hashes.add(calculated_item_hash)

            invoice = Invoice(
                report_id=report_id,
                trip_id=trip_id,
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
    expense_category: str,
    upload_file: UploadFile,
    trip_id: int | None = None,
) -> tuple[Invoice, InvoiceParsedData]:
    return upload_invoices(db, report_id, expense_category, upload_file, trip_id)[0]


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
