from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend import app_metadata
from backend.distribution import DISTRIBUTION_TARGET_ENV, TAURI_SOURCE_FALLBACK_ENV
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
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.setenv("REIMBURSEMENT_APP_ROOT", str(configured_root))
    monkeypatch.delattr(runtime_paths.sys, "frozen", raising=False)

    assert runtime_paths.app_root() == configured_root
    assert runtime_paths.upload_root() == configured_root / "uploads"


def test_source_upload_root_falls_back_without_tauri_injection(monkeypatch: pytest.MonkeyPatch):
    """普通源码开发未注入 Tauri runtime 时继续使用仓库内的上传目录。"""
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.delattr(runtime_paths.sys, "frozen", raising=False)

    assert runtime_paths.upload_root() == ROOT / "backend" / "uploads"


def test_frozen_tauri_sidecar_rejects_missing_runtime_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """冻结 Tauri sidecar 不得静默回退到安装目录或 ZIP 目录。"""
    exe_dir = tmp_path / "reimbursement-sidecar"
    exe_dir.mkdir(parents=True)
    exe_path = exe_dir / "reimbursement-sidecar.exe"
    exe_path.write_bytes(b"exe")
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.setattr(runtime_paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime_paths.sys, "executable", str(exe_path))

    with pytest.raises(RuntimeError, match="拒绝回退到 ZIP"):
        runtime_paths.app_root()
    with pytest.raises(RuntimeError, match="拒绝回退到 ZIP"):
        runtime_paths.upload_root()


def test_tauri_source_fallback_requires_explicit_development_flag(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.setenv(TAURI_SOURCE_FALLBACK_ENV, "1")
    monkeypatch.delattr(runtime_paths.sys, "frozen", raising=False)

    assert runtime_paths.app_root() == ROOT
    assert runtime_paths.upload_root() == ROOT / "backend" / "uploads"


def test_frozen_zip_app_root_detects_portable_install_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    exe_path = tmp_path / "报销管理" / "versions" / "1.4.2" / "报销管理.exe"
    exe_path.parent.mkdir(parents=True)
    exe_path.write_bytes(b"exe")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.setattr(runtime_paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime_paths.sys, "executable", str(exe_path))

    assert runtime_paths.app_root() == tmp_path / "报销管理"


def test_app_version_prefers_tauri_injected_version(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.setenv("REIMBURSEMENT_APP_VERSION", "2.0.0")

    assert app_metadata.resolve_app_version() == "2.0.0"


def test_app_version_falls_back_to_default_without_injection(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    monkeypatch.delenv("REIMBURSEMENT_APP_VERSION", raising=False)

    assert app_metadata.resolve_app_version() == app_metadata.DEFAULT_APP_VERSION


def test_zip_app_version_detects_portable_version_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    exe_path = tmp_path / "报销管理" / "versions" / "1.4.2-preview-20260901-001" / "报销管理.exe"
    exe_path.parent.mkdir(parents=True)
    exe_path.write_bytes(b"exe")
    monkeypatch.delenv("REIMBURSEMENT_APP_VERSION", raising=False)
    monkeypatch.setattr(app_metadata.sys, "frozen", True, raising=False)
    monkeypatch.setattr(app_metadata.sys, "executable", str(exe_path))

    assert app_metadata.resolve_app_version() == "1.4.2-preview-20260901-001"


def test_frozen_tauri_sidecar_rejects_missing_app_version(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.delenv("REIMBURSEMENT_APP_VERSION", raising=False)
    monkeypatch.setattr(app_metadata.sys, "frozen", True, raising=False)

    with pytest.raises(RuntimeError, match="REIMBURSEMENT_APP_VERSION"):
        app_metadata.resolve_app_version()


def test_sidecar_spec_excludes_frontend_and_pywebview():
    spec = (ROOT / "reimbursement_sidecar.spec").read_text(encoding="utf-8")

    assert '["sidecar_app.py"]' in spec
    assert "frontend" not in spec.split("datas = [", 1)[1].split("]", 1)[0]
    assert '"webview"' in spec
    assert "console=True" in spec
    assert 'name="reimbursement-sidecar"' in spec


def test_packaging_requirements_support_both_desktop_targets():
    requirements = (ROOT / "backend" / "requirements-packaging.txt").read_text(encoding="utf-8")

    assert "pyinstaller" in requirements
    assert "pywebview" in requirements


def test_tauri_build_script_stages_sidecar_and_generates_feed():
    script = (ROOT / "scripts" / "build_tauri_release.ps1").read_text(encoding="utf-8")

    assert "reimbursement_sidecar.spec" in script
    assert 'Join-Path $Root "src-tauri\\resources\\reimbursement-sidecar"' in script
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
    # OpenCV 包保持独立，不绑定任一桌面壳或便携 manifest。
    assert "reimbursement_launcher.spec" not in script
    assert "portable-release.json" not in script
    assert "versions" not in script


def test_zip_and_tauri_packaging_chains_coexist():
    for zip_asset in (
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
        assert (ROOT / zip_asset).exists(), f"ZIP target asset is missing: {zip_asset}"

    for tauri_asset in (
        "sidecar_app.py",
        "reimbursement_sidecar.spec",
        "scripts/build_tauri_release.ps1",
        "scripts/validate_tauri_release.ps1",
        "src-tauri/tauri.conf.json",
    ):
        assert (ROOT / tauri_asset).exists(), f"Tauri target asset is missing: {tauri_asset}"


def test_zip_build_script_keeps_the_v142_portable_contract():
    script = (ROOT / "scripts" / "build_release.ps1").read_text(encoding="utf-8-sig")

    assert "reimbursement_tool.spec" in script
    assert "reimbursement_launcher.spec" in script
    assert "portable-release.json" in script
    assert '"versions\\$PackageVersion"' in script
    assert "scripts\\upgrade_zip_release.ps1" in script
    assert "data_schema_version = $DataSchemaVersion" in script


def test_target_build_outputs_are_separate():
    zip_script = (ROOT / "scripts" / "build_release.ps1").read_text(encoding="utf-8-sig")
    tauri_script = (ROOT / "scripts" / "build_tauri_release.ps1").read_text(encoding="utf-8-sig")
    orchestrator = (ROOT / "scripts" / "build_target.ps1").read_text(encoding="utf-8-sig")

    assert '[string]$IntermediateRoot' in zip_script
    assert 'Join-Path $Root "release"' in zip_script
    assert '[string]$IntermediateRoot' in tauri_script
    assert 'Join-Path $TauriSrcDir "target\\release\\bundle\\nsis"' in tauri_script
    assert 'Join-Path $Root "dist-feed"' in tauri_script
    assert 'Join-Path $OutputRoot "zip"' in orchestrator
    assert 'Join-Path $OutputRoot "tauri\\online"' in orchestrator
    assert 'Join-Path $OutputRoot "tauri\\offline"' in orchestrator
    assert 'Join-Path $OutputRoot "tauri\\updater"' in orchestrator
