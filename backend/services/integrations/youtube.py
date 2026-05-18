"""YouTube Data API v3 client — the only module here that performs network I/O.

Ported from hikaku's src/lib/youtube/client.ts. Returns plain dicts with
string numbers coerced to ints. The HTTP client is injected so tests can pass
a fake; production passes an httpx.Client.
"""
import re

BASE_URL = "https://www.googleapis.com"
MAX_VIDEOS = 500


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_duration(iso: str) -> int:
    """ISO 8601 duration (e.g. PT3M20S) -> seconds."""
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def _normalize_handle(handle: str) -> str:
    return handle if handle.startswith("@") else f"@{handle}"


def _get(client, path, params):
    resp = client.get(f"{BASE_URL}{path}", params=params)
    # Do NOT use resp.raise_for_status(): its message includes the request URL,
    # which carries `?key=<API_KEY>`. Render and local stdout logs are not
    # secret-masked, so raise an error that names only the endpoint path.
    if resp.status_code >= 400:
        raise RuntimeError(f"YouTube API error {resp.status_code} for {path}")
    return resp.json()


def resolve_channel(client, handle: str, api_key: str) -> dict:
    """Resolve a channel by handle. Returns a normalized channel dict."""
    data = _get(client, "/youtube/v3/channels", {
        "part": "snippet,statistics,contentDetails",
        "forHandle": _normalize_handle(handle),
        "key": api_key,
    })
    items = data.get("items") or []
    if not items:
        raise ValueError(f"Channel not found: {handle}")
    it = items[0]
    return {
        "id": it["id"],
        "title": it["snippet"]["title"],
        "handle": it["snippet"].get("customUrl", _normalize_handle(handle)),
        "subscriber_count": _to_int(it["statistics"].get("subscriberCount")),
        "total_views": _to_int(it["statistics"].get("viewCount")),
        "video_count": _to_int(it["statistics"].get("videoCount")),
        "joined_date": it["snippet"].get("publishedAt", ""),
        "uploads_playlist_id": it["contentDetails"]["relatedPlaylists"]["uploads"],
        "description": it["snippet"].get("description", ""),
    }


def fetch_all_videos(client, uploads_playlist_id: str, api_key: str) -> list[dict]:
    """Paginate the uploads playlist, then batch-fetch video details (50/req)."""
    video_ids: list[str] = []
    page_token = None
    while True:
        params = {
            "part": "contentDetails",
            "playlistId": uploads_playlist_id,
            "maxResults": "50",
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token
        data = _get(client, "/youtube/v3/playlistItems", params)
        for item in data.get("items") or []:
            video_ids.append(item["contentDetails"]["videoId"])
        page_token = data.get("nextPageToken")
        if not page_token or len(video_ids) >= MAX_VIDEOS:
            break

    video_ids = video_ids[:MAX_VIDEOS]
    videos: list[dict] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        data = _get(client, "/youtube/v3/videos", {
            "part": "snippet,statistics,contentDetails",
            "id": ",".join(batch),
            "key": api_key,
        })
        for it in data.get("items") or []:
            sn = it.get("snippet", {})
            st = it.get("statistics", {})
            cd = it.get("contentDetails", {})
            videos.append({
                "id": it["id"],
                "title": sn.get("title", ""),
                "published_at": sn.get("publishedAt", ""),
                "views": _to_int(st.get("viewCount")),
                "likes": _to_int(st.get("likeCount")),
                "comments": _to_int(st.get("commentCount")),
                "duration_sec": parse_duration(cd.get("duration", "")),
                "tags": sn.get("tags", []),
                "description": sn.get("description", ""),
                "category_id": sn.get("categoryId", ""),
            })
    return videos
