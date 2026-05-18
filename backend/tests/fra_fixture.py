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
