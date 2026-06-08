from __future__ import annotations

import logging
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn

from backend.main import create_app
from backend.runtime_paths import APP_ROOT, DATABASE_PATH, FRONTEND_DIST_DIR, LOG_DIR, UPLOAD_ROOT
from desktop_dependencies import ensure_runtime_dependencies


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
    config = uvicorn.Config(app, host=HOST, port=port, log_level="info", access_log=False, log_config=None)
    return uvicorn.Server(config)


def run_server(server: uvicorn.Server) -> None:
    try:
        server.run()
    except Exception:
        logging.exception("fastapi server thread failed")
        raise


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
        import webview

        webview.create_window(APP_TITLE, base_url, width=1280, height=860, min_size=(1024, 700))
        webview.start(debug=False)
    except Exception:
        logging.exception("桌面应用启动失败")
        raise
    finally:
        server.should_exit = True
        server_thread.join(timeout=5)


if __name__ == "__main__":
    run_desktop_app()
