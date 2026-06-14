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
import re
import threading
import duckdb
from pathlib import Path

# Matches a weekly-partition prefix like "W10_jun04_jun10_" so all of a project's
# per-week tables collapse to one logical dataset name in the chat data map.
_WEEK_PREFIX_RE = re.compile(r"^W\d+_[A-Za-z0-9]+_[A-Za-z0-9]+_")

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

    def execute(self, sql: str, limit: int = 500, project_id: str | None = None) -> dict:
        """
        Execute a SQL query and return JSON-serialisable result.
        Automatically wraps in a LIMIT if not already present.

        When ``project_id`` is given (the chat path), the query is constrained to
        that project's tables: if it references any *other* project's table the
        call is rejected. The model only sees this project's data map, but this
        is the hard guard that keeps "Ask the data" isolated to one project.
        """
        # Safety: don't allow mutations
        stmt = sql.strip().upper()
        if any(stmt.startswith(k) for k in ("INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "ATTACH", "PRAGMA", "COPY", "CALL")):
            raise ValueError("Only SELECT queries are allowed.")

        if project_id is not None:
            lowered = sql.lower()
            foreign = sorted({
                t for t in self._tables
                if not t.startswith(f"{project_id}__") and t.lower() in lowered
            })
            if foreign:
                raise ValueError(
                    f"Query references tables outside project '{project_id}': "
                    f"{foreign[:5]}. Only {project_id}__ tables may be queried here."
                )

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

    def _entity_of(self, table: str, project_id: str) -> str:
        """Logical dataset name for a table: strip the ``{project}__`` prefix and
        any weekly-partition prefix. e.g.
        ``asset_search__W10_jun04_jun10_asset_search_query`` -> ``asset_search_query``.
        Tables without a weekly prefix (aggregates, other layouts) map to themselves."""
        rest = table[len(project_id) + 2:] if table.startswith(f"{project_id}__") else table
        return _WEEK_PREFIX_RE.sub("", rest)

    def get_data_map(self, project_id: str) -> str:
        """Compact, always-on map of a project's logical datasets — names only, no
        columns or sample rows. Per-week partition tables collapse to a single
        entry, so this stays small and flat no matter how many weekly tables
        accumulate. Column/table detail is fetched on demand via ``describe_table``.

        This replaces ``get_schema`` in the chat system prompt: dumping every
        table's full columns + sample rows blew past the model's context window
        (see backend/evals/chat_eval.py)."""
        tables = self.tables_for_project(project_id)
        if not tables:
            return "No data loaded for this project."
        groups: dict[str, list[str]] = {}
        for t in tables:
            groups.setdefault(self._entity_of(t, project_id), []).append(t)
        lines = [
            f"Project '{project_id}' has {len(groups)} datasets "
            f"(some partitioned into per-week tables).",
            "Use the describe_table tool with a dataset name to get its columns and "
            "the exact table names before writing SQL for it.",
            "",
            "Datasets:",
        ]
        for e in sorted(groups):
            n = len(groups[e])
            lines.append(f"- {e}" + (f"  ({n} weekly tables)" if n > 1 else ""))
        return "\n".join(lines)

    def describe_table(self, project_id: str, name: str) -> str:
        """On-demand schema for ONE dataset: its columns (listed once) plus the
        exact table names that back it. ``name`` may be a logical dataset name
        (``asset_search_query``) or a concrete table name. Scoped to ``project_id``."""
        tables = self.tables_for_project(project_id)
        if not tables:
            return f"No data loaded for project '{project_id}'."
        members = [t for t in tables if self._entity_of(t, project_id) == name]
        if not members:  # accept a concrete/qualified table name too
            members = [t for t in tables if t == name or t == f"{project_id}__{name}" or name in t]
        if not members:
            avail = sorted({self._entity_of(t, project_id) for t in tables})
            return f"No dataset matching '{name}' in '{project_id}'. Available datasets: {avail}"
        # Schema can EVOLVE across partitions (e.g. asset_search gained gc_id /
        # gc_name from W4), so describe the WIDEST member, not just the first —
        # otherwise newer columns would be invisible to the model.
        best, best_desc, widths = None, [], {}
        try:
            with self._lock:
                for m in members:
                    d = self.con.execute(f"DESCRIBE SELECT * FROM {m} LIMIT 0").fetchall()
                    widths[m] = len(d)
                    if len(d) > len(best_desc):
                        best, best_desc = m, d
        except Exception as e:
            return f"Could not describe '{name}': {e}"
        cols = "\n".join(f"  {r[0]} ({r[1]})" for r in best_desc)
        names = "\n".join(f"  {m}" for m in members)
        note = ""
        if len(members) > 1:
            note = (f"\n\nThis dataset is split across {len(members)} per-week tables — "
                    f"UNION ALL across them to span all weeks.")
            if len(set(widths.values())) > 1:
                note += (" NOTE: column counts differ across partitions (the schema "
                         "changed over time — newer columns like gc_id/gc_name exist "
                         "only in later weeks). Columns above are the widest/latest "
                         "schema; a column may be absent in an older partition, so a "
                         "query referencing it must restrict to the weeks that have it.")
        return f"Dataset '{name}' — columns:\n{cols}\n\nTable name(s) to query:\n{names}{note}"

    def list_tables(self) -> list[str]:
        return self._tables

    def tables_for_project(self, project_id: str) -> list[str]:
        return [t for t in self._tables if t.startswith(f"{project_id}__")]

    def close(self):
        self.con.close()


# Singleton used across the app
db = DuckService()
