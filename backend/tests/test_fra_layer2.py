from services.integrations.fra_youtube import build_layer1, build_layer2
from tests.fra_fixture import CHANNEL, VIDEOS

EXPECTED_TABLES = {
    "overview", "distribution", "category_mix", "monthly_views",
    "engagement_breakdown", "posting_patterns", "title_patterns", "catalog_health",
}


def test_build_layer2_emits_all_tables():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    layer2 = build_layer2(layer1, history={"channel_snapshots": []})
    assert set(layer2.keys()) == EXPECTED_TABLES
    for name, rows in layer2.items():
        assert isinstance(rows, list) and rows, f"{name} is empty"
