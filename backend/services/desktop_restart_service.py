from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable


DESKTOP_BROWSER_PID_ENV = "REIMBURSEMENT_BROWSER_PID"


def _read_desktop_browser_pid() -> int | None:
    value = os.environ.get(DESKTOP_BROWSER_PID_ENV)
    if not value:
        return None
    try:
        pid = int(value)
    except ValueError:
        return None
    return pid if pid > 0 else None


def _post_close_to_process_windows(pid: int) -> int:
    if sys.platform != "win32":
        return 0

    try:
        import ctypes
        from ctypes import wintypes
    except ImportError:
        return 0

    user32 = ctypes.windll.user32
    wm_close = 0x0010
    closed_count = 0

    def enum_handler(hwnd, _lparam):
        nonlocal closed_count
        if not user32.IsWindowVisible(hwnd):
            return True

        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        if int(process_id.value) != pid:
            return True

        user32.PostMessageW(hwnd, wm_close, 0, 0)
        closed_count += 1
        return True

    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(enum_handler)
    user32.EnumWindows(callback, 0)
    return closed_count


def _wait_for_process_exit(pid: int, timeout_seconds: float) -> bool:
    if sys.platform != "win32":
        return False

    try:
        import ctypes
    except ImportError:
        return False

    kernel32 = ctypes.windll.kernel32
    synchronize = 0x00100000
    wait_object_0 = 0x00000000
    handle = kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        return False
    try:
        result = kernel32.WaitForSingleObject(handle, int(timeout_seconds * 1000))
        return result == wait_object_0
    finally:
        kernel32.CloseHandle(handle)


def _terminate_process_tree(pid: int, timeout_seconds: float = 3.0) -> bool:
    if sys.platform != "win32":
        return False

    try:
        result = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def close_desktop_browser_window(wait_seconds: float = 4.0) -> bool:
    pid = _read_desktop_browser_pid()
    if pid is None:
        return False

    posted_count = _post_close_to_process_windows(pid)
    if posted_count and _wait_for_process_exit(pid, wait_seconds):
        return True

    return _terminate_process_tree(pid)


def schedule_application_restart(
    launcher_path: Path,
    *,
    app_root: Path,
    delay_seconds: float = 0.8,
    close_browser: Callable[[], bool] = close_desktop_browser_window,
) -> None:
    def restart_after_response() -> None:
        time.sleep(delay_seconds)
        close_browser()
        try:
            subprocess.Popen(
                [str(launcher_path)],
                cwd=str(app_root),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            return
        os._exit(0)

    thread = threading.Thread(target=restart_after_response, name="maintenance-restart", daemon=False)
    thread.start()
