#!/usr/bin/env python3
"""
refresh_data.py — pull a fresh week of Asset Search event data from Metabase,
sanitize it, drop it into backend/data/asset_search/, and (optionally) commit + push.

Pushing to `main` redeploys both Render (backend) and Vercel (frontend), so the
new week shows up in the live dashboard a couple of minutes later.

Stdlib only — no pip install needed. Run with the system python3.

────────────────────────────────────────────────────────────────────────────
SETUP (one time)
────────────────────────────────────────────────────────────────────────────
1. Put these in grip-analytics/backend/.env (NOT committed — see .gitignore):

       METABASE_URL=https://metabase.yourcompany.com      # no trailing slash
       METABASE_API_KEY=<your personal Metabase API key>  # Account Settings → API Keys

   (DATA_DIR is optional; defaults to <repo>/backend/data/asset_search.)

2. Fill in the SOURCE config block below (SCHEMA / DATABASE_ID and, if your
   table names differ, the EVENT_TABLES map). The SELECT column lists are
   already wired to match the CSVs the dashboard expects — leave those alone
   unless the dashboard's SQL changes too.

────────────────────────────────────────────────────────────────────────────
USAGE
────────────────────────────────────────────────────────────────────────────
    python3 scripts/refresh_data.py --next-week          # pull the next sequential week
    python3 scripts/refresh_data.py --week 7             # pull W7 explicitly
    python3 scripts/refresh_data.py --from 2026-05-12 --to 2026-05-18 --label may12-may18
    python3 scripts/refresh_data.py --next-week --no-push # write + commit, don't push
    python3 scripts/refresh_data.py --next-week --dry-run # print the plan, touch nothing

Weeks are Thu→Wed windows anchored on the launch date (2026-04-02 = W1).
`--to` is the inclusive last day.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

# ════════════════════════════════════════════════════════════════════════════
# SOURCE CONFIG — fill these in for your warehouse
# ════════════════════════════════════════════════════════════════════════════

# Metabase database id of the warehouse that holds the event tables.
# (Account context notes: id 8 = PostgreSQL "client_web"; id 24 = ClickHouse
#  "prodgripdb". Pick whichever actually has the asset_search_* tables.)
DATABASE_ID = None          # e.g. 8   ← REQUIRED, set this

# Schema / dataset the event tables live in.
SCHEMA = None               # e.g. "client_web"   ← REQUIRED, set this

# Table name per event. Default assumes one table per event named
# asset_search_<event>. Override any that differ in your warehouse.
EVENT_TABLES = {
    "initiated":           "asset_search_initiated",
    "query":               "asset_search_query",
    "result_clicked":      "asset_search_result_clicked",
    "empty_state":         "asset_search_empty_state",
    "cleared":             "asset_search_cleared",
    "suggestion_clicked":  "asset_search_suggestion_clicked",
}

# Name of the timestamp column to filter on (same across all event tables).
TS_COL = "timestamp"

# Internal/QA accounts to exclude — must match TEST_USERS in
# frontend/lib/queries/assetSearch.js.
TEST_USER_IDS = [3, 4, 207871, 207875, 207878, 207879]

# Output columns per event — these MUST match the existing CSV headers in
# backend/data/asset_search/ (the dashboard SQL reads these names).
# NOTE: `result_position` in the raw events is 0-indexed (0 = top result); the
# dashboard adds 1 for display. Don't "fix" it here.
EVENT_COLUMNS = {
    "initiated":          ["timestamp", "context_session_id", "user_id", "active_tab", "assets_visible_count"],
    "query":              ["timestamp", "context_session_id", "user_id", "query_text", "results_count", "active_tab", "is_refinement"],
    "result_clicked":     ["timestamp", "context_session_id", "user_id", "query_text", "clicked_asset_id", "clicked_asset_name", "clicked_asset_type", "result_position", "results_count", "active_tab"],
    "empty_state":        ["timestamp", "context_session_id", "user_id", "query_text", "query_length", "active_tab"],
    "cleared":            ["timestamp", "context_session_id", "user_id", "active_tab"],
    "suggestion_clicked": ["timestamp", "context_session_id", "user_id", "asset_id", "asset_name", "item_position", "suggestion_type", "suggestion_count", "active_tab"],
}

# ════════════════════════════════════════════════════════════════════════════
# PII sanitization (defensive — the SELECTs above already exclude these, but if
# you widen a SELECT to `*` this still keeps the output safe to commit).
# Mirrors search_analytics/sanitize_csvs.py.
# ════════════════════════════════════════════════════════════════════════════

DROP_COLS = {
    "context_traits_email", "context_traits_mobile_no", "context_traits_mobile_code",
    "context_traits_first_name", "context_traits_last_name",
}
HASH_COLS = {"ip_address", "context_ip", "context_request_ip"}

# Launch anchor: W1 starts here.
LAUNCH_DATE = date(2026, 4, 2)
PROJECT = "asset_search"

REPO_ROOT = Path(__file__).resolve().parents[1]   # grip-analytics/


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_dotenv(path: Path) -> None:
    """Minimal .env loader — KEY=VALUE per line, # comments, no export/quoting magic."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


def short_hash(val: str) -> str:
    import hashlib
    if not val or str(val).strip() in ("Not received", "null", "None", "nan", ""):
        return val
    return "ip_" + hashlib.sha256(str(val).encode()).hexdigest()[:10]


def week_window(n: int) -> tuple[date, date]:
    """W{n} → (start_date_inclusive, end_date_inclusive) — a 7-day Thu→Wed window."""
    start = LAUNCH_DATE + timedelta(days=7 * (n - 1))
    return start, start + timedelta(days=6)


def label_for(start: date, end_incl: date) -> str:
    """apr02-apr08 style label."""
    return f"{start:%b}{start.day:02d}-{end_incl:%b}{end_incl.day:02d}".lower()


def existing_weeks(data_dir: Path) -> list[int]:
    weeks = set()
    for p in data_dir.glob(f"W*_*_{PROJECT}_*.csv"):
        m = re.match(r"W(\d+)_", p.name)
        if m:
            weeks.add(int(m.group(1)))
    return sorted(weeks)


def native_query(database_id: int, sql: str) -> dict:
    return {
        "database": database_id,
        "type": "native",
        "native": {"query": sql},
    }


def metabase_csv(base_url: str, api_key: str, query: dict) -> list[list[str]]:
    """POST /api/dataset/csv — no 2000-row cap (unlike /api/dataset). Returns parsed rows incl. header."""
    url = base_url.rstrip("/") + "/api/dataset/csv"
    body = urllib.parse.urlencode({"query": json.dumps(query)}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"X-API-KEY": api_key, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = resp.read().decode("utf-8-sig")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise SystemExit(f"Metabase returned HTTP {e.code} for {url}\n{detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach Metabase at {url}: {e.reason}\n"
                         f"(Are you on the VPN / can this machine see the Metabase host?)")
    return list(csv.reader(io.StringIO(text)))


def build_sql(event: str, start: date, end_incl: date) -> str:
    cols = ", ".join(EVENT_COLUMNS[event])
    table = f"{SCHEMA}.{EVENT_TABLES[event]}"
    test_users = ", ".join(str(u) for u in TEST_USER_IDS)
    end_excl = end_incl + timedelta(days=1)
    return (
        f"SELECT {cols}\n"
        f"FROM {table}\n"
        f"WHERE {TS_COL} >= '{start:%Y-%m-%d}' AND {TS_COL} < '{end_excl:%Y-%m-%d}'\n"
        f"  AND user_id NOT IN ({test_users})\n"
        f"ORDER BY {TS_COL}"
    )


def sanitize_rows(rows: list[list[str]]) -> list[list[str]]:
    """Drop PII columns, hash IP columns. rows[0] is the header."""
    if not rows:
        return rows
    header = rows[0]
    drop_idx = {i for i, h in enumerate(header) if h in DROP_COLS}
    hash_idx = {i for i, h in enumerate(header) if h in HASH_COLS}
    out = []
    for r in rows:
        is_header = r is rows[0]
        new = []
        for i, v in enumerate(r):
            if i in drop_idx:
                continue
            new.append(v if is_header or i not in hash_idx else short_hash(v))
        out.append(new)
    return out


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Refresh Asset Search data from Metabase.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--week", type=int, metavar="N", help="pull W{N}")
    g.add_argument("--next-week", action="store_true", help="pull the next week after the latest one on disk")
    g.add_argument("--from", dest="start", metavar="YYYY-MM-DD", help="custom window start (needs --to and --label)")
    ap.add_argument("--to", dest="end", metavar="YYYY-MM-DD", help="custom window end (inclusive)")
    ap.add_argument("--label", help="custom window label, e.g. may12-may18")
    ap.add_argument("--no-push", action="store_true", help="commit but don't push (no redeploy)")
    ap.add_argument("--no-commit", action="store_true", help="write files only, no git at all")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and the first SQL, change nothing")
    args = ap.parse_args()

    load_dotenv(REPO_ROOT / "backend" / ".env")

    # DATA_DIR mirrors the backend's env var: the dir that *contains* project
    # subfolders (asset_search/ etc.). Relative paths resolve like the backend's
    # cwd (= backend/). Default: backend/data.
    data_root = Path(os.environ.get("DATA_DIR") or "data")
    if not data_root.is_absolute():
        data_root = REPO_ROOT / "backend" / data_root
    data_dir = data_root / PROJECT
    data_dir.mkdir(parents=True, exist_ok=True)

    # ── resolve the target window ────────────────────────────────────────────
    if args.start:
        if not (args.end and args.label):
            ap.error("--from requires --to and --label")
        start = datetime.strptime(args.start, "%Y-%m-%d").date()
        end_incl = datetime.strptime(args.end, "%Y-%m-%d").date()
        label = args.label
        wk_n = len(existing_weeks(data_dir)) + 1
    else:
        if args.next_week:
            ew = existing_weeks(data_dir)
            wk_n = (ew[-1] + 1) if ew else 1
        else:
            wk_n = args.week
        start, end_incl = week_window(wk_n)
        label = label_for(start, end_incl)

    week_tag = f"W{wk_n}"
    print(f"Target: {week_tag}  {start} → {end_incl}  (label: {label})")
    print(f"Output: {data_dir}")

    # ── config sanity ────────────────────────────────────────────────────────
    metabase_url = os.environ.get("METABASE_URL", "").strip()
    metabase_key = os.environ.get("METABASE_API_KEY", "").strip()
    if args.dry_run:
        print("\n--- DRY RUN ---")
        print("Would call:", (metabase_url.rstrip("/") if metabase_url else "<METABASE_URL unset>") + "/api/dataset/csv")
        print(f"\nExample SQL ({EVENT_TABLES['query']}):\n")
        print(build_sql("query", start, end_incl))
        print("\nWould write:")
        for ev in EVENT_COLUMNS:
            print(f"  {data_dir / f'{week_tag}_{label}_{PROJECT}_{ev}.csv'}")
        return

    missing = [k for k, v in [("METABASE_URL", metabase_url), ("METABASE_API_KEY", metabase_key)] if not v]
    if missing:
        raise SystemExit(f"Missing env var(s): {', '.join(missing)}.  Put them in {REPO_ROOT/'backend'/'.env'}.")
    if DATABASE_ID is None or SCHEMA is None:
        raise SystemExit("Set DATABASE_ID and SCHEMA in the SOURCE CONFIG block at the top of this script.")

    # ── fetch + sanitize + write ─────────────────────────────────────────────
    written = []
    for ev, expected_cols in EVENT_COLUMNS.items():
        sql = build_sql(ev, start, end_incl)
        rows = metabase_csv(metabase_url, metabase_key, native_query(DATABASE_ID, sql))
        rows = sanitize_rows(rows)
        if not rows:
            raise SystemExit(f"{ev}: Metabase returned no rows at all (not even a header). Check the SQL/table name.")
        got_cols = rows[0]
        if got_cols != expected_cols:
            print(f"  ⚠ {ev}: column mismatch.\n    expected {expected_cols}\n    got      {got_cols}\n"
                  f"    (writing anyway — but the dashboard SQL expects the 'expected' names)")
        out_path = data_dir / f"{week_tag}_{label}_{PROJECT}_{ev}.csv"
        with out_path.open("w", newline="") as f:
            csv.writer(f).writerows(rows)
        n = len(rows) - 1
        print(f"  ✓ {ev:<20} {n:>7,} rows  →  {out_path.name}")
        written.append(out_path)

    # ── git ──────────────────────────────────────────────────────────────────
    if args.no_commit:
        print("\nDone (--no-commit). Files written, nothing staged.")
        return

    rel_dir = os.path.relpath(data_dir, REPO_ROOT)
    add = run_git(["add", rel_dir], REPO_ROOT)
    if add.returncode != 0:
        raise SystemExit(f"git add failed:\n{add.stderr}")
    staged = run_git(["diff", "--cached", "--quiet"], REPO_ROOT)
    if staged.returncode == 0:
        print("\nNo changes vs what's already committed — nothing to commit.")
        return
    msg = f"Refresh data: {week_tag} ({label}) for {PROJECT}"
    commit = run_git(["commit", "-m", msg], REPO_ROOT)
    if commit.returncode != 0:
        raise SystemExit(f"git commit failed:\n{commit.stderr}")
    print(f"\nCommitted: {msg}")

    if args.no_push:
        print("Not pushing (--no-push). `git push` when you're ready to redeploy.")
        return
    push = run_git(["push"], REPO_ROOT)
    if push.returncode != 0:
        raise SystemExit(f"git push failed:\n{push.stderr}\n(Commit is in place — push manually.)")
    print("Pushed to origin. Render + Vercel will redeploy in ~2-3 min.")


if __name__ == "__main__":
    main()
