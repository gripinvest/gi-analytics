"""FRA YouTube metric builder — analog of grip_connect.py.

build_layer1: raw channel + per-video snapshot rows (with classification).
build_layer2: derived metric tables (added in later tasks).

Every row carries snapshot_date and channel_handle. Lists (tags) are joined
to comma strings so they survive CSV round-trips.
"""
from services.integrations.fra_classify import classify_video
from services.integrations.fra_metrics import median, safe_div

# v1: FRA only. Add competitor handles here for the deferred comparison tab.
CHANNELS = ["@FixedReturnsAcademy"]


def build_layer1(channels_data, snapshot_date: str) -> dict:
    """channels_data: list of (channel_dict, [video_dict, ...])."""
    channel_rows = []
    video_rows = []
    for channel, videos in channels_data:
        handle = channel["handle"]
        channel_rows.append({
            "channel_handle": handle,
            "snapshot_date": snapshot_date,
            "channel_id": channel["id"],
            "title": channel["title"],
            "subscribers": channel["subscriber_count"],
            "total_views": channel["total_views"],
            "video_count": channel["video_count"],
            "joined_date": channel["joined_date"],
        })
        for v in videos:
            cls = classify_video(v["title"], v.get("tags", []))
            video_rows.append({
                "channel_handle": handle,
                "snapshot_date": snapshot_date,
                "video_id": v["id"],
                "title": v["title"],
                "published_at": v["published_at"],
                "views": v["views"],
                "likes": v["likes"],
                "comments": v["comments"],
                "duration_sec": v["duration_sec"],
                "tags": ",".join(v.get("tags", [])),
                "category": cls["category"],
                "is_question_title": cls["is_question_title"],
                "has_rupee_or_number": cls["has_rupee_or_number"],
                "has_emoji": cls["has_emoji"],
                "title_length": cls["title_length"],
            })
    return {"channel_snapshots": channel_rows, "video_snapshots": video_rows}


def _latest_prior(history, handle, current_date):
    """Most recent history row for a channel STRICTLY BEFORE current_date.

    Excluding current_date matters: a same-day re-run (GitHub Action retry, or
    manual + scheduled on one day) would otherwise pick today's own freshly
    written row and compute `today - today = 0`, silently wiping a real delta.
    History rows come from CSV, so every value is a string — the caller coerces
    the fields it does arithmetic on.
    """
    rows = [h for h in history
            if h["channel_handle"] == handle and h["snapshot_date"] < current_date]
    return max(rows, key=lambda h: h["snapshot_date"]) if rows else None


def build_overview(channel_rows, video_rows, history) -> list[dict]:
    """One row per channel: headline figures + delta vs the prior snapshot."""
    out = []
    for ch in channel_rows:
        handle = ch["channel_handle"]
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        views = [v["views"] for v in vids]
        durations = [v["duration_sec"] for v in vids]
        prior = _latest_prior(history, handle, ch["snapshot_date"])
        # CRITICAL: `prior` comes from a CSV read, so its values are STRINGS.
        # `ch` values are native ints from build_layer1. int - str raises
        # TypeError, so coerce. When there is no prior, delta is 0.
        prior_subs = int(prior["subscribers"]) if prior else ch["subscribers"]
        prior_views = int(prior["total_views"]) if prior else ch["total_views"]
        out.append({
            "channel_handle": handle,
            "snapshot_date": ch["snapshot_date"],
            "subscribers": ch["subscribers"],
            "total_views": ch["total_views"],
            "video_count": ch["video_count"],
            "avg_views": round(safe_div(sum(views), len(views)), 1),
            "median_views": float(median(views)),
            "avg_duration_sec": round(safe_div(sum(durations), len(durations)), 1),
            "subscribers_delta": ch["subscribers"] - prior_subs,
            "total_views_delta": ch["total_views"] - prior_views,
        })
    return out
