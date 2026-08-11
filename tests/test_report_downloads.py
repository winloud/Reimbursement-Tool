import pytest
from fastapi import HTTPException

from backend.routers import reports
from backend.schemas.report import ReportBatchRequest
from backend.services.prepared_download_service import clear_prepared_downloads


@pytest.fixture(autouse=True)
def clear_downloads():
    clear_prepared_downloads()
    yield
    clear_prepared_downloads()


def test_single_pdf_preparation_returns_retrievable_native_download(monkeypatch):
    monkeypatch.setattr(reports, "_build_report_pdf", lambda _db, report_id: (b"pdf-content", f"report-{report_id}.pdf"))

    prepared = reports.post_prepare_report_pdf(7, db=object())
    token = prepared.data.download_url.rsplit("/", 1)[-1]
    response = reports.get_prepared_report_download(token)

    assert prepared.data.filename == "report-7.pdf"
    assert prepared.data.expires_in_seconds == 300
    assert response.body == b"pdf-content"
    assert response.media_type == "application/pdf"
    assert "report-7.pdf" in response.headers["content-disposition"]


def test_batch_pdf_preparation_returns_zip_download(monkeypatch):
    monkeypatch.setattr(reports, "build_batch_report_pdf_zip", lambda _db, report_ids: (b"zip-content", f"reports-{len(report_ids)}.zip"))

    prepared = reports.post_prepare_batch_report_pdf(ReportBatchRequest(report_ids=[2, 3]), db=object())
    token = prepared.data.download_url.rsplit("/", 1)[-1]
    response = reports.get_prepared_report_download(token)

    assert response.body == b"zip-content"
    assert response.media_type == "application/zip"
    assert "reports-2.zip" in response.headers["content-disposition"]


def test_expired_or_unknown_download_token_returns_404():
    with pytest.raises(HTTPException) as exc_info:
        reports.get_prepared_report_download("unknown-token-that-is-long-enough")

    assert exc_info.value.status_code == 404
    assert "失效" in exc_info.value.detail
