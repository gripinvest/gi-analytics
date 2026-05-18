"""FRA YouTube metric builder — analog of grip_connect.py.

build_layer1: raw channel + per-video snapshot rows (with classification).
build_layer2: derived metric tables (added in later tasks).

Every row carries snapshot_date and channel_handle. Lists (tags) are joined
to comma strings so they survive CSV round-trips.
"""
from collections import defaultdict
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


def build_category_mix(video_rows) -> list[dict]:
    """Per content category: count, % of library, avg views, performance vs mean."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        total = len(vids)
        channel_avg = safe_div(sum(v["views"] for v in vids), total)
        groups = defaultdict(list)
        for v in vids:
            groups[v["category"]].append(v["views"])
        for category, views in sorted(groups.items()):
            avg = safe_div(sum(views), len(views))
            out.append({
                "channel_handle": handle,
                "snapshot_date": vids[0]["snapshot_date"],
                "category": category,
                "video_count": len(views),
                "pct_of_library": round(100 * len(views) / total, 1),
                "avg_views": round(avg, 1),
                "perf_vs_mean_pct": round((safe_div(avg, channel_avg) - 1) * 100, 1),
            })
    return out


def build_monthly_views(video_rows) -> list[dict]:
    """Views by publish month (each video's lifetime views, grouped by publish month)."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        groups = defaultdict(list)
        for v in vids:
            month = v["published_at"][:7]          # YYYY-MM
            groups[month].append(v["views"])
        for month, views in sorted(groups.items()):
            out.append({
                "channel_handle": handle,
                "snapshot_date": vids[0]["snapshot_date"],
                "month": month,
                "video_count": len(views),
                "total_views": sum(views),
                "avg_views": round(safe_div(sum(views), len(views)), 1),
            })
    return out


def _duration_bucket(sec: int) -> str:
    if sec <= 60:
        return "short"
    if sec <= 600:
        return "medium"
    return "long"


def _engagement_row(handle, snapshot_date, dimension, bucket, vids) -> dict:
    views = sum(v["views"] for v in vids)
    interactions = sum(v["likes"] + v["comments"] for v in vids)
    likes = sum(v["likes"] for v in vids)
    comments = sum(v["comments"] for v in vids)
    return {
        "channel_handle": handle,
        "snapshot_date": snapshot_date,
        "dimension": dimension,
        "bucket": bucket,
        "video_count": len(vids),
        "engagement_rate_pct": round(100 * safe_div(interactions, views), 3),
        "like_rate_pct": round(100 * safe_div(likes, views), 3),
        "comment_rate_pct": round(100 * safe_div(comments, views), 3),
    }


def build_engagement_breakdown(video_rows) -> list[dict]:
    """Engagement overall, by duration bucket, and by category."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        out.append(_engagement_row(handle, snap, "overall", "all", vids))
        for bucket in ("short", "medium", "long"):
            group = [v for v in vids if _duration_bucket(v["duration_sec"]) == bucket]
            if group:
                out.append(_engagement_row(handle, snap, "duration", bucket, group))
        cats = defaultdict(list)
        for v in vids:
            cats[v["category"]].append(v)
        for category, group in sorted(cats.items()):
            out.append(_engagement_row(handle, snap, "category", category, group))
    return out


_IST_OFFSET = timedelta(hours=5, minutes=30)


def _to_ist(iso: str) -> datetime:
    return _parse_dt(iso) + _IST_OFFSET


def build_posting_patterns(video_rows) -> list[dict]:
    """Upload counts and avg views by IST posting weekday and hour."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        day_groups = defaultdict(list)
        hour_groups = defaultdict(list)
        for v in vids:
            ist = _to_ist(v["published_at"])
            day_groups[ist.strftime("%A")].append(v["views"])
            hour_groups[str(ist.hour)].append(v["views"])
        for dimension, groups in (("day", day_groups), ("hour", hour_groups)):
            for bucket, views in groups.items():
                out.append({
                    "channel_handle": handle,
                    "snapshot_date": snap,
                    "dimension": dimension,
                    "bucket": bucket,
                    "video_count": len(views),
                    "avg_views": round(safe_div(sum(views), len(views)), 1),
                })
    return out


def build_title_patterns(video_rows) -> list[dict]:
    """Avg views by title pattern: question opener, rupee/number, emoji."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    flags = {
        "question_title": lambda v: v["is_question_title"],
        "rupee_or_number": lambda v: v["has_rupee_or_number"],
        "emoji": lambda v: v["has_emoji"],
    }
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        for pattern, predicate in flags.items():
            group = [v for v in vids if predicate(v)]
            if group:
                views = [v["views"] for v in group]
                out.append({
                    "channel_handle": handle,
                    "snapshot_date": snap,
                    "pattern": pattern,
                    "video_count": len(group),
                    "avg_views": round(safe_div(sum(views), len(views)), 1),
                })
    return out


def build_catalog_health(channel_rows, video_rows) -> list[dict]:
    """Recent (trailing 30d) vs all-time averages, freshness, subscriber efficiency."""
    out = []
    for ch in channel_rows:
        handle = ch["channel_handle"]
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = _parse_dt(ch["snapshot_date"] + "T00:00:00Z")
        cutoff = snap - timedelta(days=30)
        recent = [v for v in vids if _parse_dt(v["published_at"]) >= cutoff]
        alltime_avg = safe_div(sum(v["views"] for v in vids), len(vids))
        recent_avg = safe_div(sum(v["views"] for v in recent), len(recent))
        out.append({
            "channel_handle": handle,
            "snapshot_date": ch["snapshot_date"],
            "videos_last_30d": len(recent),
            "recent_avg_views": round(recent_avg, 1),
            "alltime_avg_views": round(alltime_avg, 1),
            "freshness_delta_pct": round((safe_div(recent_avg, alltime_avg) - 1) * 100, 1),
            "subscriber_efficiency": round(safe_div(ch["total_views"], ch["subscribers"]), 1),
        })
    return out
