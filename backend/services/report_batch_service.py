from __future__ import annotations

from datetime import datetime
from io import BytesIO
import zipfile

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.report import ExpenseReport
from backend.schemas.report import (
    ReportBatchDeleteResult,
    ReportBatchDeleteSkipped,
    ReportBatchPurgeResult,
    ReportBatchRestoreResult,
    ReportBatchStatusResult,
    ReportBatchStatusSkipped,
    ReportStatus,
)
from backend.services.maintenance_service import create_safety_snapshot
from backend.services.pdf_generator import build_merged_report_pdf, build_pdf_filename
from backend.services.report_service import (
    REPORT_STATUS_LABELS,
    REPORT_STATUS_ORDER,
    ensure_fuel_subsidy_printable,
    ensure_report_ready_to_leave_draft,
    purge_report,
    restore_deleted_report,
)
from backend.services.settings_service import get_or_create_settings


def unique_report_ids(report_ids: list[int]) -> list[int]:
    seen: set[int] = set()
    unique_ids: list[int] = []
    for report_id in report_ids:
        if report_id in seen:
            continue
        seen.add(report_id)
        unique_ids.append(report_id)
    return unique_ids


def _active_report_by_id(db: Session, report_id: int) -> ExpenseReport | None:
    return db.scalar(
        select(ExpenseReport).where(
            ExpenseReport.id == report_id,
            ExpenseReport.deleted_at.is_(None),
        )
    )


def _unique_zip_filename(filename: str, report_id: int, used_names: set[str]) -> str:
    if filename not in used_names:
        return filename
    stem, suffix = filename.rsplit(".", 1)
    candidate = f"{stem}-{report_id}.{suffix}"
    index = 2
    while candidate in used_names:
        candidate = f"{stem}-{report_id}-{index}.{suffix}"
        index += 1
    return candidate


def build_batch_report_pdf_zip(db: Session, report_ids: list[int]) -> tuple[bytes, str]:
    selected_ids = unique_report_ids(report_ids)
    settings = get_or_create_settings(db)
    failures: list[dict[str, object]] = []
    pdf_items: list[tuple[ExpenseReport, bytes]] = []

    for report_id in selected_ids:
        report = _active_report_by_id(db, report_id)
        if report is None:
            failures.append({"report_id": report_id, "reason": "报销单不存在或已删除"})
            continue
        try:
            ensure_fuel_subsidy_printable(report)
            pdf_items.append(
                (
                    report,
                    build_merged_report_pdf(
                        report,
                        settings.pdf_fill_font_key,
                        settings.double_print_vat_special_invoices,
                    ),
                )
            )
        except HTTPException as exc:
            failures.append({"report_id": report_id, "reason": str(exc.detail)})

    if failures:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"failures": failures})

    buffer = BytesIO()
    used_names: set[str] = set()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for report, pdf_bytes in pdf_items:
            filename = _unique_zip_filename(build_pdf_filename(report), report.id, used_names)
            used_names.add(filename)
            archive.writestr(filename, pdf_bytes)

    filename = f"报销单批量下载-{datetime.now().strftime('%Y%m%d%H%M%S')}.zip"
    return buffer.getvalue(), filename


def batch_soft_delete_draft_reports(db: Session, report_ids: list[int]) -> ReportBatchDeleteResult:
    selected_ids = unique_report_ids(report_ids)
    candidates: list[ExpenseReport] = []
    skipped: list[ReportBatchDeleteSkipped] = []

    for report_id in selected_ids:
        report = _active_report_by_id(db, report_id)
        if report is None:
            skipped.append(ReportBatchDeleteSkipped(report_id=report_id, reason="报销单不存在或已删除"))
            continue
        if report.status != "draft":
            skipped.append(
                ReportBatchDeleteSkipped(report_id=report_id, reason="只有草稿可以删除", status=report.status)
            )
            continue
        candidates.append(report)

    if candidates:
        create_safety_snapshot(db, reason="pre_batch_delete")
        deleted_at = datetime.utcnow()
        for report in candidates:
            report.deleted_at = deleted_at
            for invoice in report.invoices:
                invoice.deleted_at = deleted_at
            for attachment in report.attachments:
                if attachment.deleted_at is None:
                    attachment.deleted_at = deleted_at
        db.commit()

    return ReportBatchDeleteResult(deleted_count=len(candidates), skipped_count=len(skipped), skipped=skipped)


def batch_update_report_status(
    db: Session,
    report_ids: list[int],
    target_status: ReportStatus,
) -> ReportBatchStatusResult:
    candidates: list[ExpenseReport] = []
    skipped: list[ReportBatchStatusSkipped] = []

    for report_id in unique_report_ids(report_ids):
        report = _active_report_by_id(db, report_id)
        if report is None:
            skipped.append(ReportBatchStatusSkipped(report_id=report_id, reason="报销单不存在或已删除"))
            continue
        if report.status == target_status:
            skipped.append(
                ReportBatchStatusSkipped(
                    report_id=report_id,
                    reason=f"当前已是{REPORT_STATUS_LABELS[target_status]}",
                    status=report.status,
                )
            )
            continue
        try:
            if report.status == "draft" and target_status != "draft":
                ensure_report_ready_to_leave_draft(report)
        except HTTPException as exc:
            skipped.append(
                ReportBatchStatusSkipped(report_id=report_id, reason=str(exc.detail), status=report.status)
            )
            continue
        candidates.append(report)

    try:
        if any(
            REPORT_STATUS_ORDER[target_status] < REPORT_STATUS_ORDER.get(report.status, 0)
            for report in candidates
        ):
            create_safety_snapshot(db, reason="pre_batch_status_rollback")
        for report in candidates:
            report.status = target_status
        if candidates:
            db.commit()
    except Exception:
        db.rollback()
        raise

    return ReportBatchStatusResult(
        target_status=target_status,
        updated_count=len(candidates),
        skipped_count=len(skipped),
        skipped=skipped,
    )


def _purgeable_report_by_id(db: Session, report_id: int) -> ExpenseReport | None:
    return db.scalar(select(ExpenseReport).where(ExpenseReport.id == report_id))


def _purge_candidates(
    db: Session,
    report_ids: list[int],
) -> tuple[list[int], list[ReportBatchDeleteSkipped]]:
    purgeable_ids: list[int] = []
    skipped: list[ReportBatchDeleteSkipped] = []
    for report_id in unique_report_ids(report_ids):
        report = _purgeable_report_by_id(db, report_id)
        if report is None:
            skipped.append(ReportBatchDeleteSkipped(report_id=report_id, reason="报销单不存在"))
            continue
        if report.status != "draft":
            skipped.append(
                ReportBatchDeleteSkipped(report_id=report_id, reason="只有草稿可以彻底删除", status=report.status)
            )
            continue
        purgeable_ids.append(report_id)
    return purgeable_ids, skipped


def batch_restore_deleted_reports(db: Session, report_ids: list[int]) -> ReportBatchRestoreResult:
    restored_count = 0
    skipped: list[ReportBatchDeleteSkipped] = []

    for report_id in unique_report_ids(report_ids):
        try:
            restore_deleted_report(db, report_id)
            restored_count += 1
        except HTTPException as exc:
            skipped.append(ReportBatchDeleteSkipped(report_id=report_id, reason=str(exc.detail)))

    return ReportBatchRestoreResult(restored_count=restored_count, skipped_count=len(skipped), skipped=skipped)


def batch_purge_reports(db: Session, report_ids: list[int]) -> ReportBatchPurgeResult:
    purged_count = 0
    files_deleted_count = 0
    purgeable_ids, skipped = _purge_candidates(db, report_ids)

    if purgeable_ids:
        create_safety_snapshot(db, reason="pre_batch_purge")

    for report_id in purgeable_ids:
        try:
            files_deleted_count += purge_report(db, report_id)
            purged_count += 1
        except HTTPException as exc:
            skipped.append(ReportBatchDeleteSkipped(report_id=report_id, reason=str(exc.detail)))

    return ReportBatchPurgeResult(
        purged_count=purged_count,
        skipped_count=len(skipped),
        files_deleted_count=files_deleted_count,
        skipped=skipped,
    )
