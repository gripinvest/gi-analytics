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


def test_tag_analysis_frequency_ranking_and_top_n():
    # "bond" appears 3×, "fd" 2×, "alpha" 1×, "zebra" 1× — verifies
    # frequency-descending sort, alphabetical tie-break, and top_n truncation.
    video_rows = [
        {"channel_handle": "@fra", "snapshot_date": "2026-05-18", "tags": "bond,fd"},
        {"channel_handle": "@fra", "snapshot_date": "2026-05-18", "tags": "bond,alpha"},
        {"channel_handle": "@fra", "snapshot_date": "2026-05-18", "tags": "bond,fd,zebra"},
    ]
    rows = build_tag_analysis(video_rows, top_n=2)
    assert len(rows) == 2
    assert rows[0]["tag"] == "bond" and rows[0]["frequency"] == 3
    assert rows[1]["tag"] == "fd" and rows[1]["frequency"] == 2
    # alpha and zebra (freq 1 each) are truncated by top_n=2


def test_tag_analysis_deduplicates_tags_per_video():
    """Spec §3.2: frequency = number of videos carrying the tag.
    A duplicated tag in a single video's comma-string must count only once.
    Before fix: "bond,bond,fd" in one video → bond frequency=2, fd frequency=1.
    After fix:  bond frequency=1, fd frequency=1.
    """
    video_rows = [
        {"channel_handle": "@fra", "snapshot_date": "2026-05-18", "tags": "bond,bond,fd"},
    ]
    rows = build_tag_analysis(video_rows)
    by_tag = {r["tag"]: r for r in rows}
    # bond must count as 1 (one video), not 2 (two occurrences in the string)
    assert by_tag["bond"]["frequency"] == 1
    assert by_tag["fd"]["frequency"] == 1
