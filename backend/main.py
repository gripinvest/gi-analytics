"""
Grip Analytics — FastAPI backend
Loads CSVs into DuckDB on startup, serves project data, handles Claude chat.
"""

# Load .env (ANTHROPIC_API_KEY etc.) before anything else imports os.environ.
from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from services.duck import db
from routers import projects, upload, chat
from middleware.basic_auth import BasicAuthMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load all CSVs into DuckDB on startup
    db.load_all_projects()
    print(f"DuckDB loaded. Tables: {db.list_tables()}")
    yield
    db.close()


app = FastAPI(title="Grip Analytics API", lifespan=lifespan)

# Always allow local dev and the known Vercel deploys; add more (preview URLs,
# custom domains) via the ALLOWED_ORIGINS env var (comma-separated).
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://grip-analytics.vercel.app",
    "https://grip-analytics-psi.vercel.app",
] + [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Basic-auth gate (no-op locally unless env vars are set; required on Render).
# Added after CORS so OPTIONS pre-flights still get the CORS response.
app.add_middleware(
    BasicAuthMiddleware,
    user=os.getenv("BASIC_AUTH_USER"),
    password=os.getenv("BASIC_AUTH_PASS"),
)

app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(upload.router,   prefix="/api/upload",   tags=["upload"])
app.include_router(chat.router,     prefix="/api/chat",     tags=["chat"])


@app.get("/health")
def health():
    return {"status": "ok", "tables": db.list_tables()}

@app.get("/ping")
def ping():
    """UptimeRobot pings this every 14min to prevent Render free tier from sleeping."""
    return "ok"
