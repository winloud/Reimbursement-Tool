from datetime import date
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from pypdf import PdfWriter

from backend.schemas.invoice import InvoiceParsedData, InvoiceUpdate
from backend.schemas.report import ReportCreate, ReportUpdate, RegularItemWrite
from backend.services import invoice_service, report_attachment_service
from backend.services.invoice_service import update_invoice, upload_invoice
from backend.services.report_attachment_service import upload_report_attachment
from backend.services.report_batch_service import batch_restore_deleted_reports, batch_soft_delete_draft_reports
from backend.services.report_service import (
    create_report,
    restore_deleted_report,
    soft_delete_report,
    update_report,
)


def make_report(db, mode: str, *, description: str = "办公用品"):
    return create_report(
        db,
        ReportCreate(
            report_type="regular",
            regular_mode=mode,
            regular_items=[
                RegularItemWrite(
                    sort_order=1,
                    occurred_on=date(2026, 8, 10),
                    description=description,
                    amount=Decimal("10.00") if mode == "no_invoice" else None,
                )
            ],
        ),
    )


def pdf_bytes(page_count: int = 1) -> bytes:
    writer = PdfWriter()
    for index in range(page_count):
        writer.add_blank_page(width=200 + index, height=200)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def upload(filename: str, payload: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(payload))


def test_no_invoice_evidence_is_item_scoped_and_counts_pdf_pages(monkeypatch, tmp_path, db):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(report_attachment_service, "UPLOAD_ROOT", upload_root)
    report = make_report(db, "no_invoice")
    item = report.regular_items[0]

    pdf = upload_report_attachment(db, report.id, upload("evidence.pdf", pdf_bytes(2)), regular_item_id=item.id)
    image_buffer = BytesIO()
    Image.new("RGB", (20, 20), color="white").save(image_buffer, format="PNG")
    image = upload_report_attachment(db, report.id, upload("photo.png", image_buffer.getvalue()), regular_item_id=item.id)
    db.refresh(report)

    assert pdf.regular_item_id == item.id
    assert pdf.page_count == 2
    assert image.page_count == 1
    assert item.document_count == 3
    assert report.document_count == 3

    updated = update_report(
        db,
        report.id,
        ReportUpdate(report_type="regular", regular_mode="no_invoice", regular_items=[]),
    )
    db.refresh(pdf)
    db.refresh(image)
    assert updated.regular_items == []
    assert pdf.deleted_at is not None and pdf.regular_item_id is None
    assert image.deleted_at is not None and image.regular_item_id is None


def test_regular_evidence_and_invoice_targets_reject_wrong_modes_and_reports(monkeypatch, tmp_path, db):
    monkeypatch.setattr(report_attachment_service, "UPLOAD_ROOT", tmp_path / "attachments")
    no_invoice = make_report(db, "no_invoice")
    invoice = make_report(db, "invoice")

    with pytest.raises(HTTPException, match="有票常规报销单不能上传报销凭据"):
        upload_report_attachment(
            db,
            invoice.id,
            upload("evidence.pdf", pdf_bytes()),
            regular_item_id=invoice.regular_items[0].id,
        )
    with pytest.raises(HTTPException, match="不属于当前报销单"):
        upload_report_attachment(
            db,
            no_invoice.id,
            upload("evidence.pdf", pdf_bytes()),
            regular_item_id=invoice.regular_items[0].id,
        )
    with pytest.raises(HTTPException, match="无票常规报销单不能上传发票"):
        upload_invoice(
            db,
            no_invoice.id,
            None,
            upload("invoice.pdf", pdf_bytes()),
            regular_item_id=no_invoice.regular_items[0].id,
        )


def test_invoice_upload_binds_regular_item_and_drives_confirmed_total(monkeypatch, tmp_path, db):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(
        invoice_service,
        "parse_invoice_files_with_engine",
        lambda _path, _file_type, _engine: [InvoiceParsedData(amount=Decimal("66.80"))],
    )
    report = make_report(db, "invoice")
    item = report.regular_items[0]

    invoice, _parsed = upload_invoice(
        db,
        report.id,
        None,
        upload("invoice.pdf", pdf_bytes()),
        regular_item_id=item.id,
    )
    db.refresh(report)
    assert invoice.regular_item_id == item.id
    assert invoice.expense_category == "regular"
    assert item.document_count == 1
    assert report.total_amount == Decimal("0.00")

    update_invoice(db, invoice.id, InvoiceUpdate(amount=Decimal("66.80"), amount_confirmed=True))
    db.refresh(report)
    assert item.amount == Decimal("66.80")
    assert report.total_amount == Decimal("66.80")

    updated = update_report(
        db,
        report.id,
        ReportUpdate(report_type="regular", regular_mode="invoice", regular_items=[]),
    )
    db.refresh(invoice)
    invoice_deleted_at = invoice.deleted_at
    assert invoice_deleted_at is not None
    assert invoice.regular_item_id is None
    assert updated.regular_items == []
    assert updated.total_amount == Decimal("0.00")

    soft_delete_report(db, report.id)
    restore_deleted_report(db, report.id)
    db.refresh(invoice)
    assert invoice.deleted_at == invoice_deleted_at
    assert invoice.regular_item_id is None

    monkeypatch.setattr("backend.services.report_batch_service.create_safety_snapshot", lambda *_args, **_kwargs: None)
    batch_soft_delete_draft_reports(db, [report.id])
    batch_restore_deleted_reports(db, [report.id])
    db.refresh(invoice)
    assert invoice.deleted_at == invoice_deleted_at
