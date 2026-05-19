from services.integrations.fra_youtube import build_layer1, build_layer2
from tests.fra_fixture import CHANNEL, VIDEOS

EXPECTED_TABLES = {
    "overview", "distribution", "category_mix", "monthly_views",
    "engagement_breakdown", "posting_patterns", "title_patterns", "catalog_health",
    "duration_buckets", "tag_analysis", "upload_cadence",
}


def test_build_layer2_emits_all_tables():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    layer2 = build_layer2(layer1, history={"channel_snapshots": []})
    assert set(layer2.keys()) == EXPECTED_TABLES
    for name, rows in layer2.items():
        assert isinstance(rows, list) and rows, f"{name} is empty"

    # Spot-check real computed values per table (fixture values are deterministic).
    # overview: fixture CHANNEL.subscriber_count = 1300
    assert layer2["overview"][0]["subscribers"] == 1300
    # distribution: 5 videos with views [100,400,1000,3000,8000] → Gini > 0
    assert layer2["distribution"][0]["gini"] > 0
    # category_mix: 5 fixture videos classified into categories; total video_count across rows = 5
    assert sum(r["video_count"] for r in layer2["category_mix"]) == 5
    # monthly_views: fixture has videos in 3 months (2026-05, 2026-04, 2026-03)
    assert len(layer2["monthly_views"]) == 3
    # engagement_breakdown: overall row present with engagement_rate_pct > 0
    overall = next(r for r in layer2["engagement_breakdown"] if r["dimension"] == "overall")
    assert overall["engagement_rate_pct"] > 0
    # posting_patterns: at least one row per dimension (day + hour)
    assert any(r["dimension"] == "day" for r in layer2["posting_patterns"])
    assert any(r["dimension"] == "hour" for r in layer2["posting_patterns"])
    # title_patterns: at least one pattern row present
    assert len(layer2["title_patterns"]) >= 1
    # catalog_health: subscriber_efficiency = total_views / subscribers = 20000/1300
    assert layer2["catalog_health"][0]["subscriber_efficiency"] == round(20000 / 1300, 1)


def test_layer2_includes_new_metric_tables():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    layer2 = build_layer2(layer1, history={})
    assert "duration_buckets" in layer2
    assert "tag_analysis" in layer2
    assert "upload_cadence" in layer2
    assert len(layer2["duration_buckets"]) == 7      # one row per bucket
    assert len(layer2["upload_cadence"]) == 1        # one channel-level row
