from __future__ import annotations

import logging
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn

from backend.main import create_app
from backend.runtime_paths import APP_ROOT, DATABASE_PATH, FRONTEND_DIST_DIR, LOG_DIR, UPLOAD_ROOT
from desktop_dependencies import ensure_runtime_dependencies, find_chromium_browser, is_webview2_available, show_error_message


HOST = "127.0.0.1"
APP_TITLE = "出差旅费报销管理工具"


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_DIR / "app.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


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

    webview.create_window(APP_TITLE, base_url, width=1280, height=860, min_size=(1024, 700))
    logging.info("starting pywebview gui=edgechromium")
    webview.start(gui="edgechromium", debug=False)


def chromium_profile_dir() -> Path:
    return APP_ROOT / "browser-profile"


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
    args = [
        str(browser_path),
        f"--app={base_url}",
        "--new-window",
        "--no-first-run",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-extensions",
        f"--user-data-dir={profile_dir}",
    ]
    logging.info("starting chromium app-mode window name=%s path=%s profile=%s", browser_name, browser_path, profile_dir)
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    process.wait()
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
