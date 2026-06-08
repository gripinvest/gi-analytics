import csv
import json
import re
from datetime import date

import pytest

from services.integrations import asset_search as a_s
from services.integrations import feature_week as fw
from services.integrations.metabase import MetabaseError


class FakeClient:
    """Stands in for MetabaseClient — matches one query to a source table by
    substring, returns canned rows. Honours `LIMIT/OFFSET` so pagination is
    actually exercised; `fail_tables` raises instead."""
    def __init__(self, rows_by_table=None, fail_tables=()):
        self.rows_by_table = rows_by_table or {}
        self.fail_tables = set(fail_tables)
        self.queries: list[str] = []

    def run_sql(self, database_id, sql, raw_columns=False):
        self.queries.append(sql)
        for t in self.fail_tables:
            if f"client_web.{t}" in sql:
                raise MetabaseError(f"boom {t}")
        m = re.search(r"LIMIT (\d+) OFFSET (\d+)", sql)
        limit, offset = (int(m.group(1)), int(m.group(2))) if m else (None, 0)
        for t, rows in self.rows_by_table.items():
            if f"client_web.{t}\n" in sql or f"client_web.{t} " in sql:
                page = rows[offset:offset + limit] if limit else rows
                cols = list(rows[0].keys()) if rows else []
                return [dict(r) for r in page], cols
        return [], []


# ── SQL template ────────────────────────────────────────────────────────────

def test_build_sql_windows_and_excludes_test_users():
    sql = a_s.build_sql("asset_search_query", date(2026, 5, 14), date(2026, 5, 21))
    assert "FROM client_web.asset_search_query" in sql
    assert "timestamp >= '2026-05-14' AND timestamp < '2026-05-21'" in sql
    # `user_id::text NOT IN (...)` makes the exclusion tolerant to user_id
    # being `integer` on some Rudderstack tables and `text` on others.
    assert ("user_id::text NOT IN "
            "('3','4','207871','207875','207878','207879')") in sql


def test_build_sql_omits_user_filter_when_table_has_no_user_id():
    sql = a_s.build_sql("some_table", date(2026, 5, 14), date(2026, 5, 21),
                        has_user_id=False)
    assert "user_id" not in sql


# ── registry / cadence ──────────────────────────────────────────────────────

def test_active_events_fetches_daily_and_weekly_excludes_off():
    # Self-healing: every run fetches both the daily search events AND the
    # heavy weekly browse/conversion tables; only `off` events are excluded.
    active = {e.key for e in a_s._active_events()}
    assert "query" in active and "quick_checkout" in active   # daily
    assert "assets_page_views" in active and "invest_now" in active  # weekly
    assert "payment_page" not in active              # off — excluded
    assert all(not e.is_off for e in a_s._active_events())


def test_invest_now_is_column_pruned():
    # The heavy invest_now table is pruned to the four columns conversion.js
    # reads, so daily re-fetching doesn't churn ~16 MB into git every run.
    ev = a_s.EVENTS["invest_now"]
    assert ev.columns == ("user_id", "timestamp", "asset_id", "product_category")
    sql = a_s.build_sql(ev.source_table, date(2026, 5, 28), date(2026, 6, 4),
                        columns=ev.columns)
    assert "SELECT user_id, timestamp, asset_id, product_category" in sql
    assert "SELECT *" not in sql


# ── atomic CSV write ────────────────────────────────────────────────────────

def test_write_csv_atomic_writes_and_is_idempotent(tmp_path):
    rows = [{"id": 1, "query_text": "navi"}, {"id": 2, "query_text": "rbi"}]
    path = tmp_path / "w.csv"
    assert a_s.write_csv_atomic(path, rows) == 2
    first = path.read_text()
    # a refetch of the same data yields a byte-identical file (no duplication).
    a_s.write_csv_atomic(path, rows)
    assert path.read_text() == first
    parsed = list(csv.DictReader(open(path)))
    assert [r["query_text"] for r in parsed] == ["navi", "rbi"]
    assert not (tmp_path / "w.csv.tmp").exists()      # temp cleaned up


def test_write_csv_atomic_empty_writes_nothing(tmp_path):
    path = tmp_path / "empty.csv"
    assert a_s.write_csv_atomic(path, []) == 0
    assert not path.exists()


# ── build_layer1 ────────────────────────────────────────────────────────────

def test_build_layer1_keys_by_week_stem():
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]})
    layer1 = build = a_s.build_layer1(client, weeks=[7])
    assert "W7_may14-may20_asset_search_query" in layer1
    assert layer1["W7_may14-may20_asset_search_query"] == [{"id": 1}]


def test_build_layer1_partial_failure_logs_and_continues():
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]},
                        fail_tables=["asset_search_cleared"])
    log: list[str] = []
    layer1 = a_s.build_layer1(client, weeks=[7], log=log)
    assert "W7_may14-may20_asset_search_query" in layer1
    assert "W7_may14-may20_asset_search_cleared" not in layer1   # failed → skipped
    assert any(line.startswith("FAIL") and "cleared" in line for line in log)


def test_build_layer1_total_failure_raises():
    client = FakeClient(fail_tables=[e.source_table for e in a_s.EVENTS.values()])
    with pytest.raises(MetabaseError, match="every fetch failed"):
        a_s.build_layer1(client, weeks=[7])


def test_build_layer1_total_failure_message_carries_per_event_detail():
    # A cron run that fails 100% must not bury the actual reasons — they were
    # being lost when the log printed only on success (a real diagnosability bug).
    client = FakeClient(fail_tables=[e.source_table for e in a_s.EVENTS.values()])
    with pytest.raises(MetabaseError) as exc:
        a_s.build_layer1(client, weeks=[7])
    msg = str(exc.value)
    assert "FAIL W7" in msg and "asset_search_query" in msg


def test_build_layer1_paginates_past_the_2000_row_cap():
    # A feature week of asset_search_query is ~4.4k rows; pagination must
    # walk past Metabase's 2000-row /api/dataset cap. With PAGE_SIZE=2000,
    # 4500 rows → 3 pages (2000/2000/500) and every row returned.
    big = [{"id": str(i), "timestamp": "2026-05-15"} for i in range(4500)]
    client = FakeClient(rows_by_table={"asset_search_query": big})
    layer1 = a_s.build_layer1(client, weeks=[7])
    assert len(layer1["W7_may14-may20_asset_search_query"]) == 4500
    pages = [q for q in client.queries if "asset_search_query" in q]
    assert len(pages) >= 3
    assert all("ORDER BY id" in q for q in pages)


def test_build_layer1_stops_at_first_short_page():
    # 1500 rows in one page (< PAGE_SIZE) → exactly one fetch, no extra call.
    rows = [{"id": str(i)} for i in range(1500)]
    client = FakeClient(rows_by_table={"asset_search_query": rows})
    layer1 = a_s.build_layer1(client, weeks=[7])
    assert len(layer1["W7_may14-may20_asset_search_query"]) == 1500
    pages = [q for q in client.queries if "asset_search_query" in q]
    assert len(pages) == 1


# ── run() ───────────────────────────────────────────────────────────────────

def test_run_writes_week_csvs_and_manifest(tmp_path):
    client = FakeClient(rows_by_table={
        "asset_search_query": [{"id": 1, "query_text": "navi"}],
        "asset_search_initiated": [{"id": 9}],
        # The two must_have_rows heavy tables need rows or the run is `partial`.
        "view_assets": [{"id": 2, "user_id": "100", "timestamp": "2026-05-15"}],
        "invest_now_button_clicked": [{"id": 3, "user_id": "100",
                                       "timestamp": "2026-05-15"}],
    })
    # 15 May 2026 is mid-W7 (not a rollover) → weeks=[7].
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert result["status"] == "ok"
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert manifest["refreshed_at"]
    assert "W7_may14-may20_asset_search_query" in manifest["tables"]


def test_run_fetches_weekly_heavy_tables_every_run(tmp_path):
    # Self-healing: the heavy browse/conversion tables are fetched on EVERY
    # run, not only on the once-a-week rollover. 15 May is mid-W7 (not a
    # rollover), yet view_assets (→ assets_page_views) lands.
    client = FakeClient(rows_by_table={
        "view_assets": [{"id": 1, "user_id": "10", "timestamp": "2026-05-15"}],
        "invest_now_button_clicked": [{"id": 2, "user_id": "11",
                                       "timestamp": "2026-05-15"}],
    })
    a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert (tmp_path / "W7_may14-may20_assets_page_views.csv").exists()
    assert (tmp_path / "W7_may14-may20_invest_now_button_clicked.csv").exists()


def test_run_partial_failure_reports_partial(tmp_path):
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]},
                        fail_tables=["asset_search_cleared"])
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert result["status"] == "partial"
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()


def test_run_partial_failure_does_not_advance_global_freshness(tmp_path):
    # Broken-but-green fix: a run that wrote SOME tables but had a fetch FAIL
    # must NOT advance the global refreshed_at — otherwise a stuck table is
    # masked by the healthy ones and the staleness badge never fires. The
    # per-table clock for the tables that DID write still advances.
    old = "2020-01-01T00:00:00+00:00"
    (tmp_path / "_manifest.json").write_text(
        json.dumps({"refreshed_at": old, "tables": {}}))
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]},
                        fail_tables=["asset_search_cleared"])
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert result["status"] == "partial"
    assert manifest["refreshed_at"] == old                 # held back
    assert "W7_may14-may20_asset_search_query" in manifest["tables"]  # per-table advanced


def test_run_backfill_weeks_overrides_trailing_window(tmp_path):
    # An explicit weeks list backfills those feature weeks regardless of today.
    client = FakeClient(rows_by_table={"asset_search_query": [
        {"id": 1, "timestamp": "2026-05-15"}]})
    a_s.run(client, tmp_path, today=date(2026, 6, 8), weeks=[7])
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()
    # The live trailing window (W9/W10) was NOT fetched — only the asked week.
    assert not (tmp_path / "W10_jun04-jun10_asset_search_query.csv").exists()


def test_run_backfill_rejects_frozen_weeks(tmp_path):
    # A backfill must never overwrite the frozen W1–W6 hand-export history.
    with pytest.raises(ValueError, match="frozen weeks"):
        a_s.run(FakeClient(), tmp_path, today=date(2026, 6, 8), weeks=[5, 7])


def test_run_zero_row_heavy_table_fails_and_holds_freshness(tmp_path):
    # Silent-collapse guard: search events land but the heavy tables fetch zero
    # rows (collapse / empty source). That must NOT pass as fresh — it logs
    # FAIL, the run is `partial`, and the global freshness clock is held back so
    # the staleness badge fires instead of being masked by the healthy dailies.
    old = "2020-01-01T00:00:00+00:00"
    (tmp_path / "_manifest.json").write_text(
        json.dumps({"refreshed_at": old, "tables": {}}))
    client = FakeClient(rows_by_table={
        "asset_search_query": [{"id": 1, "timestamp": "2026-05-15"}]})
    # view_assets / invest_now_button_clicked absent from rows_by_table → 0 rows.
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert result["status"] == "partial"
    assert any("FAIL" in l and "assets_page_views" in l for l in result["log"])
    assert any("FAIL" in l and "invest_now_button_clicked" in l for l in result["log"])
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert manifest["refreshed_at"] == old        # freshness held, not masked
    # the healthy search event still wrote its per-table clock + CSV
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()


def test_run_in_frozen_weeks_only_is_a_noop(tmp_path):
    # 1 May 2026 sits in W4 — well past launch (Apr 2) but before
    # FIRST_LIVE_WEEK=7, so current_and_prior(...) yields the empty list and
    # the runner returns early without writing the manifest. Guards against
    # accidentally re-fetching frozen weeks.
    result = a_s.run(FakeClient(), tmp_path, today=date(2026, 5, 1))
    assert result["status"] == "ok"
    assert not (tmp_path / "_manifest.json").exists()


def test_run_does_not_advance_freshness_when_nothing_written(tmp_path):
    # A run that fetches zero rows everywhere must NOT reset the staleness
    # clock — otherwise a no-op refresh silences the 26h staleness warning.
    old = "2020-01-01T00:00:00+00:00"
    (tmp_path / "_manifest.json").write_text(
        json.dumps({"refreshed_at": old, "tables": {}}))
    result = a_s.run(FakeClient(), tmp_path, today=date(2026, 5, 15))
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert manifest["refreshed_at"] == old
    assert result["refreshed_at"] == old


# ── validate_data_dir (the --validate CLI step, spec §14) ───────────────────

def _good_query_row(ts):
    return {"timestamp": ts, "context_session_id": "s1", "query_text": "navi",
            "results_count": 3, "is_refinement": False}


def _write_heavy_tables(tmp_path, n, ts):
    """Write valid (non-empty, in-window, required-cols) heavy tables for week
    `n` — assets_page_views and invest_now both carry `must_have_rows`, so a
    week with only search CSVs now (correctly) fails validation."""
    a_s.write_csv_atomic(tmp_path / f"{fw.label(n)}_assets_page_views.csv",
                         [{"user_id": "100", "anonymous_id": "a1",
                           "context_session_id": "s1", "timestamp": ts}])
    a_s.write_csv_atomic(tmp_path / f"{fw.label(n)}_invest_now_button_clicked.csv",
                         [{"user_id": "100", "timestamp": ts,
                           "asset_id": "A1", "product_category": "bond"}])


def test_validate_data_dir_passes_on_good_csvs(tmp_path):
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-05-15 10:00:00")])
    _write_heavy_tables(tmp_path, 7, "2026-05-15 10:00:00")
    errors, warnings = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 15))
    assert errors == [] and warnings == []


def test_validate_data_dir_flags_absent_heavy_table(tmp_path):
    # The silent-collapse guard: a live week with healthy search data but an
    # ABSENT heavy browse/conversion table is a BLOCKING error (not skipped).
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-05-15 10:00:00")])
    errors, _ = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 15))
    assert any("assets_page_views" in e and "absent" in e for e in errors)
    assert any("invest_now_button_clicked" in e and "absent" in e for e in errors)


def test_validate_data_dir_flags_timestamp_outside_window(tmp_path):
    # A timestamp outside the week window is hard corruption → BLOCKING error.
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-06-01 10:00:00")])
    errors, _warnings = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 15))
    assert any("outside" in e for e in errors)


def test_validate_data_dir_swing_is_a_nonblocking_warning(tmp_path):
    # A >10x row-count swing is a NON-blocking warning, never a hard error —
    # it must not abort the commit (the W9/W10 incident's failure mode). The
    # heuristic lands in `warnings`, leaving `errors` empty.
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-05-15 10:00:00")])
    a_s.write_csv_atomic(tmp_path / f"{fw.label(8)}_asset_search_query.csv",
                         [_good_query_row("2026-05-22 10:00:00")] * 50)
    _write_heavy_tables(tmp_path, 7, "2026-05-15 10:00:00")
    _write_heavy_tables(tmp_path, 8, "2026-05-22 10:00:00")
    errors, warnings = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 24))
    assert errors == []
    assert any("swing" in w for w in warnings)


def test_validate_data_dir_accepts_explicit_backfill_weeks(tmp_path):
    # A backfill validates an explicit week range (e.g. W7-W8), not just the
    # live trailing window — so a recovery run is checked end-to-end.
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-06-01 10:00:00")])   # in W7? no → outside
    errors, _ = a_s.validate_data_dir(tmp_path, today=date(2026, 6, 8),
                                      weeks=[7])
    assert any("outside" in e for e in errors)
