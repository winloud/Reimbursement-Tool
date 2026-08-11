from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

import uvicorn

from backend.main import create_app
from backend.runtime_paths import APP_ROOT, DATABASE_PATH, FRONTEND_DIST_DIR, LOG_DIR, UPLOAD_ROOT
from desktop_dependencies import ensure_runtime_dependencies, find_chromium_browser, is_webview2_available, show_error_message


HOST = "127.0.0.1"
APP_TITLE = "出差旅费报销管理工具"
WINDOW_DEFAULT_WIDTH = 1280
WINDOW_DEFAULT_HEIGHT = 860
WINDOW_MIN_WIDTH = 1024
WINDOW_MIN_HEIGHT = 700
WINDOW_MAX_WIDTH = 10000
WINDOW_MAX_HEIGHT = 10000
WINDOW_POSITION_MIN = -32000
WINDOW_POSITION_MAX = 32000
# Win32 reports a minimized window near (-32000, -32000). DPI virtualization
# can turn that into values such as (-21333, -21333), which must not be restored.
WINDOW_MINIMIZED_POSITION_LIMIT = -16000
DESKTOP_BROWSER_PID_ENV = "REIMBURSEMENT_BROWSER_PID"


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_DIR / "app.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def window_state_path() -> Path:
    return APP_ROOT / "window-state.json"


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_minimized_window_position(x: int | None, y: int | None) -> bool:
    return x is not None and y is not None and x == y and x <= WINDOW_MINIMIZED_POSITION_LIMIT


def normalize_window_state(payload: object) -> dict[str, int | None]:
    state: dict[str, int | None] = {
        "width": WINDOW_DEFAULT_WIDTH,
        "height": WINDOW_DEFAULT_HEIGHT,
        "x": None,
        "y": None,
    }
    if not isinstance(payload, dict):
        return state

    width = _coerce_int(payload.get("width"))
    if width is not None:
        state["width"] = min(max(width, WINDOW_MIN_WIDTH), WINDOW_MAX_WIDTH)

    height = _coerce_int(payload.get("height"))
    if height is not None:
        state["height"] = min(max(height, WINDOW_MIN_HEIGHT), WINDOW_MAX_HEIGHT)

    x = _coerce_int(payload.get("x"))
    y = _coerce_int(payload.get("y"))
    if (
        x is not None
        and y is not None
        and WINDOW_POSITION_MIN <= x <= WINDOW_POSITION_MAX
        and WINDOW_POSITION_MIN <= y <= WINDOW_POSITION_MAX
        and not _is_minimized_window_position(x, y)
    ):
        state["x"] = x
        state["y"] = y

    return state


def load_window_state(path: Path | None = None) -> dict[str, int | None]:
    state_file = path or window_state_path()
    try:
        payload = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return normalize_window_state({})
    return normalize_window_state(payload)


def save_window_state(state: dict[str, int | None], path: Path | None = None) -> None:
    state_file = path or window_state_path()
    normalized = normalize_window_state(state)
    payload = {
        "width": normalized["width"],
        "height": normalized["height"],
    }
    if normalized["x"] is not None and normalized["y"] is not None:
        payload["x"] = normalized["x"]
        payload["y"] = normalized["y"]

    state_file.parent.mkdir(parents=True, exist_ok=True)
    temp_path = state_file.with_name(f"{state_file.name}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(state_file)


def _safe_save_window_state(state: dict[str, int | None]) -> None:
    try:
        save_window_state(state)
    except OSError:
        logging.warning("failed to save desktop window state", exc_info=True)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_until_ready(base_url: str, timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError("FastAPI 服务启动超时") from last_error


def build_server(port: int) -> uvicorn.Server:
    app = create_app(frontend_dist_dir=Path(FRONTEND_DIST_DIR))
    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        log_level="info",
        access_log=False,
        log_config=None,
        http="h11",
        loop="asyncio",
        ws="none",
    )
    return uvicorn.Server(config)


def run_server(server: uvicorn.Server) -> None:
    try:
        server.run()
    except Exception:
        logging.exception("fastapi server thread failed")
        raise


def run_pywebview_window(base_url: str) -> None:
    import webview

    webview.settings["ALLOW_DOWNLOADS"] = True
    window_state = load_window_state()
    window_kwargs = {
        "width": int(window_state["width"] or WINDOW_DEFAULT_WIDTH),
        "height": int(window_state["height"] or WINDOW_DEFAULT_HEIGHT),
        "min_size": (WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT),
    }
    if window_state["x"] is not None and window_state["y"] is not None:
        window_kwargs["x"] = int(window_state["x"])
        window_kwargs["y"] = int(window_state["y"])

    window = webview.create_window(APP_TITLE, base_url, **window_kwargs)

    def remember_size(width: int, height: int) -> None:
        window_state["width"] = width
        window_state["height"] = height
        _safe_save_window_state(window_state)

    def remember_position(x: int, y: int) -> None:
        window_state["x"] = x
        window_state["y"] = y
        _safe_save_window_state(window_state)

    window.events.resized += remember_size
    window.events.moved += remember_position
    window.events.closing += lambda: _safe_save_window_state(window_state)
    logging.info("starting pywebview gui=edgechromium")
    webview.start(gui="edgechromium", debug=False)


def chromium_profile_dir() -> Path:
    return APP_ROOT / "browser-profile"


def ensure_chromium_download_prompt(profile_dir: Path) -> bool:
    preferences_path = profile_dir / "Default" / "Preferences"
    try:
        if preferences_path.exists():
            preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
            if not isinstance(preferences, dict):
                raise ValueError("Chromium Preferences root must be an object")
        else:
            preferences = {}
        download_preferences = preferences.setdefault("download", {})
        if not isinstance(download_preferences, dict):
            raise ValueError("Chromium download preferences must be an object")
        download_preferences["prompt_for_download"] = True

        preferences_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = preferences_path.with_name(f"{preferences_path.name}.tmp")
        temp_path.write_text(json.dumps(preferences, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        temp_path.replace(preferences_path)
        return True
    except (OSError, json.JSONDecodeError, ValueError):
        logging.warning("failed to enable chromium download prompt path=%s", preferences_path, exc_info=True)
        return False


def capture_chromium_window_state() -> bool:
    try:
        import ctypes
    except ImportError:
        return False

    user32 = ctypes.windll.user32
    matched_state: dict[str, int | None] | None = None

    def enum_handler(hwnd, _lparam):
        nonlocal matched_state
        if matched_state is not None or not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            return True

        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if APP_TITLE not in buffer.value:
            return True

        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        width = int(rect.right - rect.left)
        height = int(rect.bottom - rect.top)
        if width <= 0 or height <= 0:
            return True

        matched_state = {
            "width": width,
            "height": height,
            "x": int(rect.left),
            "y": int(rect.top),
        }
        return False

    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(enum_handler)
    user32.EnumWindows(callback, 0)
    if matched_state is None:
        return False
    _safe_save_window_state(matched_state)
    return True


def wait_for_chromium_process(process: subprocess.Popen, poll_interval_seconds: float = 0.5) -> None:
    while process.poll() is None:
        capture_chromium_window_state()
        time.sleep(poll_interval_seconds)
    capture_chromium_window_state()


def cleanup_legacy_chromium_profiles() -> None:
    if not LOG_DIR.exists():
        return

    log_dir = LOG_DIR.resolve()
    for profile_path in log_dir.glob("browser-profile-*"):
        try:
            resolved = profile_path.resolve()
            if resolved.parent != log_dir:
                continue
            if profile_path.is_dir() and not profile_path.is_symlink():
                shutil.rmtree(profile_path)
            else:
                profile_path.unlink()
            logging.info("removed legacy chromium profile path=%s", profile_path)
        except OSError:
            logging.warning("failed to remove legacy chromium profile path=%s", profile_path, exc_info=True)


def run_chromium_app_window(base_url: str) -> None:
    browser = find_chromium_browser()
    if browser is None:
        raise RuntimeError("未找到 Google Chrome 或 Microsoft Edge 浏览器")

    browser_name, browser_path = browser
    cleanup_legacy_chromium_profiles()
    profile_dir = chromium_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    ensure_chromium_download_prompt(profile_dir)
    window_state = load_window_state()
    args = [
        str(browser_path),
        f"--app={base_url}",
        "--new-window",
        "--no-first-run",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        f"--window-size={int(window_state['width'] or WINDOW_DEFAULT_WIDTH)},{int(window_state['height'] or WINDOW_DEFAULT_HEIGHT)}",
        f"--user-data-dir={profile_dir}",
    ]
    if window_state["x"] is not None and window_state["y"] is not None:
        args.insert(-1, f"--window-position={int(window_state['x'])},{int(window_state['y'])}")
    logging.info("starting chromium app-mode window name=%s path=%s profile=%s", browser_name, browser_path, profile_dir)
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser_pid = getattr(process, "pid", None)
    if browser_pid:
        os.environ[DESKTOP_BROWSER_PID_ENV] = str(browser_pid)
    try:
        wait_for_chromium_process(process)
    finally:
        if browser_pid and os.environ.get(DESKTOP_BROWSER_PID_ENV) == str(browser_pid):
            os.environ.pop(DESKTOP_BROWSER_PID_ENV, None)
    logging.info("chromium app-mode window exited returncode=%s", process.returncode)


def run_desktop_window(base_url: str) -> None:
    browser = find_chromium_browser()
    if browser is not None and browser[0] == "Google Chrome":
        try:
            run_chromium_app_window(base_url)
            return
        except Exception:
            logging.exception("chrome app-mode window failed; trying edge chromium webview")

    if is_webview2_available():
        try:
            run_pywebview_window(base_url)
            return
        except Exception:
            logging.exception("edge chromium webview failed; trying chromium app-mode fallback")
    else:
        logging.info("webview2 runtime not available; using chromium app-mode fallback")

    run_chromium_app_window(base_url)


def run_desktop_app() -> None:
    os.environ["REIMBURSEMENT_DESKTOP_MODE"] = "1"
    configure_logging()
    ensure_runtime_dependencies()
    logging.info(
        "starting desktop app app_root=%s database=%s uploads=%s frontend=%s",
        APP_ROOT,
        DATABASE_PATH,
        UPLOAD_ROOT,
        FRONTEND_DIST_DIR,
    )
    port = find_free_port()
    server = build_server(port)
    server_thread = threading.Thread(target=run_server, args=(server,), name="expense-fastapi", daemon=True)
    server_thread.start()
    base_url = f"http://{HOST}:{port}"
    logging.info("fastapi server thread started url=%s", base_url)

    try:
        wait_until_ready(base_url)
        logging.info("fastapi server is ready url=%s", base_url)
        run_desktop_window(base_url)
    except Exception:
        logging.exception("桌面应用启动失败")
        show_error_message(
            "桌面窗口启动失败",
            "应用后台服务已启动，但桌面窗口启动失败。\n\n"
            "请确认已安装 Microsoft Edge WebView2 Runtime / Google Chrome / Microsoft Edge，并查看 logs\\app.log。",
        )
        raise
    finally:
        server.should_exit = True
        server_thread.join(timeout=5)


if __name__ == "__main__":
    run_desktop_app()
