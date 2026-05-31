import shutil
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.database.connection import PROJECT_ROOT
from backend.models.invoice import Invoice
from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.services.invoice_parser import parse_invoice_file
from backend.services.report_service import EXPENSE_CATEGORIES, ensure_report_writable, get_report_or_404, recalculate_report_totals

UPLOAD_ROOT = PROJECT_ROOT / "backend" / "uploads"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}


def detect_file_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".xml":
        return "xml"
    if ext == ".pdf":
        return "pdf"
    if ext == ".ofd":
        return "ofd"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的发票文件类型")


def validate_invoice_target(report, expense_category: str, trip_id: int | None) -> None:
    if expense_category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效费用类别")
    if expense_category == "transport_fare":
        if trip_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="车船费发票必须关联行程")
        if all(trip.id != trip_id for trip in report.trips):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="行程不存在")
    elif trip_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非车船费发票不能关联行程")


def save_upload_file(upload_file: UploadFile, report_id: int, file_type: str) -> str:
    ext = Path(upload_file.filename or "").suffix.lower() or f".{file_type}"
    upload_dir = UPLOAD_ROOT / str(report_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    relative_path = Path("uploads") / str(report_id) / f"invoice_{uuid4().hex}{ext}"
    absolute_path = PROJECT_ROOT / "backend" / relative_path
    with absolute_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)
    return relative_path.as_posix()


def upload_invoice(
    db: Session,
    report_id: int,
    expense_category: str,
    upload_file: UploadFile,
    trip_id: int | None = None,
) -> tuple[Invoice, InvoiceParsedData]:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    validate_invoice_target(report, expense_category, trip_id)

    file_type = detect_file_type(upload_file.filename or "")
    relative_path = save_upload_file(upload_file, report_id, file_type)
    absolute_path = PROJECT_ROOT / "backend" / relative_path
    try:
        parsed = parse_invoice_file(absolute_path, file_type)
    except Exception as exc:
        parsed = InvoiceParsedData(raw={"source": file_type, "parse_error": str(exc)})

    amount_confirmed = file_type in {"xml", "pdf", "ofd"} and parsed.amount > Decimal("0.00")
    invoice = Invoice(
        report_id=report_id,
        trip_id=trip_id,
        expense_category=expense_category,
        file_path=relative_path,
        file_type=file_type,
        invoice_no=parsed.invoice_no,
        invoice_date=parsed.invoice_date,
        amount=parsed.amount,
        amount_confirmed=amount_confirmed,
    )
    db.add(invoice)
    db.flush()
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


def soft_delete_invoice(db: Session, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, invoice_id)
    report = get_report_or_404(db, invoice.report_id)
    ensure_report_writable(report)
    invoice.deleted_at = datetime.utcnow()
    recalculate_report_totals(report)
    db.commit()
