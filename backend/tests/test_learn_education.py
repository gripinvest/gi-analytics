"""Unit tests for services.integrations.learn_education.

Covers the three behaviours the cron depends on:
  1. Pre-launch idle — both probes return 0, returns `awaiting_first_event`,
     writes nothing.
  2. Half-wired feature — one probe returns 0, still idles cleanly.
  3. Live path — probes pass, main SQL runs, CSV + manifest are written.

Mirrors the sibling test patterns: a FakeClient that returns canned SQL
rows; tmp_path for fs assertions.
"""
import csv
import json
from pathlib import Path

import pytest

from services.integrations import learn_education
from services.integrations.metabase import MetabaseError


# ─── FakeClient ────────────────────────────────────────────────────────────
# Mirrors the real MetabaseClient.run_sql signature:
#   run_sql(database_id: int, sql: str) -> (rows: list[dict], cols: list[str])
class FakeClient:
    def __init__(self, *, learn_page_count=0, experiment_count=0, weekly_rows=None):
        self.learn_page_count = learn_page_count
        self.experiment_count = experiment_count
        self.weekly_rows = weekly_rows or []
        self.calls = []  # (database_id, sql_fragment) — for assertion

    def run_sql(self, database_id, sql, raw_columns=False):
        self.calls.append((database_id, sql[:80]))
        if "learn_page_viewed" in sql and "COUNT(*)" in sql:
            return [{"n": self.learn_page_count}], ["n"]
        if "experiment_assigned" in sql and "COUNT(*)" in sql:
            return [{"n": self.experiment_count}], ["n"]
        # Main weekly SQL
        return list(self.weekly_rows), learn_education.CANONICAL_COLUMNS


class ErrorClient:
    """Client whose run_sql always raises — used to test the error path."""
    def run_sql(self, database_id, sql, raw_columns=False):
        raise MetabaseError("simulated network failure")


# ─── Probe-empty path ──────────────────────────────────────────────────────
def test_run_returns_awaiting_when_both_probes_empty(tmp_path):
    """Pre-launch: feature has not started emitting, no data is written."""
    result = learn_education.run(FakeClient(), tmp_path)
    assert result["status"] == "awaiting_first_event"
    assert isinstance(result["log"], list), "log must be a list, not a string"
    assert result["rows_written"] == 0
    assert not (tmp_path / "weekly_ab_tracker.csv").exists()
    assert not (tmp_path / "_manifest.json").exists()


def test_run_returns_awaiting_when_only_views_present(tmp_path):
    """Half-wired: events fire but experiment_assigned isn't emitting yet."""
    client = FakeClient(learn_page_count=42, experiment_count=0)
    result = learn_education.run(client, tmp_path)
    assert result["status"] == "awaiting_first_event"
    # The log should explain which probe failed.
    joined = "\n".join(result["log"])
    assert "experiment_assigned(learn_page)=0" in joined


def test_run_returns_awaiting_when_only_experiment_present(tmp_path):
    """Half-wired: bucketing fires but learn_page_viewed isn't emitting yet."""
    client = FakeClient(learn_page_count=0, experiment_count=42)
    result = learn_education.run(client, tmp_path)
    assert result["status"] == "awaiting_first_event"
    joined = "\n".join(result["log"])
    assert "learn_page_viewed=0" in joined


# ─── Error path ────────────────────────────────────────────────────────────
def test_run_returns_error_when_probe_throws(tmp_path):
    result = learn_education.run(ErrorClient(), tmp_path)
    assert result["status"] == "error"
    assert isinstance(result["log"], list)
    assert "probe failed" in " ".join(result["log"])


# ─── Live path ─────────────────────────────────────────────────────────────
@pytest.fixture
def sample_weekly_rows():
    """One row per (week, variant) — same shape the real SQL produces."""
    return [
        {
            "week_start": "2026-05-26", "variant": "control",
            "total_non_invested_users": 5000, "learn_page_visitors": 0,
            "learn_visit_rate_pct": 0.0, "unique_video_players": 0,
            "total_video_plays": 0, "avg_videos_per_user": None,
            "avg_watch_time_sec": None, "fti_users": 50,
            "fti_users_who_watched": 0, "fti_rate_pct": 1.0,
        },
        {
            "week_start": "2026-05-26", "variant": "treatment",
            "total_non_invested_users": 5000, "learn_page_visitors": 1500,
            "learn_visit_rate_pct": 30.0, "unique_video_players": 750,
            "total_video_plays": 1200, "avg_videos_per_user": 1.6,
            "avg_watch_time_sec": 22.0, "fti_users": 75,
            "fti_users_who_watched": 40, "fti_rate_pct": 1.5,
        },
    ]


def test_run_writes_csv_when_probes_pass(tmp_path, sample_weekly_rows):
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        weekly_rows=sample_weekly_rows,
    )
    result = learn_education.run(client, tmp_path)

    assert result["status"] == "ok"
    assert result["rows_written"] == 2
    assert result["tables_written"] == ["weekly_ab_tracker"]

    csv_path = tmp_path / "weekly_ab_tracker.csv"
    assert csv_path.exists()

    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        actual_rows = list(reader)

    assert len(actual_rows) == 2
    assert actual_rows[0]["variant"] == "control"
    assert actual_rows[1]["variant"] == "treatment"
    assert actual_rows[1]["learn_page_visitors"] == "1500"
    assert actual_rows[1]["fti_rate_pct"] == "1.5"


def test_run_writes_manifest_with_table_stamp(tmp_path, sample_weekly_rows):
    """Manifest convention mirrors asset_search / grip_connect — the
    frontend `Project.manifest` field depends on this shape."""
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        weekly_rows=sample_weekly_rows,
    )
    learn_education.run(client, tmp_path)

    manifest_path = tmp_path / "_manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert "refreshed_at" in manifest
    assert manifest["tables"]["weekly_ab_tracker"]["last_refreshed_at"]


def test_log_shape_matches_sibling_convention(tmp_path, sample_weekly_rows):
    """refresh.py CLI does `'\\n'.join(result['log'])` — log must be a list."""
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        weekly_rows=sample_weekly_rows,
    )
    result = learn_education.run(client, tmp_path)
    assert isinstance(result["log"], list)
    assert all(isinstance(line, str) for line in result["log"])


# ─── SQL builder ────────────────────────────────────────────────────────────
def test_build_weekly_ab_sql_contains_all_metric_columns():
    """The SQL must produce every column in CANONICAL_COLUMNS."""
    sql = learn_education.build_weekly_ab_sql(weeks=8)
    for col in learn_education.CANONICAL_COLUMNS:
        assert col in sql, f"missing column in SQL: {col}"


def test_build_weekly_ab_sql_filters_test_users():
    """Every CTE that touches user_id must exclude TEST_USERS."""
    sql = learn_education.build_weekly_ab_sql(weeks=8)
    # All six test-user ids must appear quoted as text in the IN clause.
    for u in learn_education.TEST_USERS:
        assert f"'{u}'" in sql, f"test user {u} not excluded"


def test_build_weekly_ab_sql_uses_text_cast_throughout():
    """Rudder stores user_id as varchar; predicates must cast to text."""
    sql = learn_education.build_weekly_ab_sql(weeks=8)
    assert "user_id::text" in sql
    # Should not appear with raw-int comparison
    assert "user_id IN (3" not in sql


def test_build_weekly_ab_sql_uses_causal_ordering_for_fti_watched():
    """fti_users_who_watched needs played_at <= first_order_at."""
    sql = learn_education.build_weekly_ab_sql(weeks=8)
    assert "played_at <= f.first_order_at" in sql
