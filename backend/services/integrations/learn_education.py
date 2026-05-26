"""Learn (Grip Education) live-data fetch module.

Daily refresh of the weekly A/B tracker for the Learn page experiment
(`learn_page` experiment_name). Output is a single CSV
(`weekly_ab_tracker.csv`) plus a `_manifest.json` stamp — the dashboard
reads the CSV via DuckDB table `learn_education__weekly_ab_tracker`.

Status — pre-launch:
    The gi-client-web feature ships an event surface but no prod data
    has been recorded yet. `run()` is wired into the refresh registry
    so the daily cron is idempotent and harmless until W1 prod data
    appears — both probes (learn_page_viewed and experiment_assigned)
    must be > 0 before the main SQL runs. Status `awaiting_first_event`
    is returned cleanly so the cron does not page until live data lands.

Design: `docs/projects/learn-education/data-sources.md` §4 (canonical
SQL formulas). Deterministic Python only — Claude authors and validates;
the cron runs it.
"""
import csv
import json
from datetime import date, datetime, timezone
from pathlib import Path

from .metabase import MetabaseError

# Rudder Prod, schema client_web — same as Asset Search.
DATABASE_ID = 8

# Test users excluded from every query path. Single-sourced across projects.
TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)

# Rolling window for the weekly tracker. Documented as a module constant so
# the dashboard's "Why only N weeks?" question has an answer.
WEEKS_OF_HISTORY = 12


# ─── Probes ───────────────────────────────────────────────────────────────
# Two cheap gates before the join-heavy main query. Both must be > 0:
#   1. learn_page_viewed — feature is emitting at all
#   2. experiment_assigned for learn_page — bucketing is wired
# Without (2), we'd happily produce zero cohort rows and the cron would
# report success while the dashboard renders empty.
PROBE_LEARN_PAGE_SQL = """
SELECT COUNT(*) AS n
FROM client_web.learn_page_viewed
WHERE timestamp >= NOW() - INTERVAL '90 days'
"""

PROBE_EXPERIMENT_SQL = """
SELECT COUNT(*) AS n
FROM client_web.experiment_assigned
WHERE experiment_name = 'learn_page'
  AND timestamp >= NOW() - INTERVAL '90 days'
"""


# ─── Weekly A/B tracker SQL ───────────────────────────────────────────────
# Cohort slice: assignment-week. Each row represents users **newly bucketed
# in week N**. Engagement metrics (visitors, plays, watch time) and the
# FTI count are computed across all time at or after N for those users —
# i.e. sticky bucketing per data-sources.md §3d. This matches the product
# spreadsheet's mental model where Week N is a cohort, not just an activity
# window.
#
# Each metric block is computed in its own CTE so the cohort row never
# fans out across multiple visits/plays/orders (the LEFT-JOIN-and-aggregate
# bug an earlier revision had).
#
# user_id is normalised to ::text everywhere — Rudder stores it as varchar
# in event tables but our TEST_USERS list is ints, so casts must happen
# before any equality predicate.
def build_weekly_ab_sql(weeks: int = WEEKS_OF_HISTORY) -> str:
    test_users_in = ",".join(f"'{u}'" for u in TEST_USERS)
    return f"""
    WITH cohort AS (
      -- One row per (user, assignment-week, variant). experiment_assigned
      -- is deduped per-user-per-experiment via localStorage upstream
      -- (gi-client-web utils/experimentBucketing.ts), so each user
      -- appears in exactly one assignment-week row.
      SELECT
        user_id::text AS user_id,
        experiment_variant AS variant,
        DATE_TRUNC('week', timestamp)::date AS assigned_week
      FROM client_web.experiment_assigned
      WHERE experiment_name = 'learn_page'
        AND timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id::text NOT IN ({test_users_in})
    ),

    cohort_sizes AS (
      SELECT
        assigned_week AS week_start,
        variant,
        COUNT(DISTINCT user_id) AS total_non_invested_users
      FROM cohort
      GROUP BY assigned_week, variant
    ),

    visits AS (
      SELECT DISTINCT
        user_id::text AS user_id,
        DATE_TRUNC('week', timestamp)::date AS visit_week
      FROM client_web.learn_page_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
    ),

    visit_metrics AS (
      -- Visitors aggregated by assignment-week × variant via cohort
      -- (sticky bucketing). Computed in its own CTE so a user with
      -- multiple visits does not fan out with plays / fti.
      SELECT
        c.assigned_week AS week_start,
        c.variant,
        COUNT(DISTINCT v.user_id) AS learn_page_visitors
      FROM cohort c
      LEFT JOIN visits v ON v.user_id = c.user_id
      GROUP BY c.assigned_week, c.variant
    ),

    plays AS (
      -- Genuine plays (total_watched_seconds > 0). Filters silent
      -- autoplay-failure rows per data-sources.md §6 Q1 default.
      SELECT
        user_id::text AS user_id,
        timestamp AS played_at,
        total_watched_seconds
      FROM client_web.learn_video_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND total_watched_seconds > 0
        AND user_id::text NOT IN ({test_users_in})
    ),

    play_metrics AS (
      SELECT
        c.assigned_week AS week_start,
        c.variant,
        COUNT(DISTINCT p.user_id) AS unique_video_players,
        COUNT(p.user_id) AS total_video_plays,
        SUM(p.total_watched_seconds) AS total_watched_seconds_sum
      FROM cohort c
      LEFT JOIN plays p ON p.user_id = c.user_id
      GROUP BY c.assigned_week, c.variant
    ),

    fti AS (
      SELECT
        user_id::text AS user_id,
        MIN(timestamp) AS first_order_at
      FROM client_web.new_user_order
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id::text
    ),

    fti_metrics AS (
      -- fti_users_who_watched requires the watch to have happened at
      -- or before the first order (causal ordering per §4).
      SELECT
        c.assigned_week AS week_start,
        c.variant,
        COUNT(DISTINCT f.user_id) AS fti_users,
        COUNT(DISTINCT CASE
          WHEN EXISTS (
            SELECT 1 FROM plays p
            WHERE p.user_id = f.user_id
              AND p.played_at <= f.first_order_at
          )
          THEN f.user_id
          END
        ) AS fti_users_who_watched
      FROM cohort c
      LEFT JOIN fti f ON f.user_id = c.user_id
                     AND f.first_order_at >= c.assigned_week
      GROUP BY c.assigned_week, c.variant
    )

    SELECT
      to_char(cs.week_start, 'YYYY-MM-DD')                                 AS week_start,
      cs.variant                                                           AS variant,
      cs.total_non_invested_users                                          AS total_non_invested_users,
      COALESCE(vm.learn_page_visitors, 0)                                  AS learn_page_visitors,
      ROUND(100.0 * vm.learn_page_visitors / NULLIF(cs.total_non_invested_users, 0), 2)
                                                                           AS learn_visit_rate_pct,
      COALESCE(pm.unique_video_players, 0)                                 AS unique_video_players,
      COALESCE(pm.total_video_plays, 0)                                    AS total_video_plays,
      ROUND(1.0 * pm.total_video_plays / NULLIF(pm.unique_video_players, 0), 2)
                                                                           AS avg_videos_per_user,
      ROUND(1.0 * pm.total_watched_seconds_sum / NULLIF(pm.total_video_plays, 0), 1)
                                                                           AS avg_watch_time_sec,
      COALESCE(fm.fti_users, 0)                                            AS fti_users,
      COALESCE(fm.fti_users_who_watched, 0)                                AS fti_users_who_watched,
      ROUND(100.0 * fm.fti_users / NULLIF(cs.total_non_invested_users, 0), 2)
                                                                           AS fti_rate_pct
    FROM cohort_sizes cs
    LEFT JOIN visit_metrics vm ON vm.week_start = cs.week_start AND vm.variant = cs.variant
    LEFT JOIN play_metrics  pm ON pm.week_start = cs.week_start AND pm.variant = cs.variant
    LEFT JOIN fti_metrics   fm ON fm.week_start = cs.week_start AND fm.variant = cs.variant
    ORDER BY cs.week_start, cs.variant
    """


CANONICAL_COLUMNS = [
    "week_start", "variant",
    "total_non_invested_users", "learn_page_visitors", "learn_visit_rate_pct",
    "unique_video_players", "total_video_plays", "avg_videos_per_user",
    "avg_watch_time_sec", "fti_users", "fti_users_who_watched", "fti_rate_pct",
]


def write_csv_atomic(path: Path, rows: list[dict], columns: list[str]) -> int:
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


def _probe(client, sql: str) -> tuple[int | None, str | None]:
    """Run one probe; return (count, error_message).

    `client.run_sql` returns (rows-as-dicts, column-names) per
    services/integrations/metabase.py.
    """
    try:
        rows, _cols = client.run_sql(DATABASE_ID, sql)
        if not rows:
            return 0, None
        # COUNT(*) is exposed under the alias "n" in both probe queries.
        return int(rows[0].get("n", 0)), None
    except MetabaseError as e:
        return None, str(e)


def _write_manifest(data_dir: Path, *, refreshed_at: str, tables: list[str]) -> None:
    """Mirror the asset_search / grip_connect _manifest.json convention so
    the frontend `Project.manifest` shape is populated and the dashboard
    can surface an "as-of" badge once it's added.
    """
    manifest_path = data_dir / "_manifest.json"
    manifest = {"refreshed_at": refreshed_at, "tables": {}}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except (ValueError, OSError):
            manifest = {"refreshed_at": refreshed_at, "tables": {}}
    manifest.setdefault("tables", {})
    manifest["refreshed_at"] = refreshed_at
    for t in tables:
        manifest["tables"][t] = {"last_refreshed_at": refreshed_at}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


def run(client, data_dir, *, today: date | None = None) -> dict:
    """Daily-refresh entry point. Called by services.integrations.refresh.

    Returns the canonical run-result dict: `{status, log (list), refreshed_at,
    rows_written?, tables_written?}`. Sibling modules pass `log` as a list
    of strings — refresh.py's CLI joins it for stdout — so we do the same.

    Idempotent: if either probe returns 0, status is `awaiting_first_event`
    and no CSV / manifest is written.
    """
    data_dir = Path(data_dir)
    log: list[str] = []

    # ─── Probe 1: events firing at all? ────────────────────────────────────
    n_views, err = _probe(client, PROBE_LEARN_PAGE_SQL)
    if err is not None:
        log.append(f"learn_page_viewed probe failed — {err}")
        return {"status": "error", "log": log, "refreshed_at": _now()}

    # ─── Probe 2: bucketing wired? ─────────────────────────────────────────
    n_assigned, err = _probe(client, PROBE_EXPERIMENT_SQL)
    if err is not None:
        log.append(f"experiment_assigned probe failed — {err}")
        return {"status": "error", "log": log, "refreshed_at": _now()}

    if n_views == 0 or n_assigned == 0:
        log.append(
            f"awaiting first prod data — learn_page_viewed={n_views}, "
            f"experiment_assigned(learn_page)={n_assigned}. The gi-client-web "
            f"feature has not started emitting yet. No data written."
        )
        return {
            "status": "awaiting_first_event",
            "log": log,
            "refreshed_at": _now(),
            "rows_written": 0,
        }

    log.append(
        f"probes ok — {n_views} learn_page_viewed, {n_assigned} "
        f"experiment_assigned in last 90 days"
    )

    # ─── Live path ─────────────────────────────────────────────────────────
    sql = build_weekly_ab_sql(weeks=WEEKS_OF_HISTORY)
    try:
        rows, _cols = client.run_sql(DATABASE_ID, sql)
    except MetabaseError as e:
        log.append(f"weekly_ab_tracker SQL failed — {e}")
        return {"status": "error", "log": log, "refreshed_at": _now()}

    out_path = data_dir / "weekly_ab_tracker.csv"
    n_written = write_csv_atomic(out_path, rows, CANONICAL_COLUMNS)
    log.append(f"wrote {n_written} rows → {out_path.relative_to(data_dir.parent)}")

    refreshed_at = _now()
    _write_manifest(data_dir, refreshed_at=refreshed_at, tables=["weekly_ab_tracker"])

    return {
        "status": "ok",
        "log": log,
        "refreshed_at": refreshed_at,
        "rows_written": n_written,
        "tables_written": ["weekly_ab_tracker"],
    }
