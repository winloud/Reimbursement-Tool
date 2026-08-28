from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend import app_metadata
from backend.main import create_app
from backend import runtime_paths
from backend.runtime_paths import uploaded_path


ROOT = Path(__file__).resolve().parents[2]


def test_frontend_static_files_and_spa_fallback(tmp_path: Path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html><body>app shell</body></html>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")

    app = create_app(frontend_dist_dir=tmp_path, enable_startup=False)
    route = next(route for route in app.routes if getattr(route, "path", "") == "/{full_path:path}")

    root_response = route.endpoint("")
    nested_response = route.endpoint("reports/42/edit")
    asset_response = route.endpoint("assets/app.js")

    assert isinstance(root_response, FileResponse)
    assert Path(root_response.path) == tmp_path / "index.html"
    assert Path(nested_response.path) == tmp_path / "index.html"
    assert Path(asset_response.path) == tmp_path / "assets" / "app.js"
    with pytest.raises(HTTPException) as exc_info:
        route.endpoint("api/not-found")
    assert exc_info.value.status_code == 404


def test_uploaded_path_uses_runtime_upload_root(tmp_path: Path):
    assert uploaded_path("uploads/8/invoice.pdf", tmp_path) == tmp_path / "8" / "invoice.pdf"
    assert uploaded_path("8/invoice.pdf", tmp_path) == tmp_path / "8" / "invoice.pdf"


def test_app_root_prefers_tauri_injected_runtime_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Tauri 通过 REIMBURSEMENT_APP_ROOT 注入 AppLocalData runtime 目录（ADR 0009）。"""
    configured_root = tmp_path / "runtime"
    monkeypatch.setenv("REIMBURSEMENT_APP_ROOT", str(configured_root))

    assert runtime_paths.app_root() == configured_root


def test_frozen_app_root_falls_back_to_executable_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """缺少注入变量时冻结 sidecar 回退到 exe 目录，不再解析旧 versions/ 布局。"""
    exe_dir = tmp_path / "reimbursement-sidecar"
    exe_dir.mkdir(parents=True)
    exe_path = exe_dir / "reimbursement-sidecar.exe"
    exe_path.write_bytes(b"exe")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.setattr(runtime_paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime_paths.sys, "executable", str(exe_path))

    assert runtime_paths.app_root() == exe_dir


def test_app_version_prefers_tauri_injected_version(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REIMBURSEMENT_APP_VERSION", "2.0.0")

    assert app_metadata.resolve_app_version() == "2.0.0"


def test_app_version_falls_back_to_default_without_injection(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("REIMBURSEMENT_APP_VERSION", raising=False)

    assert app_metadata.resolve_app_version() == app_metadata.DEFAULT_APP_VERSION


def test_sidecar_spec_excludes_frontend_and_pywebview():
    spec = (ROOT / "reimbursement_sidecar.spec").read_text(encoding="utf-8")

    assert '["sidecar_app.py"]' in spec
    assert "frontend" not in spec.split("datas = [", 1)[1].split("]", 1)[0]
    assert '"webview"' in spec
    assert "console=True" in spec
    assert 'name="reimbursement-sidecar"' in spec


def test_packaging_requirements_drop_pywebview():
    requirements = (ROOT / "backend" / "requirements-packaging.txt").read_text(encoding="utf-8")

    assert "pyinstaller" in requirements
    assert "pywebview" not in requirements


def test_tauri_build_script_stages_sidecar_and_generates_feed():
    script = (ROOT / "scripts" / "build_tauri_release.ps1").read_text(encoding="utf-8")

    assert "reimbursement_sidecar.spec" in script
    assert "src-tauri\\resources\\reimbursement-sidecar" in script
    assert '"tauri", "build"' in script
    assert "offlineInstaller" in script
    assert "generate_updater_feed.ps1" in script
    assert "TAURI_SIGNING_PRIVATE_KEY_PATH" in script


def test_opencv_runtime_script_is_standalone():
    script = (ROOT / "scripts" / "build_opencv_runtime.ps1").read_text(encoding="utf-8")

    assert "[string]$OpenCvPackageVersion" in script
    assert "opencv-wechat-runtime-opencv-$ActualOpenCvPackageVersion-win_amd64.zip" in script
    assert "opencv_package_version" in script
    assert "numpy_version" in script
    assert "assets\\opencv-wechat-qrcode" in script
    # 便携 ZIP 链路已删除，运行时包脚本不得再引用 launcher/versions/portable manifest。
    assert "reimbursement_launcher.spec" not in script
    assert "portable-release.json" not in script
    assert "versions" not in script


def test_legacy_portable_zip_chain_is_removed():
    for legacy in (
        "desktop_app.py",
        "desktop_dependencies.py",
        "portable_launcher.py",
        "reimbursement_launcher.spec",
        "reimbursement_tool.spec",
        "backend/services/desktop_restart_service.py",
        "scripts/build_release.ps1",
        "scripts/upgrade_zip_release.ps1",
        "docs/zip-upgrade-guide.md",
    ):
        assert not (ROOT / legacy).exists(), f"legacy portable ZIP chain file still present: {legacy}"
