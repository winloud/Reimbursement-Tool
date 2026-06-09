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
        raise AssertionError("pywebview should not be used when Chrome or Edge is available")

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
    captured_args = []

    class FakeProcess:
        returncode = 0

        def wait(self):
            return None

    def fake_popen(args, **_kwargs):
        captured_args.append(args)
        return FakeProcess()

    monkeypatch.setattr(desktop_app, "APP_ROOT", tmp_path)
    monkeypatch.setattr(desktop_app, "LOG_DIR", log_dir)
    monkeypatch.setattr(desktop_app, "find_chromium_browser", lambda: ("Microsoft Edge", tmp_path / "msedge.exe"))
    monkeypatch.setattr(desktop_app.subprocess, "Popen", fake_popen)

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
    assert (tmp_path / "browser-profile").is_dir()
    assert not legacy_profile.exists()
    assert unrelated_dir.exists()
