from services.integrations.fra_youtube import build_layer1, build_overview
from tests.fra_fixture import CHANNEL, VIDEOS


def test_overview_current_snapshot():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_overview(layer1["channel_snapshots"], layer1["video_snapshots"], history=[])
    assert len(rows) == 1
    r = rows[0]
    assert r["subscribers"] == 1300
    assert r["video_count"] == 5
    assert r["avg_views"] == 2500          # 12500 / 5
    assert r["median_views"] == 1000
    assert r["subscribers_delta"] == 0     # no history
    assert r["total_views_delta"] == 0


def test_overview_delta_against_history():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    history = [{"channel_handle": "@fixedreturnsacademy", "snapshot_date": "2026-05-11",
                "subscribers": 1200, "total_views": 18000}]
    rows = build_overview(layer1["channel_snapshots"], layer1["video_snapshots"], history=history)
    assert rows[0]["subscribers_delta"] == 100
    assert rows[0]["total_views_delta"] == 2000
