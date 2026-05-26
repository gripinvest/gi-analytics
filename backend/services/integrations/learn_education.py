"""Learn (Grip Education) live-data fetch module.

Daily refresh of the weekly A/B tracker for the Learn page experiment
(`learn_page` experiment_name). Output is a single CSV
(`weekly_ab_tracker.csv`) — one row per (week, variant) carrying the
ten product-spreadsheet columns plus a cohort-assignment row pair from
`experiment_assigned`. The dashboard reads this CSV via DuckDB table
`learn_education__weekly_ab_tracker`.

Status — pre-launch:
    The gi-client-web feature ships an event surface but no prod data
    has been recorded yet. `run()` is wired into the refresh registry
    so the daily cron is idempotent and harmless until W1 prod data
    appears — it logs "awaiting first prod data" and exits cleanly.
    Once `learn_page_viewed` shows ≥1 row in Rudder, the gate flips
    and the SQL below begins producing live output.

Design: `docs/projects/learn-education/data-sources.md` §4 (canonical
SQL formulas), §5 (recommended fetch order). Deterministic Python only —
Claude authors and validates; the cron runs it.
"""
import csv
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import feature_week
from .metabase import MetabaseError

# Rudder Prod, schema client_web — same as Asset Search.
DATABASE_ID = 8

# Test users excluded from every query path. Single-sourced across projects.
TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)


# ─── Probe ────────────────────────────────────────────────────────────────
# Cheapest possible query — has any learn_page_viewed event ever fired?
# If not, the feature hasn't shipped to prod yet and there's nothing to
# fetch. Used to gate the rest of the run.
PROBE_SQL = """
SELECT COUNT(*) AS n
FROM client_web.learn_page_viewed
WHERE timestamp >= NOW() - INTERVAL '90 days'
"""


# ─── Weekly A/B tracker SQL ───────────────────────────────────────────────
# Joins experiment_assigned (denominator) with learn_page_viewed (visitors),
# learn_video_viewed (engagement metrics), and new_user_order (FTI). The
# output schema matches frontend/lib/queries/learnEducation.js COLUMNS.
#
# Cohort slice: assignment-week (a user assigned in W1 is in W1's denominator
# regardless of when they engaged or invested). This matches the canonical
# data-sources §3d default and the product spreadsheet's mental model.
def build_weekly_ab_sql(weeks: int = 8) -> str:
    test_users_in = ",".join(str(u) for u in TEST_USERS)
    return f"""
    WITH cohort AS (
      SELECT
        DATE_TRUNC('week', timestamp)::date AS week_start,
        experiment_variant AS variant,
        user_id::text AS user_id
      FROM client_web.experiment_assigned
      WHERE experiment_name = 'learn_page'
        AND timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id NOT IN ({test_users_in})
    ),
    visits AS (
      SELECT
        DATE_TRUNC('week', timestamp)::date AS week_start,
        user_id::text AS user_id
      FROM client_web.learn_page_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
    ),
    plays AS (
      SELECT
        DATE_TRUNC('week', timestamp)::date AS week_start,
        user_id::text AS user_id,
        total_watched_seconds
      FROM client_web.learn_video_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND total_watched_seconds > 0
        AND user_id::text NOT IN ({test_users_in})
    ),
    fti AS (
      SELECT
        user_id::text AS user_id,
        MIN(timestamp) AS first_order_at
      FROM client_web.new_user_order
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id
    )
    SELECT
      to_char(c.week_start, 'YYYY-MM-DD')                                 AS week_start,
      c.variant                                                            AS variant,
      COUNT(DISTINCT c.user_id)                                            AS total_non_invested_users,
      COUNT(DISTINCT v.user_id)                                            AS learn_page_visitors,
      ROUND(100.0 * COUNT(DISTINCT v.user_id) / NULLIF(COUNT(DISTINCT c.user_id), 0), 1)
                                                                           AS learn_visit_rate_pct,
      COUNT(DISTINCT p.user_id)                                            AS unique_video_players,
      COUNT(p.user_id)                                                     AS total_video_plays,
      ROUND(1.0 * COUNT(p.user_id) / NULLIF(COUNT(DISTINCT p.user_id), 0), 1)
                                                                           AS avg_videos_per_user,
      ROUND(1.0 * SUM(p.total_watched_seconds) / NULLIF(COUNT(p.user_id), 0), 0)
                                                                           AS avg_watch_time_sec,
      COUNT(DISTINCT f.user_id)                                            AS fti_users,
      COUNT(DISTINCT CASE WHEN p.user_id IS NOT NULL THEN f.user_id END)   AS fti_users_who_watched,
      ROUND(100.0 * COUNT(DISTINCT f.user_id) / NULLIF(COUNT(DISTINCT c.user_id), 0), 2)
                                                                           AS fti_rate_pct
    FROM cohort c
    LEFT JOIN visits v ON v.user_id = c.user_id AND v.week_start = c.week_start
    LEFT JOIN plays  p ON p.user_id = c.user_id AND p.week_start = c.week_start
    LEFT JOIN fti    f ON f.user_id = c.user_id AND f.first_order_at >= c.week_start
    GROUP BY c.week_start, c.variant
    ORDER BY c.week_start, c.variant
    """


CANONICAL_COLUMNS = [
    "week_start", "variant",
    "total_non_invested_users", "learn_page_visitors", "learn_visit_rate_pct",
    "unique_video_players", "total_video_plays", "avg_videos_per_user",
    "avg_watch_time_sec", "fti_users", "fti_users_who_watched", "fti_rate_pct",
]


def write_csv_atomic(path: Path, rows: list[dict], columns: list[str]) -> int:
    """Atomic write — temp file + rename, matches asset_search pattern."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r.get(c, "") for c in columns})
    tmp.replace(path)
    return len(rows)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(client, data_dir, *, today: date | None = None) -> dict:
    """Daily-refresh entry point. Called by services.integrations.refresh.

    Returns a dict consumed by the cron's commit step and by the manual
    refresh endpoint. Idempotent: if the feature isn't live yet, returns
    a status of 'awaiting_first_event' and writes nothing.
    """
    data_dir = Path(data_dir)
    log: list[str] = []

    # ─── Gate on data presence ─────────────────────────────────────────────
    # We do a cheap COUNT(*) on learn_page_viewed before running the
    # join-heavy weekly query. Until the gi-client-web feature ships and
    # users actually start hitting /learn, this returns 0 and we exit.
    try:
        probe = client.run_sql(PROBE_SQL, database_id=DATABASE_ID)
        n_rows = int(probe.rows[0][0]) if probe.rows else 0
    except MetabaseError as e:
        log.append(f"probe failed — {e}")
        return {
            "status": "error",
            "log": "\n".join(log),
            "refreshed_at": _now(),
        }

    if n_rows == 0:
        log.append(
            "awaiting first prod learn_page_viewed event — the gi-client-web "
            "feature has not started emitting yet. No data written."
        )
        return {
            "status": "awaiting_first_event",
            "log": "\n".join(log),
            "refreshed_at": _now(),
            "rows_written": 0,
        }

    log.append(f"probe ok — {n_rows} learn_page_viewed events in last 90 days")

    # ─── Live path ─────────────────────────────────────────────────────────
    sql = build_weekly_ab_sql(weeks=12)
    try:
        result = client.run_sql(sql, database_id=DATABASE_ID)
    except MetabaseError as e:
        log.append(f"weekly_ab_tracker SQL failed — {e}")
        return {
            "status": "error",
            "log": "\n".join(log),
            "refreshed_at": _now(),
        }

    # Metabase rows come back as positional arrays — zip with column names.
    cols = [c["name"] for c in result.columns]
    rows = [dict(zip(cols, r)) for r in result.rows]

    out_path = data_dir / "weekly_ab_tracker.csv"
    n_written = write_csv_atomic(out_path, rows, CANONICAL_COLUMNS)
    log.append(f"wrote {n_written} rows → {out_path.relative_to(data_dir.parent)}")

    return {
        "status": "ok",
        "log": "\n".join(log),
        "refreshed_at": _now(),
        "rows_written": n_written,
        "tables_written": ["weekly_ab_tracker"],
    }
