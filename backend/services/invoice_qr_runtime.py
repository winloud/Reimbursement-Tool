import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from backend.runtime_paths import APP_ROOT


INVOICE_QR_ENGINE_ZXING = "zxing"
INVOICE_QR_ENGINE_OPENCV_WECHAT = "opencv_wechat"
INVOICE_QR_ENGINES = {INVOICE_QR_ENGINE_ZXING, INVOICE_QR_ENGINE_OPENCV_WECHAT}
OPENCV_RUNTIME_DIR = APP_ROOT / "vendor" / "opencv-wechat-runtime"
OPENCV_RUNTIME_ZIP_PATTERN = "opencv-wechat-runtime-opencv-*-win_amd64.zip"
OPENCV_RUNTIME_PLATFORM = "win_amd64"
WECHAT_MODEL_FILES = [
    "wechat_qrcode/detect.prototxt",
    "wechat_qrcode/detect.caffemodel",
    "wechat_qrcode/sr.prototxt",
    "wechat_qrcode/sr.caffemodel",
]

_RUNTIME_ACTIVATED = False
_DLL_DIRECTORIES: list[Any] = []


def normalize_invoice_qr_engine(value: str | None) -> str:
    return value if value in INVOICE_QR_ENGINES else INVOICE_QR_ENGINE_ZXING


def runtime_zip_name(opencv_package_version: str) -> str:
    version = str(opencv_package_version or "").strip()
    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z._+-]*", version):
        raise ValueError("OpenCV package version is invalid")
    return f"opencv-wechat-runtime-opencv-{version}-{OPENCV_RUNTIME_PLATFORM}.zip"


def _runtime_manifest_path(runtime_dir: Path = OPENCV_RUNTIME_DIR) -> Path:
    return runtime_dir / "runtime.json"


def _read_manifest(runtime_dir: Path = OPENCV_RUNTIME_DIR) -> dict[str, Any]:
    manifest_path = _runtime_manifest_path(runtime_dir)
    if not manifest_path.exists():
        raise RuntimeError("OpenCV runtime 缺少 runtime.json")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"OpenCV runtime.json 无法读取：{exc}") from exc
    if not isinstance(manifest, dict):
        raise RuntimeError("OpenCV runtime.json 格式无效")
    return manifest


def _validate_runtime(runtime_dir: Path = OPENCV_RUNTIME_DIR) -> dict[str, Any]:
    manifest = _read_manifest(runtime_dir)
    if not manifest.get("opencv_package_version"):
        raise RuntimeError("OpenCV runtime.json 缺少 opencv_package_version")
    if manifest.get("platform") and manifest.get("platform") != OPENCV_RUNTIME_PLATFORM:
        raise RuntimeError(f"OpenCV runtime 平台不匹配：{manifest.get('platform')}")
    for required in ("cv2", "numpy"):
        if not (runtime_dir / required).exists():
            raise RuntimeError(f"OpenCV runtime 缺少 {required}")
    model_files = manifest.get("model_files") or WECHAT_MODEL_FILES
    for model_file in model_files:
        if not (runtime_dir / str(model_file)).exists():
            raise RuntimeError(f"OpenCV runtime 缺少模型文件：{model_file}")
    return manifest


def get_installed_opencv_runtime() -> dict[str, Any] | None:
    try:
        return _validate_runtime(OPENCV_RUNTIME_DIR)
    except RuntimeError:
        return None


def _find_runtime_zip() -> Path | None:
    candidates = sorted(APP_ROOT.glob(OPENCV_RUNTIME_ZIP_PATTERN), key=lambda item: item.name, reverse=True)
    return candidates[0] if candidates else None


def _assert_safe_zip_member(target_root: Path, member_name: str) -> Path:
    target = (target_root / member_name).resolve()
    root = target_root.resolve()
    if target != root and root not in target.parents:
        raise RuntimeError(f"OpenCV runtime 包含不安全路径：{member_name}")
    return target


def _remove_inside(path: Path, allowed_root: Path) -> None:
    if not path.exists():
        return
    resolved_path = path.resolve()
    resolved_root = allowed_root.resolve()
    if resolved_path != resolved_root and resolved_root not in resolved_path.parents:
        raise RuntimeError(f"拒绝删除运行目录外路径：{resolved_path}")
    shutil.rmtree(resolved_path)


def _extract_runtime_zip(zip_path: Path, target_dir: Path) -> None:
    temp_dir = target_dir.with_name(f".{target_dir.name}-installing")
    _remove_inside(temp_dir, APP_ROOT)
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as archive:
            for info in archive.infolist():
                _assert_safe_zip_member(temp_dir, info.filename)
            archive.extractall(temp_dir)
        _validate_runtime(temp_dir)
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        _remove_inside(target_dir, APP_ROOT)
        temp_dir.replace(target_dir)
    except Exception:
        _remove_inside(temp_dir, APP_ROOT)
        raise


def ensure_opencv_runtime_installed() -> dict[str, Any]:
    installed = get_installed_opencv_runtime()
    if installed is not None:
        return installed
    runtime_zip = _find_runtime_zip()
    if runtime_zip is None:
        raise RuntimeError(
            "未找到 OpenCV runtime 包，请将 "
            "opencv-wechat-runtime-opencv-<opencv_package_version>-win_amd64.zip 放到程序 EXE 同目录后重试"
        )
    try:
        _extract_runtime_zip(runtime_zip, OPENCV_RUNTIME_DIR)
        return _validate_runtime(OPENCV_RUNTIME_DIR)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"OpenCV runtime 安装失败：{exc}") from exc


def activate_opencv_runtime() -> dict[str, Any]:
    global _RUNTIME_ACTIVATED
    manifest = ensure_opencv_runtime_installed()
    if not _RUNTIME_ACTIVATED:
        runtime_dir = str(OPENCV_RUNTIME_DIR)
        if runtime_dir not in sys.path:
            sys.path.insert(0, runtime_dir)
        for dll_dir in (OPENCV_RUNTIME_DIR, OPENCV_RUNTIME_DIR / "numpy.libs"):
            if dll_dir.exists() and hasattr(os, "add_dll_directory"):
                _DLL_DIRECTORIES.append(os.add_dll_directory(str(dll_dir)))
        _RUNTIME_ACTIVATED = True
    return manifest


def wechat_model_paths() -> dict[str, Path]:
    return {
        "detect_prototxt": OPENCV_RUNTIME_DIR / "wechat_qrcode" / "detect.prototxt",
        "detect_model": OPENCV_RUNTIME_DIR / "wechat_qrcode" / "detect.caffemodel",
        "sr_prototxt": OPENCV_RUNTIME_DIR / "wechat_qrcode" / "sr.prototxt",
        "sr_model": OPENCV_RUNTIME_DIR / "wechat_qrcode" / "sr.caffemodel",
    }


def cv2_safe_wechat_model_paths() -> dict[str, Path]:
    source_paths = wechat_model_paths()
    safe_dir = Path(tempfile.gettempdir()) / "reimbursement-opencv-wechat-models"
    safe_dir.mkdir(parents=True, exist_ok=True)
    safe_paths = {
        "detect_prototxt": safe_dir / "detect.prototxt",
        "detect_model": safe_dir / "detect.caffemodel",
        "sr_prototxt": safe_dir / "sr.prototxt",
        "sr_model": safe_dir / "sr.caffemodel",
    }
    for key, source in source_paths.items():
        target = safe_paths[key]
        if not target.exists() or target.stat().st_size != source.stat().st_size:
            shutil.copy2(source, target)
    return safe_paths
