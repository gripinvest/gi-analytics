"""Learn (Grip Education) live-data fetch module.

Daily refresh of the weekly A/B tracker for the Learn page experiment
(`learn_page` experiment_name). Output is a single CSV
(`weekly_ab_tracker.csv`) plus a `_manifest.json` stamp — the dashboard
reads the CSV via DuckDB table `learn_education__weekly_ab_tracker`.

Two-database design
───────────────────
- Engagement data (cohort, visits, plays) lives in Rudder (DB 8,
  `client_web` schema). Pulled via `build_engagement_sql()`.
- FTI data (first-ever buy order per user) lives in the production
  transactions DB (DB 24, `tblorders` table). Pulled via
  `build_fti_sql()`. The canonical reference is the FTI dashboard
  Metabase question 2672 (FTI DoD non-PII):
      SELECT user_id, MIN(created_at) AS fti_date
      FROM tblorders
      WHERE status IN (1, 7, 8) AND order_type = 'BUY'
      GROUP BY user_id

Because Metabase does not support cross-database joins in native SQL,
we run two queries and merge in Python — same pattern as Grip Connect's
multi-card composition, just simpler.

Pre-launch status
─────────────────
The gi-client-web feature ships an event surface but no prod data
has been recorded yet. Two probes (`learn_page_viewed` and
`experiment_assigned(learn_page)`) gate the main fetch. Until both fire,
status is `awaiting_first_event` and nothing is written. The FTI query
is unconditional once probes pass — `tblorders` is always populated.

Spec: `docs/projects/learn-education/data-sources.md` §4.
"""
import csv
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

from .metabase import MetabaseError

# Rudder Prod, schema client_web — same as Asset Search / cohort + engagement.
RUDDER_DB_ID = 8

# Transactions DB — Metabase database_id 24 (ClickHouse warehouse).
# Source: business-analyst dashboards reference this same warehouse, so
# keeping our FTI numbers aligned to it eliminates cross-dashboard drift.
#
# `prodgripdb.tblorders` itself has column-level GRANT restrictions our
# service account can't satisfy, but `prodgripdb.ur_tblorders` is the
# unrestricted_user-role view that the role CAN read — analyst-grade
# access without the column-level perm hassle.
#
# (We were briefly on DB 2 / Postgres source-of-truth which also reads
# cleanly. Switched to DB 24 / ur_tblorders so our dashboard's numbers
# match what business analysts publish in their reports.)
TRANSACTIONS_DB_ID = 24
TRANSACTIONS_TABLE = "prodgripdb.ur_tblorders"

# Metabase /api/dataset endpoint caps each response at 2000 rows by default.
# Pagination keys on user_id and walks pages until a short read.
METABASE_ROW_CAP = 2000

# Test users excluded from every query path. Single-sourced across projects.
TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)

# Rolling window for the weekly tracker.
WEEKS_OF_HISTORY = 12

# tblorders.status codes that count toward FTI. Per Metabase question 2672:
# 1 = order placed, 7 = success, 8 = settled. The interim/failed statuses
# (2-6) do not count as a successful first-time investment.
FTI_ORDER_STATUSES = (1, 7, 8)

# Completion threshold for the "Completion rate" Tier 2 metric (V2-T2-4).
# Industry convention varies (50/75/90); 75 is the midpoint — meaningful
# watch without penalising users who skip outros. See data-sources.md §6.1
# and specs/2026-05-27-tier2-and-margin-notes.md §6.1.
COMPLETION_THRESHOLD_PCT = 75


# ─── Probes ───────────────────────────────────────────────────────────────
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


# ─── Engagement query (DB 8 — Rudder) ──────────────────────────────────────
# Returns one row per cohort user with their per-user engagement metrics.
# Aggregation up to (week, variant) happens in Python so we can also merge
# with the FTI list from DB 24 at user-level (causal-ordering for
# fti_users_who_watched requires user-level join keys).
def build_engagement_sql(
    weeks: int = WEEKS_OF_HISTORY,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> str:
    """Build the engagement query.

    `limit` and `offset` are appended to the final SELECT for
    pagination — see fetch_engagement_paginated() for the walker.
    Pass `limit=None` (default) to return the unbounded query (used by
    tests and SQL-shape pinning).

    The query orders by `user_id` so pagination produces stable,
    non-overlapping slices. Earlier versions ordered by
    (assigned_week, variant, user_id) which silently biased cap-
    truncated results toward Control (alphabetically before Treatment).
    """
    test_users_in = ",".join(f"'{u}'" for u in TEST_USERS)
    pagination = ""
    if limit is not None:
        pagination = f"\n    LIMIT {limit} OFFSET {offset}"
    return f"""
    WITH cohort AS (
      -- One row per (user, assignment-week, variant). experiment_assigned
      -- is deduped per-user-per-experiment via localStorage upstream
      -- (gi-client-web utils/experimentBucketing.ts), so each user
      -- appears in exactly one assignment-week row.
      --
      -- Variant landscape after the develop-branch experiment refactor:
      --   - 'control'     — bucket > treatmentPercentage
      --   - 'treatment'   — binary mode (no variants[] config in Strapi)
      --   - 'treatmentv1', 'treatmentv2', ...
      --                   — named-variants mode (variants[] in Strapi)
      --   - 'gc_excluded' / 'not_eligible' — would only appear if
      --                   trackExperimentAssignment misroutes; filter
      --                   defensively. These are surfaced by
      --                   getExperimentAssignment but never reach the
      --                   tracking event in the documented call path.
      SELECT
        user_id::text AS user_id,
        experiment_variant AS variant,
        DATE_TRUNC('week', timestamp)::date AS assigned_week
      FROM client_web.experiment_assigned
      WHERE experiment_name = 'learn_page'
        AND timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id::text NOT IN ({test_users_in})
        AND experiment_variant IS NOT NULL
        AND experiment_variant NOT IN ('gc_excluded', 'not_eligible')
    ),

    visits AS (
      SELECT
        user_id::text AS user_id,
        COUNT(*) AS visit_count
      FROM client_web.learn_page_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id::text
    ),

    plays AS (
      -- Genuine plays (total_watched_seconds > 0). Filters silent
      -- autoplay-failure rows per data-sources.md §6 Q1 default.
      -- `completed_play_count` filters by completion_pct >= 75; the
      -- threshold lives as a constant in this module so product can
      -- shift it without redrawing the SQL.
      SELECT
        user_id::text AS user_id,
        COUNT(*) AS play_count,
        COUNT(*) FILTER (
          WHERE completion_pct >= {COMPLETION_THRESHOLD_PCT}
        ) AS completed_play_count,
        SUM(total_watched_seconds) AS watch_seconds_sum,
        MIN(timestamp) AS first_play_at
      FROM client_web.learn_video_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND total_watched_seconds > 0
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id::text
    ),

    page_views AS (
      -- Earliest page view per user — feeds time-to-first-play
      -- (Tier 2 #5). Distinct from the `visits` CTE above which counts.
      SELECT
        user_id::text AS user_id,
        MIN(timestamp) AS first_page_viewed_at
      FROM client_web.learn_page_viewed
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id::text
    ),

    video_opens AS (
      -- Earliest video-open per user — the "intent" event before reels
      -- actually start. Pairs with page_views above to compute median
      -- time-to-first-play.
      SELECT
        user_id::text AS user_id,
        MIN(timestamp) AS first_video_opened_at
      FROM client_web.learn_video_opened
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
      GROUP BY user_id::text
    ),

    outbound AS (
      -- 1 if any outbound click, else nothing. Aggregator counts users
      -- with a row here as "outbound clickers" for the CTR metric.
      SELECT DISTINCT user_id::text AS user_id
      FROM client_web.learn_outbound_clicked
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
    ),

    banner_on_learn AS (
      -- Banner clicks that happened on /learn. The banner widget fires
      -- the same canonical `banner_clicked` event everywhere; filter by
      -- the page attribute. Cross-feature event — see D-03 in decisions.md.
      SELECT DISTINCT user_id::text AS user_id
      FROM client_web.banner_clicked
      WHERE timestamp >= NOW() - INTERVAL '{weeks} weeks'
        AND page = '/learn'
        AND user_id IS NOT NULL
        AND user_id::text NOT IN ({test_users_in})
    )

    SELECT
      c.user_id                                AS user_id,
      c.variant                                AS variant,
      to_char(c.assigned_week, 'YYYY-MM-DD')   AS assigned_week,
      COALESCE(v.visit_count, 0)               AS visit_count,
      COALESCE(p.play_count, 0)                AS play_count,
      COALESCE(p.completed_play_count, 0)      AS completed_play_count,
      COALESCE(p.watch_seconds_sum, 0)         AS watch_seconds_sum,
      p.first_play_at                          AS first_play_at,
      pv.first_page_viewed_at                  AS first_page_viewed_at,
      vo.first_video_opened_at                 AS first_video_opened_at,
      CASE WHEN ob.user_id IS NOT NULL THEN 1 ELSE 0 END AS outbound_clicked,
      CASE WHEN bn.user_id IS NOT NULL THEN 1 ELSE 0 END AS learn_banner_clicked
    FROM cohort c
    LEFT JOIN visits v          ON v.user_id  = c.user_id
    LEFT JOIN plays  p          ON p.user_id  = c.user_id
    LEFT JOIN page_views pv     ON pv.user_id = c.user_id
    LEFT JOIN video_opens vo    ON vo.user_id = c.user_id
    LEFT JOIN outbound ob       ON ob.user_id = c.user_id
    LEFT JOIN banner_on_learn bn ON bn.user_id = c.user_id
    ORDER BY c.user_id{pagination}
    """


def fetch_engagement_paginated(client, weeks: int = WEEKS_OF_HISTORY) -> list[dict]:
    """Walk the engagement query in METABASE_ROW_CAP-sized pages.

    Metabase's /api/dataset caps response at 2000 rows by default. With
    today's cohort already at ~2500 users, a single unpaginated call
    truncates Treatment users (the ORDER BY user_id keeps cohort
    distribution unbiased across the cap boundary, vs the old
    ORDER BY variant which silently biased toward Control).

    Stops on the first short read. Returns the flat list of per-user
    engagement rows for downstream aggregation.
    """
    out: list[dict] = []
    offset = 0
    while True:
        sql = build_engagement_sql(
            weeks=weeks, limit=METABASE_ROW_CAP, offset=offset
        )
        rows, _ = client.run_sql(RUDDER_DB_ID, sql)
        if not rows:
            break
        out.extend(rows)
        if len(rows) < METABASE_ROW_CAP:
            break
        offset += METABASE_ROW_CAP
    return out


# ─── FTI query (DB 24 — transactions) ──────────────────────────────────────
# Canonical FTI definition per Metabase question 2672:
# first BUY order per user where status indicates a successful purchase
# (1 = placed, 7 = success, 8 = settled). Other statuses are interim or
# failed and do not count.
#
# The query is **scoped to cohort user_ids** (passed in as `cohort_ids`)
# for two reasons:
#   1. Result size — without scoping, we'd return the full FTI universe
#      (~2000+ users) and silently hit Metabase's 2000-row cap. Scoping
#      keeps the result under a few hundred FTI rows for a single week
#      of cohort, well under cap.
#   2. Cost — querying ur_tblorders unscoped is a full table scan; with
#      `user_id IN (...)` ClickHouse uses the user_id index.
#
# A `LIMIT/OFFSET` pagination loop in fetch_fti_for_cohort() walks the
# result anyway as belt-and-suspenders against future cohort growth past
# 2000 FTI matches.
def build_fti_sql(cohort_ids: list[int], *, limit: int, offset: int) -> str:
    test_users_in = ",".join(str(u) for u in TEST_USERS)
    statuses_in = ",".join(str(s) for s in FTI_ORDER_STATUSES)
    cohort_in = ",".join(str(i) for i in cohort_ids)
    return f"""
    SELECT
      user_id,
      MIN(created_at) AS fti_date
    FROM {TRANSACTIONS_TABLE}
    WHERE status IN ({statuses_in})
      AND order_type = 'BUY'
      AND user_id NOT IN ({test_users_in})
      AND user_id IN ({cohort_in})
    GROUP BY user_id
    ORDER BY user_id
    LIMIT {limit} OFFSET {offset}
    """


# Daily-order COUNT probe — gives an empirical floor for the cap-vs-truth
# question and surfaces the order volume to the operator on every run.
DAILY_ORDER_PROBE_SQL = f"""
SELECT COUNT(*) AS n
FROM {TRANSACTIONS_TABLE}
WHERE status IN ({','.join(str(s) for s in FTI_ORDER_STATUSES)})
  AND order_type = 'BUY'
  AND created_at >= toStartOfDay(now() - INTERVAL 1 DAY)
  AND created_at <  toStartOfDay(now())
"""


def fetch_fti_for_cohort(client, cohort_ids: list[int]) -> list[dict]:
    """Paginated FTI fetch — scoped to cohort users only.

    Walks Metabase's 2000-row paging by ORDER BY user_id LIMIT 2000
    OFFSET n, stopping on a short read. Returns a flat list of
    {user_id, fti_date} dicts.

    The cohort_ids list is converted to int on the way in — Rudder
    stores user_id as varchar but ur_tblorders / tblorders use the
    integer primary key. Non-integer cohort ids (anonymous_id leakage)
    are silently dropped; we can only attribute FTI to logged-in users.
    """
    int_ids: list[int] = []
    for uid in cohort_ids:
        try:
            int_ids.append(int(uid))
        except (ValueError, TypeError):
            continue
    if not int_ids:
        return []

    out: list[dict] = []
    offset = 0
    while True:
        sql = build_fti_sql(int_ids, limit=METABASE_ROW_CAP, offset=offset)
        rows, _ = client.run_sql(TRANSACTIONS_DB_ID, sql)
        if not rows:
            break
        out.extend(rows)
        if len(rows) < METABASE_ROW_CAP:
            break
        offset += METABASE_ROW_CAP
    return out


# ─── Output schema ─────────────────────────────────────────────────────────
# Order matches the canonical product spreadsheet. Frontend reads these
# column names verbatim via lib/queries/learnEducation.js:COLUMNS.
CANONICAL_COLUMNS = [
    # Tier 1 — the product spreadsheet columns.
    "week_start", "variant",
    "total_non_invested_users", "learn_page_visitors", "learn_visit_rate_pct",
    "unique_video_players", "total_video_plays", "avg_videos_per_user",
    "avg_watch_time_sec", "fti_users", "fti_users_who_watched", "fti_rate_pct",
    # Tier 2 — derived metrics added in V2 (see specs/2026-05-27-...).
    "engaged_visitor_rate_pct",      # T2 #1 — unique_players / visitors
    "plays_per_visitor",             # T2 #2 — plays / visitors
    "drop_after_first_pct",          # T2 #3 — 1 - (multi-play / players)
    "completion_rate_pct",           # T2 #4 — plays w/ pct >= 75 / plays
    "median_time_to_first_play_sec", # T2 #5 — median(open - view) per user
    "outbound_click_rate_pct",       # T2 #6 — outbound clickers / visitors
    "banner_ctr_on_learn_pct",       # T2 #7 — banner clickers on /learn / visitors
]


# ─── Python aggregation — merge engagement + FTI per (week, variant) ───────
def aggregate_rows(engagement_rows: list[dict], fti_rows: list[dict]) -> list[dict]:
    """Combine per-user engagement (Rudder) with per-user FTI (transactions DB)
    into per-(week, variant) summary rows matching CANONICAL_COLUMNS.

    Pure function — no SQL, no I/O. Easy to unit-test.
    """
    # Build FTI lookup. tblorders.user_id is an integer in Postgres; the
    # Rudder side is text. Normalise to string on both sides so the join works.
    fti_by_user: dict[str, str] = {}
    for r in fti_rows:
        uid = r.get("user_id")
        fti_date = r.get("fti_date")
        if uid is None or fti_date is None:
            continue
        fti_by_user[str(uid)] = _to_iso(fti_date)

    # Accumulate per (week_start, variant). Tier 1 counters + Tier 2
    # additions (multi_play_users for drop-after-first; completed_plays
    # for completion rate; outbound/banner clickers for CTR metrics;
    # ttfp_seconds_list for the median time-to-first-play).
    int_keys = (
        "total_non_invested_users", "learn_page_visitors",
        "unique_video_players", "total_video_plays",
        "completed_plays", "multi_play_users",
        "outbound_clickers", "banner_clickers",
        "fti_users", "fti_users_who_watched",
    )

    def _new_bucket() -> dict:
        b = {k: 0 for k in int_keys}
        b["watch_seconds_sum"] = 0.0
        b["ttfp_seconds_list"] = []  # one entry per engaged user
        return b

    groups: dict[tuple[str, str], dict] = defaultdict(_new_bucket)

    for r in engagement_rows:
        week = r["assigned_week"]
        variant = r["variant"]
        key = (week, variant)
        bucket = groups[key]

        bucket["total_non_invested_users"] += 1

        visit_count = int(r.get("visit_count") or 0)
        if visit_count > 0:
            bucket["learn_page_visitors"] += 1

        play_count = int(r.get("play_count") or 0)
        if play_count > 0:
            bucket["unique_video_players"] += 1
            bucket["total_video_plays"] += play_count
            bucket["watch_seconds_sum"] += float(r.get("watch_seconds_sum") or 0)
            bucket["completed_plays"] += int(r.get("completed_play_count") or 0)
            # Drop-after-first: users with >1 play.
            if play_count > 1:
                bucket["multi_play_users"] += 1

        # Tier 2 — outbound + banner uniques per cohort user.
        if int(r.get("outbound_clicked") or 0) > 0:
            bucket["outbound_clickers"] += 1
        if int(r.get("learn_banner_clicked") or 0) > 0:
            bucket["banner_clickers"] += 1

        # Tier 2 #5 — time-to-first-play. Engaged users only (those with
        # both a page view AND a video open). Diff in seconds via
        # _seconds_between() which is timezone-agnostic on ISO strings.
        ttfp = _seconds_between(
            r.get("first_page_viewed_at"),
            r.get("first_video_opened_at"),
        )
        if ttfp is not None and ttfp >= 0:
            bucket["ttfp_seconds_list"].append(ttfp)

        # FTI attribution — sticky bucketing. A user assigned in W1 who
        # FTIs in W3 counts under W1's row (matches product spreadsheet
        # mental model).
        user_id = str(r["user_id"])
        fti_date = fti_by_user.get(user_id)
        # `fti_date >= assigned_week` enforces "after assignment" — defensive
        # guard against a useShowLearnPage bug; should always be true since
        # the hook gates on !isInvested.
        if fti_date and fti_date >= week:
            bucket["fti_users"] += 1
            # fti_users_who_watched — causal ordering: the watch must have
            # happened at or before the first order.
            first_play_at = r.get("first_play_at")
            if first_play_at and _to_iso(first_play_at) <= fti_date:
                bucket["fti_users_who_watched"] += 1

    # Materialise final rows in canonical order.
    out: list[dict] = []
    for (week, variant) in sorted(groups.keys()):
        g = groups[(week, variant)]
        denom = g["total_non_invested_users"] or 1  # guarded division
        plays = g["total_video_plays"] or 0
        players = g["unique_video_players"] or 0
        visitors = g["learn_page_visitors"] or 0

        out.append({
            # Tier 1.
            "week_start": week,
            "variant": variant,
            "total_non_invested_users": g["total_non_invested_users"],
            "learn_page_visitors": visitors,
            "learn_visit_rate_pct": round(100.0 * visitors / denom, 2),
            "unique_video_players": players,
            "total_video_plays": plays,
            "avg_videos_per_user": round(plays / players, 2) if players else None,
            "avg_watch_time_sec": round(g["watch_seconds_sum"] / plays, 1) if plays else None,
            "fti_users": g["fti_users"],
            "fti_users_who_watched": g["fti_users_who_watched"],
            "fti_rate_pct": round(100.0 * g["fti_users"] / denom, 2),
            # Tier 2 — derived metrics.
            "engaged_visitor_rate_pct": (
                round(100.0 * players / visitors, 2) if visitors else None
            ),
            "plays_per_visitor": (
                round(plays / visitors, 2) if visitors else None
            ),
            "drop_after_first_pct": (
                round(100.0 * (1.0 - g["multi_play_users"] / players), 2)
                if players else None
            ),
            "completion_rate_pct": (
                round(100.0 * g["completed_plays"] / plays, 2) if plays else None
            ),
            "median_time_to_first_play_sec": _median_or_none(
                g["ttfp_seconds_list"]
            ),
            "outbound_click_rate_pct": (
                round(100.0 * g["outbound_clickers"] / visitors, 2)
                if visitors else None
            ),
            "banner_ctr_on_learn_pct": (
                round(100.0 * g["banner_clickers"] / visitors, 2)
                if visitors else None
            ),
        })
    return out


def _seconds_between(start_iso, end_iso) -> float | None:
    """Seconds from start to end. Returns None if either is missing or
    if parsing fails. Used for time-to-first-play computation."""
    if not start_iso or not end_iso:
        return None
    try:
        from datetime import datetime
        s = _parse_iso(start_iso)
        e = _parse_iso(end_iso)
        return (e - s).total_seconds()
    except (ValueError, TypeError):
        return None


def _parse_iso(value):
    """Parse a Metabase timestamp into a datetime. Accepts datetime
    instances directly (some drivers surface them), strings in ISO
    format, or anything with an isoformat() method."""
    from datetime import datetime
    if hasattr(value, "year"):  # already a datetime/date
        return value
    s = str(value)
    # Strip trailing Z that Python < 3.11 won't parse on fromisoformat.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _median_or_none(values: list[float]) -> int | None:
    """Median in seconds, rounded to int. None for an empty list."""
    if not values:
        return None
    from statistics import median
    return int(round(median(values)))


def _to_iso(value) -> str:
    """Normalise a date/datetime/str to ISO-8601 string for comparison.

    Metabase usually returns dates as strings already, but be defensive —
    different drivers may surface datetime or date instances.
    """
    if isinstance(value, str):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


# ─── I/O helpers ───────────────────────────────────────────────────────────
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
    """Run one probe; return (count, error_message)."""
    try:
        rows, _cols = client.run_sql(RUDDER_DB_ID, sql)
        if not rows:
            return 0, None
        return int(rows[0].get("n", 0)), None
    except MetabaseError as e:
        return None, str(e)


def _write_manifest(
    data_dir: Path,
    *,
    refreshed_at: str,
    tables: list[str],
    margin_notes: dict | None = None,
) -> None:
    """Mirror the asset_search / grip_connect _manifest.json convention so
    the frontend `Project.manifest` shape is populated and the dashboard
    can surface an "as-of" badge once it's added.

    `margin_notes` is the dict returned by
    `learn_education_stats.compose_margin_notes()`. When present, it's
    stuffed under a top-level key for the dashboard to render the
    Margin Notes section directly off the manifest (no DuckDB query
    needed for the four indicators).
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
    if margin_notes is not None:
        manifest["margin_notes"] = margin_notes
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


# ─── Entry point ───────────────────────────────────────────────────────────
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

    # ─── Engagement query (DB 8 — Rudder, paginated) ───────────────────────
    # Paginated since the cohort already exceeds Metabase's 2000-row cap.
    # See fetch_engagement_paginated() for the walker.
    try:
        engagement_rows = fetch_engagement_paginated(client, weeks=WEEKS_OF_HISTORY)
    except MetabaseError as e:
        log.append(f"engagement query failed (DB {RUDDER_DB_ID}) — {e}")
        return {"status": "error", "log": log, "refreshed_at": _now()}
    log.append(f"engagement: {len(engagement_rows)} per-user rows from Rudder")

    # Diagnostic: cohort-side variant breakdown — surfaces SRM at the
    # source data level. Useful for catching pagination/order bugs and
    # actual experiment bucketing drift.
    from collections import Counter
    variant_counts = Counter(r.get("variant") for r in engagement_rows)
    log.append(
        f"cohort by variant: " +
        ", ".join(f"{v}={n}" for v, n in sorted(variant_counts.items()))
    )

    # ─── Daily-order volume probe (DB 24 — transactions) ──────────────────
    # Surfaces "BUY orders yesterday" so the operator can sanity-check
    # the FTI numerator's universe size on every run. Errors here are
    # non-fatal — just log and continue.
    try:
        probe_rows, _ = client.run_sql(TRANSACTIONS_DB_ID, DAILY_ORDER_PROBE_SQL)
        if probe_rows:
            daily_orders = int(probe_rows[0].get("n", 0))
            log.append(f"daily-order probe: {daily_orders} BUY orders yesterday")
    except MetabaseError as e:
        log.append(f"daily-order probe failed (non-fatal) — {e}")

    # ─── FTI query (DB 24 — transactions) ──────────────────────────────────
    # Scoped to cohort user_ids only. Pagination loop handles the 2000
    # /api/dataset row cap.
    cohort_ids = [r["user_id"] for r in engagement_rows if r.get("user_id") is not None]
    try:
        fti_rows = fetch_fti_for_cohort(client, cohort_ids)
    except MetabaseError as e:
        log.append(f"FTI query failed (DB {TRANSACTIONS_DB_ID}) — {e}")
        return {"status": "error", "log": log, "refreshed_at": _now()}
    log.append(
        f"fti: {len(fti_rows)} FTI rows from {TRANSACTIONS_TABLE} "
        f"(scoped to {len(cohort_ids)} cohort users)"
    )

    # Diagnostic: how many FTI rows have fti_date in the current cohort
    # week vs earlier. If most are earlier, that's the gate-leak signal
    # (cohort users who were pre-existing investors). If many are recent,
    # the experiment is converting users. This breakdown distinguishes
    # the two cases for operators reading the log.
    if engagement_rows and fti_rows:
        weeks_in_data = sorted({r.get("assigned_week") for r in engagement_rows
                                if r.get("assigned_week")})
        latest_week = weeks_in_data[-1] if weeks_in_data else None
        if latest_week:
            recent = sum(
                1 for r in fti_rows
                if _to_iso(r.get("fti_date") or "") >= latest_week
            )
            log.append(
                f"fti breakdown: {recent} have fti_date >= {latest_week} "
                f"(would count as post-assignment FTI); "
                f"{len(fti_rows) - recent} are pre-experiment "
                f"(gate-leak signal — these users were already invested when bucketed)"
            )

            # Diagnostic: sample user_ids from BOTH sides + actual match
            # count. If matches << expected, the join is broken (most
            # likely Rudder text vs ur_tblorders int formatting mismatch).
            eng_sample = [(str(r.get("user_id")), type(r.get("user_id")).__name__)
                          for r in engagement_rows[:3]]
            fti_sample = [(str(r.get("user_id")), type(r.get("user_id")).__name__)
                          for r in fti_rows[:3]]
            log.append(f"engagement user_id sample: {eng_sample}")
            log.append(f"fti user_id sample: {fti_sample}")

            # Direct match count — confirms whether the str(uid) keying
            # actually finds rows.
            fti_keys = {str(r.get("user_id")) for r in fti_rows}
            eng_user_ids = {str(r.get("user_id")) for r in engagement_rows}
            overlap = fti_keys & eng_user_ids
            log.append(
                f"user_id overlap: {len(overlap)} engagement∩FTI matches "
                f"(of {len(eng_user_ids)} engagement, {len(fti_keys)} FTI)"
            )

    # ─── Merge ─────────────────────────────────────────────────────────────
    summary_rows = aggregate_rows(engagement_rows, fti_rows)
    log.append(f"merged into {len(summary_rows)} (week, variant) rows")

    # ─── Margin Notes (V2 — Tier 3 A/B integrity indicators) ───────────────
    # Computed off the just-aggregated rows; written into the manifest so
    # the frontend renders the four cards directly without an extra
    # DuckDB query.
    from .learn_education_stats import compose_margin_notes
    margin_notes = compose_margin_notes(summary_rows=summary_rows)
    if margin_notes:
        log.append(
            f"margin notes (as_of_week={margin_notes['as_of_week']}): "
            f"srm={margin_notes['srm']['verdict']}, "
            f"control_leak={margin_notes['control_leak']['verdict']}, "
            f"fti_ci={margin_notes['fti_lift_ci']['verdict']}, "
            f"mde={margin_notes['mde'].get('mde_abs_pp')}pp"
        )

    out_path = data_dir / "weekly_ab_tracker.csv"
    n_written = write_csv_atomic(out_path, summary_rows, CANONICAL_COLUMNS)
    log.append(f"wrote {n_written} rows → {out_path.relative_to(data_dir.parent)}")

    refreshed_at = _now()
    _write_manifest(
        data_dir,
        refreshed_at=refreshed_at,
        tables=["weekly_ab_tracker"],
        margin_notes=margin_notes,
    )

    return {
        "status": "ok",
        "log": log,
        "refreshed_at": refreshed_at,
        "rows_written": n_written,
        "tables_written": ["weekly_ab_tracker"],
    }
