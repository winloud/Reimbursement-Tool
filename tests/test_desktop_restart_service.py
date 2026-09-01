from __future__ import annotations

from pathlib import Path

import pytest

from backend.services import desktop_restart_service


def test_schedule_application_restart_closes_old_window_before_launch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    calls = []
    captured_thread = {}
    launcher = tmp_path / "报销管理.exe"
    launcher.write_bytes(b"launcher")

    class ImmediateThread:
        def __init__(self, target, name, daemon):
            self.target = target
            captured_thread["name"] = name
            captured_thread["daemon"] = daemon

        def start(self):
            self.target()

    def fake_popen(args, **kwargs):
        calls.append(("popen", args, kwargs))
        return object()

    def fake_exit(code):
        calls.append(("exit", code))
        raise SystemExit(code)

    monkeypatch.setattr(desktop_restart_service.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(
        desktop_restart_service.time,
        "sleep",
        lambda seconds: calls.append(("sleep", seconds)),
    )
    monkeypatch.setattr(desktop_restart_service.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(desktop_restart_service.os, "_exit", fake_exit)

    with pytest.raises(SystemExit):
        desktop_restart_service.schedule_application_restart(
            launcher,
            app_root=tmp_path,
            delay_seconds=0.1,
            close_browser=lambda: calls.append("close_window") or True,
        )

    assert captured_thread == {"name": "maintenance-restart", "daemon": False}
    assert calls[0] == ("sleep", 0.1)
    assert calls[1] == "close_window"
    assert calls[2][0] == "popen"
    assert calls[2][1] == [str(launcher)]
    assert calls[2][2]["cwd"] == str(tmp_path)
    assert calls[3] == ("exit", 0)


def test_close_desktop_browser_window_uses_recorded_pid(monkeypatch: pytest.MonkeyPatch):
    calls = []
    monkeypatch.setenv(desktop_restart_service.DESKTOP_BROWSER_PID_ENV, "4321")
    monkeypatch.setattr(
        desktop_restart_service,
        "_post_close_to_process_windows",
        lambda pid: calls.append(("post", pid)) or 1,
    )
    monkeypatch.setattr(
        desktop_restart_service,
        "_wait_for_process_exit",
        lambda pid, seconds: calls.append(("wait", pid, seconds)) or True,
    )
    monkeypatch.setattr(
        desktop_restart_service,
        "_terminate_process_tree",
        lambda pid: calls.append(("terminate", pid)) or True,
    )

    assert desktop_restart_service.close_desktop_browser_window() is True
    assert calls == [("post", 4321), ("wait", 4321, 4.0)]
