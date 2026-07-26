from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.models.invoice import Invoice
from backend.routers.invoices import get_invoice_open_capability, post_invoice_open_local
from backend.schemas.report import ReportCreate
from backend.services import invoice_service
from backend.services.invoice_service import local_pdf_open_supported, open_invoice_pdf_locally
from backend.services.report_service import create_report


def make_request(client_host: str, request_host: str) -> Request:
    host_header = request_host if ":" not in request_host else f"[{request_host}]"
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/invoices/open-capability",
            "raw_path": b"/api/invoices/open-capability",
            "query_string": b"",
            "headers": [(b"host", f"{host_header}:8000".encode("ascii"))],
            "client": (client_host, 50000),
            "server": ("127.0.0.1", 8000),
        }
    )


@pytest.mark.parametrize(
    ("client_host", "request_host"),
    [
        ("127.0.0.1", "127.0.0.1"),
        ("::1", "::1"),
        ("::ffff:127.0.0.1", "localhost"),
        ("localhost", "localhost."),
    ],
)
def test_local_pdf_open_supports_windows_loopback_hosts(monkeypatch, client_host: str, request_host: str):
    monkeypatch.setattr(invoice_service.sys, "platform", "win32")

    assert local_pdf_open_supported(client_host, request_host) is True


@pytest.mark.parametrize(
    ("platform", "client_host", "request_host"),
    [
        ("linux", "127.0.0.1", "127.0.0.1"),
        ("win32", "203.0.113.10", "server.example.com"),
        ("win32", "127.0.0.1", "server.example.com"),
        ("win32", "203.0.113.10", "127.0.0.1"),
    ],
)
def test_local_pdf_open_rejects_nonlocal_or_nonwindows_requests(
    monkeypatch,
    platform: str,
    client_host: str,
    request_host: str,
):
    monkeypatch.setattr(invoice_service.sys, "platform", platform)

    assert local_pdf_open_supported(client_host, request_host) is False


def add_invoice(db, tmp_path: Path, *, file_type: str = "pdf", create_file: bool = True) -> tuple[Invoice, Path]:
    report = create_report(db, ReportCreate(report_date=date(2026, 7, 26)))
    suffix = ".pdf" if file_type == "pdf" else ".png"
    relative_path = Path("uploads") / str(report.id) / f"invoice{suffix}"
    file_path = tmp_path / str(report.id) / f"invoice{suffix}"
    if create_file:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"%PDF-1.4" if file_type == "pdf" else b"image")
    invoice = Invoice(
        report_id=report.id,
        expense_category="luggage",
        file_path=relative_path.as_posix(),
        file_type=file_type,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice, file_path


def test_open_invoice_pdf_locally_uses_windows_default_program(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, file_path = add_invoice(db, tmp_path)
    opened = []
    monkeypatch.setattr(invoice_service.os, "startfile", lambda path: opened.append(path), raising=False)

    open_invoice_pdf_locally(db, invoice.id)

    assert opened == [str(file_path)]


def test_open_invoice_pdf_locally_rejects_image(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, _ = add_invoice(db, tmp_path, file_type="image")

    with pytest.raises(HTTPException) as exc_info:
        open_invoice_pdf_locally(db, invoice.id)

    assert exc_info.value.status_code == 400


def test_open_invoice_pdf_locally_rejects_deleted_invoice(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, _ = add_invoice(db, tmp_path)
    invoice.deleted_at = datetime.utcnow()
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        open_invoice_pdf_locally(db, invoice.id)

    assert exc_info.value.status_code == 404


def test_open_invoice_pdf_locally_reports_missing_file(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, _ = add_invoice(db, tmp_path, create_file=False)

    with pytest.raises(HTTPException) as exc_info:
        open_invoice_pdf_locally(db, invoice.id)

    assert exc_info.value.status_code == 404
    assert "原始文件不存在" in exc_info.value.detail


def test_open_invoice_pdf_locally_reports_default_program_failure(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, _ = add_invoice(db, tmp_path)

    def fail_startfile(_path: str) -> None:
        raise OSError("no PDF association at C:\\private\\invoice.pdf")

    monkeypatch.setattr(invoice_service.os, "startfile", fail_startfile, raising=False)

    with pytest.raises(HTTPException) as exc_info:
        open_invoice_pdf_locally(db, invoice.id)

    assert exc_info.value.status_code == 500
    assert "C:\\private" not in exc_info.value.detail
    assert "PDF 文件关联设置" in exc_info.value.detail


def test_invoice_open_capability_reports_request_specific_mode(monkeypatch):
    monkeypatch.setattr(invoice_service.sys, "platform", "win32")

    local_response = get_invoice_open_capability(make_request("127.0.0.1", "localhost"))
    remote_response = get_invoice_open_capability(make_request("127.0.0.1", "server.example.com"))

    assert local_response.data.local_pdf_open_supported is True
    assert remote_response.data.local_pdf_open_supported is False


def test_invoice_open_route_rejects_remote_request_before_opening(monkeypatch, tmp_path: Path, db):
    monkeypatch.setattr(invoice_service.sys, "platform", "win32")
    monkeypatch.setattr(invoice_service, "UPLOAD_ROOT", tmp_path)
    invoice, _ = add_invoice(db, tmp_path)
    monkeypatch.setattr(invoice_service.os, "startfile", lambda _path: pytest.fail("unexpected local open"), raising=False)

    with pytest.raises(HTTPException) as exc_info:
        post_invoice_open_local(invoice.id, make_request("127.0.0.1", "server.example.com"), db)

    assert exc_info.value.status_code == 403
