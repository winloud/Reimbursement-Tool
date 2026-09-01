# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

project_root = Path(SPECPATH).resolve()

datas = [
    (str(project_root / "frontend" / "dist"), "frontend/dist"),
    (str(project_root / "backend" / "templates"), "backend/templates"),
]

hiddenimports = [
    "uvicorn.lifespan.on",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
]

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
        "PIL.AvifImagePlugin",
        "PIL.ImageTk",
        "PIL._avif",
        "PIL._imagingtk",
        "Pythonwin",
        "cv2",
        "httptools",
        "jinja2",
        "matplotlib",
        "numpy",
        "openpyxl",
        "pandas",
        "pkg_resources.py2_warn",
        "pygments",
        "pytest",
        "scipy",
        "tkinter",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvloop",
        "watchfiles",
        "websockets",
        "webview.platforms.android",
        "webview.platforms.cef",
        "webview.platforms.cocoa",
        "webview.platforms.gtk",
        "webview.platforms.mshtml",
        "webview.platforms.qt",
        "win32ui",
        "wsproto",
    ],
    noarchive=False,
    optimize=0,
)
a.binaries = [
    item
    for item in a.binaries
    if "_avif" not in str(item[0]).lower()
    and "_avif" not in str(item[1]).lower()
    and "_imagingtk" not in str(item[0]).lower()
    and "_imagingtk" not in str(item[1]).lower()
    and "_multiarray_tests" not in str(item[0]).lower()
    and "_multiarray_tests" not in str(item[1]).lower()
    and "pythonwin" not in str(item[0]).lower()
    and "pythonwin" not in str(item[1]).lower()
    and "win32ui" not in str(item[0]).lower()
    and "win32ui" not in str(item[1]).lower()
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
