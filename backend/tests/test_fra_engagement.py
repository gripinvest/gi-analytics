from services.integrations.fra_youtube import build_layer1, build_engagement_breakdown
from tests.fra_fixture import CHANNEL, VIDEOS


def test_engagement_overall_and_by_duration():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_engagement_breakdown(layer1["video_snapshots"])
    by_dim = {(r["dimension"], r["bucket"]): r for r in rows}

    # overall: likes 125 + comments 62 = 187 over 12500 views -> 1.496%
    overall = by_dim[("overall", "all")]
    assert overall["engagement_rate_pct"] == 1.496

    # short bucket is <=60s: b (45s) and e (30s). d (90s) is medium.
    short = by_dim[("duration", "short")]
    assert short["video_count"] == 2
