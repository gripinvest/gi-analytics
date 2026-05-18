# FRA YouTube Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `fra_youtube` project to the grip_analytics platform that tracks the Fixed Returns Academy YouTube channel via the Data API v3, with a daily snapshot refresh, a tabbed dashboard, AI insights, and chat.

**Architecture:** A near-clone of the existing Grip Connect live-data pipeline. A deterministic Python refresh runner pulls the YouTube Data API v3, classifies videos, derives metric tables, and upserts CSV snapshots into `backend/data/fra_youtube/`. A daily GitHub Action runs it and commits the CSVs (git is the durable store; Render disk is ephemeral). DuckDB materialises the CSVs as tables; the dashboard reads them via the existing `/query` endpoint; chat reuses the existing Claude-SQL loop.

**Tech Stack:** Python 3.12, FastAPI, DuckDB, `httpx` (HTTP), `anthropic` 0.34 (insights), pytest (backend tests), Next.js + React (dashboard), GitHub Actions (scheduling).

**Spec:** `docs/specs/2026-05-18-fra-youtube-analytics-design.md`

**Conventions:**
- Backend tests live in `backend/tests/`, run from `backend/` with `pytest`. `conftest.py` puts `backend/` on `sys.path`, so imports are `from services.integrations... import ...`.
- All refresh code is deterministic — no AI calls in the refresh path.
- Every CSV row carries `snapshot_date` (IST, `YYYY-MM-DD`) and `channel_handle`.

---

## Task 1: YouTube Data API v3 client

**Files:**
- Create: `backend/services/integrations/youtube.py`
- Test: `backend/tests/test_youtube_client.py`
- Create: `backend/tests/fixtures/youtube_channel.json`, `backend/tests/fixtures/youtube_playlist.json`, `backend/tests/fixtures/youtube_videos.json`

- [ ] **Step 1: Create the response fixtures**

`backend/tests/fixtures/youtube_channel.json` — a minimal `channels.list` response:

```json
{
  "items": [
    {
      "id": "UCPHv636tYhtARLzoINsGQVw",
      "snippet": { "title": "Fixed Returns Academy", "customUrl": "@fixedreturnsacademy", "publishedAt": "2025-07-01T00:00:00Z" },
      "statistics": { "subscriberCount": "1300", "viewCount": "121100", "videoCount": "142" },
      "contentDetails": { "relatedPlaylists": { "uploads": "UUPHv636tYhtARLzoINsGQVw" } }
    }
  ]
}
```

`backend/tests/fixtures/youtube_playlist.json` — a `playlistItems.list` response with two items and no `nextPageToken`:

```json
{
  "items": [
    { "contentDetails": { "videoId": "vid1", "videoPublishedAt": "2026-05-01T12:00:00Z" } },
    { "contentDetails": { "videoId": "vid2", "videoPublishedAt": "2026-04-15T12:00:00Z" } }
  ]
}
```

`backend/tests/fixtures/youtube_videos.json` — a `videos.list` response:

```json
{
  "items": [
    {
      "id": "vid1",
      "snippet": { "title": "How Are Bonds Taxed in India?", "publishedAt": "2026-05-01T12:00:00Z", "tags": ["bonds", "taxation"], "categoryId": "27", "channelId": "UCPHv636tYhtARLzoINsGQVw", "description": "d" },
      "statistics": { "viewCount": "8053", "likeCount": "90", "commentCount": "7" },
      "contentDetails": { "duration": "PT3M20S" }
    },
    {
      "id": "vid2",
      "snippet": { "title": "Bond Basics Explained", "publishedAt": "2026-04-15T12:00:00Z", "tags": ["bonds"], "categoryId": "27", "channelId": "UCPHv636tYhtARLzoINsGQVw", "description": "d" },
      "statistics": { "viewCount": "462", "likeCount": "5", "commentCount": "1" },
      "contentDetails": { "duration": "PT45S" }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`backend/tests/test_youtube_client.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_youtube_client.py -v`
Expected: FAIL — `ModuleNotFoundError: services.integrations.youtube`.

- [ ] **Step 4: Implement the client**

`backend/services/integrations/youtube.py`:

```python
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
    resp.raise_for_status()
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
        for item in data.get("items", []):
            video_ids.append(item["contentDetails"]["videoId"])
        page_token = data.get("nextPageToken")
        if not page_token or len(video_ids) >= MAX_VIDEOS:
            break

    videos: list[dict] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        data = _get(client, "/youtube/v3/videos", {
            "part": "snippet,statistics,contentDetails",
            "id": ",".join(batch),
            "key": api_key,
        })
        for it in data.get("items", []):
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_youtube_client.py -v`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/services/integrations/youtube.py backend/tests/test_youtube_client.py backend/tests/fixtures/youtube_*.json
git commit -m "feat: add YouTube Data API v3 client for FRA tracker"
```

---

## Task 2: Video classification

**Files:**
- Create: `backend/services/integrations/fra_classify.py`
- Test: `backend/tests/test_fra_classify.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_classify.py`:

```python
from services.integrations.fra_classify import classify_video


def test_category_from_keywords():
    assert classify_video("How Are Bonds Taxed in India?", ["taxation"])["category"] == "Taxation"
    assert classify_video("YTM vs Coupon Rate Explained", [])["category"] == "Bond Basics"
    assert classify_video("Are Corporate Bonds Really Safe?", ["risk"])["category"] == "Risk/Safety"
    assert classify_video("Random vlog", [])["category"] == "Other"


def test_title_pattern_flags():
    r = classify_video("How to Earn ₹12,000/Month?", [])
    assert r["is_question_title"] is True
    assert r["has_rupee_or_number"] is True
    assert r["title_length"] == len("How to Earn ₹12,000/Month?")

    r2 = classify_video("Bond Basics Explained", [])
    assert r2["is_question_title"] is False
    assert r2["has_rupee_or_number"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_classify.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier**

`backend/services/integrations/fra_classify.py`:

```python
"""Deterministic keyword classification of FRA videos.

Category taxonomy and title-pattern flags follow the Feb 2026 competitive
analysis PDF. "Other" is the fallback. Rules are intentionally simple and
fully covered by tests; tune the keyword lists here when categories drift.
"""
import re

# Ordered: first matching category wins.
CATEGORY_RULES = [
    ("Income Strategy", ["passive income", "monthly income", "income strategy", "bond ladder"]),
    ("Taxation", ["tax", "taxed", "taxation"]),
    ("Risk/Safety", ["safe", "risk", "default", "secure"]),
    ("Myths/Mistakes", ["myth", "mistake", "truth", "lie", "scam"]),
    ("FD Comparison", ["fd ", "fixed deposit", "vs fd", "savings account"]),
    ("Asset Comparison", ["vs stock", "vs mutual", "debt vs", "comparison", " vs "]),
    ("Bond Types", ["g-sec", "government bond", "corporate bond", "sdi", "debenture"]),
    ("Macro/RBI", ["rbi", "inflation", "interest rate", "repo"]),
    ("Grip Platform", ["grip"]),
    ("Bond Basics", ["bond", "ytm", "coupon", "maturity", "yield"]),
]

_QUESTION_OPENERS = ("how", "why", "what", "is", "are", "can", "should", "does", "which")
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]"
)


def classify_video(title: str, tags: list[str]) -> dict:
    haystack = (title + " " + " ".join(tags or [])).lower()
    category = "Other"
    for name, keywords in CATEGORY_RULES:
        if any(k in haystack for k in keywords):
            category = name
            break

    first_word = title.strip().lower().split(" ")[0] if title.strip() else ""
    is_question = first_word in _QUESTION_OPENERS or title.strip().endswith("?")

    return {
        "category": category,
        "is_question_title": is_question,
        "has_rupee_or_number": bool(re.search(r"[₹\d]", title)),
        "has_emoji": bool(_EMOJI.search(title)),
        "title_length": len(title),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_classify.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_classify.py backend/tests/test_fra_classify.py
git commit -m "feat: add FRA video keyword classification"
```

---

## Task 3: Shared test fixture + `build_layer1`

**Files:**
- Create: `backend/tests/fra_fixture.py`
- Create: `backend/services/integrations/fra_youtube.py` (starts here, grows in Tasks 4-10)
- Test: `backend/tests/test_fra_layer1.py`

- [ ] **Step 1: Create the shared sample fixture**

`backend/tests/fra_fixture.py` — reused by every layer2 test:

```python
"""Deterministic sample data for FRA metric tests. Five videos with hand-picked
numbers so every aggregate has a known expected value."""

CHANNEL = {
    "id": "UCPHv636tYhtARLzoINsGQVw",
    "title": "Fixed Returns Academy",
    "handle": "@fixedreturnsacademy",
    "subscriber_count": 1300,
    "total_views": 20000,
    "video_count": 5,
    "joined_date": "2025-07-01T00:00:00Z",
    "uploads_playlist_id": "UUPHv636tYhtARLzoINsGQVw",
    "description": "",
}

# views chosen so: sorted = [100, 400, 1000, 3000, 8000]; sum = 12500
VIDEOS = [
    {"id": "a", "title": "How Are Bonds Taxed in India?", "published_at": "2026-05-10T12:30:00Z",
     "views": 8000, "likes": 80, "comments": 40, "duration_sec": 200, "tags": ["taxation"], "category_id": "27"},
    {"id": "b", "title": "Bond Basics Explained", "published_at": "2026-05-02T03:00:00Z",
     "views": 1000, "likes": 10, "comments": 5, "duration_sec": 45, "tags": ["bond"], "category_id": "27"},
    {"id": "c", "title": "Corporate Bonds vs Fixed Deposit", "published_at": "2026-04-10T13:00:00Z",
     "views": 3000, "likes": 30, "comments": 15, "duration_sec": 700, "tags": ["fd"], "category_id": "27"},
    {"id": "d", "title": "Passive Income With Bonds", "published_at": "2026-04-05T13:00:00Z",
     "views": 400, "likes": 4, "comments": 2, "duration_sec": 90, "tags": ["passive income"], "category_id": "27"},
    {"id": "e", "title": "Random Update", "published_at": "2026-03-01T13:00:00Z",
     "views": 100, "likes": 1, "comments": 0, "duration_sec": 30, "tags": [], "category_id": "27"},
]
```

- [ ] **Step 2: Write the failing test**

`backend/tests/test_fra_layer1.py`:

```python
from services.integrations.fra_youtube import build_layer1
from tests.fra_fixture import CHANNEL, VIDEOS


def test_build_layer1_shapes_rows():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")

    chan = layer1["channel_snapshots"]
    assert len(chan) == 1
    assert chan[0]["snapshot_date"] == "2026-05-18"
    assert chan[0]["channel_handle"] == "@fixedreturnsacademy"
    assert chan[0]["subscribers"] == 1300

    vids = layer1["video_snapshots"]
    assert len(vids) == 5
    a = next(v for v in vids if v["video_id"] == "a")
    assert a["snapshot_date"] == "2026-05-18"
    assert a["channel_handle"] == "@fixedreturnsacademy"
    assert a["views"] == 8000
    assert a["category"] == "Taxation"
    assert a["is_question_title"] is True
    assert a["tags"] == "taxation"          # list joined for CSV storage
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_layer1.py -v`
Expected: FAIL — `services.integrations.fra_youtube` not found.

- [ ] **Step 4: Implement `build_layer1`**

`backend/services/integrations/fra_youtube.py`:

```python
"""FRA YouTube metric builder — analog of grip_connect.py.

build_layer1: raw channel + per-video snapshot rows (with classification).
build_layer2: derived metric tables (added in later tasks).

Every row carries snapshot_date and channel_handle. Lists (tags) are joined
to comma strings so they survive CSV round-trips.
"""
from services.integrations.fra_classify import classify_video

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_layer1.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/fra_fixture.py backend/tests/test_fra_layer1.py
git commit -m "feat: add FRA layer1 snapshot builder"
```

---

## Task 4: Metric helpers + `overview` table

**Files:**
- Create: `backend/services/integrations/fra_metrics.py`
- Modify: `backend/services/integrations/fra_youtube.py` (add `build_overview`)
- Test: `backend/tests/test_fra_metrics.py`, `backend/tests/test_fra_overview.py`

- [ ] **Step 1: Write the failing helper test**

`backend/tests/test_fra_metrics.py`:

```python
from services.integrations.fra_metrics import gini, percentile, median


def test_median():
    assert median([100, 400, 1000, 3000, 8000]) == 1000
    assert median([1, 3]) == 2.0
    assert median([]) == 0


def test_percentile():
    data = [100, 400, 1000, 3000, 8000]
    assert percentile(data, 0) == 100
    assert percentile(data, 100) == 8000
    assert percentile(data, 50) == 1000


def test_gini_known_values():
    assert gini([5, 5, 5, 5]) == 0.0          # perfectly equal
    assert round(gini([0, 0, 0, 100]), 3) == 0.750
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_metrics.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

`backend/services/integrations/fra_metrics.py`:

```python
"""Pure numeric helpers for FRA metric tables. No I/O, no domain logic."""


def median(values):
    xs = sorted(values)
    n = len(xs)
    if n == 0:
        return 0
    mid = n // 2
    return xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) / 2


def percentile(values, pct):
    """Linear-interpolation percentile. pct in [0, 100]."""
    xs = sorted(values)
    if not xs:
        return 0
    if len(xs) == 1:
        return xs[0]
    rank = (pct / 100) * (len(xs) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(xs) - 1)
    frac = rank - lo
    return xs[lo] + (xs[hi] - xs[lo]) * frac


def gini(values):
    """Gini coefficient: 0 = perfectly equal, 1 = all on one item."""
    xs = sorted(v for v in values if v >= 0)
    n = len(xs)
    total = sum(xs)
    if n == 0 or total == 0:
        return 0.0
    weighted = sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(xs))
    return weighted / (n * total)


def safe_div(num, den):
    return num / den if den else 0.0
```

- [ ] **Step 4: Write the failing `overview` test**

`backend/tests/test_fra_overview.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_overview
from tests.fra_fixture import CHANNEL, VIDEOS


def test_overview_current_snapshot():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_overview(layer1["channel_snapshots"], layer1["video_snapshots"], history=[])
    assert len(rows) == 1
    r = rows[0]
    assert r["subscribers"] == 1300
    assert r["video_count"] == 5
    assert r["avg_views"] == 2500          # 12500 / 5
    assert r["median_views"] == 1000
    assert r["subscribers_delta"] == 0     # no history
    assert r["total_views_delta"] == 0


def test_overview_delta_against_history():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    history = [{"channel_handle": "@fixedreturnsacademy", "snapshot_date": "2026-05-11",
                "subscribers": 1200, "total_views": 18000}]
    rows = build_overview(layer1["channel_snapshots"], layer1["video_snapshots"], history=history)
    assert rows[0]["subscribers_delta"] == 100
    assert rows[0]["total_views_delta"] == 2000
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_fra_overview.py -v`
Expected: FAIL — `build_overview` not defined.

- [ ] **Step 6: Implement `build_overview`**

Append to `backend/services/integrations/fra_youtube.py`:

```python
from services.integrations.fra_metrics import median, safe_div


def _latest_prior(history, handle):
    """Most recent history row for a channel, by snapshot_date."""
    rows = [h for h in history if h["channel_handle"] == handle]
    return max(rows, key=lambda h: h["snapshot_date"]) if rows else None


def build_overview(channel_rows, video_rows, history) -> list[dict]:
    """One row per channel: headline figures + delta vs the prior snapshot."""
    out = []
    for ch in channel_rows:
        handle = ch["channel_handle"]
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        views = [v["views"] for v in vids]
        durations = [v["duration_sec"] for v in vids]
        prior = _latest_prior(history, handle)
        out.append({
            "channel_handle": handle,
            "snapshot_date": ch["snapshot_date"],
            "subscribers": ch["subscribers"],
            "total_views": ch["total_views"],
            "video_count": ch["video_count"],
            "avg_views": round(safe_div(sum(views), len(views)), 1),
            "median_views": median(views),
            "avg_duration_sec": round(safe_div(sum(durations), len(durations)), 1),
            "subscribers_delta": ch["subscribers"] - prior["subscribers"] if prior else 0,
            "total_views_delta": ch["total_views"] - prior["total_views"] if prior else 0,
        })
    return out
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_metrics.py tests/test_fra_overview.py -v`
Expected: PASS — 5 tests.

- [ ] **Step 8: Commit**

```bash
git add backend/services/integrations/fra_metrics.py backend/services/integrations/fra_youtube.py backend/tests/test_fra_metrics.py backend/tests/test_fra_overview.py
git commit -m "feat: add FRA metric helpers and overview table"
```

---

## Task 5: `distribution` table (north-star, Gini, percentiles, thresholds)

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py` (add `build_distribution`)
- Test: `backend/tests/test_fra_distribution.py`

**Definition note:** `breakout_1k_rate` = fraction of videos published in the trailing 30 days (relative to `snapshot_date`) with `views >= 1000`. This is the v1 north-star; once snapshot history matures it can be tightened to a fixed N-day-after-publish window (spec §14, proposed 14 days).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_distribution.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_distribution
from tests.fra_fixture import CHANNEL, VIDEOS


def test_distribution_thresholds_and_concentration():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_distribution(layer1["video_snapshots"])
    r = rows[0]
    # views sorted: [100, 400, 1000, 3000, 8000]
    assert r["videos_ge_1k"] == 3           # 1000, 3000, 8000
    assert r["videos_ge_10k"] == 0
    assert r["p50_views"] == 1000
    assert r["p90_views"] == 6000           # interpolated between 3000 and 8000
    assert 0 < r["gini"] < 1


def test_breakout_rate_uses_trailing_30d():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_distribution(layer1["video_snapshots"])
    # Published within 30d of 2026-05-18: video a (May 10, 8000) and b (May 2, 1000).
    # Both >= 1000 -> rate 1.0.
    assert rows[0]["breakout_1k_rate"] == 1.0
    assert rows[0]["recent_video_count"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_distribution.py -v`
Expected: FAIL — `build_distribution` not defined.

- [ ] **Step 3: Implement `build_distribution`**

Append to `backend/services/integrations/fra_youtube.py`:

```python
from datetime import datetime, timedelta
from services.integrations.fra_metrics import gini, percentile, safe_div


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_distribution.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_distribution.py
git commit -m "feat: add FRA distribution table with 1K-breakout north-star"
```

---

## Task 6: `category_mix` + `monthly_views` tables

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_content.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_content.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_category_mix, build_monthly_views
from tests.fra_fixture import CHANNEL, VIDEOS


def test_category_mix_aggregates():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_category_mix(layer1["video_snapshots"])
    by_cat = {r["category"]: r for r in rows}
    # channel avg views = 12500 / 5 = 2500
    tax = by_cat["Taxation"]                     # video a, 8000 views
    assert tax["video_count"] == 1
    assert tax["avg_views"] == 8000
    assert tax["pct_of_library"] == 20.0
    assert tax["perf_vs_mean_pct"] == 220.0      # 8000/2500 - 1 = 2.2


def test_monthly_views_groups_by_publish_month():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_monthly_views(layer1["video_snapshots"])
    by_month = {r["month"]: r for r in rows}
    assert by_month["2026-05"]["total_views"] == 9000   # a 8000 + b 1000
    assert by_month["2026-05"]["video_count"] == 2
    assert by_month["2026-04"]["total_views"] == 3400   # c 3000 + d 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_content.py -v`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement both builders**

Append to `backend/services/integrations/fra_youtube.py`:

```python
from collections import defaultdict


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_content.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_content.py
git commit -m "feat: add FRA category-mix and monthly-views tables"
```

---

## Task 7: `engagement_breakdown` table

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_engagement.py`

**Definition note:** engagement rate = `(likes + comments) / views * 100`. Duration buckets: `short` ≤ 60s, `medium` 61-600s, `long` > 600s.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_engagement.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_engagement_breakdown
from tests.fra_fixture import CHANNEL, VIDEOS


def test_engagement_overall_and_by_duration():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_engagement_breakdown(layer1["video_snapshots"])
    by_dim = {(r["dimension"], r["bucket"]): r for r in rows}

    # overall: likes 125 + comments 62 = 187 over 12500 views -> 1.496%
    overall = by_dim[("overall", "all")]
    assert overall["engagement_rate_pct"] == 1.496

    # video b (45s) and d (90s) and e (30s) -> short bucket: b,e
    short = by_dim[("duration", "short")]
    assert short["video_count"] == 2          # b (45s), e (30s)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_engagement.py -v`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement `build_engagement_breakdown`**

Append to `backend/services/integrations/fra_youtube.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_engagement.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_engagement.py
git commit -m "feat: add FRA engagement-breakdown table"
```

---

## Task 8: `posting_patterns` table

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_posting.py`

**Definition note:** `published_at` is UTC ISO. Convert to IST (UTC+5:30) before extracting weekday/hour. Rows have `dimension` = `day` (weekday name) or `hour` (IST hour 0-23).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_posting.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_posting_patterns
from tests.fra_fixture import CHANNEL, VIDEOS


def test_posting_patterns_converts_to_ist():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_posting_patterns(layer1["video_snapshots"])
    hours = {r["bucket"]: r for r in rows if r["dimension"] == "hour"}
    # video b published 2026-05-02T03:00:00Z -> 08:30 IST -> hour bucket "8"
    assert "8" in hours
    # video a published 2026-05-10T12:30:00Z -> 18:00 IST -> hour bucket "18"
    assert "18" in hours
    days = {r["bucket"]: r for r in rows if r["dimension"] == "day"}
    assert sum(d["video_count"] for d in days.values()) == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_posting.py -v`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement `build_posting_patterns`**

Append to `backend/services/integrations/fra_youtube.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_posting.py -v`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_posting.py
git commit -m "feat: add FRA posting-patterns table"
```

---

## Task 9: `title_patterns` + `catalog_health` tables

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_titles_catalog.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_titles_catalog.py`:

```python
from services.integrations.fra_youtube import (
    build_layer1, build_title_patterns, build_catalog_health,
)
from tests.fra_fixture import CHANNEL, VIDEOS


def test_title_patterns_counts_flags():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_title_patterns(layer1["video_snapshots"])
    by_pat = {r["pattern"]: r for r in rows}
    # "How Are Bonds Taxed in India?" -> question; "Passive Income With Bonds" no
    assert by_pat["question_title"]["video_count"] == 1
    assert by_pat["question_title"]["avg_views"] == 8000


def test_catalog_health_recent_vs_alltime():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_catalog_health(layer1["channel_snapshots"], layer1["video_snapshots"])
    r = rows[0]
    assert r["alltime_avg_views"] == 2500
    # videos published within 30d of 2026-05-18: a (8000), b (1000) -> avg 4500
    assert r["recent_avg_views"] == 4500
    assert r["subscriber_efficiency"] == round(20000 / 1300, 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_titles_catalog.py -v`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement both builders**

Append to `backend/services/integrations/fra_youtube.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_titles_catalog.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_titles_catalog.py
git commit -m "feat: add FRA title-patterns and catalog-health tables"
```

---

## Task 10: `build_layer2` orchestrator

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_layer2.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_layer2.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_layer2
from tests.fra_fixture import CHANNEL, VIDEOS

EXPECTED_TABLES = {
    "overview", "distribution", "category_mix", "monthly_views",
    "engagement_breakdown", "posting_patterns", "title_patterns", "catalog_health",
}


def test_build_layer2_emits_all_tables():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    layer2 = build_layer2(layer1, history={"channel_snapshots": []})
    assert set(layer2.keys()) == EXPECTED_TABLES
    for name, rows in layer2.items():
        assert isinstance(rows, list) and rows, f"{name} is empty"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_layer2.py -v`
Expected: FAIL — `build_layer2` not defined.

- [ ] **Step 3: Implement `build_layer2`**

Append to `backend/services/integrations/fra_youtube.py`:

```python
def build_layer2(layer1: dict, history: dict) -> dict:
    """Derive all metric tables from a layer1 snapshot.

    history: {"channel_snapshots": [prior channel rows]} — used for deltas.
    """
    channel_rows = layer1["channel_snapshots"]
    video_rows = layer1["video_snapshots"]
    chan_history = history.get("channel_snapshots", [])
    return {
        "overview": build_overview(channel_rows, video_rows, chan_history),
        "distribution": build_distribution(video_rows),
        "category_mix": build_category_mix(video_rows),
        "monthly_views": build_monthly_views(video_rows),
        "engagement_breakdown": build_engagement_breakdown(video_rows),
        "posting_patterns": build_posting_patterns(video_rows),
        "title_patterns": build_title_patterns(video_rows),
        "catalog_health": build_catalog_health(channel_rows, video_rows),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_layer2.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_layer2.py
git commit -m "feat: add FRA build_layer2 orchestrator"
```

---

## Task 11: Refresh runner

**Files:**
- Create: `backend/services/integrations/fra_youtube_refresh.py`
- Test: `backend/tests/test_fra_refresh.py`

**How it loads history:** before fetching, it reads the existing
`channel_snapshots.csv` (if present) so `build_overview` can compute deltas. It
upserts every layer1 + layer2 table via `accumulate.upsert_csv`, then writes
`_manifest.json`. Layer2 tables are upserted on `(channel_handle, snapshot_date)`
plus the table's own dimension key, so each refresh fully replaces that day's
derived rows.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_refresh.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_refresh.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runner**

`backend/services/integrations/fra_youtube_refresh.py`:

```python
"""FRA YouTube refresh runner — deterministic, no AI.

Two entry points:
  - run_refresh(...)  : importable; the refresh test and any in-app caller use this.
  - main()            : standalone CLI used by the GitHub Action.

Mirrors services/integrations/refresh.py (the Grip Connect runner).
"""
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from services.integrations.accumulate import upsert_csv
from services.integrations.fra_youtube import build_layer1, build_layer2, CHANNELS
from services.integrations.youtube import resolve_channel, fetch_all_videos

# Natural keys per table for upsert accumulation.
KEYS = {
    "channel_snapshots":    ["channel_handle", "snapshot_date"],
    "video_snapshots":      ["channel_handle", "snapshot_date", "video_id"],
    "overview":             ["channel_handle", "snapshot_date"],
    "distribution":         ["channel_handle", "snapshot_date"],
    "category_mix":         ["channel_handle", "snapshot_date", "category"],
    "monthly_views":        ["channel_handle", "snapshot_date", "month"],
    "engagement_breakdown": ["channel_handle", "snapshot_date", "dimension", "bucket"],
    "posting_patterns":     ["channel_handle", "snapshot_date", "dimension", "bucket"],
    "title_patterns":       ["channel_handle", "snapshot_date", "pattern"],
    "catalog_health":       ["channel_handle", "snapshot_date"],
}


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def _http_fetch(channel_handle: str, api_key: str):
    """Production fetch: real HTTP via httpx."""
    with httpx.Client(timeout=30) as client:
        channel = resolve_channel(client, channel_handle, api_key)
        videos = fetch_all_videos(client, channel["uploads_playlist_id"], api_key)
    return channel, videos


def run_refresh(data_dir, api_key, snapshot_date=None, channels=None, fetch=_http_fetch) -> dict:
    """Fetch -> layer1 -> layer2 -> upsert CSVs + manifest. `fetch` is injectable for tests."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    channels = channels or CHANNELS
    snapshot_date = snapshot_date or datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    log: list[str] = []

    channels_data = [fetch(handle, api_key) for handle in channels]
    layer1 = build_layer1(channels_data, snapshot_date)
    history = {"channel_snapshots": _read_csv(data_dir / "channel_snapshots.csv")}
    layer2 = build_layer2(layer1, history)

    tables = {**layer1, **layer2}
    for name, rows in tables.items():
        upsert_csv(data_dir / f"{name}.csv", rows, key=KEYS[name])
        log.append(f"{name}: {len(rows)} rows")

    now = datetime.now(timezone.utc).isoformat()
    manifest = {"refreshed_at": now,
                "tables": {t: {"last_refreshed_at": now} for t in tables}}
    (data_dir / "_manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"status": "ok", "log": log, "refreshed_at": now}


def main() -> int:
    from dotenv import load_dotenv
    load_dotenv()
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        print("ERROR: set YOUTUBE_API_KEY", file=sys.stderr)
        return 1
    data_dir = Path(os.getenv("DATA_DIR", "./data")) / "fra_youtube"
    result = run_refresh(data_dir, api_key)
    print("\n".join(result["log"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_refresh.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `cd backend && python -m pytest -q`
Expected: PASS — all pre-existing tests plus the new FRA tests.

- [ ] **Step 6: Commit**

```bash
git add backend/services/integrations/fra_youtube_refresh.py backend/tests/test_fra_refresh.py
git commit -m "feat: add FRA YouTube refresh runner"
```

---

## Task 12: Project registration + seed data + config

**Files:**
- Create: `backend/data/fra_youtube/project.json`
- Create: `backend/data/fra_youtube/.gitkeep`
- Modify: `render.yaml`

**Note:** the CSVs are produced by the GitHub Action (Task 13) or a local run of the refresh runner. This task only registers the project shell so `GET /api/projects` lists it; the dashboard renders empty until the first refresh.

- [ ] **Step 1: Create the project metadata**

`backend/data/fra_youtube/project.json`:

```json
{
  "name": "FRA YouTube",
  "description": "Channel-health tracker for Fixed Returns Academy (@FixedReturnsAcademy) — Grip Invest's YouTube channel. Daily YouTube Data API snapshots, 7-lever metrics, trend deltas, and AI insights.",
  "status": "active",
  "tags": ["youtube", "content", "growth", "fra"],
  "dashboard_component": "FraYoutube",
  "refreshable": true,
  "freshness": { "reuse_window_minutes": 1440 },
  "owner": "Puru",
  "chat_context": "FRA YouTube tracks the Fixed Returns Academy YouTube channel (@FixedReturnsAcademy), Grip Invest's own channel. Data comes from the YouTube Data API v3, refreshed daily; every row has a snapshot_date (IST) and channel_handle.\n\nTables:\n- fra_youtube__channel_snapshots: one row per refresh — subscribers, total_views, video_count.\n- fra_youtube__video_snapshots: one row per (video, refresh) — views, likes, comments, duration_sec, tags, category, and title-pattern flags. View counts are cumulative lifetime totals.\n- fra_youtube__overview: headline figures plus week-over-week deltas (subscribers_delta, total_views_delta).\n- fra_youtube__distribution: view-distribution shape — Gini, percentiles, viral thresholds, and breakout_1k_rate (the north-star: share of trailing-30d uploads with >=1000 views).\n- fra_youtube__category_mix: per content category — video_count, pct_of_library, avg_views, perf_vs_mean_pct.\n- fra_youtube__monthly_views: views grouped by publish month.\n- fra_youtube__engagement_breakdown: engagement/like/comment rate overall, by duration bucket, and by category (see the `dimension` column).\n- fra_youtube__posting_patterns: upload counts and avg views by IST posting day and hour.\n- fra_youtube__title_patterns: avg views by title pattern (question opener, rupee/number, emoji).\n- fra_youtube__catalog_health: trailing-30d vs all-time averages, freshness delta, subscriber efficiency.\n\nNotes:\n- View counts are cumulative; 'monthly views' attributes each video's lifetime views to its publish month, it is not true monthly viewership.\n- Retention, impressions CTR, and traffic sources are not available — they need the YouTube Analytics API, which is not yet integrated. Say so rather than guessing."
}
```

- [ ] **Step 2: Keep the data dir tracked**

Create `backend/data/fra_youtube/.gitkeep` (empty file) so the directory exists before the first refresh.

- [ ] **Step 3: Add the YouTube API key env var to `render.yaml`**

In `render.yaml`, under `services[0].envVars`, append:

```yaml
      # YouTube Data API v3 — powers the FRA YouTube refresh.
      - key: YOUTUBE_API_KEY
        sync: false                       # paste in the Render dashboard
```

- [ ] **Step 4: Verify the project is listed**

Run:
```bash
cd backend && python -c "from routers.projects import list_projects; print([p['id'] for p in list_projects()])"
```
Expected: output includes `'fra_youtube'`.

- [ ] **Step 5: Commit**

```bash
git add backend/data/fra_youtube/project.json backend/data/fra_youtube/.gitkeep render.yaml
git commit -m "feat: register fra_youtube project and add YOUTUBE_API_KEY env var"
```

---

## Task 13: GitHub Action — daily refresh

**Files:**
- Create: `.github/workflows/refresh-fra-youtube.yml`

- [ ] **Step 1: Create the workflow**

`.github/workflows/refresh-fra-youtube.yml` (clone of `refresh-grip-connect.yml`):

```yaml
name: Refresh FRA YouTube data

# Durable populator for the FRA YouTube tracker: pulls the YouTube Data API v3
# daily and commits the canonical CSVs so accumulated snapshot history survives
# redeploys (Render's container disk is ephemeral; git is the durable store —
# see docs/specs/2026-05-18-fra-youtube-analytics-design.md).
#
# Security note: the only ${{ }} interpolations are secrets passed via env: and
# python-version. No untrusted github.event.* input is used in any run: step.

on:
  schedule:
    - cron: "30 18 * * *"   # 00:00 IST daily
  workflow_dispatch: {}

permissions:
  contents: write           # required for the commit-back step to push

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install deps
        run: pip install -r backend/requirements.txt
      - name: Run refresh
        working-directory: backend
        env:
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
        run: python -m services.integrations.fra_youtube_refresh
      - name: Commit refreshed data if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add backend/data/fra_youtube/
          git diff --staged --quiet || git commit -m "chore: refresh FRA YouTube data"
          git push
```

- [ ] **Step 2: Verify the YAML parses**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/refresh-fra-youtube.yml'))"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh-fra-youtube.yml
git commit -m "ci: add daily FRA YouTube refresh workflow"
```

- [ ] **Step 4: Manual post-merge step (document, do not execute)**

Add a note to the PR description: a repo admin must add the `YOUTUBE_API_KEY`
secret in GitHub repo settings and in the Render dashboard before the workflow
and the deployed backend can refresh.

---

## Task 14: AI insights endpoint

**Files:**
- Create: `backend/routers/fra_insights.py`
- Modify: `backend/main.py:55-58` (register the router)
- Test: `backend/tests/test_fra_insights.py`

**Design:** `GET /api/projects/fra_youtube/insights` reads the layer2 tables from
DuckDB, builds a compact metrics brief, and asks Claude for strengths /
weaknesses / recommendations / verdict. The result is cached in-process keyed
by the latest `snapshot_date`, so Claude is called at most once per snapshot.
The Claude call is isolated behind `_generate_insights(brief)` so the test can
monkeypatch it.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_fra_insights.py`:

```python
import base64
from fastapi.testclient import TestClient
import routers.fra_insights as mod
from main import app

# BasicAuthMiddleware demo credentials (backend/main.py defaults).
_AUTH = "Basic " + base64.b64encode(b"gripper:unicorn@grip.status").decode()
client = TestClient(app, headers={"Authorization": _AUTH})


def test_insights_endpoint_returns_cached_payload(monkeypatch):
    calls = []

    def fake_generate(brief):
        calls.append(brief)
        return {"verdict": "stub", "strengths": [], "weaknesses": [], "recommendations": []}

    monkeypatch.setattr(mod, "_generate_insights", fake_generate)
    monkeypatch.setattr(mod, "_latest_snapshot_date", lambda: "2026-05-18")
    monkeypatch.setattr(mod, "_build_brief", lambda: {"overview": []})
    mod._CACHE.clear()

    r1 = client.get("/api/projects/fra_youtube/insights")
    r2 = client.get("/api/projects/fra_youtube/insights")
    assert r1.status_code == 200
    assert r1.json()["verdict"] == "stub"
    assert len(calls) == 1          # second call served from cache
```

Note: the `Authorization` header is the demo credential `gripper /
unicorn@grip.status` base64-encoded; `BasicAuthMiddleware` requires it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fra_insights.py -v`
Expected: FAIL — `routers.fra_insights` not found.

- [ ] **Step 3: Implement the router**

`backend/routers/fra_insights.py`:

```python
"""AI narrative insights for the FRA YouTube project.

Reads the layer2 metric tables, asks Claude for a strengths/weaknesses/
recommendations/verdict brief, and caches the result per snapshot_date so
Claude is called at most once per daily refresh. Kept out of the deterministic
refresh runner on purpose — refresh stays AI-free.
"""
import json
import os

from fastapi import APIRouter
from anthropic import Anthropic

from services.duck import db

router = APIRouter()
_CACHE: dict[str, dict] = {}          # snapshot_date -> insights payload

_PROJECT = "fra_youtube"
_BRIEF_TABLES = ["overview", "distribution", "category_mix",
                 "engagement_breakdown", "catalog_health"]


def _latest_snapshot_date() -> str | None:
    try:
        res = db.execute(f"SELECT max(snapshot_date) AS d FROM {_PROJECT}__overview")
        return res["rows"][0]["d"] if res["rows"] else None
    except Exception:
        return None


def _build_brief() -> dict:
    """Compact dict of the latest-snapshot metric rows for Claude."""
    brief = {}
    for table in _BRIEF_TABLES:
        try:
            res = db.execute(
                f"SELECT * FROM {_PROJECT}__{table} "
                f"WHERE snapshot_date = (SELECT max(snapshot_date) FROM {_PROJECT}__{table})"
            )
            brief[table] = res["rows"]
        except Exception:
            brief[table] = []
    return brief


def _generate_insights(brief: dict) -> dict:
    """Call Claude. Returns {verdict, strengths[], weaknesses[], recommendations[]}."""
    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    prompt = (
        "You are a YouTube channel-growth analyst. Given these metric tables for "
        "the Fixed Returns Academy channel, return STRICT JSON with keys "
        "verdict (string), strengths (string[]), weaknesses (string[]), "
        "recommendations (string[]). Each recommendation must name a metric and "
        "an action. No prose outside the JSON.\n\n"
        f"METRICS:\n{json.dumps(brief, default=str)}"
    )
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    text = msg.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1].removeprefix("json").strip()
    return json.loads(text)


@router.get("/fra_youtube/insights")
def get_insights():
    snapshot = _latest_snapshot_date()
    if snapshot is None:
        return {"verdict": "No data yet — run a refresh first.",
                "strengths": [], "weaknesses": [], "recommendations": []}
    if snapshot not in _CACHE:
        _CACHE[snapshot] = _generate_insights(_build_brief())
    return {**_CACHE[snapshot], "snapshot_date": snapshot}
```

- [ ] **Step 4: Register the router in `main.py`**

In `backend/main.py`, add to the imports line (currently
`from routers import projects, upload, chat, refresh`):

```python
from routers import projects, upload, chat, refresh, fra_insights
```

And after the existing `app.include_router(...)` calls (after line 58), add:

```python
app.include_router(fra_insights.router, prefix="/api/projects", tags=["fra-insights"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_fra_insights.py -v`
Expected: PASS — 1 test.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/fra_insights.py backend/main.py backend/tests/test_fra_insights.py
git commit -m "feat: add FRA AI insights endpoint"
```

---

## Task 15: Frontend dashboard

**Files:**
- Create: `frontend/components/dashboards/FraYoutubeDashboard.jsx`
- Modify: `frontend/components/dashboards/index.js`

**Pattern:** follow `AssetSearchDashboard.jsx` — a `classic` dashboard that
receives a `project` prop and fetches data with `POST /api/projects/{id}/query`
SQL calls. Read that file first to copy its data-fetching helper, `Tabs` usage,
and `Card`/`Stat`/`Badge`/Recharts conventions. The dashboard must not hard-code
hex colors — use Tailwind aliases and `chartPalette` from `lib/tokens` (see
`DESIGN.md`).

- [ ] **Step 1: Register the dashboard in the registry**

In `frontend/components/dashboards/index.js`:
- Add the import: `import FraYoutubeDashboard from "./FraYoutubeDashboard";`
- Add to the `DASHBOARDS` object:

```javascript
  FraYoutube: {
    classic: FraYoutubeDashboard,
  },
```

- [ ] **Step 2: Create the dashboard component**

`frontend/components/dashboards/FraYoutubeDashboard.jsx`. Build, following the
`AssetSearchDashboard.jsx` structure:

- A `useQuery(sql)` helper that POSTs to `/api/proxy/api/projects/fra_youtube/query` and returns `{rows}` (copy the helper from `AssetSearchDashboard.jsx`).
- A top `Stat` strip from `fra_youtube__overview` (subscribers, total views, video count, avg views) — each `Stat` shows the `*_delta` as a secondary up/down value. Render an "as of {snapshot_date}" marker near the strip from the overview row's `snapshot_date` (spec §8).
- A `Tabs` block with eight tabs: **Overview, Discovery, Growth, Content fit, Engagement, Cadence, Titles & SEO, Catalog**. Each tab queries its layer2 table and renders a `Card` with a Recharts chart or a table, plus a one-line verdict `Badge`.
  - Discovery: show `breakout_1k_rate` as the headline north-star number, plus the viral-threshold counts and `gini`.
  - Growth: line chart of `monthly_views.total_views` by `month`.
  - Content fit: table of `category_mix` sorted by `perf_vs_mean_pct`, best/worst flagged with `Badge` tone.
  - Engagement: bar chart of `engagement_breakdown` filtered to `dimension = 'category'`.
  - Cadence: bar chart of `posting_patterns` for `dimension = 'day'`.
  - Titles & SEO: table of `title_patterns`.
  - Catalog: `recent_avg_views` vs `alltime_avg_views` with the `freshness_delta_pct`.
- A locked **Retention** panel (a disabled-looking `Card`) with copy: "Retention, impressions CTR, and traffic sources unlock when the YouTube Analytics API is integrated."
- An **AI Insights** section that fetches `GET /api/proxy/api/projects/fra_youtube/insights` and renders `verdict`, `strengths`, `weaknesses`, `recommendations`.
- An empty-state: when `overview` returns no rows, render a `Card` saying "No snapshots yet — trigger a refresh."

- [ ] **Step 3: Verify the build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors referencing `FraYoutubeDashboard`.

- [ ] **Step 4: Manual smoke test**

Run a local refresh to produce real data, then start both servers and open the project:

```bash
cd backend && YOUTUBE_API_KEY=<key> DATA_DIR=./data python -m services.integrations.fra_youtube_refresh
cd backend && uvicorn main:app --reload &
cd frontend && npm run dev
```

Open `http://localhost:3000/projects/fra_youtube`. Confirm: the Stat strip
shows numbers, all eight tabs render, the AI Insights section loads, and "Ask
the data" answers a question (e.g. "which category has the highest avg views").

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboards/FraYoutubeDashboard.jsx frontend/components/dashboards/index.js
git commit -m "feat: add FRA YouTube dashboard"
```

---

## Task 16: Final verification

- [ ] **Step 1: Full backend test suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass, no regressions.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: End-to-end refresh check**

Run a refresh into a scratch dir and confirm all ten CSVs plus `_manifest.json` appear:

```bash
cd backend && YOUTUBE_API_KEY=<key> DATA_DIR=/tmp/fra-check python -m services.integrations.fra_youtube_refresh
ls /tmp/fra-check/fra_youtube/
```
Expected: `channel_snapshots.csv`, `video_snapshots.csv`, the eight layer2 CSVs, `_manifest.json`.

- [ ] **Step 4: Open a pull request**

Use the `pr-creator` skill or `gh pr create`. PR body must include the manual
post-merge step from Task 13 Step 4: add the `YOUTUBE_API_KEY` secret in GitHub
repo settings and in the Render dashboard.

---

## Notes for the implementer

- **TDD throughout the backend.** Every metric builder has its test written first; the `tests/fra_fixture.py` sample data has hand-computed expected values.
- **The dashboard (Task 15) is not TDD'd** — it is verified by `npm run build` and a manual smoke test, matching how the existing Asset Search and Grip Connect dashboards are built.
- **No live API calls in tests.** The YouTube client test uses JSON fixtures; the refresh test injects a fake `fetch`.
- **Deferred (not in this plan):** the competitor comparison tab, the YouTube Analytics API integration, and an editorial dashboard variant — see spec §11.
