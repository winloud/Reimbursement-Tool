from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database.connection import create_db_and_tables
from backend.routers import health, invoices, reports, settings, stats

app = FastAPI(title="出差旅费报销管理工具", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


app.include_router(health.router)
app.include_router(settings.router)
app.include_router(reports.router)
app.include_router(invoices.router)
app.include_router(stats.router)
