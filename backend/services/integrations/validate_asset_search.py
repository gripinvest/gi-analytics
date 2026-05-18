"""Validate Asset Search dashboard data points against Metabase (source of truth).

Session S3 of the Asset Search plan. The dashboard reads frozen weekly CSV
exports (W1-W6) baked into grip.duckdb; every number it shows is computed by
the SQL builders in frontend/lib/queries/assetSearch.js and conversion.js.
This script re-computes each of those metrics two ways and diffs them:

  * LOCAL    — the W1-W6 CSVs, read with the same read_csv_auto(ignore_errors)
               path build_duckdb.py uses, so we validate exactly what the
               dashboard sees.
  * METABASE — the live `client_web` schema on Metabase database 8, the
               upstream source of truth.

Design — one SQL body, two backends. Each check is one SELECT referencing
logical relations (ev_query, ev_clicked, ...). LocalSource materialises them as
DuckDB tables; MetabaseSource injects them as CTEs over `client_web.*`. The
aggregate logic is therefore written once and provably identical on both sides
— the only thing that varies is the data source.

Window anchoring. Each Metabase relation is filtered to the exact UTC
[min, max] timestamp interval of its local CSV slice (timestamps load as naive
UTC — see conversion.js). That removes week-boundary and IST/UTC ambiguity: the
question becomes "for precisely the rows that were exported, does Metabase still
agree?" rather than "did the export use the same calendar boundary I guessed?".

Discipline. This is a credentialed *validation* job, not an extraction (no LLM
in the data path; Claude authored it, CI or the user runs it against Metabase).
  python -m services.integrations.validate_asset_search --local-only
  python -m services.integrations.validate_asset_search        # needs METABASE_*

Verdict policy (two-tier — locked decision, S3):
  exact match                      -> CONFIRMED
  drift <= 5 rows or <= 0.5% (counts) / <= 0.3pp (percentages) -> MINOR DRIFT
  larger                           -> DISCREPANT
MINOR DRIFT is informational — it absorbs Rudderstack events that arrived after
the CSV was exported; it is not a failure.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

# ─────────────────────────────────────────────────────────────────────────────
# Constants — kept in lock-step with frontend/lib/queries/assetSearch.js
# ─────────────────────────────────────────────────────────────────────────────

DATABASE_ID = 8                       # Metabase "Rudder Prod", schema client_web
SCHEMA = "client_web"
TEST_USERS = [3, 4, 207871, 207875, 207878, 207879]

# Two-tier verdict thresholds (S3 locked decision).
DRIFT_ROWS = 5        # absolute count drift still called MINOR
DRIFT_PCT = 0.5       # relative count drift (%) still called MINOR
DRIFT_PP = 0.3        # percentage-point drift on a *_pct column still called MINOR

# event key -> (csv filename suffix, Metabase table). The 6 search events plus
# the 3 conversion-context tables the dashboard joins to.
EVENT_TABLES = {
    "initiated":         ("asset_search_initiated",         "asset_search_initiated"),
    "query":             ("asset_search_query",             "asset_search_query"),
    "empty_state":       ("asset_search_empty_state",        "asset_search_empty_state"),
    "result_clicked":    ("asset_search_result_clicked",     "asset_search_result_clicked"),
    "suggestion_clicked": ("asset_search_suggestion_clicked", "asset_search_suggestion_clicked"),
    "cleared":           ("asset_search_cleared",            "asset_search_cleared"),
    "invest_now":        ("invest_now_button_clicked",        "invest_now_button_clicked"),
    "quick_checkout":    ("quick_checkout_invest_clicked",   "quick_checkout_invest_clicked"),
    # assets_page_views is a DERIVED export (metabase-connect/derive_page_views.py
    # projects client_web.view_assets down to 6 columns). Its Metabase counterpart
    # is the raw view_assets event — an ~88-95% distinct-user overlap is expected
    # by design, so adoption checks built on it are reported as INFORMATIONAL.
    "page_views":        ("assets_page_views",              "view_assets"),
}

# data-sources.md §0 — the row counts the doc should state for W1-W6 (raw
# COUNT(*), all weeks). The --local-only run diffs the actual local CSVs against
# these, so it doubles as a regression guard on the doc.
#
# These are the CORRECTED values. The doc originally claimed query=29,582 /
# empty=12,845 / clicked=4,384 / cleared=3,282 / initiated=10,294 /
# suggestion=887 — see FINDINGS[F1]: those summed metabase-connect/'s superseded
# partial-W6 export on top of the full week. The dashboard data was always
# correct; S3 corrected the doc.
DOC_CLAIMS_W1_W6 = {
    "query": 26544,
    "empty_state": 11509,
    "result_clicked": 3897,
    "cleared": 2967,
    "initiated": 9252,
    "suggestion_clicked": 804,
}

# Discrepancies S3 found and resolved. Rendered into the report so the run is
# self-documenting. (id, severity, title, detail, resolution).
FINDINGS = [
    ("F1", "doc error (resolved)",
     "data-sources.md §0 overstated every W1-W6 row count",
     "§0 claimed query=29,582 / empty_state=12,845 / result_clicked=4,384 / "
     "cleared=3,282 / initiated=10,294 / suggestion_clicked=887. Those totals "
     "were summed from `metabase-connect/`, which holds TWO W6 exports — a "
     "superseded partial (`W6_may07-may11`) and the full week "
     "(`W6_may07-may13`) — and the partial was counted on top of the full "
     "week. Verified exactly for all six events: e.g. query 26,544 (real) + "
     "3,038 (stale partial) = 29,582 (the doc figure). The dashboard's "
     "deployed data (`backend/data/asset_search/`, full W6 only) was always "
     "correct.",
     "data-sources.md §0 corrected to the real raw counts (query=26,544 / "
     "empty_state=11,509 / result_clicked=3,897 / cleared=2,967 / "
     "initiated=9,252 / suggestion_clicked=804). The §0 check below is now a "
     "regression guard and should read CONFIRMED."),
]

# Issuer keyword map — ported verbatim from ISSUER_MAP in assetSearch.js. Only
# `name` + `keywords` are needed to reproduce issuerCaseExpr(); `category`/`note`
# are analyst metadata the dashboard carries statically and are not data points.
# KEEP IN SYNC with assetSearch.js — a divergence here would itself be a finding.
ISSUER_MAP = [
    ("Govt / RBI Bonds", ["rbi", "rbi floating rate bond", "rbi savings bond",
                          "govt", "government bond", "gov bond", "govt sec"]),
    ("Akara Capital", ["aka", "akar", "akara", "akara capital",
                       "akara capital advisors pvt ltd", "akara ncd"]),
    ("Muthoot Finance", ["mut", "muth", "muthoot", "muthoot finance",
                         "muthoot fincorp", "muthoot microfin", "muthoot capital"]),
    ("Navi", ["nav", "navi", "navi finserv", "navi finserve", "navi ncd"]),
    ("Keertana", ["kee", "keer", "keert", "keertana", "keertana finserv", "keerthana"]),
    ("Unifinz", ["unif", "unifi", "unifin", "unifinz", "unifinz capital",
                 "unifinj capital india"]),
    ("Vedika Credit", ["ved", "vedi", "vedik", "vedika", "vedika credit",
                       "vedikacradit capital ltd"]),
    ("Mufin Finance", ["muf", "mufi", "mufin", "mufin green", "mufin green finance",
                       "mufin ncd"]),
    ("Adani", ["ada", "adani", "adani green", "adani power",
               "adani energy solutions", "adani enterprise"]),
    ("Indel Money", ["inde", "indel", "indel money", "indel oct 27", "indel money ncd"]),
]


def _sql_str(s: str) -> str:
    """A SQL string literal (single-quote escaped)."""
    return "'" + s.replace("'", "''") + "'"


def _like_arg(s: str) -> str:
    """A LIKE-pattern literal — escapes %, _, \\ as well as quotes (mirrors
    the `esc` helper in assetSearch.js)."""
    s = s.replace("'", "''")
    s = re.sub(r"([%_\\])", r"\\\1", s)
    return "'" + s + "'"


def issuer_case_expr(col: str = "query_text") -> str:
    """Reproduce issuerCaseExpr() from assetSearch.js: a query matches an issuer
    when, for any of its keywords, the query is a prefix of the keyword OR the
    keyword is a prefix of the query. First matching issuer wins."""
    q = f"LOWER(TRIM({col}))"
    arms = []
    for name, keywords in ISSUER_MAP:
        conds = " OR ".join(
            f"({q} LIKE {_like_arg(k)} ESCAPE '\\' OR {_like_arg(k)} LIKE {q} || '%')"
            for k in (kw.lower().strip() for kw in keywords)
        )
        arms.append(f"WHEN {conds} THEN {_sql_str(name)}")
    return "CASE " + " ".join(arms) + " ELSE NULL END"


# ─────────────────────────────────────────────────────────────────────────────
# Read-only safety guard
# ─────────────────────────────────────────────────────────────────────────────

_WRITE_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|"
    r"merge|copy|call|vacuum)\b", re.IGNORECASE)


def assert_read_only(sql: str) -> None:
    """Guard — every query this harness sends to Metabase must be a single
    read-only SELECT/WITH. Raises ValueError otherwise. The harness only ever
    builds SELECTs; this makes a credentialed run *provably* incapable of
    writing, on top of scoping METABASE_API_KEY read-only in Metabase itself."""
    stripped = sql.strip().rstrip(";")
    if ";" in stripped:
        raise ValueError("read-only guard: multiple statements are not allowed")
    if not re.match(r"(?is)\s*(with|select)\b", stripped):
        raise ValueError("read-only guard: query must begin with SELECT or WITH")
    hit = _WRITE_KEYWORDS.search(stripped)
    if hit:
        raise ValueError(f"read-only guard: forbidden keyword '{hit.group(0)}'")


# ─────────────────────────────────────────────────────────────────────────────
# Data sources — LocalSource (DuckDB over CSVs) and MetabaseSource (REST)
# ─────────────────────────────────────────────────────────────────────────────

# Per-event column projection. Each tuple is (output_name, source_expr). The
# source columns listed exist in every weekly CSV *and* the Metabase table; the
# W1-W3 slim exports and the W4-W6 wide exports both carry these.
EXC = f"(uid IS NULL OR uid NOT IN ({','.join(map(str, TEST_USERS))}))"

# uid is parsed as DOUBLE on both sides (W1-W3 store user_id as "622564.0").
_LOCAL_UID = "TRY_CAST(user_id AS DOUBLE)"
_MB_UID = "CAST(NULLIF(CAST(user_id AS TEXT), '') AS DOUBLE PRECISION)"
_LOCAL_AID = "TRY_CAST(TRY_CAST({c} AS DOUBLE) AS BIGINT)"
_MB_AID = "CAST(NULLIF(CAST({c} AS TEXT), '') AS DOUBLE PRECISION)"
# IST calendar day: timestamps load as naive UTC, +330 min -> IST wall clock.
_IST_DAY = "CAST(\"timestamp\" + INTERVAL '330 minutes' AS DATE)"

# (logical relation -> list of event keys it unions, and the column body).
# {uid}/{aid}/{istday} are filled per backend.
EV_SPECS = {
    "ev_query": (["query"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid, query_text, '
        'CAST(results_count AS BIGINT) AS results_count, '
        'CAST(is_refinement AS BOOLEAN) AS is_refinement, active_tab'),
    "ev_clicked": (["result_clicked"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid, query_text, '
        '{aid_clicked} AS asset_id, clicked_asset_name AS asset_name, '
        'clicked_asset_type AS asset_type, '
        'CAST(result_position AS BIGINT) AS result_position, '
        '{istday} AS ist_day, active_tab'),
    "ev_empty": (["empty_state"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid, query_text, '
        'CAST(query_length AS BIGINT) AS query_length, active_tab'),
    "ev_initiated": (["initiated"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid, '
        '{istday} AS ist_day, active_tab'),
    "ev_suggestion": (["suggestion_clicked"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid, '
        'CAST(item_position AS BIGINT) AS item_position'),
    "ev_cleared": (["cleared"],
        '"timestamp" AS ts, context_session_id AS sid, {uid} AS uid'),
    "ev_invest": (["invest_now", "quick_checkout"],
        '"timestamp" AS ts, {uid} AS uid, {istday} AS ist_day, '
        '{aid} AS asset_id, product_category'),
    "ev_pageviews": (["page_views"],
        '"timestamp" AS ts, {uid} AS uid'),
}


class LocalSource:
    """The dashboard's data, read from the W1-W6 CSVs exactly as build_duckdb.py
    does (read_csv_auto, ignore_errors=true). Materialises each ev_* relation as
    a DuckDB table once, on first use."""

    name = "local"

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.con = duckdb.connect(":memory:")
        self._files = self._discover()       # event key -> {week:int -> Path}
        self._built: set[str] = set()
        self.windows: dict[str, dict[int, tuple[str, str]]] = {}

    def _discover(self) -> dict[str, dict[int, Path]]:
        out: dict[str, dict[int, Path]] = {ev: {} for ev in EVENT_TABLES}
        for ev, (suffix, _) in EVENT_TABLES.items():
            for path in sorted(self.data_dir.glob(f"W*_{suffix}.csv")):
                m = re.match(r"W(\d+)_", path.name)
                if m:
                    out[ev][int(m.group(1))] = path
        return out

    def weeks(self, event: str) -> list[int]:
        return sorted(self._files.get(event, {}))

    def _proj(self, event: str) -> str:
        spec = EV_SPECS[next(k for k, v in EV_SPECS.items() if event in v[0])][1]
        aid_clicked = _LOCAL_AID.format(c="clicked_asset_id")
        aid = _LOCAL_AID.format(c="asset_id")
        return spec.format(uid=_LOCAL_UID, aid=aid, aid_clicked=aid_clicked,
                           istday=_IST_DAY)

    def ensure(self, relation: str) -> None:
        """Materialise an ev_* table if not already built."""
        if relation in self._built:
            return
        events, _ = EV_SPECS[relation]
        parts = []
        for ev in events:
            proj = self._proj(ev)
            for wk, path in sorted(self._files[ev].items()):
                parts.append(
                    f"SELECT 'W{wk}' AS week, {proj} FROM "
                    f"read_csv_auto({_sql_str(str(path))}, ignore_errors=true, "
                    f"header=true, all_varchar=false)")
        if not parts:
            raise SystemExit(f"no local CSVs found for {relation}")
        union = "\nUNION ALL\n".join(parts)
        self.con.execute(
            f"CREATE TABLE {relation} AS SELECT * FROM ({union}) _u WHERE {EXC}")
        self._built.add(relation)

    def compute_windows(self) -> None:
        """Per-event, per-week [min,max] UTC timestamp of the *included* rows —
        the interval each Metabase relation will be filtered to."""
        for relation, (events, _) in EV_SPECS.items():
            self.ensure(relation)
            rows = self.con.execute(
                f"SELECT week, MIN(ts) AS lo, MAX(ts) AS hi FROM {relation} "
                f"GROUP BY week").fetchall()
            for ev in events:
                self.windows.setdefault(ev, {})
                for week, lo, hi in rows:
                    wk = int(week[1:])
                    if wk in self._files.get(ev, {}):
                        self.windows[ev][wk] = (str(lo), str(hi))

    def query(self, body: str) -> list[dict]:
        for rel in re.findall(r"\bev_\w+", body):
            self.ensure(rel)
        cur = self.con.execute(body)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def raw_count(self, event: str) -> int:
        """Total CSV rows for an event across all weeks, BEFORE test-user
        exclusion — for the data-sources.md §0 doc-claim check."""
        n = 0
        for path in self._files.get(event, {}).values():
            n += self.con.execute(
                f"SELECT COUNT(*) FROM read_csv_auto({_sql_str(str(path))}, "
                f"ignore_errors=true, header=true)").fetchone()[0]
        return n


class MetabaseSource:
    """The live `client_web` schema. Each ev_* relation is a CTE over the raw
    Metabase table, filtered to the local CSV's exact UTC window and bucketed
    into weeks by the same boundaries."""

    name = "metabase"

    def __init__(self, client, windows: dict[str, dict[int, tuple[str, str]]]):
        self.client = client
        self.windows = windows

    def _table_cte(self, event: str, proj_event: str) -> str:
        """One UNION arm: a SELECT over a single client_web table, tagged with a
        week-bucketing CASE and bounded to that table's overall window."""
        win = self.windows.get(event, {})
        if not win:
            raise SystemExit(f"no window computed for {event}")
        case_arms = "".join(
            f" WHEN \"timestamp\" >= {_sql_str(lo)} AND \"timestamp\" <= {_sql_str(hi)} "
            f"THEN 'W{wk}'" for wk, (lo, hi) in sorted(win.items()))
        lo_all = min(lo for lo, _ in win.values())
        hi_all = max(hi for _, hi in win.values())
        _, mb_table = EVENT_TABLES[event]
        return (f"SELECT (CASE{case_arms} ELSE NULL END) AS week, {proj_event} "
                f"FROM {SCHEMA}.{mb_table} "
                f"WHERE \"timestamp\" >= {_sql_str(lo_all)} "
                f"AND \"timestamp\" <= {_sql_str(hi_all)}")

    def _proj(self, event: str) -> str:
        relation = next(k for k, v in EV_SPECS.items() if event in v[0])
        spec = EV_SPECS[relation][1]
        return spec.format(uid=_MB_UID,
                           aid=_MB_AID.format(c="asset_id"),
                           aid_clicked=_MB_AID.format(c="clicked_asset_id"),
                           istday=_IST_DAY)

    def _preamble(self, relations: list[str]) -> str:
        ctes = []
        for rel in relations:
            events, _ = EV_SPECS[rel]
            arms = "\nUNION ALL\n".join(
                self._table_cte(ev, self._proj(ev)) for ev in events)
            ctes.append(f"{rel} AS (SELECT * FROM (\n{arms}\n) _u "
                        f"WHERE week IS NOT NULL AND {EXC})")
        return "WITH " + ",\n".join(ctes) + "\n"

    def query(self, body: str) -> list[dict]:
        relations = sorted(set(re.findall(r"\bev_\w+", body)))
        sql = self._preamble(relations) + body
        assert_read_only(sql)                       # provably no writes to Metabase
        rows, _ = self.client.run_sql(DATABASE_ID, sql)
        return rows


# ─────────────────────────────────────────────────────────────────────────────
# Checks — one SELECT per dashboard data point, written once for both backends
# ─────────────────────────────────────────────────────────────────────────────

class Check:
    """A single validated data point. `body` is backend-agnostic SQL; `keys`
    name the columns that identify a row when diffing (the rest are numeric
    columns that get value-compared)."""

    def __init__(self, cid, title, source, body, keys, *, informational=False):
        self.cid = cid
        self.title = title
        self.source = source
        self.body = body.strip()
        self.keys = keys
        self.informational = informational


# Tier A — raw event-table volumes (data-sources.md §2). One row per week.
def _vol(relation, has_session=True):
    sess = ", COUNT(DISTINCT sid) AS sessions" if has_session else ""
    return (f"SELECT week, COUNT(*) AS rows, COUNT(DISTINCT uid) AS users{sess} "
            f"FROM {relation} GROUP BY week ORDER BY week")


CHECKS = [
    Check("vol_query", "Volume — asset_search_query", "asset_search_query",
          _vol("ev_query"), ["week"]),
    Check("vol_empty", "Volume — asset_search_empty_state", "asset_search_empty_state",
          _vol("ev_empty"), ["week"]),
    Check("vol_clicked", "Volume — asset_search_result_clicked",
          "asset_search_result_clicked", _vol("ev_clicked"), ["week"]),
    Check("vol_initiated", "Volume — asset_search_initiated", "asset_search_initiated",
          _vol("ev_initiated"), ["week"]),
    Check("vol_suggestion", "Volume — asset_search_suggestion_clicked",
          "asset_search_suggestion_clicked", _vol("ev_suggestion"), ["week"]),
    Check("vol_cleared", "Volume — asset_search_cleared", "asset_search_cleared",
          _vol("ev_cleared"), ["week"]),
    Check("vol_invest", "Volume — invest_now + quick_checkout (unioned)",
          "invest_now_button_clicked + quick_checkout_invest_clicked",
          _vol("ev_invest", has_session=False), ["week"]),

    # Tier B — search metrics (assetSearch.js builders).
    Check("query_health", "Query health — ZRR & refinement (queryHealthByWeek)",
          "asset_search_query",
          """
SELECT week,
  COUNT(*) AS queries,
  SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result,
  ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
  SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) AS refinements,
  ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) / COUNT(*), 1) AS refinement_pct
FROM ev_query GROUP BY week ORDER BY week
""", ["week"]),

    Check("funnel", "Session funnel — initiated/queried/clicked (funnelByWeek)",
          "asset_search_initiated/query/result_clicked",
          """
SELECT i.week,
  i.initiated, q.queried, c.clicked
FROM (SELECT week, COUNT(DISTINCT sid) AS initiated FROM ev_initiated GROUP BY week) i
JOIN (SELECT week, COUNT(DISTINCT sid) AS queried FROM ev_query GROUP BY week) q USING (week)
JOIN (SELECT week, COUNT(DISTINCT sid) AS clicked FROM ev_clicked GROUP BY week) c USING (week)
ORDER BY i.week
""", ["week"]),

    Check("session_outcome", "Session-outcome funnel (sessionOutcomeByWeek) — PRIMARY",
          "asset_search_query + asset_search_result_clicked",
          """
SELECT q.week,
  COUNT(*) AS searched,
  SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) AS success,
  SUM(CASE WHEN c.sid IS NULL AND q.any_results = 1 THEN 1 ELSE 0 END) AS relevance_gap,
  SUM(CASE WHEN c.sid IS NULL AND q.any_results = 0 THEN 1 ELSE 0 END) AS dead_end,
  ROUND(100.0 * SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_pct
FROM (SELECT week, sid, MAX(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) AS any_results
      FROM ev_query GROUP BY week, sid) q
LEFT JOIN (SELECT DISTINCT week, sid FROM ev_clicked) c
  ON q.week = c.week AND q.sid = c.sid
GROUP BY q.week ORDER BY q.week
""", ["week"]),

    Check("suggestions", "Suggestion CTR (suggestionsByWeek)",
          "asset_search_suggestion_clicked / asset_search_initiated",
          """
SELECT i.week,
  COALESCE(s.suggestion_clicks, 0) AS suggestion_clicks,
  i.focused,
  ROUND(100.0 * COALESCE(s.sessions_with_click, 0) / NULLIF(i.focused, 0), 1) AS ctr_pct
FROM (SELECT week, COUNT(DISTINCT sid) AS focused FROM ev_initiated GROUP BY week) i
LEFT JOIN (SELECT week, COUNT(*) AS suggestion_clicks,
                  COUNT(DISTINCT sid) AS sessions_with_click
           FROM ev_suggestion GROUP BY week) s USING (week)
ORDER BY i.week
""", ["week"]),

    Check("clears", "Clear events per week (clearsByWeek)", "asset_search_cleared",
          "SELECT week, COUNT(*) AS clears FROM ev_cleared GROUP BY week ORDER BY week",
          ["week"]),

    Check("by_tab", "Search volume & ZRR by tab (byTab)", "asset_search_query",
          """
SELECT COALESCE(active_tab, '(none)') AS tab,
  COUNT(*) AS queries,
  ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct
FROM ev_query GROUP BY tab ORDER BY queries DESC
""", ["tab"]),

    Check("total_sessions", "Distinct query sessions overall (totalQuerySessions)",
          "asset_search_query",
          "SELECT COUNT(DISTINCT sid) AS sessions FROM ev_query", []),

    Check("clicks_by_position", "Position bias — clicks by rank (clicksByPosition)",
          "asset_search_result_clicked",
          """
SELECT result_position + 1 AS rank, COUNT(*) AS clicks
FROM ev_clicked
WHERE result_position IS NOT NULL AND result_position BETWEEN 0 AND 9
GROUP BY rank ORDER BY rank
""", ["rank"]),

    Check("top_terms", "Top search terms & their ZRR (topSearchTerms)",
          "asset_search_query",
          """
SELECT LOWER(TRIM(query_text)) AS term,
  COUNT(*) AS searches,
  SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result,
  ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct
FROM ev_query
WHERE query_text IS NOT NULL AND TRIM(query_text) <> ''
GROUP BY term HAVING COUNT(*) >= 25
ORDER BY searches DESC LIMIT 18
""", ["term"]),

    Check("zero_result_terms", "Top zero-result queries (topZeroResultQueries)",
          "asset_search_empty_state",
          """
SELECT LOWER(TRIM(query_text)) AS term, COUNT(*) AS hits,
  ROUND(AVG(query_length), 0) AS avg_len
FROM ev_empty
WHERE query_text IS NOT NULL AND TRIM(query_text) <> ''
GROUP BY term ORDER BY hits DESC LIMIT 14
""", ["term"]),

    Check("clicked_assets", "Most-clicked assets & avg rank (topClickedAssets)",
          "asset_search_result_clicked",
          """
SELECT asset_name AS asset, COUNT(*) AS clicks,
  ROUND(AVG(result_position) + 1, 1) AS avg_rank
FROM ev_clicked
WHERE asset_name IS NOT NULL AND result_position IS NOT NULL
GROUP BY asset ORDER BY clicks DESC LIMIT 12
""", ["asset"]),

    Check("issuer_health", "Per-issuer health by week (issuerHealthByWeek)",
          "asset_search_query (issuer-classified)",
          f"""
SELECT week, issuer,
  COUNT(DISTINCT sid) AS sessions,
  COUNT(*) AS queries,
  ROUND(100.0 * SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS zrr_pct,
  ROUND(100.0 * SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) / COUNT(*), 1) AS refinement_pct
FROM (SELECT week, sid, results_count, is_refinement,
             {issuer_case_expr('query_text')} AS issuer FROM ev_query) c
WHERE issuer IS NOT NULL
GROUP BY week, issuer ORDER BY issuer, week
""", ["week", "issuer"]),

    Check("issuer_outcome", "Per-issuer session outcome (sessionOutcomeByIssuerWeek)",
          "asset_search_query + result_clicked (issuer-classified)",
          f"""
SELECT q.week, q.issuer,
  COUNT(*) AS searched,
  SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) AS success,
  SUM(CASE WHEN c.sid IS NULL AND q.any_results = 1 THEN 1 ELSE 0 END) AS relevance_gap,
  SUM(CASE WHEN c.sid IS NULL AND q.any_results = 0 THEN 1 ELSE 0 END) AS dead_end
FROM (SELECT week, sid, issuer,
             MAX(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) AS any_results
      FROM (SELECT week, sid, results_count,
                   {issuer_case_expr('query_text')} AS issuer FROM ev_query) cl
      WHERE issuer IS NOT NULL
      GROUP BY week, sid, issuer) q
LEFT JOIN (SELECT DISTINCT week, sid FROM ev_clicked) c
  ON q.week = c.week AND q.sid = c.sid
GROUP BY q.week, q.issuer ORDER BY q.issuer, q.week
""", ["week", "issuer"]),

    # Tier C — conversion metrics (conversion.js). Same-day = IST calendar day.
    Check("conversion_by_week", "Conversion atoms by week (conversionByWeek)",
          "asset_search_initiated/result_clicked + invest events",
          """
SELECT s.week,
  s.searchers,
  COALESCE(sc.conv_searchers, 0) AS conv_searchers,
  COALESCE(c.clickers, 0) AS clickers,
  COALESCE(cc.conv_clickers, 0) AS conv_clickers,
  COALESCE(iw.invest_events, 0) AS invest_events,
  COALESCE(iw.invest_users, 0) AS invest_users
FROM (SELECT week, COUNT(DISTINCT uid) AS searchers FROM ev_initiated GROUP BY week) s
LEFT JOIN (SELECT i.week, COUNT(DISTINCT i.uid) AS conv_searchers
           FROM (SELECT DISTINCT week, uid, ist_day FROM ev_initiated) i
           JOIN (SELECT DISTINCT uid, ist_day FROM ev_invest) v
             ON v.uid = i.uid AND v.ist_day = i.ist_day GROUP BY i.week) sc USING (week)
LEFT JOIN (SELECT week, COUNT(DISTINCT uid) AS clickers FROM ev_clicked GROUP BY week) c USING (week)
LEFT JOIN (SELECT x.week, COUNT(DISTINCT x.uid) AS conv_clickers
           FROM (SELECT DISTINCT week, uid, ist_day FROM ev_clicked) x
           JOIN (SELECT DISTINCT uid, ist_day FROM ev_invest) v
             ON v.uid = x.uid AND v.ist_day = x.ist_day GROUP BY x.week) cc USING (week)
LEFT JOIN (SELECT week, COUNT(*) AS invest_events, COUNT(DISTINCT uid) AS invest_users
           FROM ev_invest GROUP BY week) iw USING (week)
ORDER BY s.week
""", ["week"]),

    Check("search_to_invest", "Search -> invest, asset-level same-day (searchToInvestRate)",
          "asset_search_result_clicked + invest events",
          """
SELECT COUNT(*) AS click_events,
  SUM(CASE WHEN EXISTS (
        SELECT 1 FROM (SELECT DISTINCT uid, asset_id, ist_day FROM ev_invest) v
        WHERE v.uid = clk.uid AND v.asset_id = clk.asset_id AND v.ist_day = clk.ist_day
      ) THEN 1 ELSE 0 END) AS matched
FROM (SELECT DISTINCT uid, asset_id, ist_day FROM ev_clicked
      WHERE asset_id IS NOT NULL) clk
""", []),

    Check("adoption", "Search adoption by week (weeklyAdoption)",
          "view_assets / assets_page_views UNION asset_search_initiated",
          """
SELECT v.week, v.visitors, COALESCE(s.searchers, 0) AS searchers,
  ROUND(100.0 * COALESCE(s.searchers, 0) / NULLIF(v.visitors, 0), 1) AS adoption_pct
FROM (SELECT week, COUNT(DISTINCT uid) AS visitors FROM (
        SELECT week, uid FROM ev_pageviews
        UNION SELECT week, uid FROM ev_initiated) u GROUP BY week) v
LEFT JOIN (SELECT week, COUNT(DISTINCT uid) AS searchers FROM ev_initiated
           GROUP BY week) s USING (week)
ORDER BY v.week
""", ["week"], informational=True),
]


# ─────────────────────────────────────────────────────────────────────────────
# Internal-consistency checks — invariants on the LOCAL data alone. No Metabase,
# no credentials. These catch the most likely failure mode (a SQL/porting bug in
# the dashboard's own builders) by asserting the numbers are mathematically
# sound. Each body returns ONLY violating rows — an empty result means the
# invariant holds.
# ─────────────────────────────────────────────────────────────────────────────

class ConsistencyCheck:
    def __init__(self, cid, title, invariant, body, *, informational=False):
        self.cid = cid
        self.title = title
        self.invariant = invariant
        self.body = body.strip()
        self.informational = informational


_ISSUER = issuer_case_expr("query_text")

CONSISTENCY_CHECKS = [
    ConsistencyCheck(
        "funnel_buckets_sum", "Session-outcome buckets are exhaustive",
        "success + relevance_gap + dead_end = searched, every week",
        f"""
SELECT week, searched, success + relevance_gap + dead_end AS bucket_sum
FROM (
  SELECT q.week, COUNT(*) AS searched,
    SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) AS success,
    SUM(CASE WHEN c.sid IS NULL AND q.any_results = 1 THEN 1 ELSE 0 END) AS relevance_gap,
    SUM(CASE WHEN c.sid IS NULL AND q.any_results = 0 THEN 1 ELSE 0 END) AS dead_end
  FROM (SELECT week, sid, MAX(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) AS any_results
        FROM ev_query GROUP BY week, sid) q
  LEFT JOIN (SELECT DISTINCT week, sid FROM ev_clicked) c
    ON q.week = c.week AND q.sid = c.sid
  GROUP BY q.week) t
WHERE searched <> success + relevance_gap + dead_end
"""),
    ConsistencyCheck(
        "zrr_bounds", "ZRR & refinement numerators are bounded",
        "0 <= zero_result <= queries and 0 <= refinements <= queries",
        """
SELECT week, queries, zero_result, refinements FROM (
  SELECT week, COUNT(*) AS queries,
    SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result,
    SUM(CASE WHEN is_refinement THEN 1 ELSE 0 END) AS refinements
  FROM ev_query GROUP BY week) t
WHERE zero_result > queries OR refinements > queries
   OR zero_result < 0 OR refinements < 0
"""),
    ConsistencyCheck(
        "tab_split_total", "by-tab split reconciles with total queries",
        "SUM of byTab queries = COUNT(*) of asset_search_query",
        """
SELECT tab_sum, total FROM
  (SELECT SUM(queries) AS tab_sum FROM
     (SELECT COALESCE(active_tab, '(none)') AS tab, COUNT(*) AS queries
      FROM ev_query GROUP BY COALESCE(active_tab, '(none)')) x) a,
  (SELECT COUNT(*) AS total FROM ev_query) b
WHERE tab_sum <> total
"""),
    ConsistencyCheck(
        "issuer_session_bound", "Per-issuer sessions never exceed the week",
        "issuer sessions <= all-issuer weekly query sessions",
        f"""
SELECT i.week, i.issuer, i.sessions, w.weekly_sessions FROM
  (SELECT week, issuer, COUNT(DISTINCT sid) AS sessions FROM
     (SELECT week, sid, {_ISSUER} AS issuer FROM ev_query) c
   WHERE issuer IS NOT NULL GROUP BY week, issuer) i
  JOIN (SELECT week, COUNT(DISTINCT sid) AS weekly_sessions
        FROM ev_query GROUP BY week) w USING (week)
WHERE i.sessions > w.weekly_sessions
"""),
    ConsistencyCheck(
        "issuer_buckets_sum", "Per-issuer outcome buckets are exhaustive",
        "success + relevance_gap + dead_end = searched, every (week, issuer)",
        f"""
SELECT week, issuer, searched, success + relevance_gap + dead_end AS bucket_sum
FROM (
  SELECT q.week, q.issuer, COUNT(*) AS searched,
    SUM(CASE WHEN c.sid IS NOT NULL THEN 1 ELSE 0 END) AS success,
    SUM(CASE WHEN c.sid IS NULL AND q.any_results = 1 THEN 1 ELSE 0 END) AS relevance_gap,
    SUM(CASE WHEN c.sid IS NULL AND q.any_results = 0 THEN 1 ELSE 0 END) AS dead_end
  FROM (SELECT week, sid, issuer,
               MAX(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) AS any_results
        FROM (SELECT week, sid, results_count, {_ISSUER} AS issuer FROM ev_query) cl
        WHERE issuer IS NOT NULL GROUP BY week, sid, issuer) q
  LEFT JOIN (SELECT DISTINCT week, sid FROM ev_clicked) c
    ON q.week = c.week AND q.sid = c.sid
  GROUP BY q.week, q.issuer) t
WHERE searched <> success + relevance_gap + dead_end
"""),
    ConsistencyCheck(
        "position_bound", "Position-bias clicks never exceed result clicks",
        "SUM of clicksByPosition <= COUNT(*) of asset_search_result_clicked",
        """
SELECT pos_clicks, total_clicks FROM
  (SELECT COALESCE(SUM(clicks), 0) AS pos_clicks FROM
     (SELECT result_position + 1 AS rank, COUNT(*) AS clicks FROM ev_clicked
      WHERE result_position BETWEEN 0 AND 9 GROUP BY result_position + 1) z) a,
  (SELECT COUNT(*) AS total_clicks FROM ev_clicked) b
WHERE pos_clicks > total_clicks
"""),
    ConsistencyCheck(
        "funnel_monotonic", "Funnel is monotonic (initiated >= queried >= clicked)",
        "distinct sessions: initiated >= queried >= clicked, every week",
        """
SELECT i.week, i.initiated, q.queried, c.clicked FROM
  (SELECT week, COUNT(DISTINCT sid) AS initiated FROM ev_initiated GROUP BY week) i
  JOIN (SELECT week, COUNT(DISTINCT sid) AS queried FROM ev_query GROUP BY week) q USING (week)
  JOIN (SELECT week, COUNT(DISTINCT sid) AS clicked FROM ev_clicked GROUP BY week) c USING (week)
WHERE i.initiated < q.queried OR q.queried < c.clicked
""", informational=True),
]


def run_consistency(local: "LocalSource") -> list[dict]:
    """Run every internal-consistency invariant against the local data."""
    results = []
    for chk in CONSISTENCY_CHECKS:
        row = {"check": chk}
        try:
            violations = local.query(chk.body)
            if not violations:
                row.update(verdict=CONFIRMED, violations=[])
            else:
                row.update(verdict=INFO if chk.informational else DISCREPANT,
                           violations=violations)
        except Exception as e:                       # noqa: BLE001
            row.update(verdict=DISCREPANT, violations=[],
                       error=f"{type(e).__name__}: {e}")
        results.append(row)
        print(f"  {_BADGE[row['verdict']]} {chk.cid:24s} {row['verdict']}")
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Diffing & verdicts
# ─────────────────────────────────────────────────────────────────────────────

CONFIRMED, MINOR, DISCREPANT, INFO, PENDING = (
    "CONFIRMED", "MINOR DRIFT", "DISCREPANT", "INFO", "PENDING")
_RANK = {CONFIRMED: 0, INFO: 1, MINOR: 2, PENDING: 3, DISCREPANT: 4}


def classify_cell(column: str, local, mb) -> str:
    """Two-tier verdict for one numeric cell (S3 locked policy)."""
    if local is None and mb is None:
        return CONFIRMED
    if local is None or mb is None:
        return DISCREPANT
    try:
        a, b = float(local), float(mb)
    except (TypeError, ValueError):
        return CONFIRMED if str(local) == str(mb) else DISCREPANT
    if a == b:
        return CONFIRMED
    diff = abs(a - b)
    if column.endswith("_pct"):
        return MINOR if diff <= DRIFT_PP else DISCREPANT
    rel = (diff / abs(b) * 100.0) if b else 100.0
    return MINOR if (diff <= DRIFT_ROWS or rel <= DRIFT_PCT) else DISCREPANT


def diff_check(check: Check, local_rows: list[dict], mb_rows):
    """Return (verdict, [row-diff, ...]). mb_rows is None for an un-run side."""
    def rowkey(r):
        return tuple(str(r.get(k)) for k in check.keys)

    value_cols = [c for c in (local_rows[0].keys() if local_rows else [])
                  if c not in check.keys]
    local_by = {rowkey(r): r for r in local_rows}
    diffs = []
    worst = CONFIRMED

    if mb_rows is None:                       # --local-only: no Metabase side yet
        for k, lr in local_by.items():
            diffs.append({"key": k, "cells": [
                (c, lr.get(c), None, PENDING) for c in value_cols]})
        return PENDING, diffs

    mb_by = {rowkey(r): r for r in mb_rows}
    for k in sorted(set(local_by) | set(mb_by)):
        lr, mr = local_by.get(k), mb_by.get(k)
        cells = []
        if lr is None or mr is None:
            verdict = INFO if check.informational else DISCREPANT
            for c in value_cols:
                cells.append((c, lr.get(c) if lr else None,
                              mr.get(c) if mr else None, verdict))
        else:
            for c in value_cols:
                v = classify_cell(c, lr.get(c), mr.get(c))
                if check.informational and v in (MINOR, DISCREPANT):
                    v = INFO
                cells.append((c, lr.get(c), mr.get(c), v))
        diffs.append({"key": k, "cells": cells})
        for _, _, _, v in cells:
            if _RANK[v] > _RANK[worst]:
                worst = v
    return worst, diffs


# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────

_BADGE = {CONFIRMED: "✅", MINOR: "⚠️", DISCREPANT: "❌", INFO: "ℹ️", PENDING: "⏳"}


def _fmt(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def build_report(results: list[dict], consistency: list[dict],
                 local: LocalSource, mode: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    tally: dict[str, int] = {}
    for r in results + consistency:
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1

    out = ["# Asset Search — Metabase data validation report", ""]
    out.append(f"_Generated {now} · mode: **{mode}**_")
    out.append("")
    out.append("Produced by `backend/services/integrations/validate_asset_search.py`. "
               "Every metric the Asset Search dashboard renders "
               "(`frontend/lib/queries/assetSearch.js` + `conversion.js`) is "
               "re-computed from the local W1-W6 CSVs and, in `metabase` mode, "
               "from the live `client_web` schema, then diffed.")
    out.append("")
    out.append("**Verdict policy (two-tier):** exact → ✅ CONFIRMED · "
               f"drift ≤{DRIFT_ROWS} rows / ≤{DRIFT_PCT}% (counts) or ≤{DRIFT_PP}pp "
               "(percentages) → ⚠️ MINOR DRIFT (Rudderstack late-arrival noise, "
               "not a failure) · larger → ❌ DISCREPANT · ℹ️ INFO = informational "
               "(derived-source mismatch expected by design) · ⏳ PENDING = "
               "awaiting the credentialed Metabase run.")
    out.append("")
    out.append("## Summary")
    out.append("")
    out.append("| Verdict | Checks |")
    out.append("|---|---|")
    for v in (CONFIRMED, MINOR, DISCREPANT, INFO, PENDING):
        if tally.get(v):
            out.append(f"| {_BADGE[v]} {v} | {tally[v]} |")
    out.append("")

    # Findings discovered during S3.
    out.append("## Findings & corrections")
    out.append("")
    if not FINDINGS:
        out.append("_None._")
    for fid, sev, title, detail, resolution in FINDINGS:
        out.append(f"### {fid} — {title}")
        out.append("")
        out.append(f"_Severity: {sev}_")
        out.append("")
        out.append(detail)
        out.append("")
        out.append(f"**Resolution.** {resolution}")
        out.append("")

    # data-sources.md §0 doc-claim self-check (always runs — local only).
    out.append("## §0 — local CSVs vs data-sources.md (regression guard)")
    out.append("")
    out.append("Does the local W1-W6 data match the row counts `data-sources.md "
               "§0` documents? (Raw `COUNT(*)`, before test-user exclusion.) "
               "Post-F1 this should read all-CONFIRMED.")
    out.append("")
    out.append("| Event | data-sources.md §0 | Local CSVs (actual) | Verdict |")
    out.append("|---|--:|--:|---|")
    for ev, claimed in DOC_CLAIMS_W1_W6.items():
        actual = local.raw_count(ev)
        v = classify_cell("rows", claimed, actual)
        out.append(f"| `asset_search_{ev}` | {claimed:,} | {actual:,} | "
                   f"{_BADGE[v]} {v} |")
    out.append("")

    # Internal-consistency tier — runs on local data, needs no Metabase.
    out.append("## Internal consistency (no Metabase needed)")
    out.append("")
    out.append("Invariants on the local data alone — the numbers must be "
               "*mathematically sound* regardless of the upstream source. "
               "These catch SQL / porting bugs in the dashboard's own builders, "
               "the most likely failure mode, and need no credentials.")
    out.append("")
    out.append("| Check | Invariant | Verdict |")
    out.append("|---|---|---|")
    for r in consistency:
        c: ConsistencyCheck = r["check"]
        out.append(f"| `{c.cid}` | {c.invariant} | {_BADGE[r['verdict']]} "
                   f"{r['verdict']} |")
    out.append("")
    for r in consistency:
        c = r["check"]
        if r.get("error"):
            out.append(f"- ⚠️ `{c.cid}` errored: {r['error']}")
        elif r["violations"]:
            out.append(f"**`{c.cid}` — {len(r['violations'])} violation(s):** "
                       f"{c.title}")
            cols = list(r["violations"][0].keys())
            out.append("")
            out.append("| " + " | ".join(cols) + " |")
            out.append("|" + "---|" * len(cols))
            for v in r["violations"][:20]:
                out.append("| " + " | ".join(_fmt(v[c2]) for c2 in cols) + " |")
            out.append("")
    out.append("")

    # Per-check detail.
    out.append("## Checks")
    out.append("")
    for r in results:
        chk: Check = r["check"]
        out.append(f"### {_BADGE[r['verdict']]} {chk.cid} — {chk.title}")
        out.append("")
        out.append(f"_Source: `{chk.source}` · verdict: **{r['verdict']}**_")
        out.append("")
        if r.get("error"):
            out.append(f"> ⚠️ {r['error']}")
            out.append("")
            continue
        diffs = r["diffs"]
        if not diffs:
            out.append("> No rows produced.")
            out.append("")
            continue
        keycols = chk.keys or ["(value)"]
        valcols = [c for c, *_ in diffs[0]["cells"]]
        header = keycols + [f"{c} (local)" for c in valcols] + \
                 [f"{c} (metabase)" for c in valcols] + ["verdict"]
        out.append("| " + " | ".join(header) + " |")
        out.append("|" + "---|" * len(header))
        for d in diffs:
            keyvals = list(d["key"]) if chk.keys else ["—"]
            loc = [_fmt(c[1]) for c in d["cells"]]
            mb = [_fmt(c[2]) for c in d["cells"]]
            rowv = max((c[3] for c in d["cells"]), key=lambda x: _RANK[x])
            cells = keyvals + loc + mb + [f"{_BADGE[rowv]} {rowv}"]
            out.append("| " + " | ".join(cells) + " |")
        out.append("")

    out.append("---")
    out.append("")
    out.append("## Method & known calibration points")
    out.append("")
    out.append("- **Window anchoring** — each Metabase relation is filtered to "
               "the exact `[min,max]` UTC `timestamp` of its local CSV slice. "
               "CSV timestamps load as naive UTC (`read_csv_auto`), matching the "
               "naive-UTC `timestamp` column the export guide assumes.")
    out.append("- **Test users** `3,4,207871,207875,207878,207879` are excluded "
               "on both sides (`user_id` cast to DOUBLE — W1-W3 store it as "
               "`\"622564.0\"`).")
    out.append("- **Read-only by construction** — the harness prefers a "
               "`METABASE_API_KEY` (scope it read-only in Metabase) over a "
               "session login, and every query it sends is asserted to be a "
               "single bare `SELECT`/`WITH` (`assert_read_only`). It cannot "
               "write to Metabase even if asked to.")
    out.append("- **Internal-consistency tier** runs on the local data alone "
               "(no Metabase, no credentials) — see the section above. It is "
               "the validation you can trust without ever touching production.")
    out.append("- **`adoption` is INFORMATIONAL** — its local visitor base is the "
               "*derived* `assets_page_views` (a 6-column projection of "
               "`view_assets` by `metabase-connect/derive_page_views.py`); the "
               "Metabase side is raw `view_assets`. An ~88-95% distinct-user "
               "overlap is expected by design, so it is never marked DISCREPANT.")
    out.append("- **Pre-computed export tables** `10_daily_funnel_summary`, "
               "`13_asset_click_aggregated`, `14_conversion_cohort_summary` are "
               "analyst rollups with no raw Metabase table; they are validated "
               "transitively (the raw events they derive from are checked here). "
               "Re-deriving them belongs to the S4/S5 fetch pipeline.")
    out.append("- **First credentialed run** may need two adjustments, like the "
               "Grip Connect pipeline's Phase-1 pin: (1) the `timestamp` column "
               "is assumed naive-UTC — if Metabase stores `timestamptz`, the "
               "window literals need a tz cast; (2) `user_id` is cast via TEXT→"
               "DOUBLE — if the column holds non-numeric values the cast must be "
               "guarded. Both surface immediately as a SQL error, not silent.")
    out.append("")
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────────

def run(data_dir: Path, report_path: Path, local_only: bool) -> int:
    local = LocalSource(data_dir)
    local.compute_windows()

    mb = None
    if not local_only:
        from dotenv import load_dotenv
        from .metabase import MetabaseClient
        load_dotenv()
        base = os.getenv("METABASE_URL", "https://metabase.gripinvest.in")
        api_key = os.getenv("METABASE_API_KEY")
        if api_key:
            # Preferred: a read-only API key. Scope it read-only in Metabase
            # and the run is provably incapable of writing.
            client = MetabaseClient(base, api_key=api_key)
            print("  auth: METABASE_API_KEY (scope it read-only in Metabase)")
        else:
            email = os.getenv("METABASE_EMAIL")
            password = os.getenv("METABASE_PASSWORD")
            if not email or not password:
                print("ERROR: set METABASE_API_KEY (preferred, read-only), or "
                      "METABASE_EMAIL + METABASE_PASSWORD — or use --local-only",
                      file=sys.stderr)
                return 1
            client = MetabaseClient(base)
            client.login(email, password)
            print("  auth: session login (consider a read-only API key instead)")
        mb = MetabaseSource(client, local.windows)

    print("Internal-consistency checks (local, no Metabase):")
    consistency = run_consistency(local)
    print("Data-point checks:")
    results = []
    for chk in CHECKS:
        row = {"check": chk}
        try:
            local_rows = local.query(chk.body)
            mb_rows = mb.query(chk.body) if mb else None
            verdict, diffs = diff_check(chk, local_rows, mb_rows)
            row.update(verdict=verdict, diffs=diffs)
        except Exception as e:                       # noqa: BLE001 — report, don't crash
            row.update(verdict=DISCREPANT, diffs=[], error=f"{type(e).__name__}: {e}")
        results.append(row)
        mark = _BADGE[row["verdict"]]
        print(f"  {mark} {chk.cid:22s} {row['verdict']}"
              + (f"  ({row['error']})" if row.get("error") else ""))

    mode = "local-only (baseline)" if local_only else "metabase"
    report = build_report(results, consistency, local, mode)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report)
    print(f"\nReport → {report_path}")

    # Internal-consistency failures are real bugs regardless of mode.
    consistency_bad = sum(1 for r in consistency if r["verdict"] == DISCREPANT)
    discrepant = sum(1 for r in results if r["verdict"] == DISCREPANT)
    if consistency_bad:
        print(f"{consistency_bad} internal-consistency check(s) FAILED — "
              f"see the report.", file=sys.stderr)
        return 2
    if discrepant and not local_only:
        print(f"{discrepant} check(s) DISCREPANT — see the report.", file=sys.stderr)
        return 2
    return 0


def main() -> int:
    repo_backend = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--local-only", action="store_true",
                    help="compute the local-CSV baseline only; no Metabase, no creds")
    ap.add_argument("--data-dir", type=Path,
                    default=repo_backend / "data" / "asset_search",
                    help="directory of the W1-W6 Asset Search CSVs")
    ap.add_argument("--report", type=Path,
                    default=repo_backend.parent / "docs" / "projects" /
                    "asset-search" / "metabase-validation-report.md",
                    help="where to write the markdown report")
    args = ap.parse_args()
    if not args.data_dir.is_dir():
        print(f"ERROR: data dir not found: {args.data_dir}", file=sys.stderr)
        return 1
    return run(args.data_dir, args.report, args.local_only)


if __name__ == "__main__":
    raise SystemExit(main())
