import json
from pathlib import Path
import pytest
from services.integrations import youtube

FIX = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

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
