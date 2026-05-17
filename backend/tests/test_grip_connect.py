from services.integrations.grip_connect import CARDS, PARTNERS, build_layer1, build_layer2


class FakeClient:
    """Stands in for MetabaseClient — returns canned rows per (card_id)."""
    def __init__(self, by_card):
        self.by_card = by_card
    def card_param_id(self, card_id, tag):
        return "p1"
    def fetch_card(self, card_id, parameters=None):
        return list(self.by_card.get(card_id, [])), []


def test_cards_and_partners_config():
    assert CARDS["summary_wow"]["id"] == 3841
    assert CARDS["kyc_funnel"]["id"] == 4499
    assert CARDS["summary_dod"]["id"] == 3843
    assert CARDS["retention_d1"]["id"] == 5042
    assert CARDS["retention_d2"]["id"] == 5046
    assert "ET money" in PARTNERS


def test_build_layer1_tags_rows_with_partner():
    client = FakeClient({3841: [{"week": "2026-05-04", "aum": 1e7}]})
    l1 = build_layer1(client, partners=["ET money"], cards=["summary_wow"])
    rows = l1["card_3841_summary_wow"]
    assert rows == [{"partner": "ET money", "week": "2026-05-04", "aum": 1e7}]


def test_build_layer2_north_star_and_funnel():
    import datetime
    layer1 = {
        # Daily AUM (rupees) — column name is `day`, matching the real card.
        "card_3843_summary_dod": [
            {"partner": "ET money", "day": "2026-05-02", "aum": 1e7},
            {"partner": "ET money", "day": "2026-05-05", "aum": 2e7},
        ],
        # FTI + Repeat come straight from card 5042's mtd_/LMTD_ <code> columns.
        "card_5042_retention_d1": [{
            "mtd_et_fti": 90, "LMTD_et_fti": 62,
            "mtd_et_repeat": 258, "LMTD_et_repeat": 160,
        }],
        # Two weeks of the funnel — the latest week must win.
        "card_4499_kyc_funnel": [
            {"partner": "ET money", "week": "2026-04-27", "no_of_total_reg": 100,
             "no_of_full_reg": 80, "email_verified_users": 100, "mobile_verified_users": 100,
             "%landed on PAN/full_reg": 0.05, "%_kyc_initiated": 0.03, "%ucc/kyc_initiation": 0.24},
            {"partner": "ET money", "week": "2026-05-04", "no_of_total_reg": 200,
             "no_of_full_reg": 188, "email_verified_users": 200, "mobile_verified_users": 200,
             "%landed on PAN/full_reg": 0.051, "%_kyc_initiated": 0.034, "%ucc/kyc_initiation": 0.242},
        ],
    }
    l2 = build_layer2(layer1, partners=["ET money"],
                      active_week_start=datetime.date(2026, 5, 17))

    ns = {r["metric"]: r for r in l2["01_north_star"]}
    assert set(ns) == {"AUM", "FTI", "Repeat"}
    assert ns["AUM"]["partner"] == "ET Money"        # display name applied
    assert ns["AUM"]["mtd"] == 3.0                    # (1e7 + 2e7) / 1e7
    assert ns["FTI"]["mtd"] == 90 and ns["FTI"]["lmtd"] == 62
    assert ns["Repeat"]["mtd"] == 258

    funnel = l2["02_reg_to_kyc"]
    assert len(funnel) == 1
    assert funnel[0]["partner"] == "ET Money"
    assert funnel[0]["week"] == "2026-05-04"          # latest week wins
    assert funnel[0]["reg_success_pct"] == 94.0       # 188 / 200 * 100
    assert funnel[0]["landed_pan_pct"] == 5.1         # 0.051 * 100
