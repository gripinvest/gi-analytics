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
    # Single-video bucket: mean-of-ratios == sum/sum, so this passes with either formula.
    assert by_bucket["2–5m"]["engagement_rate_pct"] == 1.5


def test_duration_buckets_engagement_is_mean_of_per_video_ratios():
    """Verify engagement_rate_pct is the MEAN of per-video ratios, not sum/sum (view-weighted).

    Two videos in the same bucket:
      V1: views=100, likes=10, comments=0  → ratio = 10/100*100 = 10.0%
      V2: views=1000, likes=5, comments=0  → ratio = 5/1000*100 = 0.5%
    Mean of ratios = (10.0 + 0.5) / 2 = 5.25%
    Sum/sum (view-weighted) = 15/1100*100 ≈ 1.364%  ← what the OLD formula produced

    The test asserts 5.25, which is a value the view-weighted formula cannot produce.
    Both videos fall in the 1–2m bucket (duration_sec=90 and 91 both ≤ 120).
    """
    video_rows = [
        {
            "channel_handle": "@fra", "snapshot_date": "2026-05-18",
            "views": 100, "likes": 10, "comments": 0,
            "duration_sec": 90,
            "category": "Bond Basics", "is_question_title": False,
            "has_rupee_or_number": False, "has_emoji": False, "title_length": 10,
            "tags": "", "title": "Video One", "video_id": "v1",
            "published_at": "2026-05-01T12:00:00Z",
        },
        {
            "channel_handle": "@fra", "snapshot_date": "2026-05-18",
            "views": 1000, "likes": 5, "comments": 0,
            "duration_sec": 91,
            "category": "Bond Basics", "is_question_title": False,
            "has_rupee_or_number": False, "has_emoji": False, "title_length": 10,
            "tags": "", "title": "Video Two", "video_id": "v2",
            "published_at": "2026-05-02T12:00:00Z",
        },
    ]
    rows = build_duration_buckets(video_rows)
    by_bucket = {r["bucket"]: r for r in rows}
    # Mean of ratios: (10.0 + 0.5) / 2 = 5.25 — differs from view-weighted 1.364
    assert by_bucket["1–2m"]["video_count"] == 2
    assert by_bucket["1–2m"]["engagement_rate_pct"] == 5.25
