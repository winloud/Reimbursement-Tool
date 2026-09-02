"""PyInstaller API sidecar 入口。

由 Tauri（Rust）以子进程方式启动，只提供 HTTP API，不再携带前端和 pywebview。
启动契约：
  - sidecar 入口明确设置 REIMBURSEMENT_DISTRIBUTION_TARGET=tauri。
  - 环境变量 REIMBURSEMENT_APP_ROOT 指向运行数据根（复用 runtime_paths.app_root）。
  - 环境变量 REIMBURSEMENT_APP_VERSION 为当前版本号。
  - 环境变量 REIMBURSEMENT_SESSION_TOKEN 为随机会话令牌，用于本机 API 鉴权。
  - --port 0 让 OS 分配随机本机端口。
  - 启动并健康检查通过后，向 stdout 输出唯一一行 ready JSON：
      {"event":"ready","api_base_url":"http://127.0.0.1:<port>"}
    stdout 必须只含这一行：uvicorn 日志重定向到文件，access_log 关闭。
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn

# sidecar 入口明确声明 Tauri Target；源码直跑仅保留显式标记的开发 fallback。
os.environ["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "tauri"
if not getattr(sys, "frozen", False):
    os.environ.setdefault("REIMBURSEMENT_ALLOW_TAURI_SOURCE_FALLBACK", "1")

from backend.main import create_app
from backend.runtime_paths import APP_ROOT, LOG_DIR

HOST = "127.0.0.1"
HEALTH_TIMEOUT_SECONDS = 20.0


def configure_logging() -> None:
    """sidecar 日志写文件，避免污染 stdout（stdout 只留给 ready JSON）。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_DIR / "sidecar.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def bind_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_until_ready(base_url: str) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError("sidecar 健康检查超时") from last_error


def emit_ready(port: int) -> None:
    payload = {"event": "ready", "api_base_url": f"http://{HOST}:{port}"}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(prog="reimbursement-sidecar")
    parser.add_argument("--port", type=int, default=0, help="0 表示由 OS 分配随机端口")
    args = parser.parse_args()

    os.environ["REIMBURSEMENT_DESKTOP_MODE"] = "1"
    configure_logging()
    logging.info(
        "starting sidecar app_root=%s version=%s token_set=%s",
        APP_ROOT,
        os.environ.get("REIMBURSEMENT_APP_VERSION", "unknown"),
        bool(os.environ.get("REIMBURSEMENT_SESSION_TOKEN")),
    )

    port = args.port if args.port > 0 else bind_free_port()
    app = create_app(enable_startup=True)
    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        log_level="warning",
        access_log=False,
        log_config=None,
        http="h11",
        loop="asyncio",
        ws="none",
    )
    server = uvicorn.Server(config)

    server_thread_started = False

    def run_server() -> None:
        nonlocal server_thread_started
        server_thread_started = True
        try:
            server.run()
        except Exception:
            logging.exception("sidecar uvicorn server failed")
            raise

    import threading

    thread = threading.Thread(target=run_server, name="sidecar-uvicorn", daemon=True)
    thread.start()

    base_url = f"http://{HOST}:{port}"
    try:
        wait_until_ready(base_url)
        emit_ready(port)
        logging.info("sidecar ready url=%s", base_url)
        # 等待 server 退出（由 Tauri 通过终止进程来结束）
        while server_thread_started and thread.is_alive():
            thread.join(timeout=1.0)
    except Exception:
        logging.exception("sidecar 启动失败")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
