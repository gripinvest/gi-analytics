"""Regenerate FRA layer-2 CSVs from the committed layer-1 CSVs.

Run after changing a layer-2 transform (new table, new column). Reads the
accumulated channel_snapshots.csv + video_snapshots.csv, replays build_layer2
for every snapshot_date in order, and rewrites each layer-2 CSV. Layer-1 CSVs
are read as-is; numeric fields are coerced (CSV values are strings).
"""
import csv
from pathlib import Path

from services.integrations.fra_youtube import build_layer2
from services.integrations.fra_youtube_refresh import KEYS
from services.integrations.accumulate import upsert_csv

DATA_DIR = Path(__file__).parent / "data" / "fra_youtube"

_CHANNEL_INTS = ("subscribers", "total_views", "video_count")
_VIDEO_INTS = ("views", "likes", "comments", "duration_sec", "title_length")
_VIDEO_BOOLS = ("is_question_title", "has_rupee_or_number", "has_emoji")
_LAYER2_TABLES = ("overview", "distribution", "category_mix", "monthly_views",
                  "engagement_breakdown", "posting_patterns", "title_patterns",
                  "catalog_health", "duration_buckets", "tag_analysis",
                  "upload_cadence")


def _read(name):
    path = DATA_DIR / f"{name}.csv"
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def _coerce(row, ints, bools):
    out = dict(row)
    for k in ints:
        if k in out:
            out[k] = int(out[k])
    for k in bools:
        if k in out:
            out[k] = out[k] == "True"
    return out


def main():
    channels = [_coerce(r, _CHANNEL_INTS, ()) for r in _read("channel_snapshots")]
    videos = [_coerce(r, _VIDEO_INTS, _VIDEO_BOOLS) for r in _read("video_snapshots")]
    dates = sorted({r["snapshot_date"] for r in channels})

    # Clear stale layer-2 CSVs so removed columns/rows don't linger.
    for name in _LAYER2_TABLES:
        (DATA_DIR / f"{name}.csv").unlink(missing_ok=True)

    for date in dates:
        layer1 = {
            "channel_snapshots": [r for r in channels if r["snapshot_date"] == date],
            "video_snapshots": [r for r in videos if r["snapshot_date"] == date],
        }
        history = {"channel_snapshots":
                   [r for r in channels if r["snapshot_date"] < date]}
        layer2 = build_layer2(layer1, history)
        for name, rows in layer2.items():
            upsert_csv(DATA_DIR / f"{name}.csv", rows, key=KEYS[name])
        print(f"{date}: rebuilt {len(layer2)} layer-2 tables")


if __name__ == "__main__":
    main()
