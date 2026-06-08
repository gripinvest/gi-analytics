"""Asset Search live-data fetch module.

Pulls raw event rows from Metabase by native SQL, windowed by feature week,
and writes one CSV per `(feature-week, event)` — the layout `build_duckdb.py`
and `assetSearch.js`'s `groupTables()` already expect.

Design: `docs/projects/asset-search/specs/2026-05-19-asset-search-live-data-design.md`.
Key decisions carried here:
  · D1 — fetch by native SQL via `MetabaseClient.run_sql` (`/api/dataset`),
         paginated with `ORDER BY id LIMIT 2000 OFFSET n` to step past the
         endpoint's 2000-row default cap. The export endpoint would be a
         one-shot alternative but it requires a separate Metabase permission
         the service account does not always carry — pagination is portable.
  · D3 — each run fetches the current + prior feature week; older weeks frozen.
  · D5 — whole-week CSV is rewritten atomically; no row-level upsert.
  · D7 — every run fetches all (non-off) events for the trailing live-week
         window, heavy browse/conversion tables included, so they self-heal
         like the search events (revised after the W9/W10 incident; the
         original D7 fetched the heavy tables only on the weekly rollover).
  · D8 — the five payment-stage tables are registered but `off` until roadmap #2.
  · D10 — every query excludes the test users.

Deterministic Python — no LLM in the data path. Claude authors & validates it;
the cron / refresh endpoint runs it.
"""
import csv
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import feature_week
from .metabase import MetabaseError

# Rudder Prod, schema client_web (data-sources.md header).
DATABASE_ID = 8

# Test users excluded from every query path — single-sourced here, mirroring
# `frontend/lib/queries/assetSearch.js`'s TEST_USERS (spec D10).
TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)

# /api/dataset caps results at Metabase's default `max-results-bare-rows` (2000),
# so the fetch paginates: `ORDER BY id LIMIT PAGE_SIZE OFFSET n`. Matching the
# cap keeps each call a single page and the row-count-equals-page-size signal a
# reliable "more pages remain." MAX_PAGES guards against a runaway loop.
PAGE_SIZE = 2000
MAX_PAGES = 200          # 400k rows ceiling — well above any single feature week.

# Feature weeks are IST-aligned (the spec defines them off Apr 2 2026 IST).
# The GitHub Actions runner clock is UTC, so a cron firing at 18:30 UTC
# (= 00:00 IST) sees yesterday's UTC date. Computing `today` in IST keeps
# `week_of`/`current_and_prior` on the correct feature-week boundary instead
# of trailing a day behind whenever the run straddles UTC midnight.
IST = timezone(timedelta(hours=5, minutes=30))


@dataclass(frozen=True)
class Event:
    """One tracked event table.

    cadence: "daily" / "weekly" — both are fetched on *every* run for the
             trailing live-week window (D3). The label is now only a size hint
             (weekly = the heavy browse/conversion tables, kept column-pruned);
             it no longer gates *when* a table is fetched. Fetching the heavy
             tables daily makes them self-healing exactly like the search
             events: a failed push or transient fetch error is corrected on the
             next run, instead of being lost until the once-a-week rollover run
             (the May–Jun 2026 W9/W10 incident — a lost rollover push left the
             heavy tables permanently stuck).
             "off"    — registered but not fetched (the payment-stage tables,
                        enabled with roadmap #2 — spec D8).
    has_user_id: whether the source table carries a `user_id` column, i.e.
                 whether the test-user exclusion clause applies.
    columns: optional curated SELECT list. None = SELECT *. Used to prune
             Rudderstack-context bloat on high-volume tables that the dashboard
             only reads a few columns from — without this, `assets_page_views`
             balloons from ~10 MB (W1-W6 hand-export) to >100 MB (GitHub's
             single-file limit) because the live schema has ~126 columns and
             only six are consumed downstream.
    must_have_rows: high-volume tables that should NEVER be empty for a live
             feature week. A 0-row/absent fetch for one of these is treated as
             a hard failure (run() logs FAIL → holds the freshness clock + the
             cron alerts; validate() flags an absent file as a blocking error)
             rather than the silent skip a genuinely-sparse event gets. This
             closes the gap where a heavy browse/conversion table collapsing to
             zero — a broken WHERE, an empty source, retention truncation on a
             backfill — would otherwise commit "broken-but-green" (the W9/W10
             incident's residual silent failure mode).
    """
    key: str
    source_table: str
    stem: str
    cadence: str
    has_user_id: bool = True
    columns: tuple[str, ...] | None = None
    must_have_rows: bool = False

    @property
    def is_off(self) -> bool:
        """`off` events are registered but never fetched (the payment-stage
        tables, enabled with roadmap #2 — spec D8)."""
        return self.cadence == "off"


# The event registry — spec §6.2. `stem` MUST match the on-disk CSV names for
# already-exported events (e.g. browse is `assets_page_views`, not the source
# table `view_assets`).
EVENTS: dict[str, Event] = {e.key: e for e in [
    Event("initiated",          "asset_search_initiated",          "asset_search_initiated",          "daily"),
    Event("query",              "asset_search_query",              "asset_search_query",              "daily"),
    Event("result_clicked",     "asset_search_result_clicked",     "asset_search_result_clicked",     "daily"),
    Event("empty_state",        "asset_search_empty_state",        "asset_search_empty_state",        "daily"),
    Event("cleared",            "asset_search_cleared",            "asset_search_cleared",            "daily"),
    Event("suggestion_clicked", "asset_search_suggestion_clicked", "asset_search_suggestion_clicked", "daily"),
    # V2 outreach events — only fire when a user hits the empty state with
    # `engine_version: 'v2'`. Volumes are small (single-digit clicks/day)
    # so the daily cadence is right; the BD/CS outreach panel reads these.
    Event("notify_me_clicked",  "asset_search_notify_me_clicked",  "asset_search_notify_me_clicked",  "daily"),
    Event("chip_clicked",       "asset_search_chip_clicked",       "asset_search_chip_clicked",       "daily"),
    Event("assets_page_views",  "view_assets",                     "assets_page_views",               "weekly",
          # Identity + when only. The W1–W6 hand-export carried `path`/`title`
          # too, but the live Rudder schema renamed both away and no dashboard
          # query reads them — keep the fetch minimal so the CSV stays under
          # GitHub's 100 MB single-file cap (full SELECT * was 104 MB).
          columns=("user_id", "anonymous_id", "context_session_id", "timestamp"),
          must_have_rows=True),
    Event("invest_now",         "invest_now_button_clicked",       "invest_now_button_clicked",       "weekly",
          # Pruned to the four columns conversion.js actually reads
          # (user_id, timestamp, asset_id, product_category). SELECT * is ~126
          # Rudder-context columns / ~16 MB per feature week; now that the
          # heavy tables re-fetch daily (self-healing), the unpruned file would
          # re-churn ~16 MB into git every day. The pagination ORDER BY id does
          # not require id in the SELECT list (assets_page_views already relies
          # on this). quick_checkout carries the same four columns, so the
          # frontend's invest_now ∪ quick_checkout UNION stays valid.
          columns=("user_id", "timestamp", "asset_id", "product_category"),
          must_have_rows=True),
    Event("quick_checkout",     "quick_checkout_invest_clicked",   "quick_checkout_invest_clicked",   "daily"),
    # D8 — registered, fetched only once roadmap #2 flips these to "weekly"/"daily".
    Event("payment_page",       "view_payment_page_loaded",        "view_payment_page_loaded",        "off"),
    Event("payment_status",     "view_payment_status_page",        "view_payment_status_page",        "off"),
    Event("new_user_order",     "new_user_order",                  "new_user_order",                  "off"),
    Event("order_summary",      "order_summary_clicked",           "order_summary_clicked",           "off"),
    Event("asset_card_clicked", "asset_card_clicked",              "asset_card_clicked",              "off"),
]}


def build_sql(source_table: str, start: date, end: date,
              has_user_id: bool = True,
              columns: tuple[str, ...] | None = None) -> str:
    """The per-event fetch SQL (spec §6.3) — one feature week of raw rows.

    `start`/`end` are the half-open feature-week bounds. They come from
    `feature_week.bounds()` (not user input), so interpolating them carries no
    injection surface. `columns` is an optional curated SELECT list — pass it
    for high-volume tables where the live Rudderstack schema is wider than the
    dashboard consumes. Defaults to `SELECT *`; the validator (validate.py) is
    the schema-drift guard either way.
    """
    select_list = ", ".join(columns) if columns else "*"
    where = f"timestamp >= '{start}' AND timestamp < '{end}'"
    if has_user_id:
        # `user_id` is `integer` on most asset_search_* tables but `text` on
        # assets_page_views / invest_now_button_clicked. Cast to text on both
        # sides so the NOT IN works under either schema — Rudderstack schema
        # drift across event tables would otherwise break the fetch silently.
        excl = ",".join(f"'{u}'" for u in TEST_USERS)
        where += f"\n  AND (user_id IS NULL OR user_id::text NOT IN ({excl}))"
    return f"SELECT {select_list}\nFROM client_web.{source_table}\nWHERE {where}"


def _active_events() -> list[Event]:
    """The events to fetch this run: every registered event except the `off`
    ones. Daily and weekly tables alike are fetched on every run (for the
    trailing live-week window) so the heavy tables self-heal like the search
    events — see the `Event.cadence` docstring for why the daily/weekly split
    no longer gates fetching."""
    return [ev for ev in EVENTS.values() if not ev.is_off]


def _fetch_paginated(client, source_table: str, start: date, end: date,
                     has_user_id: bool, database_id: int,
                     columns: tuple[str, ...] | None = None) -> list[dict]:
    """Fetch one (event, feature-week) by walking /api/dataset in pages.

    Each page is `LIMIT PAGE_SIZE OFFSET n` ordered by `id` — Rudder's unique
    message_id. Ordering by a unique key makes the page boundary deterministic:
    no row can land on two pages or vanish between them. Stops the first time a
    page comes back shorter than PAGE_SIZE (so the last page is also the
    natural terminator). Raises MetabaseError if MAX_PAGES is hit, which is
    sized well above any plausible feature-week volume."""
    base = build_sql(source_table, start, end, has_user_id, columns)
    rows: list[dict] = []
    for page in range(MAX_PAGES):
        sql = f"{base}\nORDER BY id\nLIMIT {PAGE_SIZE} OFFSET {page * PAGE_SIZE}"
        page_rows, _cols = client.run_sql(database_id, sql, raw_columns=True)
        rows.extend(page_rows)
        if len(page_rows) < PAGE_SIZE:
            return rows
    raise MetabaseError(
        f"{source_table}: pagination exceeded MAX_PAGES={MAX_PAGES} "
        f"({MAX_PAGES * PAGE_SIZE} rows) — window unexpectedly large")


def build_layer1(client, weeks: list[int], *,
                 database_id: int = DATABASE_ID,
                 log: list[str] | None = None) -> dict[str, list[dict]]:
    """Fetch each active event for each week; return `{csv_stem: rows}`.

    Partial-success (spec §15): a per-(event, week) failure is logged and
    skipped — its CSV is left untouched (the last good copy stands) — and the
    other events still land. A total failure raises, with the per-event
    reasons folded into the exception message so a cron run that fails 100%
    does not bury its diagnostics (the log is built inside run() and never
    printed when build_layer1 raises).
    """
    log = log if log is not None else []
    out: dict[str, list[dict]] = {}
    failures = 0
    attempts = 0
    for ev in _active_events():
        for n in weeks:
            attempts += 1
            start, end = feature_week.bounds(n)
            stem = f"{feature_week.label(n)}_{ev.stem}"
            try:
                rows = _fetch_paginated(client, ev.source_table, start, end,
                                        ev.has_user_id, database_id,
                                        columns=ev.columns)
            except (MetabaseError, httpx.HTTPError) as exc:
                # Narrowed from `except Exception` so programming bugs (KeyError,
                # TypeError, etc.) propagate as a crash with a real traceback,
                # rather than being silently logged as `FAIL` and mistaken for a
                # Metabase outage. Network and Metabase-protocol errors still
                # land here and the per-event partial-success continues.
                failures += 1
                log.append(f"FAIL {stem}: {exc}")
                continue
            out[stem] = rows
            log.append(f"ok   {stem}: {len(rows)} rows")
    if attempts and failures == attempts:
        detail = "; ".join(l for l in log if l.startswith("FAIL"))
        raise MetabaseError(
            f"every fetch failed ({failures}/{attempts}): {detail}")
    return out


def write_csv_atomic(path: Path, rows: list[dict]) -> int:
    """Write `rows` to `path` as a whole-file atomic replace (temp file +
    os.replace) — spec D5. No append, no merge: the file always mirrors exactly
    one fresh query result, so a refetch cannot duplicate a row. Returns the
    row count written; an empty result writes nothing and returns 0.
    """
    if not rows:
        return 0
    # Fieldnames = insertion-ordered union across all rows, so a column present
    # in any row is preserved. extrasaction="ignore" keeps DictWriter from
    # crashing on an unexpected key.
    seen: dict[str, None] = {}
    for row in rows:
        for k in row:
            seen[k] = None
    fieldnames = list(seen)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)
    return len(rows)


def _read_csv_rows(path: Path) -> list[dict]:
    """Read a written CSV back into dict rows (all values are strings — the
    §14 validators are string-tolerant, so no type coercion is needed here)."""
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def validate_data_dir(data_dir, *, today: date | None = None,
                      weeks: list[int] | None = None
                      ) -> tuple[list[str], list[str]]:
    """Post-fetch validation of the Asset Search CSVs (spec §14) — the body of
    the `--validate` CLI step, run after a refresh.

    Returns `(errors, warnings)`:
      · `errors`  — BLOCKING. Hard fetch-output corruption: schema drift, a
                    test-user leak, a timestamp outside the week window. A
                    non-empty list means the data is genuinely wrong and the
                    cron must not commit it.
      · `warnings` — NON-BLOCKING. The cross-week row-count sanity band — a
                    >10x swing between consecutive weeks. This is a heuristic
                    alert, NOT a gate: it was the W9/W10 incident's trigger,
                    where a frozen heavy table made the projection fail every
                    day and blocked the *whole* commit (good daily data
                    included). Now that the heavy tables self-heal a real swing
                    is either genuine product movement (accept it) or a
                    transient that next-day's fetch corrects — neither should
                    block the commit. The cron surfaces warnings to the alert
                    channel but still commits.

    By default validates the trailing live-week window (`current_and_prior`);
    pass an explicit `weeks` list to validate a backfill range end-to-end.
    """
    from .validate import (validate_asset_search_row_counts,
                           validate_asset_search_week)
    data_dir = Path(data_dir)
    today = today or datetime.now(IST).date()
    if weeks is None:
        weeks = feature_week.current_and_prior(today)
    errors: list[str] = []
    warnings: list[str] = []
    counts: dict[str, dict[int, int]] = {}
    for ev in EVENTS.values():
        if ev.is_off:
            continue
        for n in weeks:
            start, end = feature_week.bounds(n)
            stem = f"{feature_week.label(n)}_{ev.stem}"
            path = data_dir / f"{stem}.csv"
            if not path.exists():
                # A sparse low-volume event with no rows leaves no file — that
                # is expected. But a `must_have_rows` heavy table absent for a
                # live week is the silent-collapse failure mode: flag it as a
                # blocking error so the cron does not commit a week missing its
                # browse/conversion data behind healthy search events.
                if ev.must_have_rows:
                    errors.append(
                        f"{stem}: required heavy table is absent "
                        f"(must_have_rows) — fetch returned no rows or failed")
                continue
            rows = _read_csv_rows(path)
            errors += validate_asset_search_week(stem, rows, start, end)
            counts.setdefault(ev.key, {})[n] = len(rows)
    current_week = feature_week.week_of(today)
    week_start, _ = feature_week.bounds(current_week)
    days_elapsed = (today - week_start).days + 1
    for ev_key, by_week in counts.items():
        warnings += validate_asset_search_row_counts(
            ev_key, by_week,
            current_week=current_week,
            current_week_days_elapsed=days_elapsed)
    return errors, warnings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(client, data_dir, *, today: date | None = None,
        database_id: int = DATABASE_ID,
        weeks: list[int] | None = None) -> dict:
    """Registry entry point (spec D6) — fetch → write CSVs → write manifest.

    By default fetches the trailing live-week window (`current_and_prior`).
    Pass an explicit `weeks` list to backfill specific feature weeks (the
    `--weeks` CLI flag / a `workflow_dispatch` backfill) — e.g. to recover a
    week whose heavy tables were lost. Frozen weeks (< FIRST_LIVE_WEEK) are
    rejected so a backfill can never overwrite the hand-export history.

    All non-`off` events (search *and* heavy browse/conversion) are fetched on
    every run, so the heavy tables self-heal like the search events.

    Returns `{status, log, refreshed_at}`. `status` is "ok" when every fetch
    landed, "partial" when some events failed but others succeeded; a total
    failure raises so the caller marks the job errored.
    """
    data_dir = Path(data_dir)
    today = today or datetime.now(IST).date()
    log: list[str] = []

    if weeks is None:
        weeks = feature_week.current_and_prior(today)
    else:
        frozen = [w for w in weeks if w < feature_week.FIRST_LIVE_WEEK]
        if frozen:
            raise ValueError(
                f"refusing to fetch frozen weeks {sorted(frozen)} "
                f"(< FIRST_LIVE_WEEK={feature_week.FIRST_LIVE_WEEK}) — "
                f"W1–W6 are hand-export history (spec §11)")
        weeks = sorted(set(weeks))
    if not weeks:
        return {"status": "ok", "log": ["no live feature week to fetch yet"],
                "refreshed_at": _now()}
    log.append(f"weeks={weeks}")

    layer1 = build_layer1(client, weeks,
                          database_id=database_id, log=log)

    # Stem-suffixes of the high-volume tables that must never be empty for a
    # live week — used to escalate a 0-row fetch from a soft WARN to a FAIL.
    must_have = tuple(f"_{ev.stem}" for ev in EVENTS.values() if ev.must_have_rows)

    written: list[str] = []
    for stem, rows in layer1.items():
        n = write_csv_atomic(data_dir / f"{stem}.csv", rows)
        if n == 0:
            # A zero-row event leaves the CSV untouched (the prior copy stands).
            # For a must_have_rows table that is a hard failure, not a benign
            # WARN: log FAIL so `had_fail` holds the freshness clock back and
            # the cron's FAIL-grep fires the alert — a collapsed heavy table
            # must never pass as "fresh" behind the still-healthy daily events.
            # A genuinely-sparse event (e.g. notify_me_clicked) stays a WARN.
            if stem.endswith(must_have):
                log.append(f"FAIL {stem}: 0 rows — heavy table must not be empty")
            else:
                log.append(f"WARN {stem}: 0 rows — file left unwritten")
        else:
            written.append(stem)

    now = _now()
    manifest_path = data_dir / "_manifest.json"
    manifest = {"refreshed_at": now, "tables": {}}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except (ValueError, OSError) as exc:
            # Don't swallow silently — surface the corruption in the run log
            # so a partial-write or disk error doesn't quietly wipe per-table
            # `last_refreshed_at` history with no audit trail.
            log.append(f"WARN _manifest.json unreadable, resetting: {exc}")
            manifest = {"refreshed_at": now, "tables": {}}
    manifest.setdefault("tables", {})
    # Per-table freshness advances for every table this run actually wrote —
    # the granular audit trail (`last_refreshed_at` per stem).
    for stem in written:
        manifest["tables"][stem] = {"last_refreshed_at": now}
    # The GLOBAL freshness clock — which drives the dashboard's "as of" stamp
    # and 26 h staleness warning (spec §12) — advances only on a *fully clean*
    # run: at least one CSV written AND no fetch failed. This is the
    # broken-but-green fix from the W9/W10 incident: previously `refreshed_at`
    # advanced whenever *any* table was written, so a run that refreshed the
    # daily search events while a heavy table was stuck still looked fresh and
    # the staleness badge never fired. Now a persistent fetch failure on any
    # active table holds the clock back, so >26 h later the dashboard warns.
    # (A zero-row event is a successful fetch, not a failure — it does not
    # count as `had_fail`.) Paired with self-healing fetches, a *transient*
    # failure is corrected on the next run before the 26 h threshold.
    had_fail = any(l.startswith("FAIL") for l in log)
    if written and not had_fail:
        manifest["refreshed_at"] = now
    manifest.setdefault("refreshed_at", now)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write — a reader catching a half-written manifest mid-cron
    # would 500 the project endpoint. See learn_education.py / D-26.
    tmp_path = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(manifest, indent=2))
    tmp_path.replace(manifest_path)

    status = "partial" if any(l.startswith("FAIL") for l in log) else "ok"
    return {"status": status, "log": log,
            "refreshed_at": manifest["refreshed_at"]}
