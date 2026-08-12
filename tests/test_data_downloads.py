import pytest
from fastapi import HTTPException

from backend.routers import data_transfer
from backend.schemas.data_transfer import DataExportRequest
from backend.services.prepared_download_service import clear_prepared_downloads


@pytest.fixture(autouse=True)
def clear_downloads():
    clear_prepared_downloads()
    yield
    clear_prepared_downloads()


def test_data_export_preparation_returns_repeatable_native_download(monkeypatch):
    monkeypatch.setattr(
        data_transfer,
        "build_export_zip",
        lambda _db, payload: (b"zip-content", f"selected-{len(payload.report_ids or [])}.zip"),
    )

    prepared = data_transfer.post_prepare_data_export(
        DataExportRequest(report_ids=[2, 3]),
        db=object(),
    )
    token = prepared.data.download_url.rsplit("/", 1)[-1]
    first = data_transfer.get_prepared_data_export(token)
    second = data_transfer.get_prepared_data_export(token)

    assert prepared.data.filename == "selected-2.zip"
    assert prepared.data.expires_in_seconds == 300
    assert first.body == b"zip-content"
    assert second.body == b"zip-content"
    assert first.media_type == "application/zip"
    assert "selected-2.zip" in first.headers["content-disposition"]


def test_unknown_data_export_download_token_returns_404():
    with pytest.raises(HTTPException) as exc_info:
        data_transfer.get_prepared_data_export("unknown-token-that-is-long-enough")

    assert exc_info.value.status_code == 404
    assert "失效" in exc_info.value.detail
