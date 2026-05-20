"""Performance Grip fetch module — daily archive of NR Web Vitals.

Orchestrates per-(app, hour) fetch loop, parses NerdGraph responses,
merges idempotently into hourly_web_vitals.csv.

- Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
- Discovery: docs/projects/performance-grip/data-sources.md
"""
from __future__ import annotations

from datetime import datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def clean_url(raw_url: str) -> str:
    """Normalise a URL for storage at fetch time.

    Rules (spec §4.6):
    1. Strip query string.
    2. Strip fragment.
    3. Trim trailing slash (except root).
    4. Preserve case.
    5. No path collapsing (patterns applied in dashboard layer).
    """
    if "://" in raw_url:
        path = urlparse(raw_url).path
    else:
        path = raw_url.split("?", 1)[0].split("#", 1)[0]

    if path == "":
        return "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return path


def target_hours(
    latest_in_csv: datetime | None,
    now: datetime,
    since: datetime | None,
) -> list[tuple[datetime, datetime]]:
    """Compute the (start, end) IST hour-buckets to fetch.

    Each entry is [start, start + 1h). The latest *closed* hour is the
    upper bound: at now=14:30, the latest closed hour is [13:00, 14:00).
    """
    # Floor `now` to the hour, then go back one more to get the latest closed hour.
    floor = now.replace(minute=0, second=0, microsecond=0)
    latest_closed = floor - timedelta(hours=1)

    if since is not None:
        first = since
    elif latest_in_csv is not None:
        first = latest_in_csv + timedelta(hours=1)
    else:
        first = latest_closed  # cold start: just the last hour

    if first > latest_closed:
        return []

    result = []
    cursor = first
    while cursor <= latest_closed:
        result.append((cursor, cursor + timedelta(hours=1)))
        cursor += timedelta(hours=1)
    return result
