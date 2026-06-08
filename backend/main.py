from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.database.connection import create_db_and_tables
from backend.routers import data_transfer, health, invoices, reports, settings, stats
from backend.runtime_paths import FRONTEND_DIST_DIR


def create_app(frontend_dist_dir: Path = FRONTEND_DIST_DIR, enable_startup: bool = True) -> FastAPI:
    app = FastAPI(title="出差旅费报销管理工具", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    app.include_router(stats.router)
    app.include_router(data_transfer.router)

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
