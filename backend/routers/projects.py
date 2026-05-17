"""
projects.py — project listing + schema endpoint
"""
import json
from pathlib import Path
from fastapi import APIRouter
from services.duck import db

DATA_DIR = Path("./data")
router = APIRouter()


@router.get("/")
def list_projects():
    """Return all projects with their metadata and table counts."""
    projects = []
    for d in sorted(DATA_DIR.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        meta_path = d / "project.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        tbls = db.tables_for_project(d.name)
        projects.append({
            "id":          d.name,
            "name":        meta.get("name", d.name.replace("_", " ").title()),
            "description": meta.get("description", ""),
            "status":      meta.get("status", "active"),
            "tables":      tbls,
            "table_count": len(tbls),
            "tags":        meta.get("tags", []),
            "updated_at":  meta.get("updated_at", ""),
            "owner":       meta.get("owner", ""),
            "jira_ticket": meta.get("jira_ticket", ""),
        })
    return projects


@router.get("/{project_id}")
def get_project(project_id: str):
    # Intentionally does NOT include the schema. get_schema() runs DESCRIBE +
    # SELECT LIMIT 2 per loaded table — at 57 tables on Render free tier that's
    # ~100 lock-serialized DB hits, which made the initial page-load take 2–3
    # minutes and queued every other request behind it. The schema is only used
    # by the chat handler (services/claude.py), which calls db.get_schema()
    # directly server-side — the frontend never reads it.
    meta_path = DATA_DIR / project_id / "project.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    # The refresh runner (services/integrations/refresh.py) writes _manifest.json
    # with per-table last_refreshed_at. The dashboard reads it for the "as of"
    # marker and the on-open staleness check.
    manifest_path = DATA_DIR / project_id / "_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    return {
        "id": project_id,
        **meta,
        "tables": db.tables_for_project(project_id),
        "manifest": manifest,
    }


@router.get("/{project_id}/schema")
def get_project_schema(project_id: str):
    """Lazy schema endpoint — only call when the chat panel actually needs it."""
    return {"schema": db.get_schema(project_id)}


@router.get("/{project_id}/tables")
def list_tables(project_id: str):
    return {"tables": db.tables_for_project(project_id)}


@router.post("/{project_id}/query")
def run_query(project_id: str, body: dict):
    """Ad-hoc SQL query endpoint (used by the dashboard components)."""
    sql = body.get("sql", "")
    limit = int(body.get("limit", 500))
    try:
        return db.execute(sql, limit=limit)
    except Exception as e:
        return {"error": str(e)}
