from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend.main import create_app
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


def test_release_script_can_build_optional_opencv_runtime_package():
    script = (Path(__file__).resolve().parents[1] / "scripts" / "build_release.ps1").read_text(encoding="utf-8")

    assert "[switch]$BuildOpenCvRuntime" in script
    assert "opencv-wechat-runtime-opencv-$OpenCvPackageVersion-win_amd64.zip" in script
    assert "opencv_package_version" in script
    assert "numpy_version" in script
    assert "docs\\archive\\wechat_qrcode" in script
