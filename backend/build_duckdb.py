"""
Build-time CSV → DuckDB materialisation.

Run by Render's `buildCommand` after `pip install` (see render.yaml). Walks
DATA_DIR for project subdirectories and materialises every *.csv into a
table inside backend/data/grip.duckdb. At runtime, services/duck.py prefers
this prebuilt file over re-parsing CSVs.

Why this matters. Render free tier sleeps after 15 min and the next request
pays the full cold-start cost. With 127MB of CSV and 57 tables, the
read_csv_auto path on Render's slow CPU takes ~30s. Building the .duckdb
file once at deploy time and opening it at runtime drops cold-start wake
to ~2s — the file is memory-mapped and columnar, not parsed.

Local dev. `python build_duckdb.py` from the backend/ directory does the
same thing locally. If you add a new CSV, re-run this. `uvicorn` will pick
up the new tables on next start. If the file is absent (e.g. fresh clone
without a build step), services/duck.py falls back to the original
parse-CSVs-on-boot behaviour, so nothing breaks.

Idempotent: drops and rebuilds grip.duckdb every run; cheap because all
CSVs are local files.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import duckdb

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
OUT_FILE = DATA_DIR / "grip.duckdb"


def main() -> int:
    if not DATA_DIR.is_dir():
        print(f"ERR: DATA_DIR not found at {DATA_DIR.resolve()}")
        return 1

    # Remove stale build artifact. We always rebuild from scratch so there's no
    # risk of carrying old tables forward when CSVs are renamed/deleted.
    if OUT_FILE.exists():
        OUT_FILE.unlink()

    con = duckdb.connect(str(OUT_FILE))

    table_count = 0
    failed: list[str] = []
    for project_dir in sorted(DATA_DIR.iterdir()):
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue
        for csv_path in sorted(project_dir.glob("*.csv")):
            # Same naming rule as services/duck.py.load_all_projects() — must
            # stay in lock-step with the runtime loader, otherwise the prebuilt
            # tables won't match the names queries expect.
            table_name = f"{project_dir.name}__{csv_path.stem}".replace("-", "_").replace(" ", "_")
            try:
                con.execute(
                    f"CREATE TABLE {table_name} AS "
                    f"SELECT * FROM read_csv_auto('{csv_path}', ignore_errors=true)"
                )
                table_count += 1
                print(f"  ✓ {table_name}")
            except Exception as e:
                failed.append(f"{csv_path.name}: {e}")
                print(f"  ✗ {csv_path.name}: {e}")

    con.close()

    size_mb = OUT_FILE.stat().st_size / (1024 * 1024)
    print(f"\nBuilt {OUT_FILE} — {table_count} tables, {size_mb:.1f} MB.")
    if failed:
        print(f"\n{len(failed)} table(s) failed:")
        for f in failed:
            print(f"  - {f}")
    return 0


if __name__ == "__main__":
    # Always exit 0 — failing the build over a cold-start optimisation would
    # be the tail wagging the dog. If build_duckdb hits any error, the runtime
    # falls back to parse-CSVs-on-boot (see services/duck.py). The /health
    # endpoint surfaces `.prebuilt` so the regression is visible without
    # silently degrading.
    try:
        main()
    except Exception as e:
        print(f"\n⚠️  build_duckdb failed: {e}")
        print("⚠️  Continuing — runtime will fall back to CSV parsing on boot.")
    sys.exit(0)
