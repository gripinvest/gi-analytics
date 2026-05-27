"""Statistical helpers for the Learn (Grip Education) Margin Notes section.

Pure functions, no I/O, no Metabase access. Each function takes raw
counts/rates and returns a number or a small dict — the aggregator
in learn_education.py glues them onto the manifest under the
`margin_notes` key.

Math conventions:
  · Two-tailed tests, α = 0.05 unless noted (SRM uses 0.001 — see D-11).
  · Normal-approximation intervals for proportions. Suppressed when
    either arm has < 10 successes (the normal approximation gets noisy
    below ~10).
  · stdlib only (`statistics.NormalDist`). No scipy/numpy dependency.
"""
from __future__ import annotations

import math
from statistics import NormalDist
from typing import Literal


# ─── Constants ─────────────────────────────────────────────────────────────
# Cached `NormalDist` instances — these are immutable, no risk of reuse.
_NORM = NormalDist(mu=0.0, sigma=1.0)

# Two-sided 95% z-critical value.
Z_95 = 1.959963984540054

# 80% power's z-value (one-sided, since power is a one-tailed concept).
Z_POWER_80 = 0.8416212335729143

# SRM verdict threshold — see D-11 in decisions.md. The de-facto convention
# is p < 0.001 (not 0.05) because SRM tests at large N are over-powered.
SRM_FAIL_P_VALUE = 0.001

# FTI lift CI suppression threshold. Below this many successes per arm
# the normal approximation misbehaves, so we render an em-dash instead.
MIN_SUCCESSES_FOR_CI = 10

# Control surface leak thresholds. Ideal: 0%. Up to 1% is acceptable
# (network race conditions, deep-links). Above that is a real bug.
CONTROL_LEAK_WARN_PCT = 0.0
CONTROL_LEAK_FAIL_PCT = 1.0


Verdict = Literal["ok", "warn", "fail", "insufficient_data"]


# ─── 1. Sample-Ratio Mismatch (SRM) ────────────────────────────────────────
def srm_p_value(
    control_n: int, treatment_n: int, *, expected_ratio: float = 0.5
) -> dict:
    """Test whether the control/treatment split deviates from expected.

    Two-proportion z-test against a fixed expected ratio. Returns the
    two-tailed p-value and a traffic-light verdict.

    Verdict is `fail` at p < 0.001 per the SRM convention (D-11). At
    typical experimental N this threshold flags only meaningful drift,
    not statistical-power-driven flagging on a 49.5/50.5 split.

    Returns `insufficient_data` when total N is 0.
    """
    total = control_n + treatment_n
    if total == 0:
        return {
            "control_n": control_n,
            "treatment_n": treatment_n,
            "p_value": None,
            "verdict": "insufficient_data",
        }

    p_hat = control_n / total
    se = math.sqrt(expected_ratio * (1 - expected_ratio) / total)
    z = (p_hat - expected_ratio) / se
    # Two-tailed: 2 · (1 − Φ(|z|))
    p_value = 2.0 * (1.0 - _NORM.cdf(abs(z)))

    verdict: Verdict = "fail" if p_value < SRM_FAIL_P_VALUE else "ok"
    return {
        "control_n": control_n,
        "treatment_n": treatment_n,
        "p_value": round(p_value, 4),
        "verdict": verdict,
    }


# ─── 2. Control surface leak ───────────────────────────────────────────────
def control_surface_leak(
    control_visitors: int, control_cohort: int
) -> dict:
    """Surface the % of Control users who reached `/learn`. Should be 0.

    The Learn surface is conditional-rendered on `variant === 'treatment'`,
    so a Control user appearing in `learn_page_viewed` indicates either
    a deep-link bypass, a useShowLearnPage gate edge case, or an inflight
    variant change. Non-zero is always worth a glance, but small leaks
    (≤ 1%) can be operational noise rather than a real bug.

    Returns `insufficient_data` when cohort is 0.
    """
    if control_cohort == 0:
        return {
            "control_visitors": control_visitors,
            "control_cohort": control_cohort,
            "leak_pct": None,
            "verdict": "insufficient_data",
        }

    leak_pct = 100.0 * control_visitors / control_cohort
    if control_visitors == 0:
        verdict: Verdict = "ok"
    elif leak_pct <= CONTROL_LEAK_FAIL_PCT:
        verdict = "warn"
    else:
        verdict = "fail"

    return {
        "control_visitors": control_visitors,
        "control_cohort": control_cohort,
        "leak_pct": round(leak_pct, 2),
        "verdict": verdict,
    }


# ─── 3. FTI Lift — 95% CI ──────────────────────────────────────────────────
def fti_lift_ci(
    control_fti: int, control_n: int,
    treatment_fti: int, treatment_n: int,
) -> dict:
    """95% confidence interval on (treatment_fti_rate − control_fti_rate).

    Normal-approximation interval. Suppressed when either arm has fewer
    than `MIN_SUCCESSES_FOR_CI` successes — below that, the normal
    approximation overstates precision.

    Returns rates and CI bounds in **percentage points** (not fractions)
    so the frontend can render directly.
    """
    if control_n == 0 or treatment_n == 0:
        return {
            "control_pct": None,
            "treatment_pct": None,
            "delta_pp": None,
            "ci_lower_pp": None,
            "ci_upper_pp": None,
            "verdict": "insufficient_data",
        }

    p_c = control_fti / control_n
    p_t = treatment_fti / treatment_n
    delta = p_t - p_c

    if control_fti < MIN_SUCCESSES_FOR_CI or treatment_fti < MIN_SUCCESSES_FOR_CI:
        return {
            "control_pct": round(100.0 * p_c, 2),
            "treatment_pct": round(100.0 * p_t, 2),
            "delta_pp": round(100.0 * delta, 2),
            "ci_lower_pp": None,
            "ci_upper_pp": None,
            "verdict": "insufficient_data",
        }

    se = math.sqrt(
        p_c * (1 - p_c) / control_n
        + p_t * (1 - p_t) / treatment_n
    )
    lower = delta - Z_95 * se
    upper = delta + Z_95 * se

    return {
        "control_pct": round(100.0 * p_c, 2),
        "treatment_pct": round(100.0 * p_t, 2),
        "delta_pp": round(100.0 * delta, 2),
        "ci_lower_pp": round(100.0 * lower, 2),
        "ci_upper_pp": round(100.0 * upper, 2),
        "verdict": "ok",
    }


# ─── 4. Minimum Detectable Effect at current N ─────────────────────────────
def mde_at_n(
    pooled_rate: float, n_per_arm: int,
    *, alpha: float = 0.05, power: float = 0.80,
) -> dict:
    """Smallest absolute effect detectable at the given α and power.

    Standard textbook MDE for a two-proportion test:
        MDE_abs = (z_{1-α/2} + z_{1-β}) · √(2 · p̄ · (1-p̄) / n_arm)

    `pooled_rate` is the combined success rate across both arms
    (`(s_c + s_t) / (n_c + n_t)`).

    Returns the absolute MDE in percentage points. Relative MDE is also
    returned (or None when pooled_rate is 0 — division-by-zero would
    otherwise crash). When n_per_arm is 0 → infinite MDE, surface as null.
    """
    if n_per_arm == 0:
        return {
            "n_per_arm": 0,
            "pooled_rate_pct": round(100.0 * pooled_rate, 2),
            "mde_abs_pp": None,
            "mde_rel_pct": None,
        }
    # Defensive — pooled_rate of 0 means MDE math is technically infinite,
    # since variance term is zero. But this is also exactly the state at
    # launch (W1, no FTI yet), so we still surface SOMETHING by clamping
    # variance to the maximum (p̄ = 0.5). The card caption explains the
    # caveat editorially.
    p_bar = pooled_rate if pooled_rate > 0 else 0.5

    z_alpha = NormalDist().inv_cdf(1.0 - alpha / 2.0)
    z_beta = NormalDist().inv_cdf(power)
    mde_abs = (z_alpha + z_beta) * math.sqrt(
        2 * p_bar * (1 - p_bar) / n_per_arm
    )

    mde_rel = None
    if pooled_rate > 0:
        mde_rel = 100.0 * mde_abs / pooled_rate

    return {
        "n_per_arm": n_per_arm,
        "pooled_rate_pct": round(100.0 * pooled_rate, 2),
        "mde_abs_pp": round(100.0 * mde_abs, 2),
        "mde_rel_pct": round(mde_rel, 1) if mde_rel is not None else None,
    }


# ─── 5. Compose all four into a single manifest block ──────────────────────
def compose_margin_notes(
    *,
    summary_rows: list[dict],
) -> dict | None:
    """Build the `margin_notes` dict for the manifest.

    Reads from the already-aggregated `summary_rows` (output of
    `aggregate_rows`). Returns `None` if there's no usable data.

    "As-of week" is the most recent week_start in the rows. SRM /
    Control-leak / MDE compute against that week's counts; FTI Lift CI
    needs both arms to have non-null FTI rates and ≥10 conversions each
    (otherwise verdict is `insufficient_data`).
    """
    if not summary_rows:
        return None

    # Most recent week.
    latest_week = max(r["week_start"] for r in summary_rows)
    week_rows = [r for r in summary_rows if r["week_start"] == latest_week]

    control_row = next((r for r in week_rows if r["variant"] == "control"), None)
    treatment_rows = [r for r in week_rows if r["variant"] != "control"]
    if control_row is None or not treatment_rows:
        return {
            "as_of_week": latest_week,
            "srm": {"verdict": "insufficient_data"},
            "control_leak": {"verdict": "insufficient_data"},
            "fti_lift_ci": {"verdict": "insufficient_data"},
            "mde": {"n_per_arm": 0, "mde_abs_pp": None},
        }

    # Use the lead treatment arm (first in stable sort by variant name).
    # In a multi-variant experiment, each treatment can be compared
    # separately later (V3); for V2 we headline the single arm.
    treatment_row = sorted(treatment_rows, key=lambda r: r["variant"])[0]

    control_n = int(control_row["total_non_invested_users"])
    treatment_n = int(treatment_row["total_non_invested_users"])
    control_visitors = int(control_row.get("learn_page_visitors") or 0)
    control_fti = int(control_row.get("fti_users") or 0)
    treatment_fti = int(treatment_row.get("fti_users") or 0)

    pooled_rate = (
        (control_fti + treatment_fti) / (control_n + treatment_n)
        if (control_n + treatment_n) > 0
        else 0.0
    )
    n_per_arm = min(control_n, treatment_n)

    return {
        "as_of_week": latest_week,
        "srm": srm_p_value(control_n, treatment_n),
        "control_leak": control_surface_leak(control_visitors, control_n),
        "fti_lift_ci": fti_lift_ci(
            control_fti, control_n, treatment_fti, treatment_n
        ),
        "mde": mde_at_n(pooled_rate, n_per_arm),
    }
