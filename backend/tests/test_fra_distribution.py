from services.integrations.fra_youtube import build_layer1, build_distribution
from tests.fra_fixture import CHANNEL, VIDEOS


def test_distribution_thresholds_and_concentration():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_distribution(layer1["video_snapshots"])
    r = rows[0]
    # views sorted: [100, 400, 1000, 3000, 8000]
    assert r["videos_ge_1k"] == 3           # 1000, 3000, 8000
    assert r["videos_ge_10k"] == 0
    assert r["p50_views"] == 1000
    assert r["p90_views"] == 6000           # interpolated between 3000 and 8000
    assert 0 < r["gini"] < 1


def test_breakout_rate_uses_trailing_30d():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_distribution(layer1["video_snapshots"])
    # Published within 30d of 2026-05-18: video a (May 10, 8000) and b (May 2, 1000).
    # Both >= 1000 -> rate 1.0.
    assert rows[0]["breakout_1k_rate"] == 1.0
    assert rows[0]["recent_video_count"] == 2
