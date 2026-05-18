from services.integrations.fra_youtube import build_layer1, build_posting_patterns
from tests.fra_fixture import CHANNEL, VIDEOS


def test_posting_patterns_converts_to_ist():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_posting_patterns(layer1["video_snapshots"])
    hours = {r["bucket"]: r for r in rows if r["dimension"] == "hour"}
    # video b published 2026-05-02T03:00:00Z -> 08:30 IST -> hour bucket "8"
    assert "8" in hours
    # video a published 2026-05-10T12:30:00Z -> 18:00 IST -> hour bucket "18"
    assert "18" in hours
    days = {r["bucket"]: r for r in rows if r["dimension"] == "day"}
    assert sum(d["video_count"] for d in days.values()) == 5
