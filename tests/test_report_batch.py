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
from backend.models.settings import Settings
from backend.schemas.report import ReportCreate
from backend.services import report_batch_service
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
    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 24)

    monkeypatch.setattr("backend.services.report_batch_service.date", FixedDate)
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
    assert draft.report_date == date(2026, 6, 24)
    assert printed.report_date == date(2026, 6, 5)
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
        assert len(names) == 2
        assert any(name.startswith("2026-06-24-草稿出差-") for name in names)
        assert any(name.startswith("2026-06-05-已打印出差-") for name in names)
        for name in names:
            assert name.endswith(".pdf")
            assert len(PdfReader(BytesIO(archive.read(name))).pages) == 1


def test_batch_pdf_uses_vat_special_double_print_setting(monkeypatch, db):
    db.add(
        Settings(
            id=1,
            daily_subsidy=Decimal("80.00"),
            pdf_fill_font_key="system:simsun",
            double_print_vat_special_invoices=False,
        )
    )
    db.commit()
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="批量"))
    calls = []

    def build_pdf(_report, _fill_font_key, double_print_vat_special_invoices):
        calls.append(double_print_vat_special_invoices)
        return b"%PDF-1.4\n%%EOF"

    monkeypatch.setattr("backend.services.report_batch_service.build_merged_report_pdf", build_pdf)

    zip_bytes, _filename = build_batch_report_pdf_zip(db, [report.id])

    assert calls == [False]
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        assert len(archive.namelist()) == 1


def test_batch_pdf_failure_keeps_all_statuses_unchanged(monkeypatch, tmp_path, db):
    configure_pdf_paths(monkeypatch, tmp_path)
    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 24)

    monkeypatch.setattr("backend.services.report_batch_service.date", FixedDate)
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
    assert draft.report_date == date(2026, 6, 4)
    assert invalid.report_date == date(2026, 6, 5)


def test_batch_delete_only_deletes_draft_reports(monkeypatch, db):
    snapshot_reasons = []
    monkeypatch.setattr(
        report_batch_service,
        "create_safety_snapshot",
        lambda _db, reason: snapshot_reasons.append(reason),
    )
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
    assert snapshot_reasons == ["pre_batch_delete"]


def test_batch_delete_skips_snapshot_when_no_report_will_be_deleted(monkeypatch, db):
    snapshot_reasons = []
    monkeypatch.setattr(
        report_batch_service,
        "create_safety_snapshot",
        lambda _db, reason: snapshot_reasons.append(reason),
    )
    printed = create_report(db, ReportCreate(report_date=date(2026, 6, 5), purpose="已打印"))
    update_report_status(db, printed.id, "printed")

    result = batch_soft_delete_draft_reports(db, [printed.id, 9999])

    assert result.deleted_count == 0
    assert result.skipped_count == 2
    assert snapshot_reasons == []


def test_batch_delete_aborts_when_snapshot_fails(monkeypatch, db):
    draft = create_report(db, ReportCreate(report_date=date(2026, 6, 4), purpose="草稿"))

    def fail_snapshot(_db, reason):
        raise HTTPException(status_code=500, detail=f"{reason} failed")

    monkeypatch.setattr(report_batch_service, "create_safety_snapshot", fail_snapshot)

    with pytest.raises(HTTPException):
        batch_soft_delete_draft_reports(db, [draft.id])

    db.refresh(draft)
    assert draft.deleted_at is None
