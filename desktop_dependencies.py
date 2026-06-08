from __future__ import annotations

import ctypes
import logging
import os
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


def is_webview2_available() -> bool:
    return is_webview2_installed()


def find_chromium_browser() -> tuple[str, Path] | None:
    candidates = [
        ("Google Chrome", _app_path_from_registry("chrome.exe")),
        ("Microsoft Edge", _app_path_from_registry("msedge.exe")),
        *[(name, path) for name, path in _default_chromium_paths()],
    ]
    seen: set[Path] = set()
    for name, path in candidates:
        if path is None:
            continue
        normalized = path.resolve()
        if normalized in seen:
            continue
        seen.add(normalized)
        if normalized.exists():
            logging.info("chromium browser found name=%s path=%s", name, normalized)
            return name, normalized
    return None


def _default_chromium_paths() -> list[tuple[str, Path]]:
    roots = [
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LocalAppData"),
    ]
    paths: list[tuple[str, Path]] = []
    for root in roots:
        if not root:
            continue
        base = Path(root)
        paths.extend(
            [
                ("Google Chrome", base / "Google" / "Chrome" / "Application" / "chrome.exe"),
                ("Microsoft Edge", base / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
            ]
        )
    return paths


def _app_path_from_registry(exe_name: str) -> Path | None:
    try:
        import winreg
    except ImportError:
        return None

    roots = [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"
    for root in roots:
        try:
            with winreg.OpenKey(root, key_path) as key:
                value = _query_registry_string(key, "")
                if value.strip():
                    return Path(value)
        except OSError:
            continue
    return None


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
    return is_webview2_installed()


def ensure_runtime_dependencies() -> None:
    browser = find_chromium_browser()
    if browser is not None and browser[0] == "Google Chrome":
        logging.info("google chrome runtime detected")
        return
    if is_webview2_available():
        logging.info("webview2 runtime detected")
        return

    try:
        if install_webview2():
            logging.info("webview2 runtime installed")
            return
        browser = find_chromium_browser()
        if browser is not None:
            logging.info("webview2 installation did not verify; chromium browser fallback is available name=%s", browser[0])
            return
    except Exception:
        logging.exception("webview2 runtime installation failed")
        browser = find_chromium_browser()
        if browser is not None:
            logging.info("continuing with chromium browser fallback after webview2 installation failure name=%s", browser[0])
            return

    message = (
        "未检测到 Microsoft Edge WebView2 Runtime，也未找到 Google Chrome 或 Microsoft Edge 浏览器。\n\n"
        "请联网后重新启动本程序，或手动安装 WebView2 Evergreen Runtime / Google Chrome / Microsoft Edge 后再运行。"
    )
    show_error_message("缺少运行依赖", message)
    raise RuntimeError("Chromium runtime is required")
