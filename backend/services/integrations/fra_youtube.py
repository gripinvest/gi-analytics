"""FRA YouTube metric builder — analog of grip_connect.py.

build_layer1: raw channel + per-video snapshot rows (with classification).
build_layer2: derived metric tables (added in later tasks).

Every row carries snapshot_date and channel_handle. Lists (tags) are joined
to comma strings so they survive CSV round-trips.
"""
from datetime import datetime, timedelta
from services.integrations.fra_classify import classify_video
from services.integrations.fra_metrics import gini, median, percentile, safe_div

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


def _parse_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def build_distribution(video_rows) -> list[dict]:
    """One row per channel: view-distribution shape + the 1K-breakout north-star."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        views = [v["views"] for v in vids]
        snap = _parse_dt(vids[0]["snapshot_date"] + "T00:00:00Z")
        cutoff = snap - timedelta(days=30)
        recent = [v for v in vids if _parse_dt(v["published_at"]) >= cutoff]
        recent_breakouts = [v for v in recent if v["views"] >= 1000]
        out.append({
            "channel_handle": handle,
            "snapshot_date": vids[0]["snapshot_date"],
            "videos_ge_1k": sum(1 for x in views if x >= 1000),
            "videos_ge_10k": sum(1 for x in views if x >= 10000),
            "videos_ge_100k": sum(1 for x in views if x >= 100000),
            "p10_views": round(percentile(views, 10), 1),
            "p50_views": round(percentile(views, 50), 1),
            "p90_views": round(percentile(views, 90), 1),
            "gini": round(gini(views), 4),
            "recent_video_count": len(recent),
            "breakout_1k_rate": round(safe_div(len(recent_breakouts), len(recent)), 4),
        })
    return out
