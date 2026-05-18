from services.integrations.fra_youtube import build_layer1, build_category_mix, build_monthly_views
from tests.fra_fixture import CHANNEL, VIDEOS


def test_category_mix_aggregates():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_category_mix(layer1["video_snapshots"])
    by_cat = {r["category"]: r for r in rows}
    # channel avg views = 12500 / 5 = 2500
    tax = by_cat["Taxation"]                     # video a, 8000 views
    assert tax["video_count"] == 1
    assert tax["avg_views"] == 8000
    assert tax["pct_of_library"] == 20.0
    assert tax["perf_vs_mean_pct"] == 220.0      # 8000/2500 - 1 = 2.2


def test_monthly_views_groups_by_publish_month():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_monthly_views(layer1["video_snapshots"])
    by_month = {r["month"]: r for r in rows}
    assert by_month["2026-05"]["total_views"] == 9000   # a 8000 + b 1000
    assert by_month["2026-05"]["video_count"] == 2
    assert by_month["2026-04"]["total_views"] == 3400   # c 3000 + d 400
