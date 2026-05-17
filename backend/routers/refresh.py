"""Manual refresh endpoint — async + polling, one job per project at a time.
Runs the same run_refresh() the CLI uses, in a background thread, in-container."""
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.duck import db
from services.integrations.metabase import MetabaseClient
from services.integrations import refresh as refresh_mod

router = APIRouter()

_JOBS: dict[str, dict] = {}             # job_id -> {status, log, error, ...}
_LOCKS: dict[str, threading.Lock] = {}  # project_id -> lock
DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))


def _run_job(job_id: str, project_id: str):
    job = _JOBS[job_id]
    try:
        base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
        email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
        if not email or not password:
            raise RuntimeError("METABASE_EMAIL/METABASE_PASSWORD not set")
        client = MetabaseClient(base)
        client.login(email, password)
        csv_dir = DATA_DIR / project_id
        result = refresh_mod.run_refresh(client, csv_dir)
        db.load_csvs_for_project(project_id, csv_dir)  # reload DuckDB
        job.update(status="done", log=result["log"],
                   finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # surfaced to the UI verbatim
        job.update(status="error", error=str(exc))
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
