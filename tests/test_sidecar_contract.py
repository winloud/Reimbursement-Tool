"""sidecar 启动契约测试。

Tauri（Rust 端）依赖以下约定判定 sidecar 就绪，任何一条被破坏都会让桌面壳
卡在启动等待直到超时（见 src-tauri/src/sidecar.rs 的 parse_ready_line）：

- stdout 只输出一行 ready JSON：{"event":"ready","api_base_url":"http://127.0.0.1:<port>"}
- 日志写文件，不污染 stdout
- --port 0 时由 OS 分配随机本机端口
- 健康检查未通过前不输出 ready
"""
from __future__ import annotations

import json
import socket
from pathlib import Path

import pytest

import sidecar_app


def test_bind_free_port_returns_a_bindable_loopback_port():
    port = sidecar_app.bind_free_port()

    assert 1024 < port < 65536
    # 端口在 bind_free_port 返回后已释放，uvicorn 可以立即占用同一端口。
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((sidecar_app.HOST, port))


def test_emit_ready_writes_exactly_one_parsable_json_line(capsys: pytest.CaptureFixture[str]):
    sidecar_app.emit_ready(51234)

    captured = capsys.readouterr()
    assert captured.err == ""
    lines = captured.out.splitlines()
    assert len(lines) == 1, f"stdout 必须只有一行 ready JSON，实际 {lines!r}"
    payload = json.loads(lines[0])
    assert payload == {
        "event": "ready",
        "api_base_url": f"http://{sidecar_app.HOST}:51234",
    }


def test_configure_logging_writes_to_log_dir_not_stdout(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
):
    import logging

    log_dir = tmp_path / "logs"
    monkeypatch.setattr(sidecar_app, "LOG_DIR", log_dir)
    root_logger = logging.getLogger()
    original_handlers = root_logger.handlers[:]
    original_level = root_logger.level
    try:
        root_logger.handlers = []
        sidecar_app.configure_logging()
        logging.info("sidecar log line")
        for handler in root_logger.handlers:
            handler.flush()

        assert (log_dir / "sidecar.log").is_file()
        assert "sidecar log line" in (log_dir / "sidecar.log").read_text(encoding="utf-8")
        assert capsys.readouterr().out == ""
    finally:
        for handler in root_logger.handlers:
            handler.close()
        root_logger.handlers = original_handlers
        root_logger.level = original_level


def test_wait_until_ready_returns_once_health_returns_200(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    def fake_urlopen(url: str, timeout: float):
        calls.append(url)
        if len(calls) < 3:
            raise OSError("connection refused")
        return FakeResponse()

    monkeypatch.setattr(sidecar_app.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(sidecar_app.time, "sleep", lambda _seconds: None)

    sidecar_app.wait_until_ready("http://127.0.0.1:51234")

    assert calls == ["http://127.0.0.1:51234/api/health"] * 3


def test_wait_until_ready_raises_after_timeout(monkeypatch: pytest.MonkeyPatch):
    def always_refused(url: str, timeout: float):
        raise OSError("connection refused")

    clock = iter([0.0, 0.5, 1.5, 100.0, 200.0])
    monkeypatch.setattr(sidecar_app.urllib.request, "urlopen", always_refused)
    monkeypatch.setattr(sidecar_app.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(sidecar_app.time, "monotonic", lambda: next(clock))

    with pytest.raises(RuntimeError, match="健康检查超时"):
        sidecar_app.wait_until_ready("http://127.0.0.1:51234")


def test_sidecar_reads_runtime_contract_env_vars():
    """Rust 端注入的三个环境变量必须是 sidecar 实际消费的名字。"""
    source = Path(sidecar_app.__file__).read_text(encoding="utf-8")

    assert "REIMBURSEMENT_APP_VERSION" in source
    assert "REIMBURSEMENT_SESSION_TOKEN" in source
    # app_root 复用 runtime_paths 的 REIMBURSEMENT_APP_ROOT 解析。
    from backend import runtime_paths

    assert "REIMBURSEMENT_APP_ROOT" in Path(runtime_paths.__file__).read_text(encoding="utf-8")


def test_sidecar_does_not_serve_or_bundle_a_desktop_window():
    """sidecar 只提供 API：不得再引入 pywebview 或旧桌面壳。"""
    source = Path(sidecar_app.__file__).read_text(encoding="utf-8")

    # 只允许在文档字符串里以“不携带 pywebview”的形式出现，不允许真正 import。
    assert "import webview" not in source
    assert "webview.create_window" not in source
    assert "desktop_app" not in source
    assert "access_log=False" in source
