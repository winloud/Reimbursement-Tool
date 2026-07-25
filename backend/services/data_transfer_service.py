from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime
from datetime import date as date_type
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.runtime_paths import DATA_DIR, DATABASE_PATH, PROJECT_ROOT, UPLOAD_ROOT, uploaded_path
from backend.models.expense_item import ExpenseItem
from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.models.trip import Trip
from backend.schemas.data_transfer import (
    DataExportRequest,
    ImportConflictRead,
    ImportExecuteRead,
    ImportExecuteRequest,
    ImportPreviewRead,
    ImportSummaryRead,
)
from backend.services.invoice_service import build_invoice_storage_path, calculate_file_hash
from backend.services.maintenance_service import create_safety_snapshot
from backend.services.report_service import ReportFilters, list_reports, recalculate_report_totals

SCHEMA_VERSION = 3
SUPPORTED_IMPORT_SCHEMA_VERSIONS = {1, 2, SCHEMA_VERSION}
STAGING_ROOT = DATA_DIR / "import_staging"
BACKUP_ROOT = DATA_DIR / "backups"


def _invoice_file_path(relative_path: str | Path) -> Path:
    return uploaded_path(relative_path, UPLOAD_ROOT)


def _money(value: Decimal | None) -> str:
    return str((value or Decimal("0.00")).quantize(Decimal("0.01")))


def _date(value) -> str | None:
    return value.isoformat() if value else None


def _datetime(value) -> str | None:
    return value.isoformat() if value else None


def _decimal(value) -> Decimal:
    return Decimal(str(value or "0.00")).quantize(Decimal("0.01"))


def _optional_decimal(value) -> Decimal | None:
    if value is None:
        return None
    return _decimal(value)


def _optional_nonnegative_money(value, field_label: str) -> Decimal | None:
    if value is None:
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_label}必须是有限的非负金额",
        ) from exc
    if not amount.is_finite() or amount < Decimal("0"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_label}必须是有限的非负金额",
        )
    try:
        return amount.quantize(Decimal("0.01"))
    except InvalidOperation as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_label}必须是有限的非负金额",
        ) from exc


def _parse_date(value: str | None) -> date_type | None:
    if not value:
        return None
    return date_type.fromisoformat(value)


def _safe_zip_path(path: str) -> str:
    candidate = PurePosixPath(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"非法附件路径：{path}")
    normalized = candidate.as_posix()
    if not normalized or normalized == ".":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件路径不能为空")
    return normalized


def _file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bytes_hash(payload: bytes) -> str:
    return sha256(payload).hexdigest()


def _filters_from_export_request(payload: DataExportRequest) -> ReportFilters:
    return ReportFilters(
        report_status=payload.status,
        report_statuses=_parse_export_statuses(payload.statuses),
        report_start=payload.report_start,
        report_end=payload.report_end,
        trip_start=payload.trip_start,
        trip_end=payload.trip_end,
        keyword=payload.keyword,
        amount_min=payload.amount_min,
        amount_max=payload.amount_max,
        invoice_state=payload.invoice_state,
        category=payload.category,
        has_attachment=payload.has_attachment,
        subsidy_days_min=payload.subsidy_days_min,
        subsidy_days_max=payload.subsidy_days_max,
    )


def _parse_export_statuses(value: str | None) -> set[str] | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    valid_statuses = {"draft", "printed", "reimbursed"}
    items = {item.strip() for item in normalized.split(",") if item.strip()}
    invalid = items - valid_statuses
    if invalid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效报销单状态筛选")
    return items or None


def _serialize_report(report: ExpenseReport) -> dict:
    trips = [
        {
            "original_id": trip.id,
            "sort_order": trip.sort_order,
            "depart_month": trip.depart_month,
            "depart_day": trip.depart_day,
            "depart_hour": trip.depart_hour,
            "depart_place": trip.depart_place,
            "arrive_month": trip.arrive_month,
            "arrive_day": trip.arrive_day,
            "arrive_hour": trip.arrive_hour,
            "arrive_place": trip.arrive_place,
            "transport": trip.transport,
            "subsidy_start": trip.subsidy_start,
            "subsidy_end": trip.subsidy_end,
            "paper_invoice_amount": _money(trip.paper_invoice_amount),
            "paper_invoice_count": trip.paper_invoice_count,
        }
        for trip in sorted(report.trips, key=lambda item: item.sort_order)
    ]
    expense_items = [
        {
            "original_id": item.id,
            "category": item.category,
            "remark": item.remark,
            "reimbursable_amount": _money(item.reimbursable_amount) if item.reimbursable_amount is not None else None,
            "paper_invoice_amount": _money(item.paper_invoice_amount),
            "paper_invoice_count": item.paper_invoice_count,
        }
        for item in report.expense_items
    ]
    invoices = []
    attachments = []
    for invoice in report.active_invoices:
        path = _invoice_file_path(invoice.file_path)
        if not path.exists():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"发票文件不存在：{invoice.file_path}")
        attachment_path = f"attachments/{report.report_uid}/{invoice.invoice_uid}{path.suffix.lower()}"
        file_hash = _file_hash(path)
        invoices.append(
            {
                "original_id": invoice.id,
                "invoice_uid": invoice.invoice_uid,
                "trip_original_id": invoice.trip_id,
                "expense_category": invoice.expense_category,
                "file_type": invoice.file_type,
                "invoice_type": invoice.invoice_type,
                "invoice_no": invoice.invoice_no,
                "invoice_date": _date(invoice.invoice_date),
                "amount": _money(invoice.amount),
                "amount_confirmed": invoice.amount_confirmed,
                "created_at": _datetime(invoice.created_at),
                "attachment_path": attachment_path,
                "attachment_hash": file_hash,
            }
        )
        attachments.append((attachment_path, path))
    return {
        "report": {
            "original_id": report.id,
            "report_uid": report.report_uid,
            "status": report.status,
            "report_date": _date(report.report_date),
            "department": report.department,
            "employee_name": report.employee_name,
            "purpose": report.purpose,
            "daily_subsidy": _money(report.daily_subsidy),
            "subsidy_days": report.subsidy_days,
            "subsidy_total": _money(report.subsidy_total),
            "manual_subsidy_total": (
                _money(report.manual_subsidy_total) if report.manual_subsidy_total is not None else None
            ),
            "advance_date_month": report.advance_date_month,
            "advance_date_day": report.advance_date_day,
            "advance_amount": _money(report.advance_amount),
            "total_amount": _money(report.total_amount),
            "shortfall": _money(report.shortfall),
            "surplus": _money(report.surplus),
            "created_at": _datetime(report.created_at),
            "updated_at": _datetime(report.updated_at),
        },
        "trips": trips,
        "expense_items": expense_items,
        "invoices": invoices,
        "_attachments": attachments,
    }


def build_export_zip(db: Session, payload: DataExportRequest) -> tuple[bytes, str]:
    reports, total = list_reports(db, page=1, page_size=100000, filters=_filters_from_export_request(payload))
    serialized_reports = []
    attachments = []
    for report in reports:
        item = _serialize_report(report)
        attachments.extend(item.pop("_attachments"))
        serialized_reports.append(item)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.utcnow().isoformat(),
        "filters": payload.model_dump(mode="json"),
        "reports_total": total,
        "reports": serialized_reports,
    }
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for attachment_path, source_path in attachments:
            archive.write(source_path, _safe_zip_path(attachment_path))
    filename = f"expense-data-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.zip"
    return buffer.getvalue(), filename


def _read_manifest(package_path: Path) -> tuple[dict, zipfile.ZipFile]:
    try:
        archive = zipfile.ZipFile(package_path)
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="导入包不是有效 ZIP 文件") from exc
    if "manifest.json" not in archive.namelist():
        archive.close()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="导入包缺少 manifest.json")
    try:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        archive.close()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="manifest.json 格式无效") from exc
    if manifest.get("schema_version") not in SUPPORTED_IMPORT_SCHEMA_VERSIONS:
        archive.close()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="导入包版本不支持")
    return manifest, archive


def _validate_manifest_attachments(manifest: dict, archive: zipfile.ZipFile) -> None:
    names = set(archive.namelist())
    for report_item in manifest.get("reports", []):
        for invoice in report_item.get("invoices", []):
            attachment_path = _safe_zip_path(invoice.get("attachment_path") or "")
            if attachment_path not in names:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"导入包缺少附件：{attachment_path}")
            payload = archive.read(attachment_path)
            if _bytes_hash(payload) != invoice.get("attachment_hash"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"附件 hash 不一致：{attachment_path}")


def _preview_from_manifest(db: Session, manifest: dict) -> ImportPreviewRead:
    conflicts: list[ImportConflictRead] = []
    reports = manifest.get("reports", [])
    invoices_total = 0
    attachments_total = 0
    for report_item in reports:
        report_payload = report_item.get("report", {})
        report_uid = report_payload.get("report_uid")
        local_report = (
            db.scalar(select(ExpenseReport).where(ExpenseReport.report_uid == report_uid, ExpenseReport.deleted_at.is_(None)))
            if report_uid
            else None
        )
        if local_report is not None:
            conflicts.append(
                ImportConflictRead(
                    item_type="report",
                    source_uid=report_uid,
                    local_id=local_report.id,
                    local_status=local_report.status,
                    reason="报销单 UID 已存在",
                    requires_reimbursed_confirm=local_report.status == "reimbursed",
                )
            )
        for invoice_payload in report_item.get("invoices", []):
            invoices_total += 1
            attachments_total += 1
            invoice_uid = invoice_payload.get("invoice_uid")
            local_invoice = (
                db.scalar(select(Invoice).where(Invoice.invoice_uid == invoice_uid, Invoice.deleted_at.is_(None)))
                if invoice_uid
                else None
            )
            if local_invoice is not None:
                conflicts.append(
                    ImportConflictRead(
                        item_type="invoice",
                        source_uid=invoice_uid,
                        local_id=local_invoice.id,
                        local_status=local_invoice.report.status,
                        reason="发票 UID 已存在",
                        requires_reimbursed_confirm=local_invoice.report.status == "reimbursed",
                    )
                )
    report_conflicts = [item for item in conflicts if item.item_type == "report"]
    invoice_conflicts = [item for item in conflicts if item.item_type == "invoice"]
    return ImportPreviewRead(
        preview_id="",
        summary=ImportSummaryRead(
            reports_total=len(reports),
            reports_new=len(reports) - len(report_conflicts),
            reports_conflict=len(report_conflicts),
            invoices_total=invoices_total,
            invoices_conflict=len(invoice_conflicts),
            attachments_total=attachments_total,
        ),
        conflicts=conflicts,
        requires_reimbursed_confirm=any(item.requires_reimbursed_confirm for item in conflicts),
    )


def create_import_preview(db: Session, upload_file: UploadFile) -> ImportPreviewRead:
    preview_id = uuid4().hex
    preview_dir = STAGING_ROOT / preview_id
    preview_dir.mkdir(parents=True, exist_ok=False)
    package_path = preview_dir / "package.zip"
    with package_path.open("wb") as target:
        shutil.copyfileobj(upload_file.file, target)
    manifest, archive = _read_manifest(package_path)
    try:
        _validate_manifest_attachments(manifest, archive)
    finally:
        archive.close()
    preview = _preview_from_manifest(db, manifest)
    return preview.model_copy(update={"preview_id": preview_id})


def _load_preview_package(db: Session, preview_id: str) -> tuple[Path, dict]:
    if not preview_id or any(char in preview_id for char in "/\\.."):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的 preview_id")
    package_path = STAGING_ROOT / preview_id / "package.zip"
    if not package_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="导入预览不存在或已过期")
    manifest, archive = _read_manifest(package_path)
    try:
        _validate_manifest_attachments(manifest, archive)
    finally:
        archive.close()
    return package_path, manifest


def _backup_before_import(db: Session, manifest: dict) -> Path:
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    backup_dir = BACKUP_ROOT / f"import_{timestamp}_{uuid4().hex[:8]}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    if DATABASE_PATH.exists():
        shutil.copy2(DATABASE_PATH, backup_dir / DATABASE_PATH.name)
    uploads_backup = backup_dir / "uploads"
    for report_item in manifest.get("reports", []):
        report_uid = report_item.get("report", {}).get("report_uid")
        local_report = (
            db.scalar(select(ExpenseReport).where(ExpenseReport.report_uid == report_uid, ExpenseReport.deleted_at.is_(None)))
            if report_uid
            else None
        )
        if local_report is None:
            continue
        source_dir = UPLOAD_ROOT / str(local_report.id)
        if source_dir.exists():
            shutil.copytree(source_dir, uploads_backup / str(local_report.id), dirs_exist_ok=True)
    return backup_dir


def _copy_zip_attachment_to_temp(archive: zipfile.ZipFile, attachment_path: str, staging_dir: Path) -> Path:
    payload = archive.read(_safe_zip_path(attachment_path))
    temp_path = staging_dir / f"{uuid4().hex}"
    temp_path.write_bytes(payload)
    return temp_path


def _report_field_payload(report_payload: dict) -> dict:
    return {
        "status": report_payload.get("status") or "draft",
        "report_date": _parse_date(report_payload.get("report_date")),
        "department": report_payload.get("department"),
        "employee_name": report_payload.get("employee_name"),
        "purpose": report_payload.get("purpose"),
        "daily_subsidy": _decimal(report_payload.get("daily_subsidy")),
        "subsidy_days": int(report_payload.get("subsidy_days") or 0),
        "subsidy_total": _decimal(report_payload.get("subsidy_total")),
        "manual_subsidy_total": _optional_nonnegative_money(
            report_payload.get("manual_subsidy_total"),
            "人工核定途中补贴总额",
        ),
        "advance_date_month": report_payload.get("advance_date_month"),
        "advance_date_day": report_payload.get("advance_date_day"),
        "advance_amount": _decimal(report_payload.get("advance_amount")),
        "total_amount": _decimal(report_payload.get("total_amount")),
        "shortfall": _decimal(report_payload.get("shortfall")),
        "surplus": _decimal(report_payload.get("surplus")),
    }


def _create_or_overwrite_report(
    db: Session,
    report_item: dict,
    target_report: ExpenseReport | None,
    preserve_uid: bool,
) -> tuple[ExpenseReport, dict[int, int]]:
    report_payload = report_item.get("report", {})
    data = _report_field_payload(report_payload)
    if target_report is None:
        report_uid = report_payload.get("report_uid") or uuid4().hex
        if db.scalar(select(ExpenseReport).where(ExpenseReport.report_uid == report_uid)) is not None:
            report_uid = uuid4().hex
        target_report = ExpenseReport(report_uid=report_uid)
        db.add(target_report)
        db.flush()
    elif not preserve_uid:
        imported_uid = report_payload.get("report_uid")
        if imported_uid and db.scalar(select(ExpenseReport).where(ExpenseReport.report_uid == imported_uid, ExpenseReport.id != target_report.id)) is None:
            target_report.report_uid = imported_uid

    for key, value in data.items():
        setattr(target_report, key, value)

    for invoice in target_report.invoices:
        invoice.deleted_at = datetime.utcnow()
        invoice.trip_id = None
    target_report.trips[:] = []
    target_report.expense_items[:] = []
    db.flush()

    trip_id_map: dict[int, int] = {}
    for trip_payload in report_item.get("trips", []):
        trip = Trip(
            sort_order=trip_payload["sort_order"],
            depart_month=trip_payload["depart_month"],
            depart_day=trip_payload["depart_day"],
            depart_hour=trip_payload.get("depart_hour"),
            depart_place=trip_payload.get("depart_place"),
            arrive_month=trip_payload["arrive_month"],
            arrive_day=trip_payload["arrive_day"],
            arrive_hour=trip_payload.get("arrive_hour"),
            arrive_place=trip_payload.get("arrive_place"),
            transport=trip_payload.get("transport"),
            subsidy_start=bool(trip_payload.get("subsidy_start", False)),
            subsidy_end=bool(trip_payload.get("subsidy_end", False)),
            paper_invoice_amount=_decimal(trip_payload.get("paper_invoice_amount")),
            paper_invoice_count=int(trip_payload.get("paper_invoice_count") or 0),
        )
        target_report.trips.append(trip)
        db.flush()
        if trip_payload.get("original_id") is not None:
            trip_id_map[int(trip_payload["original_id"])] = trip.id

    for item_payload in report_item.get("expense_items", []):
        target_report.expense_items.append(
            ExpenseItem(
                category=item_payload["category"],
                remark=item_payload.get("remark"),
                reimbursable_amount=_optional_decimal(item_payload.get("reimbursable_amount")),
                paper_invoice_amount=_decimal(item_payload.get("paper_invoice_amount")),
                paper_invoice_count=int(item_payload.get("paper_invoice_count") or 0),
            )
        )
    db.flush()
    return target_report, trip_id_map


def execute_import(db: Session, payload: ImportExecuteRequest) -> ImportExecuteRead:
    package_path, manifest = _load_preview_package(db, payload.preview_id)
    preview = _preview_from_manifest(db, manifest)
    if payload.strategy == "overwrite" and preview.requires_reimbursed_confirm and not payload.confirm_reimbursed_overwrite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="覆盖已报销记录需要二次确认")

    snapshot_backup = None
    if payload.strategy == "overwrite" and preview.summary.reports_conflict > 0:
        snapshot_backup = create_safety_snapshot(db, reason="pre_import_overwrite")
    backup_dir = _backup_before_import(db, manifest)
    staging_dir = STAGING_ROOT / payload.preview_id / "attachments"
    staging_dir.mkdir(parents=True, exist_ok=True)
    pending_files: list[tuple[Path, Path]] = []
    result = ImportExecuteRead(backup_path=snapshot_backup.path if snapshot_backup else backup_dir.as_posix())

    manifest_reports = manifest.get("reports", [])
    archive = zipfile.ZipFile(package_path)
    try:
        for report_item in manifest_reports:
            report_uid = report_item.get("report", {}).get("report_uid")
            local_report = (
                db.scalar(select(ExpenseReport).where(ExpenseReport.report_uid == report_uid, ExpenseReport.deleted_at.is_(None)))
                if report_uid
                else None
            )
            has_conflict = local_report is not None
            if payload.strategy == "skip" and has_conflict:
                result.reports_skipped += 1
                continue
            target = local_report if payload.strategy == "overwrite" and has_conflict else None
            report, trip_id_map = _create_or_overwrite_report(
                db,
                report_item,
                target_report=target,
                preserve_uid=target is not None,
            )
            if target is None:
                result.reports_created += 1
            else:
                result.reports_overwritten += 1

            for invoice_payload in report_item.get("invoices", []):
                invoice_uid = invoice_payload.get("invoice_uid") or uuid4().hex
                if db.scalar(select(Invoice).where(Invoice.invoice_uid == invoice_uid)) is not None:
                    invoice_uid = uuid4().hex
                invoice = Invoice(
                    invoice_uid=invoice_uid,
                    trip_id=trip_id_map.get(invoice_payload.get("trip_original_id")),
                    expense_category=invoice_payload["expense_category"],
                    file_path="",
                    file_type=invoice_payload["file_type"],
                    invoice_type=invoice_payload.get("invoice_type") or "unknown",
                    invoice_no=invoice_payload.get("invoice_no"),
                    invoice_date=_parse_date(invoice_payload.get("invoice_date")),
                    amount=_decimal(invoice_payload.get("amount")),
                    amount_confirmed=bool(invoice_payload.get("amount_confirmed")),
                )
                report.invoices.append(invoice)
                db.flush()
                temp_file = _copy_zip_attachment_to_temp(archive, invoice_payload["attachment_path"], staging_dir)
                final_relative = build_invoice_storage_path(
                    report_id=report.id,
                    invoice_id=invoice.id,
                    expense_category=invoice.expense_category,
                    file_hash=invoice_payload["attachment_hash"],
                    ext=Path(invoice_payload["attachment_path"]).suffix or invoice.file_type,
                )
                invoice.file_path = final_relative.as_posix()
                pending_files.append((temp_file, _invoice_file_path(final_relative)))
                result.invoices_created += 1
                result.attachments_written += 1
            recalculate_report_totals(report)
        db.commit()
    except Exception:
        db.rollback()
        for temp_file, _target in pending_files:
            temp_file.unlink(missing_ok=True)
        raise
    finally:
        archive.close()

    for temp_file, target in pending_files:
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_file.replace(target)
    return result
