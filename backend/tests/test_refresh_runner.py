import json
from datetime import date

import pytest

from services.integrations import grip_connect
from services.integrations.refresh import REGISTRY, VALIDATORS, run_refresh


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


def test_grip_connect_run_writes_csvs_and_manifest(tmp_path):
    # GC regression gate (spec §16 Phase 2): the GC fetch must behave exactly
    # as before, now that its body lives in grip_connect.run().
    result = grip_connect.run(FakeClient(), tmp_path, partners=["ET money"],
                              active_week_start=date(2026, 5, 11))
    assert (tmp_path / "card_3841_summary_wow.csv").exists()
    assert (tmp_path / "01_north_star.csv").exists()
    manifest = json.loads((tmp_path / "_manifest.json").read_text())
    assert "01_north_star" in manifest["tables"]
    assert manifest["tables"]["01_north_star"]["last_refreshed_at"]
    assert result["status"] == "ok"


def test_run_refresh_dispatches_by_project(tmp_path):
    result = run_refresh("grip_connect", FakeClient(), tmp_path)
    assert result["status"] == "ok"
    assert (tmp_path / "01_north_star.csv").exists()


def test_run_refresh_unknown_project_raises():
    with pytest.raises(ValueError, match="no refresh runner"):
        run_refresh("not_a_project", FakeClient(), "/tmp")


def test_registry_has_both_projects():
    assert set(REGISTRY) == {
        "grip_connect", "asset_search", "performance_grip", "learn_education",
    }


def test_validators_registry_wires_asset_search():
    # The --validate CLI step dispatches through VALIDATORS (spec §14).
    from services.integrations import asset_search
    assert VALIDATORS["asset_search"] is asset_search.validate_data_dir
