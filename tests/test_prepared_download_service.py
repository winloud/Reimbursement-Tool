import pytest

from backend.services import prepared_download_service as service


@pytest.fixture(autouse=True)
def clear_downloads():
    service.clear_prepared_downloads()
    yield
    service.clear_prepared_downloads()


def test_prepared_download_keeps_nonempty_content_until_expiry(monkeypatch):
    now = 100.0
    monkeypatch.setattr(service.time, "monotonic", lambda: now)

    token = service.prepare_download(b"pdf-content", "report.pdf", "application/pdf", ttl_seconds=5)
    prepared = service.get_prepared_download(token)

    assert prepared is not None
    assert prepared.content == b"pdf-content"
    assert prepared.filename == "report.pdf"
    assert prepared.media_type == "application/pdf"

    now = 106.0
    assert service.get_prepared_download(token) is None


def test_prepared_download_rejects_empty_content_and_invalid_ttl():
    with pytest.raises(ValueError, match="must not be empty"):
        service.prepare_download(b"", "report.pdf", "application/pdf")
    with pytest.raises(ValueError, match="must be positive"):
        service.prepare_download(b"content", "report.pdf", "application/pdf", ttl_seconds=0)


def test_prepared_download_evicts_oldest_item_at_capacity(monkeypatch):
    now = 1.0
    monkeypatch.setattr(service.time, "monotonic", lambda: now)
    tokens = []
    for index in range(service.MAX_PREPARED_DOWNLOADS + 1):
        now = float(index + 1)
        tokens.append(service.prepare_download(f"content-{index}".encode(), f"{index}.pdf", "application/pdf"))

    assert service.get_prepared_download(tokens[0]) is None
    assert service.get_prepared_download(tokens[-1]) is not None
