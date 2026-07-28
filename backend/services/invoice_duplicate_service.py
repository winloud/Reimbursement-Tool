from __future__ import annotations

from collections.abc import Callable, Iterable
from hashlib import sha256
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from backend.models.invoice import Invoice
from backend.models.report import ExpenseReport
from backend.services.report_service import REPORT_STATUS_LABELS

PathResolver = Callable[[str | Path], Path]
REPORT_CONTEXT_LIMIT = 3


def calculate_path_hash(file_path: Path) -> str | None:
    try:
        if not file_path.is_file():
            return None
        digest = sha256()
        with file_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


class InvoiceDuplicateIndex:
    """Request-scoped index of active invoices and their lazily computed hashes."""

    def __init__(self, db: Session, resolve_path: PathResolver):
        self._resolve_path = resolve_path
        self._hash_cache: dict[int, str | None] = {}
        self._invoices_by_size: dict[int, list[Invoice]] = {}
        self._invoices_by_no: dict[str, list[Invoice]] = {}

        statement = (
            select(Invoice)
            .join(ExpenseReport, Invoice.report_id == ExpenseReport.id)
            .options(joinedload(Invoice.report))
            .where(
                Invoice.deleted_at.is_(None),
                ExpenseReport.deleted_at.is_(None),
            )
            .order_by(Invoice.id)
        )
        invoices = list(db.scalars(statement).all())
        for invoice in invoices:
            normalized_no = (invoice.invoice_no or "").strip()
            if normalized_no:
                self._invoices_by_no.setdefault(normalized_no, []).append(invoice)

            try:
                file_path = Path(self._resolve_path(invoice.file_path))
                if not file_path.is_file():
                    continue
                file_size = file_path.stat().st_size
            except (OSError, TypeError, ValueError):
                continue
            self._invoices_by_size.setdefault(file_size, []).append(invoice)

    def find_file_matches(self, file_size: int, file_hash: str) -> list[Invoice]:
        matches: list[Invoice] = []
        for invoice in self._invoices_by_size.get(file_size, []):
            existing_hash = self._hash_cache.get(invoice.id)
            if invoice.id not in self._hash_cache:
                try:
                    file_path = Path(self._resolve_path(invoice.file_path))
                except (TypeError, ValueError):
                    existing_hash = None
                else:
                    existing_hash = calculate_path_hash(file_path)
                self._hash_cache[invoice.id] = existing_hash
            if existing_hash == file_hash:
                matches.append(invoice)
        return matches

    def find_invoice_no_matches(self, invoice_no: str | None) -> list[Invoice]:
        normalized = (invoice_no or "").strip()
        if not normalized:
            return []
        return list(self._invoices_by_no.get(normalized, []))


def format_duplicate_sources(matches: Iterable[Invoice], current_report_id: int) -> str:
    reports_by_id: dict[int, ExpenseReport] = {}
    for invoice in matches:
        report = invoice.report
        reports_by_id.setdefault(report.id, report)

    ordered_reports = sorted(
        reports_by_id.values(),
        key=lambda report: (report.id != current_report_id, report.id),
    )
    shown_reports = ordered_reports[:REPORT_CONTEXT_LIMIT]
    contexts = [_format_report_context(report, current_report_id) for report in shown_reports]
    remaining_count = len(ordered_reports) - len(shown_reports)
    if remaining_count > 0:
        contexts.append(f"另有 {remaining_count} 张来源报销单")
    return f"重复来源：{'；'.join(contexts)}"


def has_current_report_match(matches: Iterable[Invoice], current_report_id: int) -> bool:
    return any(invoice.report_id == current_report_id for invoice in matches)


def _format_report_context(report: ExpenseReport, current_report_id: int) -> str:
    report_label = "当前报销单" if report.id == current_report_id else "报销单"
    purpose = (report.purpose or "").strip() or "未填写"
    report_date = report.report_date.isoformat() if report.report_date else "未填写"
    employee_name = (report.employee_name or "").strip() or "未填写"
    status_label = REPORT_STATUS_LABELS.get(report.status, report.status)
    return (
        f"{report_label}（编号：{report.id}，事由：{purpose}，日期：{report_date}，"
        f"人员：{employee_name}，状态：{status_label}）"
    )
