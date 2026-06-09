import json
import zipfile
from pathlib import Path

import pytest

from backend.services import invoice_qr_runtime


def make_runtime_zip(path: Path, *, opencv_version: str = "4.10.0.84", numpy_version: str = "2.1.3") -> Path:
    model_files = [
        "wechat_qrcode/detect.prototxt",
        "wechat_qrcode/detect.caffemodel",
        "wechat_qrcode/sr.prototxt",
        "wechat_qrcode/sr.caffemodel",
    ]
    manifest = {
        "opencv_package_version": opencv_version,
        "numpy_version": numpy_version,
        "platform": "win_amd64",
        "model_files": model_files,
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("runtime.json", json.dumps(manifest))
        archive.writestr("cv2/__init__.py", "")
        archive.writestr("numpy/__init__.py", "")
        archive.writestr("numpy.libs/example.dll", b"")
        for model_file in model_files:
            archive.writestr(model_file, b"model")
    return path


def test_runtime_zip_name_uses_opencv_package_version():
    assert invoice_qr_runtime.runtime_zip_name("4.10.0.84") == "opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip"


def test_ensure_opencv_runtime_installed_extracts_local_package(monkeypatch, tmp_path):
    app_root = tmp_path / "app"
    app_root.mkdir()
    zip_path = make_runtime_zip(app_root / "opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip")
    monkeypatch.setattr(invoice_qr_runtime, "APP_ROOT", app_root)
    monkeypatch.setattr(invoice_qr_runtime, "OPENCV_RUNTIME_DIR", app_root / "vendor" / "opencv-wechat-runtime")

    installed = invoice_qr_runtime.ensure_opencv_runtime_installed()

    assert installed["opencv_package_version"] == "4.10.0.84"
    assert (app_root / "vendor" / "opencv-wechat-runtime" / "cv2" / "__init__.py").exists()
    assert (app_root / "vendor" / "opencv-wechat-runtime" / "wechat_qrcode" / "detect.prototxt").exists()
    assert zip_path.exists()


def test_ensure_opencv_runtime_installed_rejects_zip_slip(monkeypatch, tmp_path):
    app_root = tmp_path / "app"
    app_root.mkdir()
    with zipfile.ZipFile(app_root / "opencv-wechat-runtime-opencv-4.10.0.84-win_amd64.zip", "w") as archive:
        archive.writestr("runtime.json", "{}")
        archive.writestr("../escape.txt", "bad")
    monkeypatch.setattr(invoice_qr_runtime, "APP_ROOT", app_root)
    monkeypatch.setattr(invoice_qr_runtime, "OPENCV_RUNTIME_DIR", app_root / "vendor" / "opencv-wechat-runtime")

    with pytest.raises(RuntimeError, match="不安全"):
        invoice_qr_runtime.ensure_opencv_runtime_installed()

    assert not (tmp_path / "escape.txt").exists()


def test_cv2_safe_wechat_model_paths_copy_models_to_temp(monkeypatch, tmp_path):
    runtime_dir = tmp_path / "报销管理" / "vendor" / "opencv-wechat-runtime"
    model_dir = runtime_dir / "wechat_qrcode"
    model_dir.mkdir(parents=True)
    for name in ("detect.prototxt", "detect.caffemodel", "sr.prototxt", "sr.caffemodel"):
        (model_dir / name).write_bytes(name.encode("ascii"))
    safe_temp = tmp_path / "ascii-temp"
    monkeypatch.setattr(invoice_qr_runtime, "OPENCV_RUNTIME_DIR", runtime_dir)
    monkeypatch.setattr(invoice_qr_runtime.tempfile, "gettempdir", lambda: str(safe_temp))

    paths = invoice_qr_runtime.cv2_safe_wechat_model_paths()

    assert all(path.exists() for path in paths.values())
    assert all(str(path).startswith(str(safe_temp)) for path in paths.values())
