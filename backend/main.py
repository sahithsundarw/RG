"""
RepoGuardian FastAPI application.

Startup:
  - Connects to Redis (optional — warns if unavailable)
  - Mounts all routers

The background worker (tasks/worker.py) runs as a separate process.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings
from backend.routers import (
    findings_router,
    health_router,
    hitl_router,
    repositories_router,
    scan_router,
    webhooks_router,
)
from backend.services.redis_service import close_redis

settings = get_settings()

# ── Structured logging ─────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer() if settings.debug else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown tasks."""
    logger.info("Starting %s v%s", settings.app_name, settings.app_version)

    # Redis is optional — skip connection check at startup
    logger.info("Redis optional — set REDIS_URL to enable event queuing")

    yield

    await close_redis()
    logger.info("Shutdown complete")


# ── Application ────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Autonomous AI Agent System for Code Repository Management. "
        "Automatically reviews pull requests, detects vulnerabilities, "
        "monitors repository health, and provides actionable developer feedback."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ───────────────────────────────────────────────────────────────────────

_cors_origins = ["http://localhost:3000", "http://localhost:5173"]
if settings.frontend_url:
    _cors_origins.append(settings.frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────

app.include_router(webhooks_router)
app.include_router(health_router)
app.include_router(repositories_router)
app.include_router(findings_router)
app.include_router(hitl_router)
app.include_router(scan_router)

# ── Serve frontend static files ────────────────────────────────────────────────

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    async def serve_index():
        return FileResponse(str(_frontend_dist / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Let API routes pass through; serve index.html for everything else
        file = _frontend_dist / full_path
        if file.exists() and file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(_frontend_dist / "index.html"))

else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "service": settings.app_name,
            "version": settings.app_version,
            "status": "running",
            "docs": "/docs",
        }


@app.get("/health", include_in_schema=False)
async def health_check():
    """Health check endpoint required by Render."""
    return {"status": "ok"}


@app.get("/ping", include_in_schema=False)
async def ping():
    """Simple liveness probe."""
    return {"status": "ok"}


@app.get("/ready", include_in_schema=False)
async def ready():
    """Readiness probe — checks Redis."""
    checks: dict = {}

    try:
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ready" if all_ok else "degraded", "checks": checks},
    )


# ── Entrypoint ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
