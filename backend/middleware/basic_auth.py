"""
Basic-auth gate for the API. Reads BASIC_AUTH_USER / BASIC_AUTH_PASS from env.
If either is unset (typical local dev), the middleware short-circuits to allow-all
so `uvicorn main:app --reload` Just Works without ceremony.

Skips /health and /ping so UptimeRobot's keep-alive (and Render's own health probe)
keep working without needing to know the credentials.

The frontend never talks to this directly — Vercel's reverse-proxy route
(/api/proxy/...) injects the Authorization header server-side. The middleware
exists so a) direct curls to the Render URL are gated and b) the credentials
live in one place (env vars on both Vercel and Render).
"""

from __future__ import annotations

import base64
import hmac
import os

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware


# Paths that bypass auth: health checks (UptimeRobot, Render probe) and OPTIONS
# pre-flights (CORS). Everything else under /api/* requires credentials.
OPEN_PATHS = {"/health", "/ping"}


class BasicAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, user: str | None, password: str | None):
        super().__init__(app)
        self.user = user or ""
        self.password = password or ""
        self.enabled = bool(self.user and self.password)
        if not self.enabled:
            print("⚠️  BASIC_AUTH_USER/BASIC_AUTH_PASS not set — API is OPEN.")
        else:
            print(f"🔒 BasicAuth enabled (user={self.user!r}).")

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self.enabled:
            return await call_next(request)
        if request.url.path in OPEN_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        header = request.headers.get("authorization", "")
        if not header.lower().startswith("basic "):
            return _challenge()

        try:
            decoded = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
            user, _, password = decoded.partition(":")
        except Exception:
            return _challenge()

        # constant-time compare to avoid trivial timing oracles
        if not (hmac.compare_digest(user, self.user) and hmac.compare_digest(password, self.password)):
            return _challenge()

        return await call_next(request)


def _challenge() -> Response:
    return JSONResponse(
        {"error": "authentication required"},
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="grip-analytics"'},
    )
