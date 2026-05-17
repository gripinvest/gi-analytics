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


def test_build_layer2_north_star_has_one_row_per_partner_metric():
    layer1 = {
        "card_3841_summary_wow": [{"partner": "ET money", "week": "2026-05-11",
                                   "aum": 5e7, "fti_count": 12}],
        "card_3843_summary_dod": [{"partner": "ET money", "date": "2026-05-11", "aum": 1e7}],
        "card_5042_retention_d1": [{"mtd_et_repeat": 30, "LMTD_et_repeat": 20}],
        "card_5046_retention_d2": [{"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}],
    }
    l2 = build_layer2(layer1, partners=["ET money"], active_week_start=__import__("datetime").date(2026, 5, 11))
    ns = l2["01_north_star"]
    metrics = {r["metric"] for r in ns if r["partner"] == "ET Money"}
    assert metrics == {"AUM", "FTI", "Repeat"}
