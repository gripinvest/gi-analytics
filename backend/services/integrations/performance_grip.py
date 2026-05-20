"""Performance Grip fetch module — daily archive of NR Web Vitals.

Orchestrates per-(app, hour) fetch loop, parses NerdGraph responses,
merges idempotently into hourly_web_vitals.csv.

- Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
- Discovery: docs/projects/performance-grip/data-sources.md
"""
from __future__ import annotations

import csv as _csv
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

CSV_COLUMNS = [
    "date", "hour", "app", "page_url", "device",
    "page_views", "js_errors", "sample_count",
    "lcp_p75_ms", "lcp_p95_ms",
    "inp_p75_ms", "inp_p95_ms",
    "cls_p75", "cls_p95",
    "fcp_p75_ms", "fcp_p95_ms",
    "ttfb_p75_ms", "ttfb_p95_ms",
    "fetched_at",
]


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


def parse_q2_response(nrql_response: dict) -> list[dict]:
    """Parse Q2 (PageView count) response."""
    out = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet") or []
        # H6-fix: guard against single-element facet (matches Q3's defensive pattern)
        if len(facet) < 2:
            continue
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower()
        if page_url is None or not device:
            continue
        out.append({
            "page_url": page_url,
            "device": device,
            "page_views": int(entry.get("page_views") or 0),
        })
    return out


def parse_q3_response(nrql_response: dict) -> list[dict]:
    """Parse Q3 (JavaScriptError count) response.

    M13 GUARDRAIL: only `count` is projected. Do NOT extend Q3 to event-body
    fields (message, stackTrace, customAttributes) — they carry user IDs and
    auth tokens.
    """
    out = []
    for entry in nrql_response.get("results", []):
        facet = entry.get("facet", [None, None])
        page_url = clean_url(facet[0]) if facet[0] else None
        device = (facet[1] or "").lower() if len(facet) > 1 and facet[1] else None
        if page_url is None:
            continue
        out.append({
            "page_url": page_url,
            "device": device,  # may be None — handled in merge_rows
            "js_errors": int(entry.get("js_errors") or 0),
        })
    return out


def merge_rows(
    q1: list[dict],
    q2: list[dict],
    q3: list[dict],
    *,
    app: str,
    date: str,
    hour: int,
    fetched_at: str,
) -> list[dict]:
    """Merge per-query rows into canonical schema. Q1 is the spine.

    Q2 left-joined for page_views (missing = 0).
    Q3 left-joined for js_errors (missing = 0). Q3 device may be None;
    falls back to (page_url, *) bucket if exact match misses.
    """
    q2_idx = {(r["page_url"], r["device"]): r["page_views"] for r in q2}
    q3_idx: dict = {}
    for r in q3:
        key = (r["page_url"], r.get("device") or "*")
        q3_idx[key] = q3_idx.get(key, 0) + r["js_errors"]

    out = []
    for q1_row in q1:
        key = (q1_row["page_url"], q1_row["device"])
        merged = {
            "date": date,
            "hour": hour,
            "app": app,
            "page_url": q1_row["page_url"],
            "device": q1_row["device"],
            "page_views": q2_idx.get(key, 0),
            "js_errors": q3_idx.get(key, q3_idx.get((q1_row["page_url"], "*"), 0)),
            "sample_count": q1_row.get("sample_count"),
            "lcp_p75_ms": q1_row.get("lcp_p75"),
            "lcp_p95_ms": q1_row.get("lcp_p95"),
            "inp_p75_ms": q1_row.get("inp_p75"),
            "inp_p95_ms": q1_row.get("inp_p95"),
            "cls_p75":    q1_row.get("cls_p75"),
            "cls_p95":    q1_row.get("cls_p95"),
            "fcp_p75_ms": q1_row.get("fcp_p75"),
            "fcp_p95_ms": q1_row.get("fcp_p95"),
            "ttfb_p75_ms": q1_row.get("ttfb_p75"),
            "ttfb_p95_ms": q1_row.get("ttfb_p95"),
            "fetched_at": fetched_at,
        }
        out.append(merged)
    return out


def append_hour_atomic(
    csv_path: Path,
    new_rows: list[dict],
    *,
    app: str,
    date: str,
    hour: int,
) -> None:
    """Atomically replace any existing rows for (app, date, hour) and append new ones.

    Algorithm: read existing → filter out (app, date, hour) matches → append
    new → write to .tmp → atomic rename. Crash leaves CSV intact; partial
    .tmp is discarded.
    """
    existing: list[dict] = []
    if csv_path.exists():
        with open(csv_path, newline="") as f:
            existing = list(_csv.DictReader(f))

    filtered = [
        r for r in existing
        if not (r.get("app") == app and r.get("date") == date and str(r.get("hour")) == str(hour))
    ]

    combined = filtered + [{k: row.get(k, "") for k in CSV_COLUMNS} for row in new_rows]
    combined.sort(key=lambda r: (r["date"], int(r["hour"]) if r["hour"] != "" else 0,
                                  r["app"], r["page_url"], r["device"]))

    tmp = csv_path.with_suffix(".csv.tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp, "w", newline="") as f:
        writer = _csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in combined:
            writer.writerow(row)
    os.replace(tmp, csv_path)


def latest_in_csv(csv_path: Path, app: str) -> datetime | None:
    """Return the latest (date, hour) for the given app, as an IST datetime."""
    if not csv_path.exists():
        return None
    latest: datetime | None = None
    with open(csv_path, newline="") as f:
        for row in _csv.DictReader(f):
            if row.get("app") != app:
                continue
            try:
                dt = datetime.strptime(row["date"], "%Y-%m-%d").replace(
                    hour=int(row["hour"]), tzinfo=IST
                )
            except (ValueError, KeyError):
                continue
            if latest is None or dt > latest:
                latest = dt
    return latest
