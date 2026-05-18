import csv
from pathlib import Path
from services.integrations import fra_youtube_refresh as runner
from tests.fra_fixture import CHANNEL, VIDEOS


def test_run_refresh_writes_all_csvs(tmp_path):
    def fake_fetch(channel_handle, api_key):
        return CHANNEL, VIDEOS

    result = runner.run_refresh(
        data_dir=tmp_path, api_key="KEY", snapshot_date="2026-05-18",
        channels=["@FixedReturnsAcademy"], fetch=fake_fetch,
    )
    assert result["status"] == "ok"

    for name in ("channel_snapshots", "video_snapshots", "overview",
                 "distribution", "category_mix", "monthly_views",
                 "engagement_breakdown", "posting_patterns",
                 "title_patterns", "catalog_health"):
        path = tmp_path / f"{name}.csv"
        assert path.exists(), f"{name}.csv missing"

    vids = list(csv.DictReader((tmp_path / "video_snapshots.csv").open()))
    assert len(vids) == 5
    assert (tmp_path / "_manifest.json").exists()


def test_run_refresh_accumulates_history(tmp_path):
    def fake_fetch(channel_handle, api_key):
        return CHANNEL, VIDEOS

    runner.run_refresh(data_dir=tmp_path, api_key="KEY", snapshot_date="2026-05-11",
                       channels=["@FixedReturnsAcademy"], fetch=fake_fetch)
    runner.run_refresh(data_dir=tmp_path, api_key="KEY", snapshot_date="2026-05-18",
                       channels=["@FixedReturnsAcademy"], fetch=fake_fetch)

    chan = list(csv.DictReader((tmp_path / "channel_snapshots.csv").open()))
    dates = sorted(r["snapshot_date"] for r in chan)
    assert dates == ["2026-05-11", "2026-05-18"]   # both snapshots retained

    # Regression guard: the second refresh feeds snapshot-1 history (read from
    # CSV, all-string values) into build_overview. If the delta math is not
    # coerced, this raises TypeError. The row must exist with an int delta.
    ov = list(csv.DictReader((tmp_path / "overview.csv").open()))
    latest = next(r for r in ov if r["snapshot_date"] == "2026-05-18")
    assert int(latest["subscribers_delta"]) == 0   # 1300 - 1300
