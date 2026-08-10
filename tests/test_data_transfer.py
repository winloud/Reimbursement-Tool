"""Report data export, import, compatibility, and rollback tests."""

import json
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import zipfile

import pytest
from fastapi import HTTPException

from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.schemas.data_transfer import DataExportRequest, ImportExecuteRequest
from backend.schemas.report import ExpenseItemWrite, ReportCreate, TripWrite
from backend.services import data_transfer_service
from backend.services.data_transfer_service import build_export_zip, create_import_preview, execute_import
from backend.services.report_service import create_report, recalculate_report_totals
from backend.services.report_service import soft_delete_report


def configure_transfer_paths(monkeypatch, tmp_path):
    project_root = tmp_path / "project"
    (project_root / "backend" / "uploads").mkdir(parents=True)
    data_dir = project_root / "data"
    data_dir.mkdir(parents=True)
    database_path = data_dir / "expense.db"
    database_path.write_bytes(b"test-db")
    monkeypatch.setattr(data_transfer_service, "PROJECT_ROOT", project_root)
    monkeypatch.setattr(data_transfer_service, "UPLOAD_ROOT", project_root / "backend" / "uploads")
    monkeypatch.setattr(data_transfer_service, "STAGING_ROOT", data_dir / "import_staging")
    monkeypatch.setattr(data_transfer_service, "BACKUP_ROOT", data_dir / "backups")
    monkeypatch.setattr(data_transfer_service, "DATABASE_PATH", database_path)
    return project_root


def attach_invoice(db, project_root, report, content=b"invoice-pdf", invoice_type: str = "unknown"):
    upload_dir = project_root / "backend" / "uploads" / str(report.id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / "invoice.pdf"
    file_path.write_bytes(content)
    invoice = Invoice(
        report_id=report.id,
        expense_category="accommodation",
        file_path=f"uploads/{report.id}/invoice.pdf",
        file_type="pdf",
        invoice_type=invoice_type,
        invoice_no="INV-001",
        invoice_date=date(2026, 5, 2),
        amount=Decimal("88.00"),
        amount_confirmed=True,
    )
    db.add(invoice)
    db.flush()
    recalculate_report_totals(report)
    db.commit()
    db.refresh(report)
    db.refresh(invoice)
    return invoice


def upload_from_bytes(payload: bytes):
    return SimpleNamespace(file=BytesIO(payload))


def test_report_and_invoice_uid_generated(db):
    report = create_report(db, ReportCreate(purpose="UID 测试"))
    invoice = Invoice(
        report_id=report.id,
        expense_category="accommodation",
        file_path="uploads/test.pdf",
        file_type="pdf",
        amount=Decimal("1.00"),
    )
    db.add(invoice)
    db.commit()

    assert report.report_uid
    assert invoice.invoice_uid


def test_export_zip_contains_manifest_uids_and_attachment(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 1), purpose="导出"))
    invoice = attach_invoice(db, project_root, report, invoice_type="vat_special")

    zip_bytes, filename = build_export_zip(db, DataExportRequest())

    assert filename.endswith(".zip")
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        exported_report = manifest["reports"][0]
        exported_invoice = exported_report["invoices"][0]
        assert exported_report["report"]["report_uid"] == report.report_uid
        assert exported_invoice["invoice_uid"] == invoice.invoice_uid
        assert exported_invoice["invoice_type"] == "vat_special"
        assert exported_invoice["attachment_path"] in archive.namelist()


def test_import_recalculation_includes_confirmed_transport_invoice(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 1),
            daily_subsidy=Decimal("0.00"),
            manual_subsidy_total=Decimal("0.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=1)],
        ),
    )
    upload_dir = project_root / "backend" / "uploads" / str(report.id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    invoice_path = upload_dir / "transport.pdf"
    invoice_path.write_bytes(b"transport-invoice")
    report.invoices.append(
        Invoice(
            trip_id=report.trips[0].id,
            expense_category="transport_fare",
            file_path=f"uploads/{report.id}/transport.pdf",
            file_type="pdf",
            amount=Decimal("88.00"),
            amount_confirmed=True,
        )
    )
    db.flush()
    recalculate_report_totals(report)
    db.commit()
    assert report.total_amount == Decimal("88.00")

    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    preview = create_import_preview(db, upload_from_bytes(zip_bytes))
    execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))
    imported = db.query(type(report)).order_by(type(report).id.desc()).first()

    assert imported.invoices[0].trip_id == imported.trips[0].id
    assert imported.subsidy_total == Decimal("0.00")
    assert imported.total_amount == Decimal("88.00")
    assert imported.shortfall == Decimal("88.00")


def test_export_import_preserves_paper_invoice_values_and_accepts_v1(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 1),
            purpose="纸质发票导出",
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_month=5,
                    depart_day=1,
                    arrive_month=5,
                    arrive_day=1,
                    paper_invoice_amount=Decimal("15.00"),
                    paper_invoice_count=1,
                )
            ],
            expense_items=[ExpenseItemWrite(category="accommodation", paper_invoice_amount=Decimal("88.00"), paper_invoice_count=2)],
        ),
    )
    attach_invoice(db, project_root, report)

    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert manifest["schema_version"] == data_transfer_service.SCHEMA_VERSION
        assert manifest["reports"][0]["trips"][0]["paper_invoice_amount"] == "15.00"
        exported_accommodation = next(item for item in manifest["reports"][0]["expense_items"] if item["category"] == "accommodation")
        assert exported_accommodation["paper_invoice_amount"] == "88.00"
        attachment_payloads = {name: archive.read(name) for name in archive.namelist() if name != "manifest.json"}

    preview = create_import_preview(db, upload_from_bytes(zip_bytes))
    execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))
    imported = db.query(type(report)).order_by(type(report).id.desc()).first()
    imported_accommodation = next(item for item in imported.expense_items if item.category == "accommodation")
    assert imported.trips[0].paper_invoice_amount == Decimal("15.00")
    assert imported.trips[0].paper_invoice_count == 1
    assert imported_accommodation.paper_invoice_amount == Decimal("88.00")
    assert imported_accommodation.paper_invoice_count == 2

    manifest["schema_version"] = 1
    manifest["reports"][0]["trips"][0].pop("paper_invoice_amount")
    manifest["reports"][0]["trips"][0].pop("paper_invoice_count")
    exported_accommodation.pop("paper_invoice_amount")
    exported_accommodation.pop("paper_invoice_count")
    v1_buffer = BytesIO()
    with zipfile.ZipFile(v1_buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, payload in attachment_payloads.items():
            archive.writestr(name, payload)
    v1_preview = create_import_preview(db, upload_from_bytes(v1_buffer.getvalue()))
    execute_import(db, ImportExecuteRequest(preview_id=v1_preview.preview_id, strategy="import_as_new"))
    imported_v1 = db.query(type(report)).order_by(type(report).id.desc()).first()
    imported_v1_accommodation = next(item for item in imported_v1.expense_items if item.category == "accommodation")
    assert imported_v1.trips[0].paper_invoice_amount == Decimal("0.00")
    assert imported_v1.trips[0].paper_invoice_count == 0
    assert imported_v1_accommodation.paper_invoice_amount == Decimal("0.00")
    assert imported_v1_accommodation.paper_invoice_count == 0
    assert imported_v1.manual_subsidy_total is None


def test_export_import_preserves_zero_manual_subsidy_and_accepts_v2_without_it(db, monkeypatch, tmp_path):
    configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("0.00"),
            trips=[TripWrite(sort_order=1, depart_month=5, depart_day=1, arrive_month=5, arrive_day=2)],
        ),
    )

    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    exported_report = manifest["reports"][0]["report"]
    assert manifest["schema_version"] == data_transfer_service.SCHEMA_VERSION
    assert exported_report["manual_subsidy_total"] == "0.00"

    preview = create_import_preview(db, upload_from_bytes(zip_bytes))
    execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))
    imported = db.query(type(report)).order_by(type(report).id.desc()).first()
    assert imported.manual_subsidy_total == Decimal("0.00")
    assert imported.subsidy_days == 0
    assert imported.subsidy_total == Decimal("0.00")

    report.manual_subsidy_total = None
    recalculate_report_totals(report)
    db.commit()
    assert report.subsidy_days == 2
    assert report.subsidy_total == Decimal("200.00")

    snapshot_path = tmp_path / "manual-subsidy-overwrite.zip"
    snapshot_path.write_bytes(b"snapshot")
    monkeypatch.setattr(
        data_transfer_service,
        "create_safety_snapshot",
        lambda _db, reason: SimpleNamespace(path=snapshot_path.as_posix()),
    )
    overwrite_preview = create_import_preview(db, upload_from_bytes(zip_bytes))
    execute_import(
        db,
        ImportExecuteRequest(preview_id=overwrite_preview.preview_id, strategy="overwrite"),
    )
    db.refresh(report)
    assert report.manual_subsidy_total == Decimal("0.00")
    assert report.subsidy_days == 0
    assert report.subsidy_total == Decimal("0.00")

    manifest["schema_version"] = 2
    exported_report.pop("manual_subsidy_total")
    v2_buffer = BytesIO()
    with zipfile.ZipFile(v2_buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

    v2_preview = create_import_preview(db, upload_from_bytes(v2_buffer.getvalue()))
    execute_import(db, ImportExecuteRequest(preview_id=v2_preview.preview_id, strategy="import_as_new"))
    imported_v2 = db.query(type(report)).order_by(type(report).id.desc()).first()
    assert imported_v2.manual_subsidy_total is None
    assert imported_v2.subsidy_days == 2
    assert imported_v2.subsidy_total == Decimal("200.00")


def test_export_import_preserves_checked_status_and_accepts_v3(db, monkeypatch, tmp_path):
    configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 12), purpose="已核对数据"))
    report.status = "checked"
    db.commit()

    zip_bytes, _filename = build_export_zip(db, DataExportRequest(status="checked"))
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))

    assert manifest["schema_version"] == data_transfer_service.SCHEMA_VERSION
    assert manifest["reports"][0]["report"]["status"] == "checked"

    manifest["schema_version"] = 3
    legacy_buffer = BytesIO()
    with zipfile.ZipFile(legacy_buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

    preview = create_import_preview(db, upload_from_bytes(legacy_buffer.getvalue()))
    execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))
    imported = db.query(ExpenseReport).order_by(ExpenseReport.id.desc()).first()
    assert imported.status == "checked"


@pytest.mark.parametrize("invalid_amount", ["-0.001", "NaN", "Infinity", "not-a-number"])
def test_import_rejects_invalid_manual_subsidy_total(db, monkeypatch, tmp_path, invalid_amount):
    configure_transfer_paths(monkeypatch, tmp_path)
    create_report(
        db,
        ReportCreate(
            report_date=date(2026, 5, 10),
            manual_subsidy_total=Decimal("0.00"),
        ),
    )
    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    manifest["reports"][0]["report"]["manual_subsidy_total"] = invalid_amount
    invalid_buffer = BytesIO()
    with zipfile.ZipFile(invalid_buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

    preview = create_import_preview(db, upload_from_bytes(invalid_buffer.getvalue()))
    with pytest.raises(HTTPException) as exc:
        execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))

    assert exc.value.status_code == 400
    assert exc.value.detail == "人工核定途中补贴总额必须是有限的非负金额"
    assert db.query(ExpenseReport).count() == 1


def test_export_zip_respects_report_date_and_multi_status_filters(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    included = create_report(db, ReportCreate(report_date=date(2024, 6, 1), purpose="命中导出"))
    attach_invoice(db, project_root, included)
    included.status = "reimbursed"
    excluded = create_report(db, ReportCreate(report_date=date(2026, 6, 1), purpose="不应导出"))
    attach_invoice(db, project_root, excluded)
    excluded.status = "printed"
    db.commit()

    zip_bytes, _filename = build_export_zip(
        db,
        DataExportRequest(
            statuses="printed,reimbursed",
            report_start=date(2024, 1, 1),
            report_end=date(2024, 12, 31),
        ),
    )

    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        purposes = [item["report"]["purpose"] for item in manifest["reports"]]
        assert purposes == ["命中导出"]


def test_import_preview_rejects_unsafe_attachment_path(db, monkeypatch, tmp_path):
    configure_transfer_paths(monkeypatch, tmp_path)
    manifest = {
        "schema_version": 1,
        "reports": [
            {
                "report": {"report_uid": "r1"},
                "trips": [],
                "expense_items": [],
                "invoices": [
                    {
                        "invoice_uid": "i1",
                        "attachment_path": "../bad.pdf",
                        "attachment_hash": "x",
                    }
                ],
            }
        ],
    }
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

    with pytest.raises(HTTPException) as exc:
        create_import_preview(db, upload_from_bytes(buffer.getvalue()))

    assert exc.value.status_code == 400


def test_import_as_new_regenerates_conflicting_uids_and_writes_backup(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 1), purpose="原始"))
    invoice = attach_invoice(db, project_root, report, content=b"original", invoice_type="vat_special")
    zip_bytes, _filename = build_export_zip(db, DataExportRequest())

    preview = create_import_preview(db, upload_from_bytes(zip_bytes))
    assert preview.summary.reports_conflict == 1
    assert preview.summary.invoices_conflict == 1

    result = execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="import_as_new"))

    reports = db.query(type(report)).order_by(type(report).id).all()
    invoices = db.query(type(invoice)).order_by(type(invoice).id).all()
    assert result.reports_created == 1
    assert result.invoices_created == 1
    assert len(reports) == 2
    assert len({item.report_uid for item in reports}) == 2
    assert len({item.invoice_uid for item in invoices}) == 2
    assert Path(result.backup_path).exists()
    imported_invoice = invoices[-1]
    assert imported_invoice.invoice_type == invoice.invoice_type
    assert (project_root / "backend" / imported_invoice.file_path).exists()


def test_import_overwrite_creates_safety_snapshot_before_replacing_conflict(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 1), purpose="原始"))
    attach_invoice(db, project_root, report, content=b"original")
    zip_bytes, _filename = build_export_zip(db, DataExportRequest())
    snapshot_path = tmp_path / "pre_import_overwrite.zip"
    snapshot_calls = []

    def fake_snapshot(_db, reason):
        snapshot_calls.append(reason)
        snapshot_path.write_bytes(b"snapshot")
        return SimpleNamespace(path=snapshot_path.as_posix())

    monkeypatch.setattr(data_transfer_service, "create_safety_snapshot", fake_snapshot)
    preview = create_import_preview(db, upload_from_bytes(zip_bytes))

    result = execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="overwrite"))

    db.refresh(report)
    assert result.reports_overwritten == 1
    assert result.backup_path == snapshot_path.as_posix()
    assert snapshot_calls == ["pre_import_overwrite"]
    assert report.purpose == "原始"


def test_import_overwrite_aborts_when_safety_snapshot_fails(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 1), purpose="原始"))
    invoice = attach_invoice(db, project_root, report, content=b"original")
    zip_bytes, _filename = build_export_zip(db, DataExportRequest())

    def fail_snapshot(_db, reason):
        raise HTTPException(status_code=500, detail=f"{reason} failed")

    monkeypatch.setattr(data_transfer_service, "create_safety_snapshot", fail_snapshot)
    preview = create_import_preview(db, upload_from_bytes(zip_bytes))

    with pytest.raises(HTTPException):
        execute_import(db, ImportExecuteRequest(preview_id=preview.preview_id, strategy="overwrite"))

    db.refresh(report)
    db.refresh(invoice)
    assert report.purpose == "原始"
    assert invoice.deleted_at is None


def test_import_preview_ignores_soft_deleted_uid_conflicts(db, monkeypatch, tmp_path):
    project_root = configure_transfer_paths(monkeypatch, tmp_path)
    report = create_report(db, ReportCreate(report_date=date(2026, 5, 1), purpose="删除后导入"))
    attach_invoice(db, project_root, report, content=b"deleted")
    zip_bytes, _filename = build_export_zip(db, DataExportRequest())

    soft_delete_report(db, report.id)

    preview = create_import_preview(db, upload_from_bytes(zip_bytes))

    assert preview.summary.reports_conflict == 0
    assert preview.summary.invoices_conflict == 0
    assert preview.summary.reports_new == 1
