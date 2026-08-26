"""Tauri sidecar 会话鉴权中间件。

sidecar 启动时由 Rust 注入环境变量 REIMBURSEMENT_SESSION_TOKEN。
本中间件对除 /api/health 外的所有请求校验 X-Session-Token 头，
防止本地随机端口被其他进程探测后直接调用 API。

开发模式（未设 REIMBURSEMENT_SESSION_TOKEN 环境变量）放行全部请求，
这样后端单测和直接调 python -m backend.main 的场景不受影响。
"""
from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

SESSION_HEADER = "X-Session-Token"
SESSION_ENV = "REIMBURSEMENT_SESSION_TOKEN"
# 健康检查与 OPTIONS 预检放行：sidecar 启动时 Rust 探活 /api/health，此时前端未带令牌。
PUBLIC_PATHS = {"/api/health"}


class SessionAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        expected = os.environ.get(SESSION_ENV)
        if not expected:
            # 开发模式无令牌，放行。
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        provided = request.headers.get(SESSION_HEADER)
        if provided != expected:
            return JSONResponse({"detail": "未授权"}, status_code=401)
        return await call_next(request)
