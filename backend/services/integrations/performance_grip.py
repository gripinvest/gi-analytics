"""Performance Grip fetch module — daily archive of NR Web Vitals.

Orchestrates per-(app, hour) fetch loop, parses NerdGraph responses,
merges idempotently into hourly_web_vitals.csv.

- Spec: docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md
- Discovery: docs/projects/performance-grip/data-sources.md
"""
from __future__ import annotations

import csv as _csv
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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


def validate_since(value: str | None, *, now: datetime) -> datetime | None:
    """Validate the --since input. Returns IST midnight datetime or None.

    Rejects: malformed, future, or older than 8 days (NR retention).
    """
    if not value:
        return None
    if not _SINCE_RE.match(value):
        raise ValueError(f"--since must be YYYY-MM-DD, got {value!r}")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=IST)
    except ValueError as e:
        raise ValueError(f"--since must be YYYY-MM-DD: {e}")
    if parsed.date() > now.date():
        raise ValueError(f"--since cannot be in the future ({value} > {now.date()})")
    if (now - parsed).days > 8:
        raise ValueError(
            f"--since {value} is outside NR's 8-day retention window; data is gone."
        )
    return parsed


class FacetCapExceeded(RuntimeError):
    """uniqueCount(pageUrl) too close to NerdGraph's 5000-facet LIMIT MAX (H10)."""


def check_facet_cap(unique_count: int, *, app: str, hour: str) -> None:
    # NerdGraph's LIMIT MAX is 5000 (raised from 2000 in early 2024). Our queries
    # use LIMIT MAX. We treat ≥4500 as the danger zone — the long tail is at
    # risk of silent truncation before we hit the hard cap.
    if unique_count >= 4500:
        raise FacetCapExceeded(
            f"{app} hour {hour}: uniqueCount(pageUrl) = {unique_count} — "
            f"approaching NerdGraph's facet cap (LIMIT MAX = 5000). "
            f"Likely truncating long tail."
        )


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


APP_CONFIG = [
    # (canonical slug, NR appName) — locked from Phase 0 task 0.2 (2026-05-21).
    ("gi-client-static", "gi_client_static_prod"),
    ("gi-client-web",   "gi_client_web_prod"),
]


# Phase 0 (2026-05-21) discovery established Path C — see spec §12 K2 row.
# Web app has 4882 distinct URLs/24h (99% partner-webview UUIDs) saturating
# NerdGraph's 5000-facet cap. We split each fetch into a "raw" query (named
# URLs, excluding collapse+deprecated patterns) and N "collapse" queries (one
# per pattern, aggregating across all matching URLs into a single row per device).
#
# Pattern config lives in: backend/data/performance_grip/route_patterns.csv
# Schema: app, pattern, nrql_like, collapse_at_fetch, exclude, sort_priority, notes
#
# Load at run() start; pass collapse_likes + exclude_likes into the _raw builders.

# H5-lite: validate app names at module load. NRQL doesn't support parameterised
# queries; we mitigate injection risk by allowlisting safe characters at config
# load rather than escaping at query construction time.
_APP_NAME_OK = re.compile(r"^[A-Za-z0-9 \-_./]+$")
for _slug, _nr_app in APP_CONFIG:
    if not _APP_NAME_OK.match(_nr_app):
        raise ValueError(
            f"NR appName {_nr_app!r} contains characters outside [A-Za-z0-9 -_./]; "
            f"NRQL injection risk. Edit APP_CONFIG to match a safer name."
        )


def load_route_patterns(csv_path: Path) -> dict:
    """Load route_patterns.csv. Returns dict {app: {"collapse": [(label, nrql_like), ...],
    "exclude": [nrql_like, ...]}}.

    The wildcard app="*" applies to all apps.
    Lines starting with # are comments.
    """
    out: dict = {}
    if not csv_path.exists():
        return out
    with open(csv_path, newline="") as f:
        reader = _csv.DictReader(
            line for line in f if not line.startswith("#") and line.strip()
        )
        for row in reader:
            app = row["app"]
            apps = [a for a, _ in APP_CONFIG] if app == "*" else [app]
            for a in apps:
                bucket = out.setdefault(a, {"collapse": [], "exclude": []})
                if row.get("exclude") == "1":
                    if row.get("nrql_like"):
                        bucket["exclude"].append(row["nrql_like"])
                elif row.get("collapse_at_fetch") == "1":
                    if row.get("nrql_like"):
                        bucket["collapse"].append((row["pattern"], row["nrql_like"]))
    return out


def _q1_select() -> str:
    """The SELECT clause is identical for all Q1 variants — only WHERE/FACET differ.
    Per Phase 0 CA2: filter() wrappers required (timingName discriminator inflates count ~5x).
    """
    return (
        "SELECT "
        "filter(percentile(largestContentfulPaint, 75, 95), WHERE timingName='largestContentfulPaint') AS lcp, "
        "filter(percentile(interactionToNextPaint,  75, 95), WHERE timingName='interactionToNextPaint') AS inp, "
        "filter(percentile(cumulativeLayoutShift,   75, 95), WHERE timingName='cumulativeLayoutShift') AS cls, "
        "filter(percentile(firstContentfulPaint,    75, 95), WHERE timingName='firstContentfulPaint') AS fcp, "
        "filter(percentile(firstByte,               75, 95), WHERE timingName='firstByte') AS ttfb, "
        "filter(count(*), WHERE timingName='largestContentfulPaint') AS sample_count "
        "FROM PageViewTiming"
    )


def _nrql_q1_raw(nr_app: str, since: datetime, until: datetime,
                  collapse_likes: list[str], exclude_likes: list[str]) -> str:
    collapse_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in collapse_likes])
    dep_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in exclude_likes])
    extra = (f" AND {collapse_excl}" if collapse_likes else "") + (f" AND {dep_excl}" if exclude_likes else "")
    return (
        f"{_q1_select()} "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL AND deviceType IS NOT NULL"
        f"{extra} "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT MAX"
    )


def _nrql_q1_collapse(nr_app: str, since: datetime, until: datetime,
                       like_clause: str) -> str:
    return (
        f"{_q1_select()} "
        f"WHERE appName = '{nr_app}' "
        "AND deviceType IS NOT NULL "
        f"AND pageUrl LIKE '{like_clause}' "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET deviceType"
    )


def _nrql_q2_raw(nr_app: str, since: datetime, until: datetime,
                  collapse_likes: list[str], exclude_likes: list[str]) -> str:
    collapse_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in collapse_likes])
    dep_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in exclude_likes])
    extra = (f" AND {collapse_excl}" if collapse_likes else "") + (f" AND {dep_excl}" if exclude_likes else "")
    return (
        "SELECT count(*) AS page_views FROM PageView "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL AND deviceType IS NOT NULL"
        f"{extra} "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT MAX"
    )


def _nrql_q2_collapse(nr_app: str, since: datetime, until: datetime,
                      like_clause: str) -> str:
    return (
        "SELECT count(*) AS page_views FROM PageView "
        f"WHERE appName = '{nr_app}' "
        "AND deviceType IS NOT NULL "
        f"AND pageUrl LIKE '{like_clause}' "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET deviceType"
    )


def _nrql_q3_raw(nr_app: str, since: datetime, until: datetime,
                  collapse_likes: list[str], exclude_likes: list[str]) -> str:
    # M13 PII GUARDRAIL: never extend to message/stackTrace/customAttributes.
    collapse_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in collapse_likes])
    dep_excl = " AND ".join([f"pageUrl NOT LIKE '{p}'" for p in exclude_likes])
    extra = (f" AND {collapse_excl}" if collapse_likes else "") + (f" AND {dep_excl}" if exclude_likes else "")
    return (
        "SELECT count(*) AS js_errors FROM JavaScriptError "
        f"WHERE appName = '{nr_app}' "
        "AND pageUrl IS NOT NULL"
        f"{extra} "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET pageUrl, deviceType LIMIT MAX"
    )


def _nrql_q3_collapse(nr_app: str, since: datetime, until: datetime,
                      like_clause: str) -> str:
    return (
        "SELECT count(*) AS js_errors FROM JavaScriptError "
        f"WHERE appName = '{nr_app}' "
        "AND deviceType IS NOT NULL "
        f"AND pageUrl LIKE '{like_clause}' "
        f"SINCE '{since.strftime('%Y-%m-%d %H:%M:%S')}' "
        f"UNTIL '{until.strftime('%Y-%m-%d %H:%M:%S')}' "
        "WITH TIMEZONE 'Asia/Kolkata' "
        "FACET deviceType"
    )


def parse_collapse_response(nrql_response: list, *, label: str, metric_type: str) -> list[dict]:
    """Parse a collapse-query response (FACET deviceType, no pageUrl) into rows
    matching the raw-query shape, with page_url = pattern label.

    metric_type: 'q1' (timings) | 'q2' (page_views) | 'q3' (js_errors)
    """
    out = []
    for entry in nrql_response:
        # When FACETing on a single dimension, NerdGraph returns it as a scalar
        # "facet" key (not a list). Defensive handling for both shapes.
        facet = entry.get("facet")
        if isinstance(facet, list):
            device = (facet[0] or "").lower() if facet else None
        else:
            device = (facet or "").lower() if facet else None
        if not device:
            continue

        if metric_type == "q1":
            row = {
                "page_url": label,
                "device": device,
                "sample_count": entry.get("sample_count"),
            }
            for m in ["lcp", "inp", "cls", "fcp", "ttfb"]:
                mobj = entry.get(m) or {}
                row[f"{m}_p75"] = mobj.get("75")
                row[f"{m}_p95"] = mobj.get("95")
            out.append(row)
        elif metric_type == "q2":
            out.append({
                "page_url": label,
                "device": device,
                "page_views": int(entry.get("page_views") or 0),
            })
        elif metric_type == "q3":
            out.append({
                "page_url": label,
                "device": device,
                "js_errors": int(entry.get("js_errors") or 0),
            })
    return out


def run(
    client,
    data_dir: Path,
    *,
    now: datetime | None = None,
    since: datetime | None = None,
) -> dict:
    """Orchestrate per-(app, hour) fetch loop with Path C split queries.

    For each (app, hour) window:
      1. Run "raw" Q1/Q2/Q3 — gets named-URL rows excluding collapse+excluded patterns
      2. For each collapse pattern (from route_patterns.csv): run "collapse" Q1/Q2/Q3
         — gets one aggregate row per device, page_url = pattern label
      3. Merge all rows via merge_rows
      4. Write per-(app, hour) atomically
    """
    now = now or datetime.now(IST)
    csv_path = Path(data_dir) / "hourly_web_vitals.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    # Load Path C pattern config (Phase 0 finding)
    patterns_path = Path(data_dir) / "route_patterns.csv"
    route_config = load_route_patterns(patterns_path)

    log_lines: list[str] = []
    successes = 0
    failures = 0

    for app_slug, nr_app in APP_CONFIG:
        app_cfg = route_config.get(app_slug, {"collapse": [], "exclude": []})
        collapse_patterns = app_cfg["collapse"]   # [(label, nrql_like), ...]
        collapse_likes = [like for _, like in collapse_patterns]
        exclude_likes = app_cfg["exclude"]

        last = latest_in_csv(csv_path, app=app_slug)
        windows = target_hours(latest_in_csv=last, now=now, since=since)
        log_lines.append(
            f"[{app_slug}] {len(windows)} hours, "
            f"{len(collapse_patterns)} collapse patterns, "
            f"{len(exclude_likes)} excluded"
        )

        for win_start, win_end in windows:
            try:
                # Raw queries (named URLs only)
                q1r = client.nrql(_nrql_q1_raw(nr_app, win_start, win_end, collapse_likes, exclude_likes))
                q2r = client.nrql(_nrql_q2_raw(nr_app, win_start, win_end, collapse_likes, exclude_likes))
                q3r = client.nrql(_nrql_q3_raw(nr_app, win_start, win_end, collapse_likes, exclude_likes))

                # Facet-cap check on the RAW query (post-exclusion count)
                check_facet_cap(len(q1r), app=app_slug, hour=win_start.isoformat())

                q1 = parse_q1_response({"results": q1r})
                q2 = parse_q2_response({"results": q2r})
                q3 = parse_q3_response({"results": q3r})

                # Per-pattern collapse queries
                for label, like_clause in collapse_patterns:
                    c1 = client.nrql(_nrql_q1_collapse(nr_app, win_start, win_end, like_clause))
                    c2 = client.nrql(_nrql_q2_collapse(nr_app, win_start, win_end, like_clause))
                    c3 = client.nrql(_nrql_q3_collapse(nr_app, win_start, win_end, like_clause))
                    q1.extend(parse_collapse_response(c1, label=label, metric_type="q1"))
                    q2.extend(parse_collapse_response(c2, label=label, metric_type="q2"))
                    q3.extend(parse_collapse_response(c3, label=label, metric_type="q3"))

                if not q1 or not q2:
                    log_lines.append(
                        f"[{app_slug}] EMPTY {win_start.isoformat()}: Q1={len(q1)} Q2={len(q2)}"
                    )
                    failures += 1
                    continue

                merged = merge_rows(
                    q1, q2, q3,
                    app=app_slug,
                    date=win_start.strftime("%Y-%m-%d"),
                    hour=win_start.hour,
                    fetched_at=datetime.now(IST).isoformat(),
                )
                append_hour_atomic(
                    csv_path, merged,
                    app=app_slug,
                    date=win_start.strftime("%Y-%m-%d"),
                    hour=win_start.hour,
                )
                successes += 1
                log_lines.append(
                    f"[{app_slug}] {win_start.isoformat()}: {len(merged)} rows"
                )
            except Exception as e:
                failures += 1
                log_lines.append(
                    f"[{app_slug}] FAILED {win_start.isoformat()}: {type(e).__name__}: {e}"
                )

    status = "ok" if failures == 0 else ("partial" if successes > 0 else "fail")
    return {
        "status": status,
        "log": log_lines,
        "refreshed_at": datetime.now(IST).isoformat(),
    }


# Back-compat shims for the simpler test cases — production code uses the _raw/_collapse pair.
def _nrql_q1(nr_app: str, since: datetime, until: datetime) -> str:
    return _nrql_q1_raw(nr_app, since, until, collapse_likes=[], exclude_likes=[])


def _nrql_q2(nr_app: str, since: datetime, until: datetime) -> str:
    return _nrql_q2_raw(nr_app, since, until, collapse_likes=[], exclude_likes=[])


def _nrql_q3(nr_app: str, since: datetime, until: datetime) -> str:
    return _nrql_q3_raw(nr_app, since, until, collapse_likes=[], exclude_likes=[])
