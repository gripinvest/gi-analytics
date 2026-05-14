"""
DuckDB service.

Two startup paths:

1. **Prebuilt file path (production).** If `DATA_DIR/grip.duckdb` exists (built
   at deploy time by `backend/build_duckdb.py` — see render.yaml's
   buildCommand), open it directly. All tables are already materialised inside
   the file; startup is just a file-open and a `SHOW TABLES`. On Render free
   tier this drops cold-start wake from ~30s (parse 127MB of CSV) to ~2s.

2. **CSV-parsing fallback (local dev / fresh clones).** If the prebuilt file
   is missing, scan DATA_DIR/<project_id>/*.csv and materialise each into a
   table inside an in-memory connection — the original behaviour. This keeps
   `uvicorn main:app --reload` working with zero ceremony.

Table names in both paths: `{project_id}__{filename_stem}` with hyphens and
spaces underscore-mangled. `build_duckdb.py` uses the same rule — they MUST
stay in lock-step or queries built off the runtime table list won't find the
prebuilt tables.

These tables used to be views (`CREATE VIEW ... AS SELECT * FROM read_csv_auto(...)`),
which meant every SELECT re-parsed the CSV from disk. Queries that unioned 6
weekly page-views + 12 invest tables ended up re-parsing ~25 MB of CSV per call,
and on Render free tier that took minutes per query. As tables, the parse happens
once (at build time or first startup); subsequent queries hit RAM in tens of ms.
"""

import os
import threading
import duckdb
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
PREBUILT = DATA_DIR / "grip.duckdb"


class DuckService:
    def __init__(self):
        # A single DuckDB connection is not safe for concurrent use. FastAPI runs
        # sync route handlers in a threadpool, and the dashboard fires ~24 /query
        # requests at once — without this lock those threads race on the one
        # connection and the process can wedge. With CSVs materialised as tables
        # each query is tens of milliseconds, so serialising them is invisible.
        self._lock = threading.RLock()
        self._tables: list[str] = []

        if PREBUILT.exists():
            # Open read-write so the upload endpoint can still CREATE OR REPLACE
            # tables into it; those writes don't persist past container lifetime
            # on free tier anyway (same as today's :memory: behaviour).
            self.con = duckdb.connect(str(PREBUILT))
            self._prebuilt = True
            size_mb = PREBUILT.stat().st_size / (1024 * 1024)
            print(f"📦 Opened prebuilt {PREBUILT.name} ({size_mb:.1f} MB)")
        else:
            self.con = duckdb.connect(database=":memory:")
            self._prebuilt = False
            print(f"⚠️  No prebuilt {PREBUILT.name} — will parse CSVs at boot (slower)")

    def load_all_projects(self):
        """Materialise CSVs OR refresh the table list from the prebuilt file.

        Called by main.py's lifespan. When a prebuilt file is in use this is
        just a `SHOW TABLES` — the heavy lifting happened at build time. Without
        the prebuilt file we fall through to the original CSV-parsing path.
        """
        if self._prebuilt:
            self._tables = [r[0] for r in self.con.execute("SHOW TABLES").fetchall()]
            return

        for project_dir in sorted(DATA_DIR.iterdir()):
            if not project_dir.is_dir() or project_dir.name.startswith("."):
                continue
            for csv_path in sorted(project_dir.glob("*.csv")):
                table_name = f"{project_dir.name}__{csv_path.stem}"
                # Sanitise: replace hyphens/spaces with underscores for SQL safety.
                # MUST match backend/build_duckdb.py's naming rule.
                table_name = table_name.replace("-", "_").replace(" ", "_")
                try:
                    self.con.execute(
                        f"CREATE OR REPLACE TABLE {table_name} AS "
                        f"SELECT * FROM read_csv_auto('{csv_path}', ignore_errors=true)"
                    )
                    self._tables.append(table_name)
                    print(f"  ✓ Loaded {table_name}")
                except Exception as e:
                    print(f"  ✗ Failed {csv_path.name}: {e}")

    def load_csvs_for_project(self, project_id: str, csv_dir: Path):
        """Load or reload a single project's CSVs (called after upload)."""
        with self._lock:
            for csv_path in sorted(csv_dir.glob("*.csv")):
                table_name = f"{project_id}__{csv_path.stem}".replace("-", "_")
                self.con.execute(
                    f"CREATE OR REPLACE TABLE {table_name} AS "
                    f"SELECT * FROM read_csv_auto('{csv_path}', ignore_errors=true)"
                )
                if table_name not in self._tables:
                    self._tables.append(table_name)

    def execute(self, sql: str, limit: int = 500) -> dict:
        """
        Execute a SQL query and return JSON-serialisable result.
        Automatically wraps in a LIMIT if not already present.
        """
        # Safety: don't allow mutations
        stmt = sql.strip().upper()
        if any(stmt.startswith(k) for k in ("INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "ATTACH", "PRAGMA", "COPY", "CALL")):
            raise ValueError("Only SELECT queries are allowed.")

        if "LIMIT" not in stmt:
            sql = f"SELECT * FROM ({sql}) _q LIMIT {limit}"

        with self._lock:
            rel = self.con.execute(sql)
            cols = [d[0] for d in rel.description]
            rows = rel.fetchall()
        return {
            "columns": cols,
            "rows": [dict(zip(cols, row)) for row in rows],
            "row_count": len(rows),
        }

    def get_schema(self, project_id: str) -> str:
        """
        Build a compact schema string for Claude's system prompt.
        Lists table names + column names + first 2 sample rows per table.
        """
        tables = [t for t in self._tables if t.startswith(f"{project_id}__")]
        if not tables:
            return "No data loaded for this project."

        lines = [f"Project: {project_id}", "Available tables:\n"]
        for table in tables:
            short = table.replace(f"{project_id}__", "")
            try:
                with self._lock:
                    schema = self.con.execute(
                        f"DESCRIBE SELECT * FROM {table} LIMIT 0"
                    ).fetchall()
                cols = [f"  {r[0]} ({r[1]})" for r in schema]
                sample = self.execute(f"SELECT * FROM {table} LIMIT 2", limit=2)
                lines.append(f"Table: {table}  (alias: {short})")
                lines.append("Columns:\n" + "\n".join(cols))
                lines.append(f"Sample rows (2): {sample['rows']}\n")
            except Exception as e:
                lines.append(f"Table: {table} [schema error: {e}]\n")

        return "\n".join(lines)

    def list_tables(self) -> list[str]:
        return self._tables

    def tables_for_project(self, project_id: str) -> list[str]:
        return [t for t in self._tables if t.startswith(f"{project_id}__")]

    def close(self):
        self.con.close()


# Singleton used across the app
db = DuckService()
