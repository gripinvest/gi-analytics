import json
from pathlib import Path
import pytest
from services.integrations import youtube

FIX = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class FakeClient:
    """Stand-in for httpx.Client. Returns fixtures keyed by URL path."""
    def __init__(self, routes):
        self.routes = routes

    def get(self, url, params=None):
        for needle, payload in self.routes.items():
            if needle in url:
                return FakeResponse(payload)
        raise AssertionError(f"no fixture for {url}")


class StatefulFakeClient:
    """Fake client whose responses for a given URL path are consumed in order."""
    def __init__(self, sequences: dict):
        # sequences: {url_needle: [response1, response2, ...]}
        self._sequences = {k: list(v) for k, v in sequences.items()}
        # record every (url, params) call so tests can inspect batches
        self.calls: list[tuple[str, dict]] = []

    def get(self, url, params=None):
        self.calls.append((url, params or {}))
        for needle, responses in self._sequences.items():
            if needle in url:
                if not responses:
                    raise AssertionError(f"no more responses queued for {needle}")
                payload, status = responses.pop(0)
                return FakeResponse(payload, status_code=status)
        raise AssertionError(f"no fixture for {url}")


def _load(name):
    return json.loads((FIX / name).read_text())


def test_resolve_channel_normalizes_fields():
    client = FakeClient({"/channels": _load("youtube_channel.json")})
    ch = youtube.resolve_channel(client, "@FixedReturnsAcademy", "KEY")
    assert ch["id"] == "UCPHv636tYhtARLzoINsGQVw"
    assert ch["subscriber_count"] == 1300
    assert ch["total_views"] == 121100
    assert ch["video_count"] == 142
    assert ch["uploads_playlist_id"] == "UUPHv636tYhtARLzoINsGQVw"


def test_resolve_channel_raises_when_not_found():
    client = FakeClient({"/channels": {"items": []}})
    with pytest.raises(ValueError, match="Channel not found"):
        youtube.resolve_channel(client, "@nope", "KEY")


def test_fetch_all_videos_parses_and_coerces():
    client = FakeClient({
        "/playlistItems": _load("youtube_playlist.json"),
        "/videos": _load("youtube_videos.json"),
    })
    videos = youtube.fetch_all_videos(client, "UUPHv636tYhtARLzoINsGQVw", "KEY")
    assert len(videos) == 2
    v1 = next(v for v in videos if v["id"] == "vid1")
    assert v1["views"] == 8053
    assert v1["likes"] == 90
    assert v1["comments"] == 7
    assert v1["duration_sec"] == 200          # PT3M20S
    assert v1["tags"] == ["bonds", "taxation"]
    v2 = next(v for v in videos if v["id"] == "vid2")
    assert v2["duration_sec"] == 45           # PT45S


def test_fetch_all_videos_paginates():
    """Multi-page playlistItems: both pages' video IDs are collected and
    videos.list is called with all IDs batched together."""
    page1 = {
        "items": [
            {"contentDetails": {"videoId": "vid1"}},
            {"contentDetails": {"videoId": "vid2"}},
        ],
        "nextPageToken": "TOKEN2",
    }
    page2 = {
        "items": [
            {"contentDetails": {"videoId": "vid3"}},
        ],
        # no nextPageToken -> final page
    }
    videos_response = {
        "items": [
            {
                "id": f"vid{n}",
                "snippet": {"title": f"Video {n}", "publishedAt": "2026-01-01T00:00:00Z",
                            "tags": [], "categoryId": "27", "description": ""},
                "statistics": {"viewCount": str(n * 100), "likeCount": "0", "commentCount": "0"},
                "contentDetails": {"duration": "PT1M"},
            }
            for n in (1, 2, 3)
        ]
    }
    client = StatefulFakeClient({
        "/playlistItems": [(page1, 200), (page2, 200)],
        "/videos": [(videos_response, 200)],
    })
    videos = youtube.fetch_all_videos(client, "PLtest", "KEY")

    # All three video IDs collected across two pages
    assert len(videos) == 3
    assert {v["id"] for v in videos} == {"vid1", "vid2", "vid3"}

    # videos.list was called exactly once (all 3 IDs fit in one batch of 50)
    video_list_calls = [url for url, _ in client.calls if "/videos" in url]
    assert len(video_list_calls) == 1

    # The second playlistItems call should carry the nextPageToken
    playlist_calls = [(url, p) for url, p in client.calls if "/playlistItems" in url]
    assert len(playlist_calls) == 2
    assert playlist_calls[0][1].get("pageToken") is None
    assert playlist_calls[1][1].get("pageToken") == "TOKEN2"


def test_get_raises_on_4xx_and_omits_api_key():
    """_get raises RuntimeError on 4xx; the error message must not leak the API key."""
    api_key = "SUPER_SECRET_API_KEY"

    class ErrorClient:
        def get(self, url, params=None):
            return FakeResponse({}, status_code=403)

    with pytest.raises(RuntimeError) as exc_info:
        youtube._get(ErrorClient(), "/youtube/v3/videos", {"key": api_key})

    msg = str(exc_info.value)
    assert "403" in msg
    assert api_key not in msg


def test_resolve_channel_accepts_bare_handle():
    """resolve_channel should work when the handle has no leading '@'."""
    client = FakeClient({"/channels": _load("youtube_channel.json")})
    # Pass without '@'; _normalize_handle should prepend it transparently
    ch = youtube.resolve_channel(client, "FixedReturnsAcademy", "KEY")
    assert ch["id"] == "UCPHv636tYhtARLzoINsGQVw"


def test_parse_duration_standard_cases():
    """parse_duration handles hour/minute/second, day, combined, and empty input."""
    assert youtube.parse_duration("PT1H") == 3600
    assert youtube.parse_duration("PT1H2M3S") == 3723
    assert youtube.parse_duration("P4D") == 345600
    assert youtube.parse_duration("") == 0


def test_get_raises_network_error_without_url():
    """_get wraps httpx.RequestError so the full URL (with API key) is suppressed."""
    import httpx

    class NetworkErrorClient:
        def get(self, url, params=None):
            raise httpx.ConnectError("Connection refused [including full url with key=SECRET]")

    with pytest.raises(RuntimeError) as exc_info:
        youtube._get(NetworkErrorClient(), "/youtube/v3/videos", {"key": "SECRET"})

    msg = str(exc_info.value)
    assert "network error" in msg.lower()
    assert "SECRET" not in msg
    # The chained exception must be suppressed (from None)
    assert exc_info.value.__cause__ is None
