"""Tests for the Margin Notes statistical helpers.

Edge cases per spec §6 — n=0, both arms zero, equal rates, large lift,
< 10 successes (CI suppression), zero pooled rate (MDE clamping).
"""
from __future__ import annotations

import math

from backend.services.integrations import learn_education_stats as s


# ─── SRM ───────────────────────────────────────────────────────────────────
def test_srm_balanced_passes():
    """50/50 split → p ≈ 1.0, verdict ok."""
    result = s.srm_p_value(500, 500)
    assert result["verdict"] == "ok"
    assert result["p_value"] >= 0.99


def test_srm_mild_skew_passes_at_typical_n():
    """982/994 — today's W1 numbers. Should NOT flag SRM."""
    result = s.srm_p_value(982, 994)
    assert result["verdict"] == "ok"
    assert result["p_value"] > s.SRM_FAIL_P_VALUE


def test_srm_severe_skew_fails():
    """45/55 % split at N=5000 → p well below 0.001.
    Note: at N=1000 the same 45/55 split sits at p≈0.0016 — above the
    0.001 fail threshold by design. Need bigger N for unambiguous skew."""
    result = s.srm_p_value(2250, 2750)
    assert result["verdict"] == "fail"
    assert result["p_value"] < s.SRM_FAIL_P_VALUE


def test_srm_empty_returns_insufficient_data():
    result = s.srm_p_value(0, 0)
    assert result["verdict"] == "insufficient_data"
    assert result["p_value"] is None


# ─── Control surface leak ──────────────────────────────────────────────────
def test_control_leak_zero_is_ok():
    result = s.control_surface_leak(0, 982)
    assert result["verdict"] == "ok"
    assert result["leak_pct"] == 0.0


def test_control_leak_under_1pct_warns():
    """Today's 2/982 leak — warn but don't fail."""
    result = s.control_surface_leak(2, 982)
    assert result["verdict"] == "warn"
    assert result["leak_pct"] == 0.20


def test_control_leak_over_1pct_fails():
    """5% leak — real bug, surface red."""
    result = s.control_surface_leak(50, 1000)
    assert result["verdict"] == "fail"
    assert result["leak_pct"] == 5.0


def test_control_leak_no_cohort_insufficient():
    result = s.control_surface_leak(0, 0)
    assert result["verdict"] == "insufficient_data"
    assert result["leak_pct"] is None


# ─── FTI lift CI ───────────────────────────────────────────────────────────
def test_fti_lift_ci_below_threshold_suppresses():
    """< 10 successes in either arm → suppress CI."""
    result = s.fti_lift_ci(0, 982, 0, 994)
    assert result["verdict"] == "insufficient_data"
    assert result["ci_lower_pp"] is None
    assert result["ci_upper_pp"] is None


def test_fti_lift_ci_under_10_in_treatment_suppresses():
    result = s.fti_lift_ci(15, 1000, 5, 1000)  # treatment < 10
    assert result["verdict"] == "insufficient_data"
    # But rates still surface.
    assert result["control_pct"] == 1.5
    assert result["treatment_pct"] == 0.5


def test_fti_lift_ci_normal_case_returns_band():
    """Control 50/1000 (5.0%), Treatment 100/1000 (10.0%).
    Expected delta = +5.0 pp, CI should bracket it tightly."""
    result = s.fti_lift_ci(50, 1000, 100, 1000)
    assert result["verdict"] == "ok"
    assert result["control_pct"] == 5.0
    assert result["treatment_pct"] == 10.0
    assert result["delta_pp"] == 5.0
    # CI should be ~ (2.6, 7.4) pp — exclude 0 (significant lift).
    assert result["ci_lower_pp"] > 0
    assert result["ci_upper_pp"] < 10


def test_fti_lift_ci_no_difference_includes_zero():
    """Same rate in both arms → CI brackets 0."""
    result = s.fti_lift_ci(50, 1000, 50, 1000)
    assert result["verdict"] == "ok"
    assert result["delta_pp"] == 0.0
    assert result["ci_lower_pp"] < 0
    assert result["ci_upper_pp"] > 0


def test_fti_lift_ci_zero_n_insufficient():
    result = s.fti_lift_ci(0, 0, 0, 0)
    assert result["verdict"] == "insufficient_data"


# ─── MDE ───────────────────────────────────────────────────────────────────
def test_mde_zero_n_returns_null():
    result = s.mde_at_n(0.01, 0)
    assert result["mde_abs_pp"] is None
    assert result["mde_rel_pct"] is None


def test_mde_zero_pooled_rate_clamps_to_05():
    """At p̄=0 the math blows up; we clamp to 0.5 (max variance)."""
    result = s.mde_at_n(0.0, 1000)
    assert result["mde_abs_pp"] is not None
    # Sanity: MDE at p=0.5, N=1000/arm, 5% α, 80% power ≈ 6.3 pp
    assert 5.0 < result["mde_abs_pp"] < 8.0
    # Relative undefined when pooled rate is 0.
    assert result["mde_rel_pct"] is None


def test_mde_typical_case_returns_sensible_value():
    """At 1% pooled FTI rate and 5,000 users/arm, MDE should be ~0.5 pp."""
    result = s.mde_at_n(0.01, 5000)
    assert result["mde_abs_pp"] is not None
    # Just a sanity range; precise value depends on z-table precision.
    assert 0.3 < result["mde_abs_pp"] < 0.8


def test_mde_relative_computed_when_pooled_rate_positive():
    result = s.mde_at_n(0.02, 10000)
    assert result["mde_rel_pct"] is not None
    # Should be a sensible percentage of the pooled rate, not raw pp.
    assert 5 < result["mde_rel_pct"] < 40


def test_mde_n_scales_inversely_with_mde():
    """Doubling N should shrink MDE by sqrt(2) ≈ 1.414."""
    small = s.mde_at_n(0.05, 1000)["mde_abs_pp"]
    big = s.mde_at_n(0.05, 4000)["mde_abs_pp"]
    # 4x N → MDE / 2
    ratio = small / big
    assert 1.9 < ratio < 2.1


# ─── compose_margin_notes (integration) ────────────────────────────────────
def test_compose_margin_notes_empty_returns_none():
    assert s.compose_margin_notes(summary_rows=[]) is None


def test_compose_margin_notes_only_control_returns_partial():
    """Single control row → treatment can't compare; all four return
    insufficient_data verdicts."""
    rows = [{
        "week_start": "2026-05-25", "variant": "control",
        "total_non_invested_users": 100,
        "learn_page_visitors": 0, "fti_users": 0,
    }]
    result = s.compose_margin_notes(summary_rows=rows)
    assert result["as_of_week"] == "2026-05-25"
    assert result["srm"]["verdict"] == "insufficient_data"


def test_compose_margin_notes_typical_w1_shape():
    """Today's actual numbers shape, end-to-end."""
    rows = [
        {
            "week_start": "2026-05-25", "variant": "control",
            "total_non_invested_users": 982,
            "learn_page_visitors": 2, "fti_users": 0,
        },
        {
            "week_start": "2026-05-25", "variant": "treatment",
            "total_non_invested_users": 994,
            "learn_page_visitors": 56, "fti_users": 0,
        },
    ]
    result = s.compose_margin_notes(summary_rows=rows)
    assert result["as_of_week"] == "2026-05-25"
    assert result["srm"]["verdict"] == "ok"
    assert result["control_leak"]["verdict"] == "warn"  # 0.20% — exact today
    assert result["control_leak"]["leak_pct"] == 0.20
    assert result["fti_lift_ci"]["verdict"] == "insufficient_data"  # 0 FTI
    assert result["mde"]["mde_abs_pp"] is not None  # clamped to 0.5 var


def test_compose_margin_notes_uses_most_recent_week():
    """Multiple weeks present → use the latest one."""
    rows = [
        {"week_start": "2026-05-18", "variant": "control",
         "total_non_invested_users": 100, "learn_page_visitors": 0,
         "fti_users": 0},
        {"week_start": "2026-05-18", "variant": "treatment",
         "total_non_invested_users": 100, "learn_page_visitors": 30,
         "fti_users": 0},
        {"week_start": "2026-05-25", "variant": "control",
         "total_non_invested_users": 500, "learn_page_visitors": 1,
         "fti_users": 5},
        {"week_start": "2026-05-25", "variant": "treatment",
         "total_non_invested_users": 510, "learn_page_visitors": 200,
         "fti_users": 15},
    ]
    result = s.compose_margin_notes(summary_rows=rows)
    assert result["as_of_week"] == "2026-05-25"
    assert result["srm"]["control_n"] == 500
    assert result["srm"]["treatment_n"] == 510


# ─── Sanity: known-good reference values ───────────────────────────────────
def test_z_constants_match_published_values():
    """Z critical values used in the math should match standard tables."""
    # Two-sided 95% z.
    assert math.isclose(s.Z_95, 1.96, abs_tol=0.001)
    # 80% power z (one-sided).
    assert math.isclose(s.Z_POWER_80, 0.842, abs_tol=0.001)
