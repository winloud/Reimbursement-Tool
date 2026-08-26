"""会话鉴权中间件测试。"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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
