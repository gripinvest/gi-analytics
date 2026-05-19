"""Asset Search live-data fetch module.

Pulls raw event rows from Metabase by native SQL, windowed by feature week,
and writes one CSV per `(feature-week, event)` — the layout `build_duckdb.py`
and `assetSearch.js`'s `groupTables()` already expect.

Design: `docs/projects/asset-search/specs/2026-05-19-asset-search-live-data-design.md`.
Key decisions carried here:
  · D1 — fetch by native SQL via `MetabaseClient.run_sql` (not saved cards).
  · D3 — each run fetches the current + prior feature week; older weeks frozen.
  · D5 — whole-week CSV is rewritten atomically; no row-level upsert.
  · D7 — search events fetched daily; heavy browse/conversion tables weekly.
  · D8 — the five payment-stage tables are registered but `off` until roadmap #2.
  · D10 — every query excludes the test users.

Deterministic Python — no LLM in the data path. Claude authors & validates it;
the cron / refresh endpoint runs it.
"""
import csv
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from . import feature_week
from .metabase import MetabaseError

# Rudder Prod, schema client_web (data-sources.md header).
DATABASE_ID = 8

# Test users excluded from every query path — single-sourced here, mirroring
# `frontend/lib/queries/assetSearch.js`'s TEST_USERS (spec D10).
TEST_USERS = (3, 4, 207871, 207875, 207878, 207879)


@dataclass(frozen=True)
class Event:
    """One tracked event table.

    cadence: "daily"  — fetched every run (the small search events);
             "weekly" — fetched only on a feature-week-rollover run (heavy
                        browse/conversion tables — spec D7);
             "off"    — registered but not fetched (the payment-stage tables,
                        enabled with roadmap #2 — spec D8).
    has_user_id: whether the source table carries a `user_id` column, i.e.
                 whether the test-user exclusion clause applies.
    """
    key: str
    source_table: str
    stem: str
    cadence: str
    has_user_id: bool = True


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
    Event("assets_page_views",  "view_assets",                     "assets_page_views",               "weekly"),
    Event("invest_now",         "invest_now_button_clicked",       "invest_now_button_clicked",       "weekly"),
    Event("quick_checkout",     "quick_checkout_invest_clicked",   "quick_checkout_invest_clicked",   "daily"),
    # D8 — registered, fetched only once roadmap #2 flips these to "weekly"/"daily".
    Event("payment_page",       "view_payment_page_loaded",        "view_payment_page_loaded",        "off"),
    Event("payment_status",     "view_payment_status_page",        "view_payment_status_page",        "off"),
    Event("new_user_order",     "new_user_order",                  "new_user_order",                  "off"),
    Event("order_summary",      "order_summary_clicked",           "order_summary_clicked",           "off"),
    Event("asset_card_clicked", "asset_card_clicked",              "asset_card_clicked",              "off"),
]}


def build_sql(source_table: str, start: date, end: date,
              has_user_id: bool = True) -> str:
    """The per-event fetch SQL (spec §6.3) — one feature week of raw rows.

    `start`/`end` are the half-open feature-week bounds. They come from
    `feature_week.bounds()` (not user input), so interpolating them carries no
    injection surface. `SELECT *` keeps the export column-complete; the
    validator (validate.py) is the schema-drift guard.
    """
    where = f"timestamp >= '{start}' AND timestamp < '{end}'"
    if has_user_id:
        excl = ",".join(str(u) for u in TEST_USERS)
        where += f"\n  AND (user_id IS NULL OR user_id NOT IN ({excl}))"
    return f"SELECT *\nFROM client_web.{source_table}\nWHERE {where}"


def _active_events(include_weekly: bool) -> list[Event]:
    """The events to fetch this run: always the daily ones; the weekly (heavy)
    ones only on a rollover run; never the `off` ones."""
    out = []
    for ev in EVENTS.values():
        if ev.cadence == "daily" or (ev.cadence == "weekly" and include_weekly):
            out.append(ev)
    return out


def build_layer1(client, weeks: list[int], *, include_weekly: bool = False,
                 database_id: int = DATABASE_ID,
                 log: list[str] | None = None) -> dict[str, list[dict]]:
    """Fetch each active event for each week; return `{csv_stem: rows}`.

    Partial-success (spec §15): a per-(event, week) failure is logged and
    skipped — its CSV is left untouched (the last good copy stands) — and the
    other events still land. Only a total failure raises.
    """
    log = log if log is not None else []
    out: dict[str, list[dict]] = {}
    failures = 0
    attempts = 0
    for ev in _active_events(include_weekly):
        for n in weeks:
            attempts += 1
            start, end = feature_week.bounds(n)
            stem = f"{feature_week.label(n)}_{ev.stem}"
            sql = build_sql(ev.source_table, start, end, ev.has_user_id)
            try:
                rows, _cols = client.run_sql(database_id, sql, raw_columns=True)
            except (MetabaseError, Exception) as exc:  # noqa: BLE001 — log & continue
                failures += 1
                log.append(f"FAIL {stem}: {exc}")
                continue
            out[stem] = rows
            log.append(f"ok   {stem}: {len(rows)} rows")
    if attempts and failures == attempts:
        raise MetabaseError(f"every fetch failed ({failures}/{attempts}) — see log")
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


def validate_data_dir(data_dir, *, today: date | None = None) -> list[str]:
    """Post-fetch validation of the Asset Search CSVs (spec §14) — the body of
    the `--validate` CLI step, run after a refresh. Validates the freshly-
    fetched current + prior feature weeks: per-week schema / test-user / window
    checks, plus the cross-week row-count sanity band. Returns a list of error
    strings; empty means the fetch output looks sound. Frozen historical weeks
    are out of scope — `current_and_prior` only yields live weeks.
    """
    from .validate import (validate_asset_search_row_counts,
                           validate_asset_search_week)
    data_dir = Path(data_dir)
    today = today or date.today()
    weeks = feature_week.current_and_prior(today)
    errors: list[str] = []
    counts: dict[str, dict[int, int]] = {}
    for ev in EVENTS.values():
        if ev.cadence == "off":
            continue
        for n in weeks:
            start, end = feature_week.bounds(n)
            stem = f"{feature_week.label(n)}_{ev.stem}"
            path = data_dir / f"{stem}.csv"
            if not path.exists():
                # A weekly table on a non-rollover run is not re-fetched — its
                # absence here is expected, not a validation failure.
                continue
            rows = _read_csv_rows(path)
            errors += validate_asset_search_week(stem, rows, start, end)
            counts.setdefault(ev.key, {})[n] = len(rows)
    for ev_key, by_week in counts.items():
        errors += validate_asset_search_row_counts(ev_key, by_week)
    return errors


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(client, data_dir, *, today: date | None = None,
        database_id: int = DATABASE_ID) -> dict:
    """Registry entry point (spec D6) — fetch → write CSVs → write manifest.

    Returns `{status, log, refreshed_at}`. `status` is "ok" when every fetch
    landed, "partial" when some events failed but others succeeded; a total
    failure raises so the caller marks the job errored.
    """
    data_dir = Path(data_dir)
    today = today or date.today()
    log: list[str] = []

    weeks = feature_week.current_and_prior(today)
    if not weeks:
        return {"status": "ok", "log": ["no live feature week to fetch yet"],
                "refreshed_at": _now()}
    include_weekly = feature_week.is_rollover(today)
    log.append(f"weeks={weeks} include_weekly={include_weekly}")

    layer1 = build_layer1(client, weeks, include_weekly=include_weekly,
                          database_id=database_id, log=log)

    written: list[str] = []
    for stem, rows in layer1.items():
        n = write_csv_atomic(data_dir / f"{stem}.csv", rows)
        if n == 0:
            # A zero-row event is suspect (we fetch whole feature weeks). The
            # CSV is left untouched; the `--validate` step (validate.py §14)
            # is what flags this as a hard error and blocks the cron commit.
            log.append(f"WARN {stem}: 0 rows — file left unwritten")
        else:
            written.append(stem)

    now = _now()
    manifest_path = data_dir / "_manifest.json"
    manifest = {"refreshed_at": now, "tables": {}}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except (ValueError, OSError):
            manifest = {"refreshed_at": now, "tables": {}}
    manifest.setdefault("tables", {})
    # Advance the freshness clock only when this run actually wrote a CSV. A
    # run that fetched zero rows everywhere must leave `refreshed_at` stale so
    # the dashboard's 26 h staleness warning still fires (spec §12) instead of
    # being silenced by a no-op refresh.
    if written:
        manifest["refreshed_at"] = now
        for stem in written:
            manifest["tables"][stem] = {"last_refreshed_at": now}
    manifest.setdefault("refreshed_at", now)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2))

    status = "partial" if any(l.startswith("FAIL") for l in log) else "ok"
    return {"status": status, "log": log,
            "refreshed_at": manifest["refreshed_at"]}
