"""
DuckDB service.
On startup: scans DATA_DIR/{project_id}/*.csv and registers each as a table.
Table names: {project_id}__{filename_stem}
  e.g.  asset_search__W4_apr23-apr29_asset_search_query
"""

import os
import threading
import duckdb
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))


class DuckService:
    def __init__(self):
        self.con = duckdb.connect(database=":memory:")
        self._tables: list[str] = []
        # A single DuckDB connection is not safe for concurrent use. FastAPI runs
        # sync route handlers in a threadpool, and the dashboard fires several
        # /query requests at once — without this lock those threads race on the
        # one connection and the process can wedge. Each query is sub-100ms, so
        # serializing them is invisible to the user.
        self._lock = threading.RLock()

    def load_all_projects(self):
        """Scan DATA_DIR and load every CSV as a DuckDB view."""
        for project_dir in sorted(DATA_DIR.iterdir()):
            if not project_dir.is_dir() or project_dir.name.startswith("."):
                continue
            for csv_path in sorted(project_dir.glob("*.csv")):
                table_name = f"{project_dir.name}__{csv_path.stem}"
                # Sanitise: replace hyphens/spaces with underscores for SQL safety
                table_name = table_name.replace("-", "_").replace(" ", "_")
                try:
                    self.con.execute(
                        f"CREATE OR REPLACE VIEW {table_name} AS "
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
                    f"CREATE OR REPLACE VIEW {table_name} AS "
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
