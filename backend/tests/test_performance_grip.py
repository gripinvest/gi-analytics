"""Unit tests for performance_grip.py."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import pytest

from services.integrations.performance_grip import clean_url, parse_q1_response, target_hours

FIXTURES = Path(__file__).parent / "fixtures" / "new_relic"

IST = ZoneInfo("Asia/Kolkata")


class TestCleanUrl:
    def test_strips_query_string(self):
        assert clean_url("/checkout?utm_source=email") == "/checkout"

    def test_strips_fragment(self):
        assert clean_url("/page#section-2") == "/page"

    def test_strips_both(self):
        assert clean_url("/page?ref=foo#section") == "/page"

    def test_strips_trailing_slash(self):
        assert clean_url("/about/") == "/about"

    def test_preserves_root_slash(self):
        assert clean_url("/") == "/"

    def test_preserves_case(self):
        assert clean_url("/Assets/ABC-2024") == "/Assets/ABC-2024"

    def test_handles_full_url(self):
        assert clean_url("https://gripinvest.in/checkout?x=1") == "/checkout"


class TestTargetHours:
    def test_fresh_start_returns_last_closed_hour(self):
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        result = target_hours(latest_in_csv=None, now=now, since=None)
        assert result[-1] == (datetime(2026, 5, 20, 13, tzinfo=IST),
                              datetime(2026, 5, 20, 14, tzinfo=IST))

    def test_gap_after_last_csv_row(self):
        latest = datetime(2026, 5, 19, 18, tzinfo=IST)
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        result = target_hours(latest_in_csv=latest, now=now, since=None)
        # First missing: 19:00 May 19. Last closed: 13:00 May 20. Total = 19.
        assert len(result) == 19
        assert result[0][0] == datetime(2026, 5, 19, 19, tzinfo=IST)
        assert result[-1][0] == datetime(2026, 5, 20, 13, tzinfo=IST)

    def test_since_overrides_latest(self):
        now = datetime(2026, 5, 13, 5, 30, tzinfo=IST)
        since = datetime(2026, 5, 12, 0, tzinfo=IST)
        result = target_hours(latest_in_csv=datetime(2026, 5, 13, 2, tzinfo=IST),
                              now=now, since=since)
        # 24h on May 12 + hours 0-4 on May 13 = 29
        assert len(result) == 29
        assert result[0][0] == datetime(2026, 5, 12, 0, tzinfo=IST)
        assert result[-1][0] == datetime(2026, 5, 13, 4, tzinfo=IST)

    def test_caught_up_returns_empty(self):
        now = datetime(2026, 5, 20, 14, 30, tzinfo=IST)
        latest = datetime(2026, 5, 20, 13, tzinfo=IST)
        assert target_hours(latest_in_csv=latest, now=now, since=None) == []

    # H22-fix: timezone-boundary edge cases
    def test_now_exactly_on_hour_boundary(self):
        """At now=14:00:00 exactly, the latest closed hour is [13:00, 14:00)."""
        now = datetime(2026, 5, 20, 14, 0, 0, tzinfo=IST)
        latest = datetime(2026, 5, 20, 12, tzinfo=IST)
        result = target_hours(latest_in_csv=latest, now=now, since=None)
        assert len(result) == 1
        assert result[0] == (datetime(2026, 5, 20, 13, tzinfo=IST),
                             datetime(2026, 5, 20, 14, tzinfo=IST))

    def test_window_crosses_midnight(self):
        """latest=23:00 May 19, now=02:30 May 20 → fetch 00:00 + 01:00 of May 20."""
        latest = datetime(2026, 5, 19, 23, tzinfo=IST)
        now = datetime(2026, 5, 20, 2, 30, tzinfo=IST)
        result = target_hours(latest_in_csv=latest, now=now, since=None)
        assert len(result) == 2
        assert result[0][0] == datetime(2026, 5, 20, 0, tzinfo=IST)
        assert result[1][0] == datetime(2026, 5, 20, 1, tzinfo=IST)


class TestParseQ1:
    def test_extracts_rows_from_real_fixture_with_actual_values(self):
        """CC2: assert actual values, not just key presence. A parser returning
        all-None rows must FAIL this test."""
        fixture = json.loads((FIXTURES / "Q1_pageviewtiming_response.json").read_text())

        rows = parse_q1_response(fixture)

        # Must produce rows
        assert len(rows) > 0, "Parser returned no rows from fixture"

        # Schema check
        sample = rows[0]
        assert "page_url" in sample and "device" in sample and "sample_count" in sample
        for metric in ["lcp", "inp", "cls", "fcp", "ttfb"]:
            assert f"{metric}_p75" in sample
            assert f"{metric}_p95" in sample

        # VALUE check — at least one row must have non-None LCP p75 (the canonical
        # metric — if this is None across every row, the parser is wrong)
        lcp_values = [r["lcp_p75"] for r in rows if r["lcp_p75"] is not None]
        assert len(lcp_values) > 0, "Every row has lcp_p75 = None — parser shape is wrong"
        assert all(isinstance(v, (int, float)) for v in lcp_values), \
            "lcp_p75 must be numeric"

        # Sample count sanity
        sample_counts = [r["sample_count"] for r in rows if r["sample_count"] is not None]
        assert any(c > 0 for c in sample_counts), "All sample_counts are zero or None"

    def test_handles_null_percentiles_gracefully(self):
        """A NR row with null INP (older Browser agent) parses to None, not crash.

        SHAPE NOTE: the synthetic input below assumes nested {"75": v, "95": v}.
        Verified against the real fixture in Step 1 — it uses the same shape.
        """
        synthetic = {
            "results": [{
                "facet": ["/test", "Mobile"],
                "lcp": {"75": 2450, "95": 3920},
                "inp": {"75": None, "95": None},
                "cls": {"75": 0.08, "95": 0.21},
                "fcp": {"75": 1100, "95": 2200},
                "ttfb": {"75": 320, "95": 780},
                "sample_count": 100,
            }]
        }
        rows = parse_q1_response(synthetic)
        assert rows[0]["inp_p75"] is None
        assert rows[0]["lcp_p75"] == 2450


class TestParseQ2:
    def test_extracts_page_view_counts(self):
        fixture = json.loads((FIXTURES / "Q2_pageview_response.json").read_text())
        from services.integrations.performance_grip import parse_q2_response
        rows = parse_q2_response(fixture)
        assert len(rows) > 0
        assert all("page_url" in r and "device" in r and "page_views" in r for r in rows)
        assert all(isinstance(r["page_views"], int) and r["page_views"] >= 0 for r in rows)


class TestParseQ3:
    def test_extracts_js_error_counts(self):
        fixture = json.loads((FIXTURES / "Q3_javascripterror_response.json").read_text())
        from services.integrations.performance_grip import parse_q3_response
        rows = parse_q3_response(fixture)
        if rows:  # Q3 may legitimately return 0
            assert all("page_url" in r and "js_errors" in r for r in rows)


class TestMergeRows:
    BASE_Q1 = {
        "page_url": "/a", "device": "mobile",
        "lcp_p75": 2400, "lcp_p95": 3900,
        "inp_p75": 180, "inp_p95": 420,
        "cls_p75": 0.08, "cls_p95": 0.21,
        "fcp_p75": 1100, "fcp_p95": 2200,
        "ttfb_p75": 320, "ttfb_p95": 780,
        "sample_count": 100,
    }

    def test_merge_joins_on_page_and_device(self):
        from services.integrations.performance_grip import merge_rows
        q1 = [self.BASE_Q1]
        q2 = [{"page_url": "/a", "device": "mobile", "page_views": 50000}]
        q3 = [{"page_url": "/a", "device": "mobile", "js_errors": 5}]
        rows = merge_rows(q1, q2, q3, app="gi-client-static",
                          date="2026-05-19", hour=14,
                          fetched_at="2026-05-20T01:30:00+05:30")
        assert len(rows) == 1
        r = rows[0]
        assert r["app"] == "gi-client-static"
        assert r["date"] == "2026-05-19"
        assert r["hour"] == 14
        assert r["page_url"] == "/a"
        assert r["device"] == "mobile"
        assert r["lcp_p75_ms"] == 2400
        assert r["page_views"] == 50000
        assert r["js_errors"] == 5

    def test_no_q3_yields_zero_errors(self):
        from services.integrations.performance_grip import merge_rows
        rows = merge_rows([self.BASE_Q1],
                          [{"page_url": "/a", "device": "mobile", "page_views": 50000}],
                          [], app="x", date="2026-05-19", hour=14, fetched_at="x")
        assert rows[0]["js_errors"] == 0

    def test_drops_rows_with_no_q1(self):
        from services.integrations.performance_grip import merge_rows
        rows = merge_rows([],
                          [{"page_url": "/x", "device": "mobile", "page_views": 1}],
                          [], app="x", date="2026-05-19", hour=14, fetched_at="x")
        assert rows == []
