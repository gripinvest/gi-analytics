from services.integrations.fra_youtube import build_layer1, build_tag_analysis
from tests.fra_fixture import CHANNEL, VIDEOS


def test_tag_analysis_counts_and_types():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_tag_analysis(layer1["video_snapshots"])
    # Fixture tags: taxation, bond, fd, passive income (one video each); video e has none.
    assert len(rows) == 4
    by_tag = {r["tag"]: r for r in rows}
    assert by_tag["bond"]["frequency"] == 1
    assert by_tag["bond"]["tag_type"] == "product"
    assert by_tag["fd"]["tag_type"] == "product"
    assert by_tag["passive income"]["tag_type"] == "aspirational"
    assert by_tag["taxation"]["tag_type"] == "other"
    # Ranked by (-frequency, tag) — all freq 1, so alphabetical.
    assert [r["tag"] for r in rows] == ["bond", "fd", "passive income", "taxation"]
