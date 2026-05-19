from services.integrations.fra_youtube import build_layer1, build_upload_cadence
from tests.fra_fixture import CHANNEL, VIDEOS


def test_upload_cadence_gaps_and_pace():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    r = build_upload_cadence(layer1["video_snapshots"])[0]
    # Published (sorted): 2026-03-01, 04-05, 04-10, 05-02, 05-10.
    # Gaps in days: 35, 5, 22, 8.
    assert r["avg_gap_days"] == 17.5            # (35+5+22+8)/4
    assert r["median_gap_days"] == 15.0         # median of [5, 8, 22, 35]
    assert r["longest_gap_days"] == 35
    # 5 videos across 3 distinct calendar months (Mar, Apr, May).
    assert r["avg_uploads_per_month"] == 1.67   # round(5/3, 2)
