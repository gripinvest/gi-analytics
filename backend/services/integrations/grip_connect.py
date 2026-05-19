"""Grip Connect fetch orchestration. Config + layer-1/layer-2 builders.

Layer 1 = raw card output, one dict per row, tagged with `partner`.
Layer 2 = derived dashboard tables (North Star, reg-to-KYC funnel).
Card IDs, partner list and RETENTION_FIELD_MAP are lifted from
gc-analyst's metabase_fetch.py.
"""
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from .transforms import (
    compute_mtd_from_dod, detect_dod_date_column, detect_dod_aum_column, to_float,
)

# Natural keys per canonical table — used by upsert accumulation.
KEYS = {
    "card_3841_summary_wow":  ["partner", "week"],
    "card_4499_kyc_funnel":   ["partner", "week"],
    "card_3843_summary_dod":  ["partner", "day"],
    "card_5042_retention_d1": ["partner"],
    "card_5046_retention_d2": ["partner"],
    "01_north_star":          ["partner", "metric"],
    "02_reg_to_kyc":          ["partner"],
}

# Card registry — keyed by a stable short name. (metabase_fetch.py:35-54 + 5042/5046)
CARDS = {
    "summary_wow":   {"id": 3841, "table": "card_3841_summary_wow",   "param": "gc_name"},
    "kyc_funnel":    {"id": 4499, "table": "card_4499_kyc_funnel",    "param": "gc_name"},
    "summary_dod":   {"id": 3843, "table": "card_3843_summary_dod",   "param": "gc_name"},
    "retention_d1":  {"id": 5042, "table": "card_5042_retention_d1",  "param": None},
    "retention_d2":  {"id": 5046, "table": "card_5046_retention_d2",  "param": None},
}

# v1 partners — the four the current dashboard covers. Strings MUST match the
# Metabase `gc_name` filter values exactly (metabase_fetch.py:57-69).
PARTNERS = ["ET money", "Paisa Bazaar", "Mobikwik", "Tata Digital Private Ltd"]

# Partner string -> the display name the dashboard expects (its PARTNER_ORDER:
# "ET Money", "Paisa Bazaar", "Mobikwik", "Tata Digital").
DISPLAY_NAMES = {"ET money": "ET Money", "Paisa Bazaar": "Paisa Bazaar",
                 "Mobikwik": "Mobikwik", "Tata Digital Private Ltd": "Tata Digital"}

# Partner string -> the short code used in cards 5042/5046 column names
# (mtd_<code>_fti, mtd_<code>_repeat, LMTD_<code>_fti, ...).
RETENTION_CODES = {"ET money": "et", "Paisa Bazaar": "pb",
                   "Mobikwik": "mbk", "Tata Digital Private Ltd": "tdl"}


def build_layer1(client, partners=PARTNERS, cards=None) -> dict[str, list[dict]]:
    """Fetch each card; return {table_name: [row, ...]} with `partner` tagged on
    every parameterised-card row. Unparameterised cards (retention) fetched once."""
    cards = cards or list(CARDS)
    out: dict[str, list[dict]] = {}
    for key in cards:
        cfg = CARDS[key]
        rows: list[dict] = []
        if cfg["param"]:
            pid = client.card_param_id(cfg["id"], cfg["param"])
            for partner in partners:
                param = {"type": "category",
                         "target": ["variable", ["template-tag", cfg["param"]]],
                         "value": partner}
                if pid:
                    param["id"] = pid
                card_rows, _ = client.fetch_card(cfg["id"], [param])
                for r in card_rows:
                    rows.append({"partner": partner, **r})
        else:
            card_rows, _ = client.fetch_card(cfg["id"])
            rows = card_rows
        out[cfg["table"]] = rows
    return out


def build_layer2(layer1, partners=PARTNERS, active_week_start: date | None = None
                 ) -> dict[str, list[dict]]:
    """Derive the dashboard tables from layer-1.

    01_north_star: long format — one row per (partner, metric in AUM/FTI/Repeat).
      · AUM    — month-to-date sum of the DoD card's daily AUM (rupees -> Cr),
                 against the same window one month prior.
      · FTI    — month-to-date / last-MTD first-time investors, read straight
                 from the D1 retention card (card 5042).
      · Repeat — same, from card 5042's repeat columns.
    02_reg_to_kyc: the latest week of card 4499, mapped to the six percentage
      columns the dashboard renders.
    """
    active_week_start = active_week_start or date.today()
    dod = layer1.get("card_3843_summary_dod", [])
    d1 = (layer1.get("card_5042_retention_d1") or [{}])[0]
    funnel = layer1.get("card_4499_kyc_funnel", [])

    north_star: list[dict] = []
    for partner in partners:
        # AUM — month-to-date sum of daily AUM from the DoD card.
        p_dod = [r for r in dod if r.get("partner") == partner]
        date_col = detect_dod_date_column(list(p_dod[0])) if p_dod else "day"
        aum_col = detect_dod_aum_column(list(p_dod[0])) if p_dod else "aum"
        cur, prior = compute_mtd_from_dod(p_dod, date_col, aum_col, active_week_start)
        north_star.append(_metric_row(partner, "AUM", cur, prior, unit="cr", scale=1e7))

        # FTI + Repeat — month-to-date / LMTD straight from the D1 retention card,
        # whose columns are keyed by the partner's short code (et / pb / mbk / tdl).
        code = RETENTION_CODES.get(partner)
        fti_mtd = to_float(d1.get(f"mtd_{code}_fti")) if code else None
        fti_lmtd = to_float(d1.get(f"LMTD_{code}_fti")) if code else None
        rep_mtd = to_float(d1.get(f"mtd_{code}_repeat")) if code else None
        rep_lmtd = to_float(d1.get(f"LMTD_{code}_repeat")) if code else None
        north_star.append(_metric_row(partner, "FTI", fti_mtd, fti_lmtd, unit="count", scale=1))
        north_star.append(_metric_row(partner, "Repeat", rep_mtd, rep_lmtd, unit="count", scale=1))

    # Funnel — the latest week per partner from card 4499, mapped to the
    # dashboard's six pct columns. Card 4499 stores some ratios as 0-1 fractions;
    # the dashboard renders pct numbers (90.5 == 90.5%), so fractions are x100.
    reg_to_kyc: list[dict] = []
    for partner in partners:
        p_rows = [r for r in funnel if r.get("partner") == partner]
        if not p_rows:
            continue
        latest = max(p_rows, key=lambda r: str(r.get("week", "")))
        total = latest.get("no_of_total_reg")
        reg_to_kyc.append({
            "partner": DISPLAY_NAMES.get(partner, partner),
            "week": latest.get("week"),
            "reg_success_pct":     _pct_of(latest.get("no_of_full_reg"), total),
            "email_verified_pct":  _pct_of(latest.get("email_verified_users"), total),
            "mobile_verified_pct": _pct_of(latest.get("mobile_verified_users"), total),
            "landed_pan_pct":      _as_pct(latest.get("%landed on PAN/full_reg")),
            "kyc_init_pct":        _as_pct(latest.get("%_kyc_initiated")),
            "ucc_kyc_init_pct":    _as_pct(latest.get("%ucc/kyc_initiation")),
        })
    return {"01_north_star": north_star, "02_reg_to_kyc": reg_to_kyc}


def _metric_row(partner, metric, mtd_raw, lmtd_raw, unit, scale):
    mtd = round(mtd_raw / scale, 2) if mtd_raw is not None else None
    lmtd = round(lmtd_raw / scale, 2) if lmtd_raw is not None else None
    delta = None
    if mtd is not None and lmtd not in (None, 0):
        delta = round(100.0 * (mtd - lmtd) / lmtd, 2)
    return {"partner": DISPLAY_NAMES.get(partner, partner), "metric": metric,
            "mtd": mtd, "lmtd": lmtd, "delta_pct": delta, "unit": unit}


def _pct_of(num, den):
    """num/den as a percentage number (90.5 == 90.5%), or None."""
    n, d = to_float(num), to_float(den)
    if n is None or not d or not math.isfinite(n / d):
        return None
    return round(100.0 * n / d, 2)


def _as_pct(frac):
    """A 0-1 fraction -> a percentage number, or None. Drops Infinity/NaN
    (card 4499's early weeks carry those for zero-denominator ratios)."""
    f = to_float(frac)
    if f is None or not math.isfinite(f):
        return None
    return round(100.0 * f, 2)


def run(client, data_dir, *, partners=PARTNERS, active_week_start=None) -> dict:
    """Registry entry point (spec D6) — fetch -> accumulate -> derive -> write
    CSVs + manifest. Returns {status, log, refreshed_at}.

    This is the body that used to live in refresh.run_refresh; only its home
    moved (refresh.py is now a per-project dispatcher). Behaviour unchanged —
    the `partners` / `active_week_start` kwargs keep their old defaults so the
    registry can call `run(client, data_dir)` and tests can still pin them.
    """
    from .accumulate import upsert_csv
    data_dir = Path(data_dir)
    active_week_start = active_week_start or date.today()
    log: list[str] = []

    layer1 = build_layer1(client, partners=partners)
    for table, rows in layer1.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    layer2 = build_layer2(layer1, partners=partners, active_week_start=active_week_start)
    for table, rows in layer2.items():
        upsert_csv(data_dir / f"{table}.csv", rows, key=KEYS.get(table, ["partner"]))
        log.append(f"{table}: {len(rows)} rows")

    now = datetime.now(timezone.utc).isoformat()
    all_tables = list(layer1) + list(layer2)
    manifest = {"refreshed_at": now,
                "tables": {t: {"last_refreshed_at": now} for t in all_tables}}
    (data_dir / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"status": "ok", "log": log, "refreshed_at": now}
