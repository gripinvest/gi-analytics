"""Refresh runner — the single source of truth, two entry points:
  · imported by the refresh endpoint (routers/refresh.py)
  · run standalone:  python -m services.integrations.refresh
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from .grip_connect import CARDS, PARTNERS, build_layer1, build_layer2
from .metabase import MetabaseClient

# Natural keys per canonical table — used by upsert accumulation.
KEYS = {
    "card_3841_summary_wow":  ["partner", "week"],
    "card_4499_kyc_funnel":   ["partner", "week"],
    "card_3843_summary_dod":  ["partner", "day"],
    "card_5042_retention_d1": ["partner"],
    "card_5046_retention_d2": ["partner"],
    "01_north_star":          ["partner", "metric"],
    "02_reg_to_kyc":          ["partner"],
}


def run_refresh(client, data_dir, partners=PARTNERS, active_week_start=None) -> dict:
    """Fetch -> accumulate -> derive -> write CSVs + manifest. Returns a summary.

    NOTE: the exact `week`/`date` column names are confirmed against a live card
    response in the first run (spec §16). If a card's week column is not literally
    `week`/`date`, adjust KEYS above — this is the one Phase-1 pin.
    """
    from .accumulate import upsert_csv  # local import keeps this importable w/o cycles
    data_dir = Path(data_dir)
    active_week_start = active_week_start or date.today()
    log: list[str] = []

    layer1 = build_layer1(client, partners=partners)
    for table, rows in layer1.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    layer2 = build_layer2(layer1, partners=partners, active_week_start=active_week_start)
    for table, rows in layer2.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    now = datetime.now(timezone.utc).isoformat()
    all_tables = list(layer1) + list(layer2)
    manifest = {"refreshed_at": now,
                "tables": {t: {"last_refreshed_at": now} for t in all_tables}}
    (data_dir / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"status": "ok", "log": log, "refreshed_at": now}


def main() -> int:
    # Standalone CLI: load .env so METABASE_* are available (the FastAPI app
    # loads it in main.py; the GitHub Action injects real env vars instead).
    from dotenv import load_dotenv
    load_dotenv()
    base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
    email, password = os.getenv("METABASE_EMAIL"), os.getenv("METABASE_PASSWORD")
    if not email or not password:
        print("ERROR: set METABASE_EMAIL and METABASE_PASSWORD", file=sys.stderr)
        return 1
    client = MetabaseClient(base)
    client.login(email, password)
    data_dir = Path(os.getenv("DATA_DIR", "./data")) / "grip_connect"
    result = run_refresh(client, data_dir)
    print("\n".join(result["log"]))
    print(f"Done — {result['refreshed_at']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
