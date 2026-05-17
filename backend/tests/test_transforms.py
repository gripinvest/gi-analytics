from datetime import date
from services.integrations.transforms import (
    to_float, compute_mtd_from_dod, compute_retention_metrics, detect_week_column,
)


def test_to_float_strips_currency_and_handles_blanks():
    assert to_float("₹1,234.50") == 1234.5
    assert to_float("12%") == 12.0
    assert to_float("-") is None
    assert to_float(None) is None
    assert to_float("") is None


def test_detect_week_column_finds_week_like_name():
    assert detect_week_column(["week_start", "aum"]) == "week_start"
    assert detect_week_column(["aum", "report_date"]) == "report_date"


def test_compute_mtd_from_dod_sums_the_right_windows():
    # active week start = Wed 2026-05-13. Current window: 2026-05-01..05-13.
    # Prior window: 2026-04-01..04-13.
    rows = [
        {"d": "2026-05-02", "aum": 100}, {"d": "2026-05-13", "aum": 50},
        {"d": "2026-04-05", "aum": 200}, {"d": "2026-04-30", "aum": 999},  # out of prior window
    ]
    cur, prior = compute_mtd_from_dod(rows, "d", "aum", date(2026, 5, 13))
    assert cur == 150.0
    assert prior == 200.0


def test_compute_retention_metrics_formulas():
    d1 = {"mtd_et_repeat": 30, "LMTD_et_repeat": 20}
    d2 = {"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}
    fmap = {"d1_mtd_repeat": "mtd_et_repeat", "d1_lmtd_repeat": "LMTD_et_repeat",
            "d2_mtd_unique": "mtd_et_unique_inv", "d2_lmtd_unique": "lmtd_et_unique_inv"}
    r = compute_retention_metrics(d1, d2, fmap)
    assert r["repeat_rate"] == 30 / 80
    assert r["retention_mtd"] == 30 / 100
    assert r["retention_lmtd"] == 20 / 80
