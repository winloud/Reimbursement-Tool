from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import zipfile

from fastapi import HTTPException, UploadFile
from PIL import Image
from pypdf import PdfReader
import pytest
from reportlab.pdfgen import canvas
from sqlalchemy import select

from backend.data_schema import DATA_SCHEMA_VERSION
from backend.main import create_app
from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.report_attachment import ReportAttachment
from backend.schemas.data_transfer import DataExportRequest, ImportExecuteRequest
from backend.schemas.report import ExpenseItemWrite, ReportCreate, ReportDetailRead, TripWrite
from backend.services import data_transfer_service, maintenance_service, pdf_generator, report_attachment_service, report_service
from backend.services.data_transfer_service import build_export_zip, create_import_preview, execute_import
from backend.services.pdf_generator import build_merged_report_pdf
from backend.services.report_attachment_service import soft_delete_report_attachment, upload_report_attachment
from backend.services.report_service import (
    ReportFilters,
    create_report,
    list_reports,
    purge_report,
    report_matches_invoice_state,
    restore_deleted_report,
    soft_delete_report,
    update_report_status,
)


def _pdf_bytes(pagesize: tuple[int, int] = (120, 180), label: str = "attachment") -> bytes:
    buffer = BytesIO()
    document = canvas.Canvas(buffer, pagesize=pagesize)
    document.drawString(10, pagesize[1] - 20, label)
    document.showPage()
    document.save()
    return buffer.getvalue()


def _write_pdf(path: Path, pagesize: tuple[int, int], label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_pdf_bytes(pagesize, label))


def _upload(filename: str, payload: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(payload))


def _configure_attachment_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True)
    monkeypatch.setattr(report_attachment_service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(report_service, "UPLOAD_ROOT", upload_root)
    return upload_root


def _configure_transfer_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database_path = data_dir / "expense.db"
    database_path.write_bytes(b"test-db")
    monkeypatch.setattr(data_transfer_service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(data_transfer_service, "STAGING_ROOT", data_dir / "import_staging")
    monkeypatch.setattr(data_transfer_service, "BACKUP_ROOT", data_dir / "backups")
    monkeypatch.setattr(data_transfer_service, "DATABASE_PATH", database_path)
    return upload_root, data_dir


def test_report_attachment_upload_is_report_level_and_does_not_change_invoice_semantics(monkeypatch, tmp_path, db):
    upload_root = _configure_attachment_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 8, 9), purpose="附件测试"))

    first = upload_report_attachment(db, report.id, _upload("folder/evidence.pdf", _pdf_bytes()))
    second = upload_report_attachment(db, report.id, _upload("evidence.pdf", _pdf_bytes()))
    image_buffer = BytesIO()
    Image.new("RGB", (31, 47), color="white").save(image_buffer, format="PNG")
    third = upload_report_attachment(db, report.id, _upload("photo.png", image_buffer.getvalue()))
    db.refresh(report)

    assert [item.id for item in report.active_attachments] == [first.id, second.id, third.id]
    assert first.original_filename == "evidence.pdf"
    assert first.file_type == "pdf"
    assert third.file_type == "image"
    assert (upload_root / str(report.id) / Path(first.file_path).name).is_file()
    assert report.invoice_count == 0
    assert report.total_amount == Decimal("0.00")
    assert report_matches_invoice_state(report, "no_invoice")
    assert list_reports(db, filters=ReportFilters(has_attachment=True))[0] == [report]
    assert list_reports(db, filters=ReportFilters(has_attachment=False))[1] == 0

    detail = ReportDetailRead.model_validate(report)
    assert [item.original_filename for item in detail.attachments] == ["evidence.pdf", "evidence.pdf", "photo.png"]


@pytest.mark.parametrize(
    ("filename", "payload"),
    [("notes.txt", b"plain text"), ("broken.pdf", b"not a pdf"), ("broken.png", b"not an image")],
)
def test_report_attachment_upload_rejects_unsupported_or_damaged_files(
    monkeypatch,
    tmp_path,
    db,
    filename,
    payload,
):
    upload_root = _configure_attachment_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="损坏附件"))

    with pytest.raises(HTTPException) as exc:
        upload_report_attachment(db, report.id, _upload(filename, payload))

    assert exc.value.status_code == 400
    assert db.scalars(select(ReportAttachment)).all() == []
    assert list(upload_root.rglob("*.*")) == []


def test_report_attachment_mutation_is_draft_only_and_soft_delete_hides_detail(monkeypatch, tmp_path, db):
    _configure_attachment_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="附件锁定"))
    attachment = upload_report_attachment(db, report.id, _upload("evidence.pdf", _pdf_bytes()))

    soft_delete_report_attachment(db, attachment.id)
    db.refresh(report)
    assert ReportDetailRead.model_validate(report).attachments == []

    active = upload_report_attachment(db, report.id, _upload("active.pdf", _pdf_bytes()))
    update_report_status(db, report.id, "checked")
    with pytest.raises(HTTPException) as upload_error:
        upload_report_attachment(db, report.id, _upload("locked.pdf", _pdf_bytes()))
    with pytest.raises(HTTPException) as delete_error:
        soft_delete_report_attachment(db, active.id)
    assert upload_error.value.status_code == 403
    assert delete_error.value.status_code == 403


def test_report_attachment_follows_report_trash_restore_and_purge_lifecycle(monkeypatch, tmp_path, db):
    upload_root = _configure_attachment_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(purpose="附件生命周期"))
    attachment = upload_report_attachment(db, report.id, _upload("evidence.pdf", _pdf_bytes()))
    removed = upload_report_attachment(db, report.id, _upload("removed.pdf", _pdf_bytes()))
    soft_delete_report_attachment(db, removed.id)
    removed_deleted_at = removed.deleted_at
    stored_path = upload_root / str(report.id) / Path(attachment.file_path).name

    soft_delete_report(db, report.id)
    db.refresh(attachment)
    assert attachment.deleted_at is not None
    restore_deleted_report(db, report.id)
    db.refresh(attachment)
    db.refresh(removed)
    assert attachment.deleted_at is None
    assert removed.deleted_at == removed_deleted_at

    files_deleted = purge_report(db, report.id)
    assert files_deleted == 2
    assert not stored_path.exists()
    assert db.get(ExpenseReport, report.id) is None
    assert db.get(ReportAttachment, attachment.id) is None
    assert db.get(ReportAttachment, removed.id) is None


def test_merged_pdf_orders_trip_then_other_invoices_then_report_attachments_and_keeps_sizes(
    monkeypatch,
    tmp_path,
    db,
):
    template = tmp_path / "template.pdf"
    _write_pdf(template, (595, 298), "report")
    upload_root = tmp_path / "backend" / "uploads"
    monkeypatch.setattr(pdf_generator, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(pdf_generator, "TEMPLATE_CANDIDATES", [template])

    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 8, 9),
            purpose="导出排序",
            trips=[
                TripWrite(sort_order=1, depart_month=8, depart_day=1, arrive_month=8, arrive_day=1),
                TripWrite(sort_order=2, depart_month=8, depart_day=2, arrive_month=8, arrive_day=2),
            ],
            expense_items=[ExpenseItemWrite(category="custom:宴请"), ExpenseItemWrite(category="custom:资料")],
        ),
    )
    base_time = datetime(2026, 8, 9, 8, 0, 0)
    invoice_specs = [
        ("trip2", "transport_fare", report.trips[1].id, (201, 301), base_time),
        ("accommodation", "accommodation", None, (401, 501), base_time),
        ("trip1-second", "transport_fare", report.trips[0].id, (102, 202), base_time + timedelta(seconds=2)),
        ("custom-second", "custom:资料", None, (601, 701), base_time),
        ("trip1-first", "transport_fare", report.trips[0].id, (101, 201), base_time + timedelta(seconds=1)),
        ("custom-first", "custom:宴请", None, (501, 601), base_time),
        ("luggage-special", "luggage", None, (301, 401), base_time),
    ]
    for index, (name, category, trip_id, page_size, created_at) in enumerate(invoice_specs, start=1):
        relative = Path("uploads") / str(report.id) / f"{name}.pdf"
        _write_pdf(upload_root / str(report.id) / f"{name}.pdf", page_size, name)
        report.invoices.append(
            Invoice(
                trip_id=trip_id,
                expense_category=category,
                file_path=relative.as_posix(),
                file_type="pdf",
                invoice_type="vat_special" if name == "luggage-special" else "normal",
                amount=Decimal(index),
                amount_confirmed=True,
                created_at=created_at,
            )
        )

    attachment_pdf_path = upload_root / str(report.id) / "supporting.pdf"
    _write_pdf(attachment_pdf_path, (701, 801), "supporting")
    image_path = upload_root / str(report.id) / "photo.png"
    Image.new("RGB", (37, 53), color="white").save(image_path)
    report.attachments.extend(
        [
            ReportAttachment(
                original_filename="supporting.pdf",
                file_path=f"uploads/{report.id}/supporting.pdf",
                file_type="pdf",
                created_at=base_time,
            ),
            ReportAttachment(
                original_filename="photo.png",
                file_path=f"uploads/{report.id}/photo.png",
                file_type="image",
                created_at=base_time + timedelta(seconds=1),
            ),
        ]
    )
    db.commit()
    db.refresh(report)

    reader = PdfReader(BytesIO(build_merged_report_pdf(report)))
    sizes = [
        (round(float(page.mediabox.width)), round(float(page.mediabox.height)))
        for page in reader.pages
    ]

    assert sizes == [
        (595, 298),
        (101, 201),
        (102, 202),
        (201, 301),
        (301, 401),
        (301, 401),
        (401, 501),
        (501, 601),
        (601, 701),
        (701, 801),
        (37, 53),
    ]


def test_data_zip_v5_round_trip_preserves_report_attachment_and_v4_remains_accepted(monkeypatch, tmp_path, db):
    upload_root, _data_dir = _configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 8, 9), purpose="附件导出"))
    attachment_path = upload_root / str(report.id) / "supporting.pdf"
    _write_pdf(attachment_path, (222, 333), "supporting")
    attachment = ReportAttachment(
        report_id=report.id,
        original_filename="原始资料.pdf",
        file_path=f"uploads/{report.id}/supporting.pdf",
        file_type="pdf",
        created_at=datetime(2026, 8, 9, 9, 30, 0),
    )
    db.add(attachment)
    db.commit()

    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        exported_attachment = manifest["reports"][0]["report_attachments"][0]
        archived_payload = archive.read(exported_attachment["attachment_path"])
    assert manifest["schema_version"] == DATA_SCHEMA_VERSION
    assert exported_attachment["original_filename"] == "原始资料.pdf"

    legacy_manifest = json.loads(json.dumps(manifest))
    legacy_manifest["schema_version"] = 4
    legacy_manifest["reports"][0].pop("report_attachments")
    legacy = BytesIO()
    with zipfile.ZipFile(legacy, "w") as archive:
        archive.writestr("manifest.json", json.dumps(legacy_manifest))
    legacy_preview = create_import_preview(db, _upload("legacy-v4.zip", legacy.getvalue()))
    assert legacy_preview.summary.attachments_total == 0

    preview = create_import_preview(db, _upload("data-v6.zip", zip_bytes))
    assert preview.summary.invoices_total == 0
    assert preview.summary.attachments_total == 1
    result = execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))
    imported = db.query(ExpenseReport).order_by(ExpenseReport.id.desc()).first()
    assert result.attachments_written == 1
    assert imported.invoice_count == 0
    assert len(imported.active_attachments) == 1
    imported_attachment = imported.active_attachments[0]
    assert imported_attachment.original_filename == "原始资料.pdf"
    assert imported_attachment.created_at == datetime(2026, 8, 9, 9, 30, 0)
    assert (upload_root / str(imported.id) / Path(imported_attachment.file_path).name).read_bytes() == archived_payload


def test_integrity_check_covers_report_attachment_uid_lifecycle_and_file(monkeypatch, tmp_path):
    database_path = tmp_path / "expense.db"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE expense_reports (
                id INTEGER PRIMARY KEY,
                report_uid TEXT,
                status TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE report_attachments (
                id INTEGER PRIMARY KEY,
                attachment_uid TEXT,
                report_id INTEGER NOT NULL,
                file_path TEXT,
                deleted_at TEXT,
                FOREIGN KEY(report_id) REFERENCES expense_reports(id)
            );
            INSERT INTO expense_reports (id, report_uid, status, deleted_at)
            VALUES (1, 'r1', 'draft', NULL), (2, 'r2', 'draft', '2026-08-09T00:00:00');
            INSERT INTO report_attachments (id, attachment_uid, report_id, file_path, deleted_at)
            VALUES
                (1, 'same', 1, 'uploads/1/missing.pdf', NULL),
                (2, 'same', 2, '../unsafe.pdf', NULL);
            """
        )
    monkeypatch.setattr(maintenance_service, "DATABASE_PATH", database_path)
    monkeypatch.setattr(maintenance_service, "UPLOAD_ROOT", upload_root)

    result = maintenance_service.check_database_integrity()
    codes = {issue.code for issue in result.issues}

    assert result.tables["report_attachments"] == 2
    assert "duplicate_report_attachment_uid" in codes
    assert "active_report_attachment_in_deleted_report" in codes
    assert "missing_attachment_file" in codes
    assert "unsafe_attachment_path" in codes


def test_schema_version_and_app_routes_include_report_attachments(tmp_path):
    assert DATA_SCHEMA_VERSION == 6
    assert "report_attachments" in ReportAttachment.metadata.tables
    routes = {route.path for route in create_app(frontend_dist_dir=tmp_path, enable_startup=False).routes}
    assert "/api/report-attachments/upload" in routes
    assert "/api/report-attachments/{attachment_id}/file" in routes
    assert "/api/report-attachments/{attachment_id}" in routes
