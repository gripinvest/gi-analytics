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
    meta_path = DATA_DIR / project_id / "project.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return {
        "id": project_id,
        **meta,
        "tables": db.tables_for_project(project_id),
        "schema": db.get_schema(project_id),
    }


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
