"""Manual refresh endpoint — async + polling, one job per project at a time.
Runs the same run_refresh() the CLI uses, in a background thread, in-container."""
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.duck import db
from services.integrations.metabase import MetabaseClient, MetabaseError
from services.integrations import refresh as refresh_mod

logger = logging.getLogger(__name__)

router = APIRouter()

_JOBS: dict[str, dict] = {}             # job_id -> {status, log, error, ...}
_LOCKS: dict[str, threading.Lock] = {}  # project_id -> lock
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))


def _run_job(job_id: str, project_id: str):
    job = _JOBS[job_id]
    try:
        # Auth mirrors the CLI (services/integrations/refresh.py): prefer a
        # service-account API key, fall back to email/password. Without this
        # the manual Refresh button would break whenever only METABASE_API_KEY
        # is configured — the credential the daily cron is meant to use.
        base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
        api_key = os.getenv("METABASE_API_KEY")
        email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
        if not api_key and not (email and password):
            raise RuntimeError(
                "Set METABASE_API_KEY, or METABASE_EMAIL and METABASE_PASSWORD")
        client = MetabaseClient(base, api_key=api_key)
        if not api_key:
            client.login(email, password)
        csv_dir = DATA_DIR / project_id
        result = refresh_mod.run_refresh(project_id, client, csv_dir)
        db.load_csvs_for_project(project_id, csv_dir)  # reload DuckDB
        job.update(status="done", log=result["log"],
                   finished_at=datetime.now(timezone.utc).isoformat())
    except MetabaseError as exc:
        # Log full details server-side; expose only the Metabase-level message
        # (no URLs or env-var names) to the browser.
        logger.exception("Refresh job %s failed (MetabaseError)", job_id)
        job.update(status="error", error=str(exc))
    except Exception as exc:
        # Log full details server-side; send a generic message to the browser
        # to avoid leaking env vars, URLs, or internal paths.
        logger.exception("Refresh job %s failed", job_id)
        job.update(status="error", error="Refresh failed — see server logs")
    finally:
        _LOCKS[project_id].release()


@router.post("/{project_id}/refresh")
def start_refresh(project_id: str):
    lock = _LOCKS.setdefault(project_id, threading.Lock())
    if not lock.acquire(blocking=False):
        running = next((j for j in _JOBS.values()
                        if j["project_id"] == project_id and j["status"] == "running"), None)
        raise HTTPException(409, detail={"message": "refresh already running",
                                         "job_id": running["job_id"] if running else None})
    job_id = uuid.uuid4().hex[:12]
    _JOBS[job_id] = {"job_id": job_id, "project_id": project_id,
                     "status": "running", "log": [], "error": None}
    threading.Thread(target=_run_job, args=(job_id, project_id), daemon=True).start()
    return {"job_id": job_id}


@router.get("/{project_id}/refresh/{job_id}")
def poll_refresh(project_id: str, job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, detail="unknown job")
    return job
