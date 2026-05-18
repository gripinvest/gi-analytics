"""FRA YouTube refresh runner — deterministic, no AI.

Two entry points:
  - run_refresh(...)  : importable; the refresh test and any in-app caller use this.
  - main()            : standalone CLI used by the GitHub Action.

Mirrors services/integrations/refresh.py (the Grip Connect runner).
"""
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from services.integrations.accumulate import upsert_csv
from services.integrations.fra_youtube import build_layer1, build_layer2, CHANNELS
from services.integrations.youtube import resolve_channel, fetch_all_videos

# Natural keys per table for upsert accumulation.
KEYS = {
    "channel_snapshots":    ["channel_handle", "snapshot_date"],
    "video_snapshots":      ["channel_handle", "snapshot_date", "video_id"],
    "overview":             ["channel_handle", "snapshot_date"],
    "distribution":         ["channel_handle", "snapshot_date"],
    "category_mix":         ["channel_handle", "snapshot_date", "category"],
    "monthly_views":        ["channel_handle", "snapshot_date", "month"],
    "engagement_breakdown": ["channel_handle", "snapshot_date", "dimension", "bucket"],
    "posting_patterns":     ["channel_handle", "snapshot_date", "dimension", "bucket"],
    "title_patterns":       ["channel_handle", "snapshot_date", "pattern"],
    "catalog_health":       ["channel_handle", "snapshot_date"],
}


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def _http_fetch(channel_handle: str, api_key: str):
    """Production fetch: real HTTP via httpx."""
    with httpx.Client(timeout=30) as client:
        channel = resolve_channel(client, channel_handle, api_key)
        videos = fetch_all_videos(client, channel["uploads_playlist_id"], api_key)
    return channel, videos


def run_refresh(data_dir, api_key, snapshot_date=None, channels=None, fetch=_http_fetch) -> dict:
    """Fetch -> layer1 -> layer2 -> upsert CSVs + manifest. `fetch` is injectable for tests."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    channels = channels or CHANNELS
    snapshot_date = snapshot_date or datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    log: list[str] = []

    channels_data = [fetch(handle, api_key) for handle in channels]
    layer1 = build_layer1(channels_data, snapshot_date)
    history = {"channel_snapshots": _read_csv(data_dir / "channel_snapshots.csv")}
    layer2 = build_layer2(layer1, history)

    tables = {**layer1, **layer2}
    for name, rows in tables.items():
        upsert_csv(data_dir / f"{name}.csv", rows, key=KEYS[name])
        log.append(f"{name}: {len(rows)} rows")

    now = datetime.now(timezone.utc).isoformat()
    manifest = {"refreshed_at": now,
                "tables": {t: {"last_refreshed_at": now} for t in tables}}
    # Atomic write, performed LAST: a complete `_manifest.json` is the signal
    # that the whole snapshot landed. A crash mid-refresh leaves the prior
    # manifest intact (each CSV is already atomic via accumulate.upsert_csv).
    manifest_tmp = data_dir / "_manifest.json.tmp"
    manifest_tmp.write_text(json.dumps(manifest, indent=2))
    os.replace(manifest_tmp, data_dir / "_manifest.json")
    return {"status": "ok", "log": log, "refreshed_at": now}


def main() -> int:
    from dotenv import load_dotenv
    load_dotenv()
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        print("ERROR: set YOUTUBE_API_KEY", file=sys.stderr)
        return 1
    data_dir = Path(os.getenv("DATA_DIR", "./data")) / "fra_youtube"
    result = run_refresh(data_dir, api_key)
    print("\n".join(result["log"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
