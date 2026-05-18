"""Unit tests for the Asset Search Metabase validation script.

Covers the pure logic — the two-tier verdict policy, row diffing, and the
ported issuer-classification SQL. The Metabase REST path is covered by
test_metabase.py; the local DuckDB path is exercised end-to-end whenever the
script is run with --local-only.
"""
import duckdb
import pytest

from services.integrations.validate_asset_search import (
    CONFIRMED, MINOR, DISCREPANT, INFO, PENDING,
    Check, classify_cell, diff_check, issuer_case_expr,
)


# ── two-tier verdict policy ───────────────────────────────────────────────────

def test_classify_exact_match_is_confirmed():
    assert classify_cell("rows", 4183, 4183) == CONFIRMED


def test_classify_small_absolute_count_drift_is_minor():
    # <= 5 rows of drift absorbs Rudderstack late arrivals.
    assert classify_cell("rows", 4183, 4186) == MINOR


def test_classify_small_relative_count_drift_is_minor():
    # 40 / 10000 = 0.4% <= 0.5% threshold, even though > 5 rows absolute.
    assert classify_cell("rows", 10000, 10040) == MINOR


def test_classify_large_count_drift_is_discrepant():
    assert classify_cell("rows", 100, 130) == DISCREPANT


def test_classify_percentage_within_tolerance_is_minor():
    assert classify_cell("zrr_pct", 12.0, 12.2) == MINOR


def test_classify_percentage_beyond_tolerance_is_discrepant():
    assert classify_cell("zrr_pct", 12.0, 13.0) == DISCREPANT


def test_classify_one_sided_null_is_discrepant():
    assert classify_cell("rows", 4183, None) == DISCREPANT
    assert classify_cell("rows", None, None) == CONFIRMED


# ── row diffing ───────────────────────────────────────────────────────────────

def _check(informational=False):
    return Check("c", "t", "s", "SELECT week, rows FROM ev_query",
                 ["week"], informational=informational)


def test_diff_local_only_is_pending():
    local = [{"week": "W1", "rows": 10}]
    verdict, diffs = diff_check(_check(), local, None)
    assert verdict == PENDING
    assert diffs[0]["cells"][0][3] == PENDING


def test_diff_matching_rows_confirmed():
    rows = [{"week": "W1", "rows": 10}, {"week": "W2", "rows": 20}]
    verdict, _ = diff_check(_check(), rows, list(rows))
    assert verdict == CONFIRMED


def test_diff_missing_row_is_discrepant():
    verdict, _ = diff_check(_check(), [{"week": "W1", "rows": 10}], [])
    assert verdict == DISCREPANT


def test_diff_informational_check_downgrades_to_info():
    # An informational check (e.g. adoption) never escalates to DISCREPANT.
    local = [{"week": "W1", "rows": 100}]
    mb = [{"week": "W1", "rows": 200}]
    verdict, _ = diff_check(_check(informational=True), local, mb)
    assert verdict == INFO


# ── ported issuer classification ──────────────────────────────────────────────

@pytest.mark.parametrize("query,expected", [
    ("muthoot finance", "Muthoot Finance"),
    ("mut", "Muthoot Finance"),          # early-typing prefix
    ("akara capital advisors", "Akara Capital"),
    ("rbi", "Govt / RBI Bonds"),
    ("  Navi  ", "Navi"),                 # case-folded + trimmed
    ("zomato", None),                     # no issuer
])
def test_issuer_case_expr_classifies(query, expected):
    expr = issuer_case_expr("query_text")
    sql = f"SELECT {expr} AS issuer FROM (VALUES ('{query}')) t(query_text)"
    assert duckdb.sql(sql).fetchone()[0] == expected
