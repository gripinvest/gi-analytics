"""Pure transform functions ported from gc-analyst's metabase_fetch.py.
No network, no I/O — deterministic, unit-tested."""
import re
from datetime import datetime, date, timedelta


def to_float(val) -> float | None:
    # verbatim from metabase_fetch.py:315-321 (renamed from _to_float)
    if val is None or str(val).strip() in ("", "-", "N/A", "null", "None"):
        return None
    try:
        return float(re.sub(r"[₹$,% ]", "", str(val)))
    except (ValueError, TypeError):
        return None


def detect_week_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"(week|wk|date|period|dt)", c, re.I):
            return c
    return col_names[0] if col_names else None


def detect_dod_date_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"\bdate\b|\bday\b", c, re.I):
            return c
    return col_names[0] if col_names else None


def detect_dod_aum_column(col_names: list[str]) -> str | None:
    for c in col_names:
        if re.search(r"\baum\b", c, re.I):
            return c
    return None


def compute_mtd_from_dod(dod_rows, date_col, aum_col, active_week_start):
    # verbatim from metabase_fetch.py:383-421
    cur_start = active_week_start.replace(day=1)
    cur_end = active_week_start
    prior_month_end = cur_start - timedelta(days=1)
    prior_start = prior_month_end.replace(day=1)
    prior_end_day = min(active_week_start.day, prior_month_end.day)
    prior_end = prior_start.replace(day=prior_end_day)
    cur_total, prior_total = 0.0, 0.0
    cur_found, prior_found = False, False
    for row in dod_rows:
        try:
            row_date = datetime.strptime(str(row.get(date_col, ""))[:10], "%Y-%m-%d").date()
        except ValueError:
            continue
        aum_val = to_float(row.get(aum_col))
        if aum_val is None:
            continue
        if cur_start <= row_date <= cur_end:
            cur_total += aum_val
            cur_found = True
        elif prior_start <= row_date <= prior_end:
            prior_total += aum_val
            prior_found = True
    return (cur_total if cur_found else None), (prior_total if prior_found else None)


def compute_retention_metrics(d1_row, d2_row, field_map):
    # verbatim from metabase_fetch.py:253-283
    mtd_repeat = to_float(d1_row.get(field_map["d1_mtd_repeat"]))
    lmtd_repeat = to_float(d1_row.get(field_map["d1_lmtd_repeat"]))
    mtd_unique = to_float(d2_row.get(field_map["d2_mtd_unique"]))
    lmtd_unique = to_float(d2_row.get(field_map["d2_lmtd_unique"]))

    def _safe_div(num, den):
        if num is None or den is None or den == 0:
            return None
        return num / den

    return {
        "repeat_rate": _safe_div(mtd_repeat, lmtd_unique),
        "retention_mtd": _safe_div(mtd_repeat, mtd_unique),
        "retention_lmtd": _safe_div(lmtd_repeat, lmtd_unique),
        "mtd_repeat": mtd_repeat, "lmtd_repeat": lmtd_repeat,
        "mtd_unique": mtd_unique, "lmtd_unique": lmtd_unique,
    }
