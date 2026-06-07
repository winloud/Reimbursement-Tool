import shutil
from datetime import datetime
from decimal import Decimal
from hashlib import sha1
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.database.connection import PROJECT_ROOT
from backend.models.invoice import Invoice
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.services.invoice_parser import parse_invoice_file
from backend.services.report_service import (
    EXPENSE_CATEGORIES,
    CUSTOM_CATEGORY_PREFIX,
    ensure_report_writable,
    get_report_or_404,
    is_custom_category,
    recalculate_report_totals,
    validate_expense_category,
)

UPLOAD_ROOT = PROJECT_ROOT / "backend" / "uploads"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}


def detect_file_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的发票文件类型，请上传 PDF 发票或图片")


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
    if not file_path.exists():
        return None
    digest = sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def calculate_upload_hash(upload_file: UploadFile) -> str:
    digest = sha256()
    upload_file.file.seek(0)
    for chunk in iter(lambda: upload_file.file.read(1024 * 1024), b""):
        digest.update(chunk)
    upload_file.file.seek(0)
    return digest.hexdigest()


def ensure_no_duplicate_invoice_file(report, upload_hash: str) -> None:
    for invoice in report.invoices:
        if invoice.deleted_at is not None:
            continue
        existing_hash = calculate_file_hash(PROJECT_ROOT / "backend" / invoice.file_path)
        if existing_hash == upload_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该发票文件已在本报销单中上传，请删除重复发票后再上传",
            )


def ensure_no_duplicate_invoice_no(report, invoice_no: str | None) -> None:
    normalized = (invoice_no or "").strip()
    if not normalized:
        return
    for invoice in report.invoices:
        if invoice.deleted_at is not None:
            continue
        if (invoice.invoice_no or "").strip() == normalized:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"识别到相同发票号 {normalized} 已在本报销单中上传，请删除重复发票后再上传",
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
    absolute_path = PROJECT_ROOT / "backend" / relative_path
    with absolute_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)
    return relative_path.as_posix()


def build_invoice_storage_path(report_id: int, invoice_id: int, expense_category: str, file_hash: str, ext: str) -> Path:
    filename_prefix = safe_category_filename_prefix(expense_category)
    safe_ext = ext.lower() if ext.startswith(".") else f".{ext.lower()}"
    return Path("uploads") / str(report_id) / f"{invoice_id}_{filename_prefix}_{file_hash[:8]}_{uuid4().hex}{safe_ext}"


def relocate_invoice_file(invoice: Invoice, file_hash: str) -> None:
    current_relative = Path(invoice.file_path)
    source = PROJECT_ROOT / "backend" / current_relative
    if not source.exists():
        return
    final_relative = build_invoice_storage_path(
        report_id=invoice.report_id,
        invoice_id=invoice.id,
        expense_category=invoice.expense_category,
        file_hash=file_hash,
        ext=source.suffix or invoice.file_type,
    )
    target = PROJECT_ROOT / "backend" / final_relative
    target.parent.mkdir(parents=True, exist_ok=True)
    source.replace(target)
    invoice.file_path = final_relative.as_posix()


def upload_invoice(
    db: Session,
    report_id: int,
    expense_category: str,
    upload_file: UploadFile,
    trip_id: int | None = None,
) -> tuple[Invoice, InvoiceParsedData]:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    expense_category = validate_invoice_target(report, expense_category, trip_id)

    file_type = detect_file_type(upload_file.filename or "")
    upload_hash = calculate_upload_hash(upload_file)
    ensure_no_duplicate_invoice_file(report, upload_hash)

    relative_path = save_upload_file(upload_file, report_id, expense_category, file_type)
    absolute_path = PROJECT_ROOT / "backend" / relative_path
    try:
        parsed = parse_invoice_file(absolute_path, file_type)
    except Exception as exc:
        parsed = InvoiceParsedData(raw={"source": file_type, "parse_error": str(exc)})
    try:
        ensure_no_duplicate_invoice_no(report, parsed.invoice_no)
    except HTTPException:
        absolute_path.unlink(missing_ok=True)
        raise

    invoice = Invoice(
        report_id=report_id,
        trip_id=trip_id,
        expense_category=expense_category,
        file_path=relative_path,
        file_type=file_type,
        invoice_type=parsed.invoice_type,
        invoice_no=parsed.invoice_no,
        invoice_date=parsed.invoice_date,
        amount=parsed.amount,
        amount_confirmed=False,
    )
    db.add(invoice)
    db.flush()
    relocate_invoice_file(invoice, upload_hash)
    recalculate_report_totals(report)
    db.commit()
    db.refresh(invoice)
    return invoice, parsed


def get_invoice_or_404(db: Session, invoice_id: int) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None or invoice.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="发票不存在")
    return invoice


def update_invoice(db: Session, invoice_id: int, payload: InvoiceUpdate) -> Invoice:
    invoice = get_invoice_or_404(db, invoice_id)
    report = get_report_or_404(db, invoice.report_id)
    ensure_report_writable(report)
    invoice.amount = payload.amount.quantize(Decimal("0.01"))
    invoice.amount_confirmed = payload.amount_confirmed
    recalculate_report_totals(report)
    db.commit()
    db.refresh(invoice)
    return invoice


def parse_existing_invoice(db: Session, invoice_id: int) -> InvoiceParsedData:
    invoice = get_invoice_or_404(db, invoice_id)
    absolute_path = PROJECT_ROOT / "backend" / invoice.file_path
    try:
        return parse_invoice_file(absolute_path, invoice.file_type)
    except Exception as exc:
        return InvoiceParsedData(raw={"source": invoice.file_type, "parse_error": str(exc)})


def soft_delete_invoice(db: Session, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, invoice_id)
    report = get_report_or_404(db, invoice.report_id)
    ensure_report_writable(report)
    invoice.deleted_at = datetime.utcnow()
    recalculate_report_totals(report)
    db.commit()
