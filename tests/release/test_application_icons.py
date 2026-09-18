import ast
import json
import struct
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]


def test_windows_icon_frames_match_their_directory_sizes():
    path = ROOT / "src-tauri/icons/icon.ico"
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data)
    assert (reserved, kind) == (0, 1)
    with Image.open(path) as icon:
        assert icon.ico.sizes() == {(s, s) for s in (16, 24, 32, 48, 64, 128, 256)}
        for index in range(count):
            width, height = struct.unpack_from("BB", data, 6 + index * 16)
            size = (width or 256, height or 256)
            assert icon.ico.getimage(size).size == size
    assert (ROOT / "frontend/public/favicon.ico").read_bytes() == data
    with Image.open(ROOT / "src-tauri/icons/icon.png") as image:
        assert image.size == (512, 512)
        assert image.mode == "RGBA"


def test_packagers_reference_existing_application_icons():
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    bundle = config["bundle"]
    assert "icons/icon.ico" in bundle["icon"]
    for path in [*bundle["icon"], bundle["windows"]["nsis"]["installerIcon"], bundle["windows"]["nsis"]["uninstallerIcon"]]:
        assert (ROOT / "src-tauri" / path).is_file()
    for spec in ("reimbursement_launcher.spec", "reimbursement_tool.spec"):
        tree = ast.parse((ROOT / spec).read_text(encoding="utf-8"))
        exe = next(node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "EXE")
        icon = next(keyword.value for keyword in exe.keywords if keyword.arg == "icon")
        icon_path = eval(compile(ast.Expression(icon), spec, "eval"), {"str": str, "project_root": ROOT})
        assert Path(icon_path) == ROOT / "src-tauri/icons/icon.ico"
