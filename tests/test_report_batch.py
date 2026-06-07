from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import zipfile

import pytest
from fastapi import HTTPException
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from backend.models.invoice import Invoice
from backend.schemas.report import ReportCreate
from backend.services.report_batch_service import batch_soft_delete_draft_reports, build_batch_report_pdf_zip
from backend.services.report_service import create_report, update_report_status


def write_blank_pdf(path: Path, pages: int = 1, pagesize: tuple[int, int] = (595, 298)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=pagesize)
    for page in range(pages):
        c.drawString(40, 260, f"page {page + 1}")
        c.showPage()
    c.save()


def configure_pdf_paths(monkeypatch, tmp_path: Path) -> None:
    template = tmp_path / "backend" / "templates" / "expense_template.pdf"
    write_blank_pdf(template)
    monkeypatch.setattr("backend.services.pdf_generator.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("backend.services.pdf_generator.TEMPLATE_CANDIDATES", [template])


def test_batch_pdf_success_returns_zip_and_marks_drafts_printed(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    draft = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="草稿出差"))
    printed = create_report(db, ReportCreate(report_date=date(2026, 6, 5), purpose="已打印出差"))
    update_report_status(db, printed.id, "printed")

    zip_bytes, filename = build_batch_report_pdf_zip(db, [draft.id, printed.id])

    db.refresh(draft)
    db.refresh(printed)
    assert filename.startswith("报销单批量下载-")
    assert filename.endswith(".zip")
    assert draft.status == "printed"
    assert printed.status == "printed"
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
        assert len(names) == 2
        for name in names:
            assert name.endswith(".pdf")
            assert len(PdfReader(BytesIO(archive.read(name))).pages) == 1


def test_batch_pdf_failure_keeps_all_statuses_unchanged(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    draft = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="草稿出差"))
    invalid = create_report(db, ReportCreate(report_date=date(2026, 6, 5), purpose="未确认发票"))
    db.add(
        Invoice(
            report_id=invalid.id,
            expense_category="luggage",
            file_path="uploads/missing.pdf",
            file_type="pdf",
            amount=Decimal("10.00"),
            amount_confirmed=False,
        )
    )
    db.commit()

    with pytest.raises(HTTPException) as exc:
        build_batch_report_pdf_zip(db, [draft.id, invalid.id])

    db.refresh(draft)
    db.refresh(invalid)
    assert exc.value.status_code == 400
    assert exc.value.detail["failures"][0]["report_id"] == invalid.id
    assert "未确认发票" in exc.value.detail["failures"][0]["reason"]
    assert draft.status == "draft"
    assert invalid.status == "draft"


def test_batch_delete_only_deletes_draft_reports(db):
    draft = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="草稿"))
    printed = create_report(db, ReportCreate(report_date=date(2026, 6, 5), purpose="已打印"))
    reimbursed = create_report(db, ReportCreate(report_date=date(2026, 6, 6), purpose="已报销"))
    update_report_status(db, printed.id, "printed")
    update_report_status(db, reimbursed.id, "printed")
    update_report_status(db, reimbursed.id, "reimbursed")

    result = batch_soft_delete_draft_reports(db, [draft.id, printed.id, reimbursed.id, 9999])

    db.refresh(draft)
    db.refresh(printed)
    db.refresh(reimbursed)
    assert result.deleted_count == 1
    assert result.skipped_count == 3
    assert draft.deleted_at is not None
    assert printed.deleted_at is None
    assert reimbursed.deleted_at is None
    assert {item.report_id for item in result.skipped} == {printed.id, reimbursed.id, 9999}
