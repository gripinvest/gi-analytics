"""Unit tests for performance_grip.py."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import pytest

from services.integrations.performance_grip import clean_url, target_hours

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
