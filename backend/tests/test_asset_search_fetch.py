import csv
import json
from datetime import date

import pytest

from services.integrations import asset_search as a_s
from services.integrations.metabase import MetabaseError


class FakeClient:
    """Stands in for MetabaseClient — matches one query to a source table by
    substring, returns canned rows. `fail_tables` raises instead."""
    def __init__(self, rows_by_table=None, fail_tables=()):
        self.rows_by_table = rows_by_table or {}
        self.fail_tables = set(fail_tables)
        self.queries: list[str] = []

    def run_sql(self, database_id, sql, raw_columns=False):
        self.queries.append(sql)
        for t in self.fail_tables:
            if f"client_web.{t}" in sql:
                raise MetabaseError(f"boom {t}")
        for t, rows in self.rows_by_table.items():
            if f"client_web.{t}\n" in sql or f"client_web.{t} " in sql:
                cols = list(rows[0].keys()) if rows else []
                return [dict(r) for r in rows], cols
        return [], []


# ── SQL template ────────────────────────────────────────────────────────────

def test_build_sql_windows_and_excludes_test_users():
    sql = a_s.build_sql("asset_search_query", date(2026, 5, 14), date(2026, 5, 21))
    assert "FROM client_web.asset_search_query" in sql
    assert "timestamp >= '2026-05-14' AND timestamp < '2026-05-21'" in sql
    assert "user_id NOT IN (3,4,207871,207875,207878,207879)" in sql


def test_build_sql_omits_user_filter_when_table_has_no_user_id():
    sql = a_s.build_sql("some_table", date(2026, 5, 14), date(2026, 5, 21),
                        has_user_id=False)
    assert "user_id" not in sql


# ── registry / cadence ──────────────────────────────────────────────────────

def test_active_events_respects_cadence():
    daily = {e.key for e in a_s._active_events(include_weekly=False)}
    assert "query" in daily and "quick_checkout" in daily
    assert "assets_page_views" not in daily          # weekly — excluded
    assert "payment_page" not in daily               # off — excluded

    weekly = {e.key for e in a_s._active_events(include_weekly=True)}
    assert "assets_page_views" in weekly and "invest_now" in weekly
    assert "payment_page" not in weekly              # off — still excluded


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
    layer1 = build = a_s.build_layer1(client, weeks=[7], include_weekly=False)
    assert "W7_may14-may20_asset_search_query" in layer1
    assert layer1["W7_may14-may20_asset_search_query"] == [{"id": 1}]


def test_build_layer1_partial_failure_logs_and_continues():
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]},
                        fail_tables=["asset_search_cleared"])
    log: list[str] = []
    layer1 = a_s.build_layer1(client, weeks=[7], include_weekly=False, log=log)
    assert "W7_may14-may20_asset_search_query" in layer1
    assert "W7_may14-may20_asset_search_cleared" not in layer1   # failed → skipped
    assert any(line.startswith("FAIL") and "cleared" in line for line in log)


def test_build_layer1_total_failure_raises():
    client = FakeClient(fail_tables=[e.source_table for e in a_s.EVENTS.values()])
    with pytest.raises(MetabaseError, match="every fetch failed"):
        a_s.build_layer1(client, weeks=[7], include_weekly=False)


# ── run() ───────────────────────────────────────────────────────────────────

def test_run_writes_week_csvs_and_manifest(tmp_path):
    client = FakeClient(rows_by_table={
        "asset_search_query": [{"id": 1, "query_text": "navi"}],
        "asset_search_initiated": [{"id": 9}],
    })
    # 15 May 2026 is mid-W7 (not a rollover) → weeks=[7], daily events only.
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert result["status"] == "ok"
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert manifest["refreshed_at"]
    assert "W7_may14-may20_asset_search_query" in manifest["tables"]
    # weekly-heavy tables are NOT fetched on a non-rollover run.
    assert not (tmp_path / "W7_may14-may20_assets_page_views.csv").exists()


def test_run_partial_failure_reports_partial(tmp_path):
    client = FakeClient(rows_by_table={"asset_search_query": [{"id": 1}]},
                        fail_tables=["asset_search_cleared"])
    result = a_s.run(client, tmp_path, today=date(2026, 5, 15))
    assert result["status"] == "partial"
    assert (tmp_path / "W7_may14-may20_asset_search_query.csv").exists()


def test_run_before_first_live_week_is_a_noop(tmp_path):
    result = a_s.run(FakeClient(), tmp_path, today=date(2026, 5, 1))
    assert result["status"] == "ok"
    assert not (tmp_path / "_manifest.json").exists()
