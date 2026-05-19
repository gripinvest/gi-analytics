from datetime import date

from services.integrations.validate import (
    validate_asset_search_week,
    validate_north_star,
)


def test_validate_passes_on_good_rows():
    rows = [{"partner": "ET Money", "metric": "AUM", "mtd": 50.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money"})
    assert errors == []


def test_validate_flags_missing_partner_and_bad_metric():
    rows = [{"partner": "ET Money", "metric": "BOGUS", "mtd": 1.0, "unit": "cr"}]
    errors = validate_north_star(rows, expected_partners={"ET Money", "MobiKwik"})
    assert any("MobiKwik" in e for e in errors)
    assert any("BOGUS" in e for e in errors)


# ── Asset Search fetch validation (spec §14) ────────────────────────────────

_W7 = (date(2026, 5, 14), date(2026, 5, 21))


def test_asset_search_week_passes_on_good_rows():
    rows = [{"timestamp": "2026-05-15 10:00:00", "context_session_id": "s1",
             "query_text": "navi", "results_count": 3, "is_refinement": False,
             "user_id": 99}]
    assert validate_asset_search_week(
        "W7_may14-may20_asset_search_query", rows, *_W7) == []


def test_asset_search_week_flags_missing_columns():
    rows = [{"timestamp": "2026-05-15 10:00:00", "context_session_id": "s1"}]
    errors = validate_asset_search_week(
        "W7_may14-may20_asset_search_query", rows, *_W7)
    assert any("missing columns" in e for e in errors)


def test_asset_search_week_flags_test_user_leak():
    rows = [{"timestamp": "2026-05-15 10:00:00", "context_session_id": "s1",
             "query_text": "x", "results_count": 1, "is_refinement": False,
             "user_id": 207871}]
    errors = validate_asset_search_week(
        "W7_may14-may20_asset_search_query", rows, *_W7)
    assert any("test-user" in e for e in errors)


def test_asset_search_week_flags_timestamp_outside_window():
    rows = [{"timestamp": "2026-05-30 10:00:00", "context_session_id": "s1",
             "query_text": "x", "results_count": 1, "is_refinement": False}]
    errors = validate_asset_search_week(
        "W7_may14-may20_asset_search_query", rows, *_W7)
    assert any("outside" in e for e in errors)


def test_asset_search_week_flags_zero_rows():
    assert validate_asset_search_week(
        "W7_may14-may20_asset_search_query", [], *_W7) == [
        "W7_may14-may20_asset_search_query: zero rows"]
