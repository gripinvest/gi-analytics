from services.integrations.fra_youtube import (
    build_layer1, build_title_patterns, build_catalog_health,
)
from tests.fra_fixture import CHANNEL, VIDEOS


def test_title_patterns_counts_flags():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_title_patterns(layer1["video_snapshots"])
    by_pat = {r["pattern"]: r for r in rows}
    # "How Are Bonds Taxed in India?" -> question; "Passive Income With Bonds" no
    assert by_pat["question_title"]["video_count"] == 1
    assert by_pat["question_title"]["avg_views"] == 8000


def test_catalog_health_recent_vs_alltime():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_catalog_health(layer1["channel_snapshots"], layer1["video_snapshots"])
    r = rows[0]
    assert r["alltime_avg_views"] == 2500
    # videos published within 30d of 2026-05-18: a (8000), b (1000) -> avg 4500
    assert r["recent_avg_views"] == 4500
    assert r["subscriber_efficiency"] == round(20000 / 1300, 1)
