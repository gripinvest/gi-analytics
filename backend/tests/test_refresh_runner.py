import json
from datetime import date
from services.integrations.refresh import run_refresh


class FakeClient:
    def card_param_id(self, card_id, tag):
        return "p1"
    def fetch_card(self, card_id, parameters=None):
        canned = {
            3841: [{"week": "2026-05-11", "aum": 5e7, "fti_count": 12}],
            3843: [{"date": "2026-05-11", "aum": 1e7}],
            4499: [{"no_of_total_reg": 100}],
            5042: [{"mtd_et_repeat": 30, "LMTD_et_repeat": 20}],
            5046: [{"mtd_et_unique_inv": 100, "lmtd_et_unique_inv": 80}],
        }
        return list(canned.get(card_id, [])), []


def test_run_refresh_writes_csvs_and_manifest(tmp_path):
    result = run_refresh(FakeClient(), data_dir=tmp_path, partners=["ET money"],
                         active_week_start=date(2026, 5, 11))
    assert (tmp_path / "card_3841_summary_wow.csv").exists()
    assert (tmp_path / "01_north_star.csv").exists()
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert "01_north_star" in manifest["tables"]
    assert manifest["tables"]["01_north_star"]["last_refreshed_at"]
    assert result["status"] == "ok"
