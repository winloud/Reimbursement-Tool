from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend import app_metadata
from backend.main import create_app
from backend import runtime_paths
from backend.runtime_paths import uploaded_path


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


def test_frozen_app_root_detects_portable_install_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    exe_path = tmp_path / "报销管理" / "versions" / "1.2.0" / "报销管理.exe"
    exe_path.parent.mkdir(parents=True)
    exe_path.write_bytes(b"exe")
    monkeypatch.delenv("REIMBURSEMENT_APP_ROOT", raising=False)
    monkeypatch.setattr(runtime_paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime_paths.sys, "executable", str(exe_path))

    assert runtime_paths.app_root() == tmp_path / "报销管理"


def test_app_root_prefers_launcher_configured_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configured_root = tmp_path / "portable-root"
    monkeypatch.setenv("REIMBURSEMENT_APP_ROOT", str(configured_root))

    assert runtime_paths.app_root() == configured_root


def test_app_version_prefers_launcher_configured_version(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REIMBURSEMENT_APP_VERSION", "1.2.0")

    assert app_metadata.resolve_app_version() == "1.2.0"


def test_app_version_detects_portable_version_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    exe_path = tmp_path / "报销管理" / "versions" / "1.2.0" / "报销管理.exe"
    exe_path.parent.mkdir(parents=True)
    exe_path.write_bytes(b"exe")
    monkeypatch.delenv("REIMBURSEMENT_APP_VERSION", raising=False)
    monkeypatch.setattr(app_metadata.sys, "frozen", True, raising=False)
    monkeypatch.setattr(app_metadata.sys, "executable", str(exe_path))

    assert app_metadata.resolve_app_version() == "1.2.0"


def test_release_script_can_build_optional_opencv_runtime_package():
    script = (Path(__file__).resolve().parents[2] / "scripts" / "build_release.ps1").read_text(encoding="utf-8")

    assert "[switch]$BuildOpenCvRuntime" in script
    assert "[switch]$PreviewBuild" in script
    assert "[string]$PreviewSerial" in script
    assert "[switch]$TestBuild" in script
    assert "[string]$TestBuildSerial" in script
    assert "TestBuild is deprecated. Use -PreviewBuild and -PreviewSerial NNN." in script
    assert "$PreviewId = \"preview-$ReleaseDate-$PreviewSerial\"" in script
    assert '$ZipFileName = "{0}-{1}.zip" -f $AppName, $PreviewId' in script
    assert '$ZipFileName = "{0}-v{1}-{2}.zip" -f $AppName, $Version, $PreviewId' in script
    assert "PreviewSerial must be a three-digit daily serial" in script
    assert "Version is required for formal release builds. Use -PreviewBuild" in script
    assert "Compress-ArchiveWithRetry" in script
    assert "Compress-Archive failed on attempt" in script
    assert '$ZipFileName = "{0}-v{1}-{2}.zip" -f $AppName, $PackageVersion, $ReleaseDate' in script
    assert '$StageName = ".staging-{0}-{1}" -f $PackageVersion, $ReleaseDate' in script
    assert "[string]$ReleaseDate" in script
    assert "ReleaseDate must use yyyymmdd format" in script
    assert "reimbursement_launcher.spec" in script
    assert "portable-release.json" in script
    assert '"versions\\$PackageVersion"' in script
    assert "from backend.data_schema import DATA_SCHEMA_VERSION" in script
    assert "$DataSchemaVersion = [int]$DataSchemaInfo.data_schema_version" in script
    assert "$MinSupportedDataSchemaVersion = [int]$DataSchemaInfo.min_supported_data_schema_version" in script
    assert "$MaxSupportedDataSchemaVersion = [int]$DataSchemaInfo.max_supported_data_schema_version" in script
    assert "$DataSchemaVersion = 1" not in script
    assert "data_schema_version = $DataSchemaVersion" in script
    assert "min_supported_data_schema_version = $MinSupportedDataSchemaVersion" in script
    assert "max_supported_data_schema_version = $MaxSupportedDataSchemaVersion" in script
    assert "scripts\\upgrade_zip_release.ps1" in script
    assert '"browser-profile", "vendor"' in script
    assert "opencv-wechat-runtime-opencv-$OpenCvPackageVersion-win_amd64.zip" in script
    assert "opencv_package_version" in script
    assert "numpy_version" in script
    assert "assets\\opencv-wechat-qrcode" in script
    assert "docs\\archive\\wechat_qrcode" not in script
