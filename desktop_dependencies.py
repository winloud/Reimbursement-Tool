from __future__ import annotations

import ctypes
import logging
import subprocess
import tempfile
import urllib.request
from pathlib import Path


WEBVIEW2_BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"


def show_error_message(title: str, message: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)


def is_webview2_installed() -> bool:
    try:
        import winreg
    except ImportError:
        return False

    roots = [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]
    paths = [
        r"Software\Microsoft\EdgeUpdate\Clients",
        r"Software\WOW6432Node\Microsoft\EdgeUpdate\Clients",
    ]
    for root in roots:
        for clients_path in paths:
            try:
                with winreg.OpenKey(root, clients_path) as clients_key:
                    subkey_count, _value_count, _modified = winreg.QueryInfoKey(clients_key)
                    for index in range(subkey_count):
                        subkey_name = winreg.EnumKey(clients_key, index)
                        with winreg.OpenKey(clients_key, subkey_name) as client_key:
                            name = _query_registry_string(client_key, "name").lower()
                            version = _query_registry_string(client_key, "pv")
                            if "webview2" in name and version.strip():
                                logging.info("webview2 runtime registry entry found version=%s", version)
                                return True
            except OSError:
                continue
    return False


def _query_registry_string(key, value_name: str) -> str:
    import winreg

    try:
        value, _kind = winreg.QueryValueEx(key, value_name)
        return str(value or "")
    except OSError:
        return ""


def can_import_webview() -> bool:
    try:
        import webview  # noqa: F401

        return True
    except Exception:
        logging.exception("pywebview import failed")
        return False


def is_webview2_available() -> bool:
    if is_webview2_installed():
        return True
    if can_import_webview():
        logging.info("pywebview import is available; continuing without registry match")
        return True
    return False


def install_webview2() -> bool:
    logging.info("webview2 runtime not found; downloading evergreen bootstrapper")
    installer_path = Path(tempfile.gettempdir()) / "MicrosoftEdgeWebView2Setup.exe"
    urllib.request.urlretrieve(WEBVIEW2_BOOTSTRAPPER_URL, installer_path)

    logging.info("running webview2 installer path=%s", installer_path)
    completed = subprocess.run(
        [str(installer_path), "/silent", "/install"],
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW,
        timeout=300,
    )
    logging.info("webview2 installer finished returncode=%s", completed.returncode)
    return is_webview2_available()


def ensure_runtime_dependencies() -> None:
    if is_webview2_available():
        logging.info("webview2 runtime detected")
        return

    try:
        if install_webview2():
            logging.info("webview2 runtime installed")
            return
    except Exception:
        logging.exception("webview2 runtime installation failed")

    message = (
        "未检测到 Microsoft Edge WebView2 Runtime，且自动安装失败。\n\n"
        "请联网后重新启动本程序，或手动安装 WebView2 Evergreen Runtime 后再运行。"
    )
    show_error_message("缺少运行依赖", message)
    raise RuntimeError("Microsoft Edge WebView2 Runtime is required")
