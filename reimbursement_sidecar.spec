# -*- mode: python ; coding: utf-8 -*-

# Tauri sidecar spec。
#
# 入口 sidecar_app.py：只提供 HTTP API，不携带前端和 pywebview。
# 前端由 Tauri 打包（frontend/dist），不进 PyInstaller 产物。
# onedir 产物经 Tauri bundle.resources 装入 NSIS，由 Rust 端 spawn 启动。
#
# ZIP Target 继续使用 reimbursement_tool.spec（desktop_app.py）与
# reimbursement_launcher.spec；本 spec 仅用于并行的 Tauri sidecar：
# - 入口：sidecar_app.py（非 desktop_app.py）
# - datas：移除 frontend/dist（前端由 Tauri 打包）
# - hiddenimports：移除 webview.*（不依赖 pywebview）
# - excludes：加 pywebview/webview

from pathlib import Path

project_root = Path(SPECPATH).resolve()

datas = [
    (str(project_root / "backend" / "templates"), "backend/templates"),
]

hiddenimports = [
    "uvicorn.lifespan.on",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.h11_impl",
]

a = Analysis(
    ["sidecar_app.py"],
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
        "webview",
        "webview.platforms.android",
        "webview.platforms.cef",
        "webview.platforms.cocoa",
        "webview.platforms.gtk",
        "webview.platforms.mshtml",
        "webview.platforms.qt",
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
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
    # 移除 pywebview 相关二进制
    and "webview" not in str(item[0]).lower()
    and "webview" not in str(item[1]).lower()
    and "clr" not in str(item[0]).lower()
    and "pythonnet" not in str(item[0]).lower()
]
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="reimbursement-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # console=True：sidecar 靠 sys.stdout 输出 ready JSON 握手，Rust 端读它判定就绪。
    # windowed/noconsole 模式下 sys.stdout 为 None，握手无法完成。
    # sidecar 是后台子进程，console 不会闪窗（无独立窗口，Tauri 管窗口）。
    console=True,
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
    name="reimbursement-sidecar",
)
