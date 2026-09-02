from __future__ import annotations

import json
import os
import subprocess
import sys
import ctypes
from pathlib import Path


APP_EXE_NAME = "报销管理.exe"
CURRENT_VERSION_FILE = "current-version.json"


def _show_error(message: str) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, message, "报销管理启动失败", 0x10)
    except Exception:
        pass


def _launcher_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _read_current_version(root: Path) -> str:
    current_path = root / CURRENT_VERSION_FILE
    try:
        payload = json.loads(current_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取当前版本文件：{current_path}") from exc

    version = payload.get("current_version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError(f"当前版本文件格式无效：{current_path}")
    if any(part in version for part in ("/", "\\", "..")):
        raise RuntimeError(f"当前版本号无效：{version}")
    return version


def _resolve_version_exe(root: Path, version: str) -> Path:
    exe_path = root / "versions" / version / APP_EXE_NAME
    if not exe_path.is_file():
        raise RuntimeError(f"当前版本程序不存在：{exe_path}")
    return exe_path


def main() -> int:
    root = _launcher_root()
    try:
        version = _read_current_version(root)
        exe_path = _resolve_version_exe(root, version)
        env = os.environ.copy()
        env["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "zip"
        env["REIMBURSEMENT_APP_ROOT"] = str(root)
        env["REIMBURSEMENT_APP_VERSION"] = version
        subprocess.Popen([str(exe_path)], cwd=str(root), env=env)
    except Exception as exc:
        _show_error(str(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
