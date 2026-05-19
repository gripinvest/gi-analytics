from services.integrations.fra_youtube import build_layer1, build_duration_buckets
from tests.fra_fixture import CHANNEL, VIDEOS


def test_duration_buckets_partition_and_averages():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_duration_buckets(layer1["video_snapshots"])
    by_bucket = {r["bucket"]: r for r in rows}
    # All seven buckets always emitted, even when empty.
    assert set(by_bucket) == {"0–30s", "30–60s", "1–2m", "2–5m",
                              "5–10m", "10–20m", "20m+"}
    # Fixture durations land one per bucket: 30→0–30s, 45→30–60s, 90→1–2m,
    # 200→2–5m, 700→10–20m. 5–10m and 20m+ stay empty.
    assert by_bucket["0–30s"]["video_count"] == 1
    assert by_bucket["0–30s"]["avg_views"] == 100.0
    assert by_bucket["2–5m"]["video_count"] == 1
    assert by_bucket["2–5m"]["avg_views"] == 8000.0
    assert by_bucket["5–10m"]["video_count"] == 0
    assert by_bucket["5–10m"]["avg_views"] == 0.0
    # Video a (2–5m): 8000 views, 80 likes + 40 comments → 1.5% engagement.
    assert by_bucket["2–5m"]["engagement_rate_pct"] == 1.5
