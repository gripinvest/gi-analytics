"""Unit tests for services.integrations.learn_education.

Covers:
  · Pre-launch idle (both probes 0 → awaiting_first_event, no I/O)
  · Half-wired (one probe 0 → awaiting_first_event)
  · Probe error (run_sql raises)
  · Live path (CSV + _manifest.json written)
  · SQL builder invariants
  · aggregate_rows() — the Python merge of engagement (DB 8) + FTI (DB 24)

The FakeClient dispatches by database_id so we can exercise the two-DB
design — Rudder probes / engagement go to DB 8, FTI goes to DB 24.
"""
import csv
import json

import pytest

from services.integrations import learn_education
from services.integrations.metabase import MetabaseError


# ─── FakeClient — dispatches by database_id ────────────────────────────────
class FakeClient:
    """Mirrors MetabaseClient.run_sql(database_id, sql) -> (rows, cols)."""

    def __init__(self, *, learn_page_count=0, experiment_count=0,
                 engagement_rows=None, fti_rows=None, daily_orders=0):
        self.learn_page_count = learn_page_count
        self.experiment_count = experiment_count
        self.engagement_rows = engagement_rows or []
        self.fti_rows = fti_rows or []
        self.daily_orders = daily_orders
        self.calls = []

    def run_sql(self, database_id, sql, raw_columns=False):
        # Store the full SQL so cohort-scope tests can assert on the IN clause.
        self.calls.append((database_id, sql))
        normalized = sql.strip()

        # Rudder DB — distinguish probes (no CTEs, return COUNT) from the
        # engagement query (starts with `WITH cohort`).
        if database_id == learn_education.RUDDER_DB_ID:
            is_probe = not normalized.upper().startswith("WITH")
            if is_probe and "learn_page_viewed" in normalized:
                return [{"n": self.learn_page_count}], ["n"]
            if is_probe and "experiment_assigned" in normalized:
                return [{"n": self.experiment_count}], ["n"]
            # Engagement query (CTE-heavy). Respects LIMIT/OFFSET to
            # exercise pagination — mirrors the FTI walker pattern.
            import re
            m = re.search(r"LIMIT\s+(\d+)\s+OFFSET\s+(\d+)", normalized, re.IGNORECASE)
            limit = int(m.group(1)) if m else len(self.engagement_rows)
            offset = int(m.group(2)) if m else 0
            return list(self.engagement_rows[offset:offset + limit]), [
                "user_id", "variant", "assigned_week",
                "visit_count", "play_count", "watch_seconds_sum", "first_play_at",
            ]

        # Transactions DB — distinguish:
        #   · daily-order COUNT(*) probe → returns {n: daily_order_count}
        #   · paginated FTI fetch        → returns the canned fti_rows
        if database_id == learn_education.TRANSACTIONS_DB_ID:
            if "COUNT(*)" in normalized and "INTERVAL 1 DAY" in normalized:
                return [{"n": getattr(self, "daily_orders", 0)}], ["n"]
            # FTI query — respects LIMIT/OFFSET to exercise pagination.
            import re
            m = re.search(r"LIMIT\s+(\d+)\s+OFFSET\s+(\d+)", normalized, re.IGNORECASE)
            limit = int(m.group(1)) if m else len(self.fti_rows)
            offset = int(m.group(2)) if m else 0
            return list(self.fti_rows[offset:offset + limit]), ["user_id", "fti_date"]

        raise AssertionError(f"unexpected database_id: {database_id}")


class ErrorClient:
    """Client whose run_sql always raises — used to test the error path."""
    def run_sql(self, database_id, sql, raw_columns=False):
        raise MetabaseError("simulated network failure")


# ─── Probe-empty path ──────────────────────────────────────────────────────
def test_run_returns_awaiting_when_both_probes_empty(tmp_path):
    result = learn_education.run(FakeClient(), tmp_path)
    assert result["status"] == "awaiting_first_event"
    assert isinstance(result["log"], list)
    assert result["rows_written"] == 0
    assert not (tmp_path / "weekly_ab_tracker.csv").exists()
    assert not (tmp_path / "_manifest.json").exists()


def test_run_returns_awaiting_when_only_views_present(tmp_path):
    client = FakeClient(learn_page_count=42, experiment_count=0)
    result = learn_education.run(client, tmp_path)
    assert result["status"] == "awaiting_first_event"
    assert "experiment_assigned(learn_page)=0" in "\n".join(result["log"])


def test_run_returns_awaiting_when_only_experiment_present(tmp_path):
    client = FakeClient(learn_page_count=0, experiment_count=42)
    result = learn_education.run(client, tmp_path)
    assert result["status"] == "awaiting_first_event"
    assert "learn_page_viewed=0" in "\n".join(result["log"])


# ─── Error path ────────────────────────────────────────────────────────────
def test_run_returns_error_when_probe_throws(tmp_path):
    result = learn_education.run(ErrorClient(), tmp_path)
    assert result["status"] == "error"
    assert "probe failed" in " ".join(result["log"])


# ─── Live path fixtures ────────────────────────────────────────────────────
@pytest.fixture
def sample_engagement_rows():
    """Per-user engagement rows the SQL would return for two cohort weeks."""
    return [
        # W1 Control — engaged 0 since surface is invisible
        {"user_id": "1001", "variant": "control", "assigned_week": "2026-05-26",
         "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0,
         "first_play_at": None},
        {"user_id": "1002", "variant": "control", "assigned_week": "2026-05-26",
         "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0,
         "first_play_at": None},
        # W1 Treatment — two users, both engaged
        {"user_id": "2001", "variant": "treatment", "assigned_week": "2026-05-26",
         "visit_count": 1, "play_count": 3, "watch_seconds_sum": 60,
         "first_play_at": "2026-05-27T10:00:00"},
        {"user_id": "2002", "variant": "treatment", "assigned_week": "2026-05-26",
         "visit_count": 1, "play_count": 1, "watch_seconds_sum": 18,
         "first_play_at": "2026-05-28T15:30:00"},
        # W1 Treatment — one user who visited but did not play
        {"user_id": "2003", "variant": "treatment", "assigned_week": "2026-05-26",
         "visit_count": 1, "play_count": 0, "watch_seconds_sum": 0,
         "first_play_at": None},
    ]


@pytest.fixture
def sample_fti_rows():
    """FTI rows from tblorders. user_id is int (Postgres native)."""
    return [
        {"user_id": 1001, "fti_date": "2026-05-30T12:00:00"},  # Control FTI
        {"user_id": 2001, "fti_date": "2026-05-29T09:00:00"},  # Treatment FTI, watched first
        # 2002 did not FTI
        # 2003 did not FTI
    ]


# ─── Live path ─────────────────────────────────────────────────────────────
def test_run_writes_csv_when_probes_pass(tmp_path, sample_engagement_rows, sample_fti_rows):
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=sample_engagement_rows,
        fti_rows=sample_fti_rows,
    )
    result = learn_education.run(client, tmp_path)

    assert result["status"] == "ok"
    assert result["rows_written"] == 2  # control + treatment
    assert result["tables_written"] == ["weekly_ab_tracker"]

    csv_path = tmp_path / "weekly_ab_tracker.csv"
    assert csv_path.exists()

    with csv_path.open() as fh:
        actual = list(csv.DictReader(fh))

    assert len(actual) == 2
    control = next(r for r in actual if r["variant"] == "control")
    treatment = next(r for r in actual if r["variant"] == "treatment")

    # Control: 2 users, 0 visits, 1 FTI → 1/2 = 50.0%
    assert control["total_non_invested_users"] == "2"
    assert control["learn_page_visitors"] == "0"
    assert control["fti_users"] == "1"
    assert control["fti_rate_pct"] == "50.0"

    # Treatment: 3 users, 3 visits, 2 players, 4 plays, 1 FTI who watched first
    assert treatment["total_non_invested_users"] == "3"
    assert treatment["learn_page_visitors"] == "3"
    assert treatment["unique_video_players"] == "2"
    assert treatment["total_video_plays"] == "4"
    assert treatment["fti_users"] == "1"
    assert treatment["fti_users_who_watched"] == "1"


def test_run_dispatches_to_both_databases(tmp_path, sample_engagement_rows, sample_fti_rows):
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=sample_engagement_rows,
        fti_rows=sample_fti_rows,
    )
    learn_education.run(client, tmp_path)

    db_ids_hit = {db_id for (db_id, _) in client.calls}
    assert learn_education.RUDDER_DB_ID in db_ids_hit, "engagement queries skipped DB 8"
    assert learn_education.TRANSACTIONS_DB_ID in db_ids_hit, "FTI query skipped DB 24"


def test_run_writes_manifest_with_table_stamp(tmp_path, sample_engagement_rows, sample_fti_rows):
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=sample_engagement_rows,
        fti_rows=sample_fti_rows,
    )
    learn_education.run(client, tmp_path)

    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert "refreshed_at" in manifest
    assert manifest["tables"]["weekly_ab_tracker"]["last_refreshed_at"]


def test_log_shape_matches_sibling_convention(tmp_path, sample_engagement_rows, sample_fti_rows):
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=sample_engagement_rows,
        fti_rows=sample_fti_rows,
    )
    result = learn_education.run(client, tmp_path)
    assert isinstance(result["log"], list)
    assert all(isinstance(line, str) for line in result["log"])


# ─── aggregate_rows — unit tests for the merge logic ───────────────────────
def test_aggregate_rows_empty_inputs():
    assert learn_education.aggregate_rows([], []) == []


def test_aggregate_rows_treats_int_and_str_user_ids_as_same():
    """Rudder stores user_id as text; tblorders as int. The merge must
    normalise both sides to string to find the same user."""
    eng = [{
        "user_id": "12345", "variant": "treatment", "assigned_week": "2026-05-26",
        "visit_count": 1, "play_count": 1, "watch_seconds_sum": 10,
        "first_play_at": "2026-05-27T10:00:00",
    }]
    fti = [{"user_id": 12345, "fti_date": "2026-05-28T10:00:00"}]  # int

    [row] = learn_education.aggregate_rows(eng, fti)
    assert row["fti_users"] == 1
    assert row["fti_users_who_watched"] == 1


def test_aggregate_rows_excludes_fti_before_assignment_week():
    """Defensive: a user with first_order_at < assigned_week must NOT count
    (would mean they were already an investor when assigned — should have
    been gated out upstream by useShowLearnPage's !isInvested check)."""
    eng = [{
        "user_id": "1", "variant": "treatment", "assigned_week": "2026-05-26",
        "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0,
        "first_play_at": None,
    }]
    fti = [{"user_id": 1, "fti_date": "2026-05-20T10:00:00"}]  # before W1 starts

    [row] = learn_education.aggregate_rows(eng, fti)
    assert row["fti_users"] == 0


def test_aggregate_rows_fti_who_watched_requires_play_before_order():
    """Causal ordering: a user who FTI'd then watched should NOT count
    as fti_users_who_watched. Watching after the purchase decision proves
    nothing about Learn's causal influence."""
    eng = [{
        "user_id": "1", "variant": "treatment", "assigned_week": "2026-05-26",
        "visit_count": 1, "play_count": 1, "watch_seconds_sum": 10,
        "first_play_at": "2026-05-30T10:00:00",  # AFTER fti_date below
    }]
    fti = [{"user_id": 1, "fti_date": "2026-05-28T10:00:00"}]

    [row] = learn_education.aggregate_rows(eng, fti)
    assert row["fti_users"] == 1, "still counts as FTI"
    assert row["fti_users_who_watched"] == 0, "watch was after invest, no causality"


def test_aggregate_rows_computes_rates_correctly():
    eng = [
        # 5 users in cohort, 2 visits, 1 play
        {"user_id": str(i), "variant": "treatment", "assigned_week": "2026-05-26",
         "visit_count": 1 if i <= 2 else 0,
         "play_count": 1 if i == 1 else 0,
         "watch_seconds_sum": 30 if i == 1 else 0,
         "first_play_at": "2026-05-27T10:00:00" if i == 1 else None}
        for i in range(1, 6)
    ]
    fti = []

    [row] = learn_education.aggregate_rows(eng, fti)
    assert row["total_non_invested_users"] == 5
    assert row["learn_page_visitors"] == 2
    assert row["learn_visit_rate_pct"] == 40.0  # 2/5
    assert row["unique_video_players"] == 1
    assert row["total_video_plays"] == 1
    assert row["avg_videos_per_user"] == 1.0  # 1/1
    assert row["avg_watch_time_sec"] == 30.0  # 30/1
    assert row["fti_rate_pct"] == 0.0  # 0/5


# ─── Multi-variant — develop-branch experiment architecture ───────────────
def test_aggregate_rows_handles_multi_treatment_variants():
    """Per gi-client-web develop branch utils/experimentBucketing.ts:
    getExperimentVariant() can return 'treatment' (binary mode) OR named
    variants like 'treatmentv1', 'treatmentv2' (when Strapi config has
    variants[]). The aggregator must pass any variant string through to
    a per-(week, variant) row without special-casing."""
    eng = [
        {"user_id": "1", "variant": "control",     "assigned_week": "2026-05-26",
         "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0, "first_play_at": None},
        {"user_id": "2", "variant": "treatmentv1", "assigned_week": "2026-05-26",
         "visit_count": 1, "play_count": 2, "watch_seconds_sum": 30,
         "first_play_at": "2026-05-27T10:00:00"},
        {"user_id": "3", "variant": "treatmentv2", "assigned_week": "2026-05-26",
         "visit_count": 1, "play_count": 1, "watch_seconds_sum": 15,
         "first_play_at": "2026-05-27T10:00:00"},
    ]
    out = learn_education.aggregate_rows(eng, [])
    variants = sorted(r["variant"] for r in out)
    assert variants == ["control", "treatmentv1", "treatmentv2"]
    # Engagement metrics are per-variant — no cross-arm aggregation.
    t1 = next(r for r in out if r["variant"] == "treatmentv1")
    t2 = next(r for r in out if r["variant"] == "treatmentv2")
    assert t1["total_video_plays"] == 2
    assert t2["total_video_plays"] == 1


def test_engagement_sql_filters_gc_excluded_and_not_eligible():
    """Defensive filter: trackExperimentAssignment short-circuits before
    firing for gc_excluded/not_eligible cases, but if any leak through
    (e.g. an analytics dev wires a different call path) we must not let
    them pollute the cohort denominator."""
    sql = learn_education.build_engagement_sql(weeks=8)
    assert "experiment_variant NOT IN ('gc_excluded', 'not_eligible')" in sql
    assert "experiment_variant IS NOT NULL" in sql


# ─── SQL builder invariants ────────────────────────────────────────────────
def test_engagement_sql_uses_text_casts_and_excludes_test_users():
    sql = learn_education.build_engagement_sql(weeks=8)
    assert "user_id::text" in sql
    for u in learn_education.TEST_USERS:
        assert f"'{u}'" in sql


def _sample_fti_sql():
    """The cohort-scoped FTI SQL with sentinel values for builder tests."""
    return learn_education.build_fti_sql([12345, 67890], limit=2000, offset=0)


def test_fti_sql_filters_to_buy_orders_with_settled_status():
    sql = _sample_fti_sql()
    assert "order_type = 'BUY'" in sql
    for status in (1, 7, 8):
        assert str(status) in sql
    assert "status IN (1,7,8)" in sql


def test_fti_sql_excludes_test_users():
    sql = _sample_fti_sql()
    for u in learn_education.TEST_USERS:
        assert str(u) in sql


def test_fti_sql_uses_min_created_at():
    """First-time investor = MIN(created_at) per user_id."""
    sql = _sample_fti_sql()
    assert "MIN(created_at)" in sql
    assert "GROUP BY user_id" in sql


def test_fti_sql_scopes_to_cohort_user_ids():
    """The query must IN-filter to the cohort to stay under the 2000 cap
    and use ur_tblorders' user_id index efficiently."""
    sql = learn_education.build_fti_sql([12345, 67890], limit=2000, offset=0)
    assert "user_id IN (12345,67890)" in sql
    assert "ORDER BY user_id" in sql
    assert "LIMIT 2000" in sql
    assert "OFFSET 0" in sql


def test_fti_sql_references_ur_tblorders_not_rudder():
    """FTI source is prodgripdb.ur_tblorders on DB 24 (ClickHouse warehouse).
    This is the analyst-canonical view; not Rudder, not tblorders directly."""
    sql = _sample_fti_sql()
    assert "prodgripdb.ur_tblorders" in sql
    assert "new_user_order" not in sql
    assert "client_web" not in sql


def test_fetch_fti_for_cohort_paginates_past_the_2000_cap(tmp_path):
    """Walking pagination must accumulate across calls until short read."""
    # 2501 FTI rows: requires 2 full pages (2000+501) and a third stop check.
    fti = [{"user_id": i, "fti_date": "2026-05-26T00:00:00"} for i in range(2501)]
    client = FakeClient(fti_rows=fti)
    out = learn_education.fetch_fti_for_cohort(client, [str(i) for i in range(2501)])
    assert len(out) == 2501


def test_fetch_fti_for_cohort_returns_empty_for_empty_cohort():
    """No cohort → no FTI query at all (would otherwise return everything)."""
    client = FakeClient(fti_rows=[{"user_id": 1, "fti_date": "x"}])
    assert learn_education.fetch_fti_for_cohort(client, []) == []
    assert client.calls == [], "must not issue any SQL when cohort is empty"


def test_fetch_fti_for_cohort_drops_non_integer_cohort_ids():
    """Rudder anonymous_id leakage shouldn't make it into the IN clause."""
    client = FakeClient(fti_rows=[])
    learn_education.fetch_fti_for_cohort(client, ["123", "abc", "", "456"])
    # Should have issued one call; the SQL should contain only the int ids.
    assert len(client.calls) == 1
    sql = client.calls[0][1]
    assert "123" in sql and "456" in sql
    assert "abc" not in sql


def test_database_ids_are_pinned():
    """Pin the IDs so an accidental swap stays caught by CI.

    RUDDER_DB_ID = 8           — client_web schema, cohort + engagement events.
    TRANSACTIONS_DB_ID = 24    — ClickHouse warehouse (prodgripdb.ur_tblorders).
                                 Aligned with what business analysts use, so
                                 our numbers match what's published elsewhere.
                                 Note: the underlying `tblorders` has
                                 column-level GRANTs we lack; ur_tblorders is
                                 the unrestricted_user role's view.
    """
    assert learn_education.RUDDER_DB_ID == 8
    assert learn_education.TRANSACTIONS_DB_ID == 24
    assert learn_education.TRANSACTIONS_TABLE == "prodgripdb.ur_tblorders"


# ─── V2 — Tier 2 metrics + Margin Notes ────────────────────────────────────
# See specs/2026-05-27-tier2-and-margin-notes.md §2.1 for the 7 Tier 2
# metrics. Each test exercises the aggregator's handling of new
# per-user fields with realistic inputs.

@pytest.fixture
def v2_engagement_rows():
    """Engagement rows with all V2 per-user fields populated.

    Treatment arm: 4 users.
      u1 — visited, 1 play, completed
      u2 — visited, 3 plays, 2 completed, clicked outbound + banner
      u3 — visited, 0 plays
      u4 — visited, 0 plays
    Control arm: 2 users — neither visits (surface invisible).
    """
    return [
        {"user_id": "u1", "variant": "treatment", "assigned_week": "2026-05-25",
         "visit_count": 1, "play_count": 1, "completed_play_count": 1,
         "watch_seconds_sum": 30,
         "first_play_at": "2026-05-26T10:01:00",
         "first_page_viewed_at": "2026-05-26T10:00:00",
         "first_video_opened_at": "2026-05-26T10:00:30",
         "outbound_clicked": 0, "learn_banner_clicked": 0},
        {"user_id": "u2", "variant": "treatment", "assigned_week": "2026-05-25",
         "visit_count": 2, "play_count": 3, "completed_play_count": 2,
         "watch_seconds_sum": 120,
         "first_play_at": "2026-05-26T11:01:00",
         "first_page_viewed_at": "2026-05-26T11:00:00",
         "first_video_opened_at": "2026-05-26T11:00:10",
         "outbound_clicked": 1, "learn_banner_clicked": 1},
        {"user_id": "u3", "variant": "treatment", "assigned_week": "2026-05-25",
         "visit_count": 1, "play_count": 0, "completed_play_count": 0,
         "watch_seconds_sum": 0,
         "first_play_at": None,
         "first_page_viewed_at": "2026-05-26T12:00:00",
         "first_video_opened_at": None,
         "outbound_clicked": 0, "learn_banner_clicked": 0},
        {"user_id": "u4", "variant": "treatment", "assigned_week": "2026-05-25",
         "visit_count": 1, "play_count": 0, "completed_play_count": 0,
         "watch_seconds_sum": 0,
         "first_play_at": None,
         "first_page_viewed_at": "2026-05-26T13:00:00",
         "first_video_opened_at": None,
         "outbound_clicked": 0, "learn_banner_clicked": 0},
        {"user_id": "c1", "variant": "control", "assigned_week": "2026-05-25",
         "visit_count": 0, "play_count": 0, "completed_play_count": 0,
         "watch_seconds_sum": 0,
         "first_play_at": None,
         "first_page_viewed_at": None,
         "first_video_opened_at": None,
         "outbound_clicked": 0, "learn_banner_clicked": 0},
        {"user_id": "c2", "variant": "control", "assigned_week": "2026-05-25",
         "visit_count": 0, "play_count": 0, "completed_play_count": 0,
         "watch_seconds_sum": 0,
         "first_play_at": None,
         "first_page_viewed_at": None,
         "first_video_opened_at": None,
         "outbound_clicked": 0, "learn_banner_clicked": 0},
    ]


def test_v2_engaged_visitor_rate(v2_engagement_rows):
    """T2 #1 — unique_video_players / learn_page_visitors.
    Treatment: 2 players / 4 visitors = 50.0%. Control: 0/0 = None."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    c = next(r for r in rows if r["variant"] == "control")
    assert t["engaged_visitor_rate_pct"] == 50.0
    assert c["engaged_visitor_rate_pct"] is None


def test_v2_plays_per_visitor(v2_engagement_rows):
    """T2 #2 — total_video_plays / learn_page_visitors.
    Treatment: 4 plays / 4 visitors = 1.0. Control: None."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    c = next(r for r in rows if r["variant"] == "control")
    assert t["plays_per_visitor"] == 1.0
    assert c["plays_per_visitor"] is None


def test_v2_drop_after_first_video(v2_engagement_rows):
    """T2 #3 — 1 - (multi_play_users / unique_players).
    Treatment: u2 has 3 plays (multi), u1 has 1 (single) → 1/2 multi.
    Drop = 1 - 0.5 = 0.5 = 50.0%."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    assert t["drop_after_first_pct"] == 50.0


def test_v2_completion_rate(v2_engagement_rows):
    """T2 #4 — completed_plays / total_plays.
    Treatment: 3 completed / 4 plays = 75.0%."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    assert t["completion_rate_pct"] == 75.0


def test_v2_median_time_to_first_play(v2_engagement_rows):
    """T2 #5 — median seconds between first page view and first video open.
    Treatment: u1=30s, u2=10s. u3/u4 have no video_opened (excluded).
    Median of [10, 30] = 20."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    assert t["median_time_to_first_play_sec"] == 20


def test_v2_outbound_click_rate(v2_engagement_rows):
    """T2 #6 — unique outbound clickers / visitors.
    Treatment: 1 outbound clicker (u2) / 4 visitors = 25.0%."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    assert t["outbound_click_rate_pct"] == 25.0


def test_v2_banner_ctr_on_learn(v2_engagement_rows):
    """T2 #7 — unique banner clickers on /learn / visitors.
    Treatment: 1 banner clicker (u2) / 4 visitors = 25.0%."""
    rows = learn_education.aggregate_rows(v2_engagement_rows, [])
    t = next(r for r in rows if r["variant"] == "treatment")
    assert t["banner_ctr_on_learn_pct"] == 25.0


def test_v2_canonical_columns_match_spec():
    """The CANONICAL_COLUMNS list must match the frontend COLUMNS array
    in lib/queries/learnEducation.js exactly. Pinning here catches any
    accidental rename."""
    expected = [
        # Tier 1.
        "week_start", "variant",
        "total_non_invested_users", "learn_page_visitors", "learn_visit_rate_pct",
        "unique_video_players", "total_video_plays", "avg_videos_per_user",
        "avg_watch_time_sec", "fti_users", "fti_users_who_watched", "fti_rate_pct",
        # Tier 2.
        "engaged_visitor_rate_pct", "plays_per_visitor",
        "drop_after_first_pct", "completion_rate_pct",
        "median_time_to_first_play_sec",
        "outbound_click_rate_pct", "banner_ctr_on_learn_pct",
    ]
    assert learn_education.CANONICAL_COLUMNS == expected


def test_v2_engagement_sql_references_new_event_sources():
    """The engagement SQL must pull from learn_video_opened (for TTFP),
    learn_outbound_clicked (for outbound CTR), and banner_clicked
    filtered to /learn (for banner CTR)."""
    sql = learn_education.build_engagement_sql(weeks=12)
    assert "learn_video_opened" in sql, "TTFP source missing"
    assert "learn_outbound_clicked" in sql, "outbound source missing"
    assert "banner_clicked" in sql, "banner source missing"
    assert "page = '/learn'" in sql, "banner filter must target /learn"
    assert "completion_pct >= 75" in sql, "completion threshold not 75"


def test_v2_margin_notes_in_manifest(tmp_path, v2_engagement_rows):
    """The run() entry must write a margin_notes block into the
    manifest. The dashboard reads it for the four cards."""
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=v2_engagement_rows,
        fti_rows=[],
    )
    learn_education.run(client, tmp_path)
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert "margin_notes" in manifest
    mn = manifest["margin_notes"]
    assert mn["as_of_week"] == "2026-05-25"
    assert mn["srm"]["control_n"] == 2
    assert mn["srm"]["treatment_n"] == 4
    assert mn["control_leak"]["leak_pct"] == 0.0
    assert "mde" in mn


def test_v2_completion_threshold_pinned():
    """If product wants to change this, it's a deliberate change with
    docs to update — not a hidden constant drift."""
    assert learn_education.COMPLETION_THRESHOLD_PCT == 75


# ─── Engagement pagination (V2.1 — fixes 2000-row cap bug) ─────────────────
# The original engagement query silently hit Metabase's 2000-row cap once
# cohort grew past 2000. Worse, the ORDER BY (assigned_week, variant, ...)
# meant Control was prioritized over Treatment alphabetically — making the
# truncation biased and flagging SRM=fail on otherwise-balanced experiments.
# These tests pin both the pagination logic and the unbiased ordering.

def test_engagement_sql_orders_by_user_id_not_variant():
    """Pagination requires stable ordering by user_id to avoid biasing
    truncation toward Control. Order by variant would silently re-order
    pages by alphabet, sending all Control before any Treatment."""
    sql = learn_education.build_engagement_sql(weeks=12)
    assert "ORDER BY c.user_id" in sql
    # Must NOT order by variant first — that's the bias bug.
    assert "ORDER BY c.assigned_week, c.variant" not in sql


def test_engagement_sql_appends_pagination_when_limit_provided():
    sql = learn_education.build_engagement_sql(weeks=12, limit=2000, offset=4000)
    assert "LIMIT 2000" in sql
    assert "OFFSET 4000" in sql


def test_engagement_sql_omits_pagination_when_no_limit():
    """Unbounded query for tests and SQL-shape pinning."""
    sql = learn_education.build_engagement_sql(weeks=12)
    assert "LIMIT" not in sql
    assert "OFFSET" not in sql


def test_fetch_engagement_paginated_walks_past_the_2000_cap():
    """The actual bug from prod 2026-05-27: 2576 cohort users got
    silently truncated to 2000 by Metabase's default response cap.
    The walker must accumulate across pages until a short read."""
    # 2501 cohort users — one full page (2000), one short page (501).
    rows = [
        {"user_id": str(i), "variant": "treatment" if i % 2 else "control",
         "assigned_week": "2026-05-25",
         "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0,
         "first_play_at": None}
        for i in range(2501)
    ]
    client = FakeClient(engagement_rows=rows)
    out = learn_education.fetch_engagement_paginated(client)
    assert len(out) == 2501, "pagination must walk past the 2000 cap"


def test_fetch_engagement_paginated_single_page_stops_early():
    """If the cohort fits in one page (< 2000 rows), the walker should
    return after one call — short-read triggers the loop exit."""
    rows = [
        {"user_id": str(i), "variant": "control", "assigned_week": "2026-05-25",
         "visit_count": 0, "play_count": 0, "watch_seconds_sum": 0,
         "first_play_at": None}
        for i in range(150)
    ]
    client = FakeClient(engagement_rows=rows)
    out = learn_education.fetch_engagement_paginated(client)
    assert len(out) == 150
    # One run_sql call to RUDDER (after probes) for the engagement query.
    # The cohort returned 150 rows < 2000 cap → no second call.
    engagement_calls = [
        c for c in client.calls
        if c[0] == learn_education.RUDDER_DB_ID
        and c[1].strip().upper().startswith("WITH")
    ]
    assert len(engagement_calls) == 1


def test_run_uses_paginated_engagement_fetch(tmp_path, v2_engagement_rows):
    """run() must call the paginated walker, not the single-shot query.
    Regression guard against accidentally reverting the fix."""
    client = FakeClient(
        learn_page_count=100, experiment_count=10000,
        engagement_rows=v2_engagement_rows,
    )
    result = learn_education.run(client, tmp_path)
    assert result["status"] == "ok"
    # The cohort breakdown line is logged regardless of size — its
    # presence confirms the paginated path executed.
    log_str = " ".join(result["log"])
    assert "cohort by variant" in log_str
