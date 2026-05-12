"""
upload.py — CSV upload endpoint
"""
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File
from services.duck import db

DATA_DIR = Path("./data")
router = APIRouter()


@router.post("/{project_id}")
async def upload_csvs(
    project_id: str,
    files: list[UploadFile] = File(...),
):
    """
    Upload one or more CSV files for a project.
    Auto-registers them as DuckDB tables immediately.
    """
    project_dir = DATA_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for f in files:
        dest = project_dir / f.filename
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(f.filename)

    # Reload tables for this project
    db.load_csvs_for_project(project_id, project_dir)

    return {
        "uploaded": saved,
        "tables": db.tables_for_project(project_id),
    }
