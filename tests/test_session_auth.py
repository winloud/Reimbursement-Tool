"""会话鉴权中间件测试。"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.distribution import DISTRIBUTION_TARGET_ENV
from backend.middleware.session_auth import SESSION_ENV, SESSION_HEADER, SessionAuthMiddleware


def _make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/reports")
    def reports() -> dict:
        return {"data": []}

    return app


@pytest.fixture()
def app():
    return _make_app()


@pytest.fixture()
def client(app):
    return TestClient(app)


def test_no_token_env_allows_all(client, monkeypatch):
    """开发模式（未设 REIMBURSEMENT_SESSION_TOKEN）放行全部请求。"""
    monkeypatch.delenv(SESSION_ENV, raising=False)
    app = _make_app()
    app.add_middleware(SessionAuthMiddleware)
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/reports").status_code == 200


def test_health_is_public_when_token_set(client, monkeypatch):
    """令牌已设时 /api/health 仍可匿名访问（sidecar 启动探活）。"""
    monkeypatch.setenv(SESSION_ENV, "secret-token")
    app = _make_app()
    app.add_middleware(SessionAuthMiddleware)
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200


def test_protected_route_requires_token(client, monkeypatch):
    monkeypatch.setenv(SESSION_ENV, "secret-token")
    app = _make_app()
    app.add_middleware(SessionAuthMiddleware)
    with TestClient(app) as c:
        response = c.get("/api/reports")
        assert response.status_code == 401


def test_protected_route_rejects_wrong_token(client, monkeypatch):
    monkeypatch.setenv(SESSION_ENV, "secret-token")
    app = _make_app()
    app.add_middleware(SessionAuthMiddleware)
    with TestClient(app) as c:
        response = c.get("/api/reports", headers={SESSION_HEADER: "wrong"})
        assert response.status_code == 401


def test_protected_route_accepts_correct_token(client, monkeypatch):
    monkeypatch.setenv(SESSION_ENV, "secret-token")
    app = _make_app()
    app.add_middleware(SessionAuthMiddleware)
    with TestClient(app) as c:
        response = c.get("/api/reports", headers={SESSION_HEADER: "secret-token"})
        assert response.status_code == 200


def test_zip_maintenance_routes_are_registered_without_tauri_token(monkeypatch, tmp_path):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    monkeypatch.delenv(SESSION_ENV, raising=False)

    app = create_app(frontend_dist_dir=tmp_path, enable_startup=False)
    paths = {route.path for route in app.routes}

    assert "/api/maintenance/info" in paths
    assert "/api/maintenance/updates/preview" in paths
    assert "/api/maintenance/versions/switch" in paths
    assert "/api/maintenance/restart" in paths


def test_tauri_target_disables_zip_maintenance_routes(monkeypatch, tmp_path):
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.setenv(SESSION_ENV, "secret-token")

    app = create_app(frontend_dist_dir=tmp_path, enable_startup=False)
    paths = {route.path for route in app.routes}

    assert "/api/maintenance/info" in paths
    assert "/api/maintenance/updates/preview" not in paths
    assert "/api/maintenance/versions/switch" not in paths
    assert "/api/maintenance/restart" not in paths


def test_zip_target_with_session_auth_keeps_zip_routes(monkeypatch, tmp_path):
    """Target 决定 router；token 只决定请求是否需要鉴权。"""
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "zip")
    monkeypatch.setenv(SESSION_ENV, "secret-token")

    app = create_app(frontend_dist_dir=tmp_path, enable_startup=False)
    paths = {route.path for route in app.routes}

    assert "/api/maintenance/updates/preview" in paths
    with TestClient(app) as client:
        assert client.get("/openapi.json").status_code == 401
        assert client.get("/openapi.json", headers={SESSION_HEADER: "secret-token"}).status_code == 200


def test_tauri_target_without_session_token_still_hides_zip_routes(monkeypatch, tmp_path):
    """异常缺 token 时也绝不能把 Tauri 误判成 ZIP。"""
    monkeypatch.setenv(DISTRIBUTION_TARGET_ENV, "tauri")
    monkeypatch.delenv(SESSION_ENV, raising=False)

    app = create_app(frontend_dist_dir=tmp_path, enable_startup=False)
    paths = {route.path for route in app.routes}

    assert "/api/maintenance/info" in paths
    assert "/api/maintenance/updates/preview" not in paths
    assert "/api/maintenance/versions/switch" not in paths
    with TestClient(app) as client:
        assert client.get("/openapi.json").status_code == 200
