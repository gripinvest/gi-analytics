"""Performance Grip fetch module — daily archive of NR Web Vitals.

Orchestrates per-(app, hour) fetch loop, parses NerdGraph responses,
merges idempotently into hourly_web_vitals.csv.

- Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
- Discovery: docs/projects/performance-grip/data-sources.md
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
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


def parse_q1_response(nrql_response: dict) -> list[dict]:
    """Parse Q1 (Web Vitals timings) NerdGraph response.

    Per spec C1: percentile() returns nested {"75": v, "95": v} objects.
    Verified against captured fixture (Q1_pageviewtiming_response.json):
    each result has keys {facet: [url, device], lcp/inp/cls/fcp/ttfb:
    {"75": v, "95": v}, sample_count: int}.

    Input: {"results": [{"facet": ["/page", "Mobile"], "lcp": {"75": ..., "95": ...}, ...}]}
    Output: list of dicts: page_url, device, {metric}_p75, {metric}_p95, sample_count
    """
    metrics = ["lcp", "inp", "cls", "fcp", "ttfb"]
    out: list[dict] = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet") or []
        # H6-fix: defensive against single-element facet
        if len(facet) < 2:
            continue
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower()
        if page_url is None or not device:
            continue
        row: dict[str, Any] = {
            "page_url": page_url,
            "device": device,
            "sample_count": entry.get("sample_count"),
        }
        for m in metrics:
            mobj = entry.get(m) or {}
            row[f"{m}_p75"] = mobj.get("75")
            row[f"{m}_p95"] = mobj.get("95")
        out.append(row)
    return out
