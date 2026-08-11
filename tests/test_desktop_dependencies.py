import json
import os
import sys

import desktop_dependencies
import desktop_app


def test_webview2_available_does_not_fallback_to_pywebview_import(monkeypatch):
    monkeypatch.setattr(desktop_dependencies, "is_webview2_installed", lambda: False)

    assert desktop_dependencies.is_webview2_available() is False


def test_runtime_dependencies_prefer_google_chrome(monkeypatch, tmp_path):
    monkeypatch.setattr(desktop_dependencies, "is_webview2_available", lambda: False)
    monkeypatch.setattr(desktop_dependencies, "find_chromium_browser", lambda: ("Google Chrome", tmp_path / "chrome.exe"))

    desktop_dependencies.ensure_runtime_dependencies()


def test_runtime_dependencies_install_webview2_before_edge_fallback(monkeypatch, tmp_path):
    calls = []

    monkeypatch.setattr(desktop_dependencies, "is_webview2_available", lambda: False)
    monkeypatch.setattr(desktop_dependencies, "find_chromium_browser", lambda: ("Microsoft Edge", tmp_path / "msedge.exe"))
    monkeypatch.setattr(desktop_dependencies, "install_webview2", lambda: calls.append("install_webview2") or True)

    desktop_dependencies.ensure_runtime_dependencies()

    assert calls == ["install_webview2"]


def test_desktop_window_uses_chromium_before_webview2(monkeypatch):
    calls = []

    monkeypatch.setattr(desktop_app, "find_chromium_browser", lambda: ("Google Chrome", object()))
    monkeypatch.setattr(desktop_app, "is_webview2_available", lambda: True)
    monkeypatch.setattr(desktop_app, "run_chromium_app_window", lambda base_url: calls.append(("chromium", base_url)))

    def fail_pywebview(_base_url):
        raise AssertionError("pywebview should not be used when Chrome is available")

    monkeypatch.setattr(desktop_app, "run_pywebview_window", fail_pywebview)

    desktop_app.run_desktop_window("http://127.0.0.1:12345")

    assert calls == [("chromium", "http://127.0.0.1:12345")]


def test_desktop_window_uses_webview2_before_edge_app_mode(monkeypatch):
    calls = []

    monkeypatch.setattr(desktop_app, "find_chromium_browser", lambda: ("Microsoft Edge", object()))
    monkeypatch.setattr(desktop_app, "is_webview2_available", lambda: True)
    monkeypatch.setattr(desktop_app, "run_pywebview_window", lambda base_url: calls.append(("pywebview", base_url)))

    def fail_chromium(_base_url):
        raise AssertionError("Edge app-mode should not be used before WebView2")

    monkeypatch.setattr(desktop_app, "run_chromium_app_window", fail_chromium)

    desktop_app.run_desktop_window("http://127.0.0.1:23456")

    assert calls == [("pywebview", "http://127.0.0.1:23456")]


def test_chromium_app_window_reuses_stable_profile_and_removes_legacy_profiles(monkeypatch, tmp_path):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    legacy_profile = log_dir / "browser-profile-old"
    legacy_profile.mkdir()
    unrelated_dir = log_dir / "keep"
    unrelated_dir.mkdir()
    (tmp_path / "window-state.json").write_text(json.dumps({"width": 1366, "height": 768, "x": 40, "y": 50}), encoding="utf-8")
    captured_args = []

    class FakeProcess:
        returncode = 0

        def poll(self):
            return 0

    def fake_popen(args, **_kwargs):
        captured_args.append(args)
        return FakeProcess()

    monkeypatch.setattr(desktop_app, "APP_ROOT", tmp_path)
    monkeypatch.setattr(desktop_app, "LOG_DIR", log_dir)
    monkeypatch.setattr(desktop_app, "find_chromium_browser", lambda: ("Microsoft Edge", tmp_path / "msedge.exe"))
    monkeypatch.setattr(desktop_app.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(desktop_app, "capture_chromium_window_state", lambda: True)

    desktop_app.run_chromium_app_window("http://127.0.0.1:34567")
    desktop_app.run_chromium_app_window("http://127.0.0.1:45678")

    profile_args = [
        arg
        for args in captured_args
        for arg in args
        if arg.startswith("--user-data-dir=")
    ]

    assert profile_args == [
        f"--user-data-dir={tmp_path / 'browser-profile'}",
        f"--user-data-dir={tmp_path / 'browser-profile'}",
    ]
    assert all("--window-size=1366,768" in args for args in captured_args)
    assert all("--window-position=40,50" in args for args in captured_args)
    assert (tmp_path / "browser-profile").is_dir()
    preferences = json.loads((tmp_path / "browser-profile" / "Default" / "Preferences").read_text(encoding="utf-8"))
    assert preferences["download"]["prompt_for_download"] is True
    assert all("--disable-extensions" not in args for args in captured_args)
    assert not legacy_profile.exists()
    assert unrelated_dir.exists()


def test_chromium_app_window_publishes_browser_pid_during_run(monkeypatch, tmp_path):
    captured = {}

    class FakeProcess:
        pid = 4321
        returncode = 0

    def fake_popen(_args, **_kwargs):
        return FakeProcess()

    def fake_wait(_process):
        captured["browser_pid"] = os.environ.get(desktop_app.DESKTOP_BROWSER_PID_ENV)

    monkeypatch.setattr(desktop_app, "APP_ROOT", tmp_path)
    monkeypatch.setattr(desktop_app, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(desktop_app, "find_chromium_browser", lambda: ("Google Chrome", tmp_path / "chrome.exe"))
    monkeypatch.setattr(desktop_app.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(desktop_app, "wait_for_chromium_process", fake_wait)

    desktop_app.run_chromium_app_window("http://127.0.0.1:34567")

    assert captured["browser_pid"] == "4321"
    assert os.environ.get(desktop_app.DESKTOP_BROWSER_PID_ENV) is None


def test_chromium_process_polling_captures_window_state_until_exit(monkeypatch):
    calls = []
    poll_results = [None, None, 0]

    class FakeProcess:
        def poll(self):
            return poll_results.pop(0)

    monkeypatch.setattr(desktop_app, "capture_chromium_window_state", lambda: calls.append("capture") or True)
    monkeypatch.setattr(desktop_app.time, "sleep", lambda _seconds: calls.append("sleep"))

    desktop_app.wait_for_chromium_process(FakeProcess(), poll_interval_seconds=0.01)

    assert calls == ["capture", "sleep", "capture", "sleep", "capture"]


def test_chromium_window_capture_skips_minimized_window(monkeypatch):
    calls = []
    saved_states = []

    class FakeUser32:
        @staticmethod
        def IsWindowVisible(_hwnd):
            calls.append("visible")
            return True

        @staticmethod
        def IsIconic(_hwnd):
            calls.append("iconic")
            return True

        @staticmethod
        def EnumWindows(callback, _lparam):
            callback(1, 0)

    class FakeCtypes:
        windll = type("FakeWindll", (), {"user32": FakeUser32()})()

        @staticmethod
        def WINFUNCTYPE(*_args):
            return lambda callback: callback

    monkeypatch.setitem(sys.modules, "ctypes", FakeCtypes)
    monkeypatch.setattr(desktop_app, "_safe_save_window_state", lambda state: saved_states.append(state))

    assert desktop_app.capture_chromium_window_state() is False
    assert calls == ["visible", "iconic"]
    assert saved_states == []


def test_window_state_loads_defaults_for_missing_or_invalid_file(tmp_path):
    missing = tmp_path / "missing-window-state.json"
    invalid = tmp_path / "invalid-window-state.json"
    invalid.write_text("{not-json", encoding="utf-8")

    assert desktop_app.load_window_state(missing) == {
        "width": 1280,
        "height": 860,
        "x": None,
        "y": None,
    }
    assert desktop_app.load_window_state(invalid) == {
        "width": 1280,
        "height": 860,
        "x": None,
        "y": None,
    }


def test_window_state_clamps_size_and_persists_position(tmp_path):
    state_path = tmp_path / "window-state.json"

    desktop_app.save_window_state({"width": 800, "height": 500, "x": 120, "y": 80}, state_path)

    assert json.loads(state_path.read_text(encoding="utf-8")) == {
        "width": 1024,
        "height": 700,
        "x": 120,
        "y": 80,
    }


def test_window_state_discards_dpi_virtualized_minimized_position(tmp_path):
    state_path = tmp_path / "window-state.json"
    state_path.write_text(json.dumps({"width": 1024, "height": 700, "x": -21333, "y": -21333}), encoding="utf-8")

    assert desktop_app.load_window_state(state_path) == {
        "width": 1024,
        "height": 700,
        "x": None,
        "y": None,
    }

    desktop_app.save_window_state({"width": 1024, "height": 700, "x": -21333, "y": -21333}, state_path)

    assert json.loads(state_path.read_text(encoding="utf-8")) == {
        "width": 1024,
        "height": 700,
    }


def test_pywebview_window_restores_and_remembers_window_state(monkeypatch, tmp_path):
    state_path = tmp_path / "window-state.json"
    state_path.write_text(json.dumps({"width": 1366, "height": 768, "x": 50, "y": 70}), encoding="utf-8")
    captured = {}

    class FakeEvent:
        def __init__(self):
            self.handlers = []

        def __iadd__(self, handler):
            self.handlers.append(handler)
            return self

    class FakeEvents:
        def __init__(self):
            self.resized = FakeEvent()
            self.moved = FakeEvent()
            self.closing = FakeEvent()

    class FakeWindow:
        def __init__(self):
            self.events = FakeEvents()

    fake_window = FakeWindow()

    class FakeWebview:
        settings = {"ALLOW_DOWNLOADS": False}

        @staticmethod
        def create_window(title, url, **kwargs):
            captured["title"] = title
            captured["url"] = url
            captured["kwargs"] = kwargs
            return fake_window

        @staticmethod
        def start(**kwargs):
            captured["start"] = kwargs

    monkeypatch.setattr(desktop_app, "APP_ROOT", tmp_path)
    monkeypatch.setitem(sys.modules, "webview", FakeWebview)

    desktop_app.run_pywebview_window("http://127.0.0.1:12345")
    fake_window.events.resized.handlers[0](1440, 900)
    fake_window.events.moved.handlers[0](88, 99)
    fake_window.events.closing.handlers[0]()

    assert captured["title"] == desktop_app.APP_TITLE
    assert captured["url"] == "http://127.0.0.1:12345"
    assert captured["kwargs"] == {
        "width": 1366,
        "height": 768,
        "x": 50,
        "y": 70,
        "min_size": (1024, 700),
    }
    assert captured["start"] == {"gui": "edgechromium", "debug": False}
    assert FakeWebview.settings["ALLOW_DOWNLOADS"] is True
    assert json.loads(state_path.read_text(encoding="utf-8")) == {
        "width": 1440,
        "height": 900,
        "x": 88,
        "y": 99,
    }


def test_chromium_download_prompt_preserves_existing_preferences(tmp_path):
    preferences_path = tmp_path / "Default" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text(
        json.dumps({"download": {"directory_upgrade": True}, "existing": {"value": 7}}),
        encoding="utf-8",
    )

    assert desktop_app.ensure_chromium_download_prompt(tmp_path) is True

    preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
    assert preferences["download"] == {"directory_upgrade": True, "prompt_for_download": True}
    assert preferences["existing"] == {"value": 7}


def test_chromium_download_prompt_does_not_overwrite_invalid_preferences(tmp_path):
    preferences_path = tmp_path / "Default" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("not-json", encoding="utf-8")

    assert desktop_app.ensure_chromium_download_prompt(tmp_path) is False
    assert preferences_path.read_text(encoding="utf-8") == "not-json"
