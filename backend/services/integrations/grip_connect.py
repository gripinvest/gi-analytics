"""Grip Connect fetch orchestration. Config + layer-1/layer-2 builders.

Layer 1 = raw card output, one dict per row, tagged with `partner`.
Layer 2 = derived dashboard tables (North Star, reg-to-KYC funnel).
Card IDs, partner list and RETENTION_FIELD_MAP are lifted from
gc-analyst's metabase_fetch.py.
"""
from datetime import date
from .transforms import (
    compute_mtd_from_dod, compute_retention_metrics,
    detect_dod_date_column, detect_dod_aum_column, to_float,
)

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

# Per-partner retention column map (metabase_fetch.py:94-125).
RETENTION_FIELD_MAP = {
    "ET money": {"d1_mtd_repeat": "mtd_et_repeat", "d1_lmtd_repeat": "LMTD_et_repeat",
                 "d2_mtd_unique": "mtd_et_unique_inv", "d2_lmtd_unique": "lmtd_et_unique_inv"},
    "Tata Digital Private Ltd": {"d1_mtd_repeat": "mtd_tdl_repeat", "d1_lmtd_repeat": "LMTD_tdl_repeat",
                 "d2_mtd_unique": "mtd_tdl_unique_inv", "d2_lmtd_unique": "lmtd_tdl_unique_inv"},
    "Paisa Bazaar": {"d1_mtd_repeat": "mtd_pb_repeat", "d1_lmtd_repeat": "LMTD_pb_repeat",
                 "d2_mtd_unique": "mtd_pb_unique_inv", "d2_lmtd_unique": "lmtd_pb_unique_inv"},
    "Mobikwik": {"d1_mtd_repeat": "mtd_mbk_repeat", "d1_lmtd_repeat": "LMTD_mbk_repeat",
                 "d2_mtd_unique": "mtd_mbk_unique_inv", "d2_lmtd_unique": "lmtd_mbk_unique_inv"},
}

# Partner string -> the display name used in the dashboard (metabase_fetch.py:72-79).
DISPLAY_NAMES = {"ET money": "ET Money", "Paisa Bazaar": "Paisabazaar",
                 "Mobikwik": "MobiKwik", "Tata Digital Private Ltd": "Tata Digital"}


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
    02_reg_to_kyc: the funnel — passed through from card 4499, latest week per partner.
    """
    active_week_start = active_week_start or date.today()
    wow = layer1.get("card_3841_summary_wow", [])
    dod = layer1.get("card_3843_summary_dod", [])
    d1 = layer1.get("card_5042_retention_d1", [{}])
    d2 = layer1.get("card_5046_retention_d2", [{}])
    funnel = layer1.get("card_4499_kyc_funnel", [])

    north_star: list[dict] = []
    for partner in partners:
        # AUM — MTD vs LMTD from the DoD card.
        p_dod = [r for r in dod if r.get("partner") == partner]
        date_col = detect_dod_date_column(list(p_dod[0])) if p_dod else "date"
        aum_col = detect_dod_aum_column(list(p_dod[0])) if p_dod else "aum"
        cur, prior = compute_mtd_from_dod(p_dod, date_col, aum_col, active_week_start)
        north_star.append(_metric_row(partner, "AUM", cur, prior, unit="cr", scale=1e7))

        # FTI — latest WoW row's fti_count.
        p_wow = [r for r in wow if r.get("partner") == partner]
        latest = p_wow[-1] if p_wow else {}
        north_star.append(_metric_row(partner, "FTI", to_float(latest.get("fti_count")),
                                      None, unit="count", scale=1))

        # Repeat — from retention cards.
        fmap = RETENTION_FIELD_MAP.get(partner)
        rep = compute_retention_metrics(d1[0], d2[0], fmap) if fmap else {}
        north_star.append(_metric_row(partner, "Repeat", rep.get("mtd_repeat"),
                                      rep.get("lmtd_repeat"), unit="count", scale=1))

    # Funnel: keep the latest row per partner.
    by_partner: dict[str, dict] = {}
    for r in funnel:
        by_partner[r.get("partner")] = r
    return {"01_north_star": north_star, "02_reg_to_kyc": list(by_partner.values())}


def _metric_row(partner, metric, mtd_raw, lmtd_raw, unit, scale):
    mtd = (mtd_raw / scale) if mtd_raw is not None else None
    lmtd = (lmtd_raw / scale) if lmtd_raw is not None else None
    delta = None
    if mtd is not None and lmtd not in (None, 0):
        delta = round(100.0 * (mtd - lmtd) / lmtd, 2)
    return {"partner": DISPLAY_NAMES.get(partner, partner), "metric": metric,
            "mtd": mtd, "lmtd": lmtd, "delta_pct": delta, "unit": unit}
