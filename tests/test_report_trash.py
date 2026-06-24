from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.schemas.report import ReportCreate
from backend.services import report_batch_service
from backend.services import report_service
from backend.services.report_batch_service import batch_purge_reports, batch_restore_deleted_reports
from backend.services.report_service import (
    create_report,
    list_deleted_reports,
    list_reports,
    purge_report,
    restore_deleted_report,
    soft_delete_report,
    update_report_status,
)


def configure_upload_paths(monkeypatch, tmp_path: Path) -> Path:
    project_root = tmp_path / "project"
    upload_root = project_root / "backend" / "uploads"
    upload_root.mkdir(parents=True)
    monkeypatch.setattr(report_service, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(report_service, "UPLOAD_ROOT", upload_root)
    return project_root


def attach_invoice(db, project_root: Path, report, content: bytes = b"invoice") -> Invoice:
    file_path = project_root / "backend" / "uploads" / str(report.id) / "invoice.pdf"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content)
    invoice = Invoice(
        report_id=report.id,
        expense_category="accommodation",
        file_path=f"uploads/{report.id}/invoice.pdf",
        file_type="pdf",
        amount=Decimal("10.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice


def test_soft_deleted_draft_moves_to_trash_and_can_restore(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="可恢复草稿"))
    soft_delete_report(db, report.id)

    active_items, active_total = list_reports(db)
    trash_items, trash_total = list_deleted_reports(db)

    assert active_total == 0
    assert active_items == []
    assert trash_total == 1
    assert trash_items[0].id == report.id
    assert trash_items[0].deleted_at is not None

    restored = restore_deleted_report(db, report.id)
    active_items, active_total = list_reports(db)
    trash_items, trash_total = list_deleted_reports(db)

    assert restored.deleted_at is None
    assert active_total == 1
    assert active_items[0].id == report.id
    assert trash_total == 0
    assert trash_items == []


def test_restore_recovers_report_invoices(db):
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="恢复发票"))
    invoice = Invoice(
        report_id=report.id,
        expense_category="accommodation",
        file_path="uploads/1/invoice.pdf",
        file_type="pdf",
        amount=Decimal("10.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()

    soft_delete_report(db, report.id)
    db.refresh(invoice)
    assert invoice.deleted_at is not None

    restore_deleted_report(db, report.id)
    db.refresh(invoice)
    assert invoice.deleted_at is None


def test_purge_deletes_database_rows_and_attachment_file(monkeypatch, tmp_path, db):
    project_root = configure_upload_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="彻底删除"))
    invoice = attach_invoice(db, project_root, report)
    attachment_path = project_root / "backend" / invoice.file_path

    files_deleted = purge_report(db, report.id)

    assert files_deleted == 1
    assert not attachment_path.exists()
    assert db.get(ExpenseReport, report.id) is None
    assert db.scalar(select(Invoice).where(Invoice.id == invoice.id)) is None


def test_purge_rejects_non_draft_report(monkeypatch, tmp_path, db):
    configure_upload_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="已打印"))
    update_report_status(db, report.id, "printed")

    with pytest.raises(HTTPException) as exc:
        purge_report(db, report.id)

    assert exc.value.status_code == 403
    assert db.get(ExpenseReport, report.id) is not None


def test_purge_rejects_unsafe_attachment_path(monkeypatch, tmp_path, db):
    configure_upload_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="路径越界"))
    invoice = Invoice(
        report_id=report.id,
        expense_category="accommodation",
        file_path="../bad.pdf",
        file_type="pdf",
        amount=Decimal("10.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        purge_report(db, report.id)

    assert exc.value.status_code == 400
    assert db.get(ExpenseReport, report.id) is not None


def test_batch_restore_and_purge_return_counts(monkeypatch, tmp_path, db):
    snapshot_reasons = []
    monkeypatch.setattr(
        report_batch_service,
        "create_safety_snapshot",
        lambda _db, reason: snapshot_reasons.append(reason),
    )
    project_root = configure_upload_paths(monkeypatch, tmp_path)
    restore_target = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="批量恢复"))
    purge_target = create_report(db, ReportCreate(report_date=date(2026, 6, 2), purpose="批量彻底删除"))
    printed = create_report(db, ReportCreate(report_date=date(2026, 6, 3), purpose="跳过已打印"))
    update_report_status(db, printed.id, "printed")
    soft_delete_report(db, restore_target.id)
    soft_delete_report(db, purge_target.id)
    attach_invoice(db, project_root, purge_target)

    restore_result = batch_restore_deleted_reports(db, [restore_target.id, printed.id, 9999])
    purge_result = batch_purge_reports(db, [purge_target.id, printed.id, 9999])

    assert restore_result.restored_count == 1
    assert restore_result.skipped_count == 2
    assert purge_result.purged_count == 1
    assert purge_result.skipped_count == 2
    assert purge_result.files_deleted_count == 1
    assert db.get(ExpenseReport, restore_target.id).deleted_at is None
    assert db.get(ExpenseReport, purge_target.id) is None
    assert snapshot_reasons == ["pre_batch_purge"]


def test_batch_purge_aborts_when_snapshot_fails(monkeypatch, tmp_path, db):
    project_root = configure_upload_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 6, 2), purpose="批量彻底删除失败"))
    invoice = attach_invoice(db, project_root, report)
    attachment_path = project_root / "backend" / invoice.file_path

    def fail_snapshot(_db, reason):
        raise HTTPException(status_code=500, detail=f"{reason} failed")

    monkeypatch.setattr(report_batch_service, "create_safety_snapshot", fail_snapshot)

    with pytest.raises(HTTPException):
        batch_purge_reports(db, [report.id])

    assert db.get(ExpenseReport, report.id) is not None
    assert attachment_path.exists()
