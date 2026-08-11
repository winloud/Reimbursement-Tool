from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass


PREPARED_DOWNLOAD_TTL_SECONDS = 300
MAX_PREPARED_DOWNLOADS = 8


@dataclass(frozen=True)
class PreparedDownload:
    content: bytes
    filename: str
    media_type: str
    expires_at: float


_downloads: dict[str, PreparedDownload] = {}
_downloads_lock = threading.Lock()


def _remove_expired(now: float) -> None:
    expired_tokens = [token for token, item in _downloads.items() if item.expires_at <= now]
    for token in expired_tokens:
        _downloads.pop(token, None)


def prepare_download(
    content: bytes,
    filename: str,
    media_type: str,
    *,
    ttl_seconds: int = PREPARED_DOWNLOAD_TTL_SECONDS,
) -> str:
    if not content:
        raise ValueError("prepared download content must not be empty")
    if ttl_seconds <= 0:
        raise ValueError("prepared download ttl must be positive")

    now = time.monotonic()
    token = secrets.token_urlsafe(32)
    item = PreparedDownload(
        content=content,
        filename=filename,
        media_type=media_type,
        expires_at=now + ttl_seconds,
    )
    with _downloads_lock:
        _remove_expired(now)
        while len(_downloads) >= MAX_PREPARED_DOWNLOADS:
            oldest_token = min(_downloads, key=lambda current: _downloads[current].expires_at)
            _downloads.pop(oldest_token, None)
        _downloads[token] = item
    return token


def get_prepared_download(token: str) -> PreparedDownload | None:
    now = time.monotonic()
    with _downloads_lock:
        _remove_expired(now)
        return _downloads.get(token)


def clear_prepared_downloads() -> None:
    with _downloads_lock:
        _downloads.clear()
