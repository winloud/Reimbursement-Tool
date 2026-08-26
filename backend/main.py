from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.app_metadata import APP_TITLE, APP_VERSION
from backend.database.connection import create_db_and_tables
from backend.middleware.session_auth import SessionAuthMiddleware
from backend.routers import data_transfer, health, invoices, maintenance, report_attachments, reports, settings, stats, tickets
from backend.runtime_paths import FRONTEND_DIST_DIR


def create_app(frontend_dist_dir: Path = FRONTEND_DIST_DIR, enable_startup: bool = True) -> FastAPI:
    app = FastAPI(title=APP_TITLE, version=APP_VERSION)

    # 会话鉴权先于 CORS：未授权请求不应拿到 CORS 响应头。
    # 放行 /api/health（sidecar 启动探活）与开发模式（未设令牌）。
    app.add_middleware(SessionAuthMiddleware)

    app.add_middleware(
        CORSMiddleware,
        # Tauri 桌面壳前端用 tauri://localhost（WebView2 经 http://tauri.localhost 代理）。
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if enable_startup:

        @app.on_event("startup")
        def on_startup() -> None:
            create_db_and_tables()

    app.include_router(health.router)
    app.include_router(settings.router)
    app.include_router(reports.router)
    app.include_router(invoices.router)
    app.include_router(report_attachments.router)
    app.include_router(tickets.router)
    app.include_router(stats.router)
    app.include_router(data_transfer.router)
    app.include_router(maintenance.router)

    mount_frontend(app, frontend_dist_dir)
    return app


def mount_frontend(app: FastAPI, frontend_dist_dir: Path) -> None:
    index_path = frontend_dist_dir / "index.html"
    if not index_path.exists():
        return

    static_root = frontend_dist_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
        candidate = (frontend_dist_dir / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(static_root):
            return FileResponse(candidate)
        return FileResponse(index_path)


app = create_app()
