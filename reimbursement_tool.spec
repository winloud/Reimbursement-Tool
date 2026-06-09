# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


project_root = Path(SPECPATH).resolve()

datas = [
    (str(project_root / "frontend" / "dist"), "frontend/dist"),
    (str(project_root / "backend" / "templates"), "backend/templates"),
    (str(project_root / "backend" / "models" / "wechat_qrcode"), "backend/models/wechat_qrcode"),
]

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("webview")
    + [
        "uvicorn.lifespan.on",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
    ]
)

a = Analysis(
    ["desktop_app.py"],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "jinja2",
        "matplotlib",
        "openpyxl",
        "pandas",
        "pkg_resources.py2_warn",
        "pygments",
        "pytest",
        "scipy",
        "tkinter",
    ],
    noarchive=False,
    optimize=0,
)
a.binaries = [
    item
    for item in a.binaries
    if "opencv_videoio_ffmpeg" not in str(item[0]).lower()
    and "opencv_videoio_ffmpeg" not in str(item[1]).lower()
]
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="报销管理",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="报销管理",
)
