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


def test_build_layer1_total_failure_message_carries_per_event_detail():
    # A cron run that fails 100% must not bury the actual reasons — they were
    # being lost when the log printed only on success (a real diagnosability bug).
    client = FakeClient(fail_tables=[e.source_table for e in a_s.EVENTS.values()])
    with pytest.raises(MetabaseError) as exc:
        a_s.build_layer1(client, weeks=[7], include_weekly=False)
    msg = str(exc.value)
    assert "FAIL W7" in msg and "asset_search_query" in msg


def test_build_layer1_paginates_past_the_2000_row_cap():
    # A feature week of asset_search_query is ~4.4k rows; pagination must
    # walk past Metabase's 2000-row /api/dataset cap. With PAGE_SIZE=2000,
    # 4500 rows → 3 pages (2000/2000/500) and every row returned.
    big = [{"id": str(i), "timestamp": "2026-05-15"} for i in range(4500)]
    client = FakeClient(rows_by_table={"asset_search_query": big})
    layer1 = a_s.build_layer1(client, weeks=[7], include_weekly=False)
    assert len(layer1["W7_may14-may20_asset_search_query"]) == 4500
    pages = [q for q in client.queries if "asset_search_query" in q]
    assert len(pages) >= 3
    assert all("ORDER BY id" in q for q in pages)


def test_build_layer1_stops_at_first_short_page():
    # 1500 rows in one page (< PAGE_SIZE) → exactly one fetch, no extra call.
    rows = [{"id": str(i)} for i in range(1500)]
    client = FakeClient(rows_by_table={"asset_search_query": rows})
    layer1 = a_s.build_layer1(client, weeks=[7], include_weekly=False)
    assert len(layer1["W7_may14-may20_asset_search_query"]) == 1500
    pages = [q for q in client.queries if "asset_search_query" in q]
    assert len(pages) == 1


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


def test_validate_data_dir_passes_on_good_csvs(tmp_path):
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-05-15 10:00:00")])
    assert a_s.validate_data_dir(tmp_path, today=date(2026, 5, 15)) == []


def test_validate_data_dir_flags_timestamp_outside_window(tmp_path):
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-06-01 10:00:00")])
    errors = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 15))
    assert any("outside" in e for e in errors)


def test_validate_data_dir_flags_row_count_swing(tmp_path):
    a_s.write_csv_atomic(tmp_path / f"{fw.label(7)}_asset_search_query.csv",
                         [_good_query_row("2026-05-15 10:00:00")])
    a_s.write_csv_atomic(tmp_path / f"{fw.label(8)}_asset_search_query.csv",
                         [_good_query_row("2026-05-22 10:00:00")] * 50)
    errors = a_s.validate_data_dir(tmp_path, today=date(2026, 5, 24))
    assert any("swing" in e for e in errors)
