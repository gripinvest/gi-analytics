# FRA Backend Metrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new FRA layer-2 metric tables — `duration_buckets`, `tag_analysis`, `upload_cadence` — and extend the `distribution` table with five percentile/concentration columns, all as deterministic-Python transforms.

**Architecture:** New `build_*` transforms in `fra_youtube.py` following the existing pattern (pure functions over `video_rows`), a tag-type keyword classifier alongside the existing category classifier in `fra_classify.py`, wired into `build_layer2` and the refresh runner's `KEYS` registry. A rebuild script regenerates the committed layer-2 CSVs from accumulated layer-1, and `build_duckdb.py` re-bakes `grip.duckdb`.

**Tech Stack:** Python 3, pytest, DuckDB.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `backend/services/integrations/fra_classify.py` | keyword classifiers | **Modify** — add `classify_tag` |
| `backend/services/integrations/fra_youtube.py` | layer-2 transforms | **Modify** — 3 new `build_*`, extend `build_distribution`, wire `build_layer2` |
| `backend/services/integrations/fra_youtube_refresh.py` | refresh runner | **Modify** — add 3 entries to `KEYS` |
| `backend/tests/test_fra_classify.py` | classifier tests | **Modify** — `classify_tag` cases |
| `backend/tests/test_fra_distribution.py` | distribution tests | **Modify** — percentile-ladder test |
| `backend/tests/test_fra_duration_buckets.py` | new transform test | **Create** |
| `backend/tests/test_fra_tag_analysis.py` | new transform test | **Create** |
| `backend/tests/test_fra_upload_cadence.py` | new transform test | **Create** |
| `backend/tests/test_fra_layer2.py` | orchestration test | **Modify** — assert new keys present |
| `backend/rebuild_fra_layer2.py` | regenerate layer-2 CSVs from layer-1 | **Create** |

Tests run from `backend/` with the project venv: `cd backend && .venv/bin/python -m pytest …`. `fra_fixture.py` provides `CHANNEL` + `VIDEOS` (5 videos: views sorted `[100, 400, 1000, 3000, 8000]`; durations `30, 45, 90, 200, 700`; published `2026-03-01 … 2026-05-10`).

---

## Task 1: Tag-type classifier

**Files:**
- Modify: `backend/services/integrations/fra_classify.py`
- Test: `backend/tests/test_fra_classify.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_fra_classify.py`:

```python
from services.integrations.fra_classify import classify_tag


def test_classify_tag_types():
    assert classify_tag("bond") == "product"
    assert classify_tag("fd") == "product"
    assert classify_tag("passive income") == "aspirational"
    assert classify_tag("youtube shorts") == "platform"
    assert classify_tag("grip") == "brand"
    assert classify_tag("taxation") == "other"
    assert classify_tag("") == "other"
    assert classify_tag("  BOND  ") == "product"   # trimmed + lowercased
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_classify.py::test_classify_tag_types -v`
Expected: FAIL — `ImportError: cannot import name 'classify_tag'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/services/integrations/fra_classify.py`:

```python
# Ordered: first matching tag type wins. "other" is the fallback.
TAG_TYPE_RULES = [
    ("platform", ["youtube", "shorts", "ytshort", "ytvideo"]),
    ("brand", ["fixed returns academy", "grip", "finenjy"]),
    ("product", ["bond", "debenture", "fixed income", "fixed return", "g-sec",
                 "government bond", "corporate bond", "sdi", "debt mutual fund",
                 "fd", "fixed deposit"]),
    ("aspirational", ["passive income", "financial freedom", "financial independence",
                      "wealth", "retirement", "money", "salary", "rich",
                      "safe investment"]),
    ("educational", ["how ", "explained", "guide", "basics", "what is", "tutorial"]),
]


def classify_tag(tag: str) -> str:
    """Classify a single SEO tag into a coarse type for the SEO analysis."""
    t = (tag or "").strip().lower()
    if not t:
        return "other"
    for name, keywords in TAG_TYPE_RULES:
        if any(k in t for k in keywords):
            return name
    return "other"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_classify.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_classify.py backend/tests/test_fra_classify.py
git commit -m "feat: add tag-type classifier for FRA SEO analysis"
```

---

## Task 2: `build_tag_analysis` transform

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_tag_analysis.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_fra_tag_analysis.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_tag_analysis
from tests.fra_fixture import CHANNEL, VIDEOS


def test_tag_analysis_counts_and_types():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_tag_analysis(layer1["video_snapshots"])
    # Fixture tags: taxation, bond, fd, passive income (one video each); video e has none.
    assert len(rows) == 4
    by_tag = {r["tag"]: r for r in rows}
    assert by_tag["bond"]["frequency"] == 1
    assert by_tag["bond"]["tag_type"] == "product"
    assert by_tag["fd"]["tag_type"] == "product"
    assert by_tag["passive income"]["tag_type"] == "aspirational"
    assert by_tag["taxation"]["tag_type"] == "other"
    # Ranked by (-frequency, tag) — all freq 1, so alphabetical.
    assert [r["tag"] for r in rows] == ["bond", "fd", "passive income", "taxation"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_tag_analysis.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_tag_analysis'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/integrations/fra_youtube.py`, change the classifier import line:

```python
from services.integrations.fra_classify import classify_video, classify_tag
```

Add this function after `build_title_patterns` (before `build_catalog_health`):

```python
def build_tag_analysis(video_rows, top_n=30) -> list[dict]:
    """Per channel: tag frequency across the library, ranked, capped at top N,
    each with a keyword-classified tag_type. The `tags` field is a comma-joined
    string from build_layer1; it is split and trimmed here."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        counts = defaultdict(int)
        for v in vids:
            for raw in str(v["tags"]).split(","):
                tag = raw.strip().lower()
                if tag:
                    counts[tag] += 1
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]
        for tag, freq in ranked:
            out.append({
                "channel_handle": handle,
                "snapshot_date": snap,
                "tag": tag,
                "frequency": freq,
                "tag_type": classify_tag(tag),
            })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_tag_analysis.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_tag_analysis.py
git commit -m "feat: add build_tag_analysis FRA transform"
```

---

## Task 3: `build_duration_buckets` transform

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_duration_buckets.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_fra_duration_buckets.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_duration_buckets
from tests.fra_fixture import CHANNEL, VIDEOS


def test_duration_buckets_partition_and_averages():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    rows = build_duration_buckets(layer1["video_snapshots"])
    by_bucket = {r["bucket"]: r for r in rows}
    # All seven buckets always emitted, even when empty.
    assert set(by_bucket) == {"0–30s", "30–60s", "1–2m", "2–5m",
                              "5–10m", "10–20m", "20m+"}
    # Fixture durations land one per bucket: 30→0–30s, 45→30–60s, 90→1–2m,
    # 200→2–5m, 700→10–20m. 5–10m and 20m+ stay empty.
    assert by_bucket["0–30s"]["video_count"] == 1
    assert by_bucket["0–30s"]["avg_views"] == 100.0
    assert by_bucket["2–5m"]["video_count"] == 1
    assert by_bucket["2–5m"]["avg_views"] == 8000.0
    assert by_bucket["5–10m"]["video_count"] == 0
    assert by_bucket["5–10m"]["avg_views"] == 0.0
    # Video a (2–5m): 8000 views, 80 likes + 40 comments → 1.5% engagement.
    assert by_bucket["2–5m"]["engagement_rate_pct"] == 1.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_duration_buckets.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_duration_buckets'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/integrations/fra_youtube.py`, add after `build_tag_analysis`:

```python
# Upper-bound-inclusive duration buckets (seconds). A video lands in the first
# bucket whose ceiling it does not exceed; the last bucket is open-ended.
_DURATION_BUCKETS = [
    ("0–30s", 30), ("30–60s", 60), ("1–2m", 120), ("2–5m", 300),
    ("5–10m", 600), ("10–20m", 1200), ("20m+", float("inf")),
]


def _duration_bucket_label(sec) -> str:
    for label, ceiling in _DURATION_BUCKETS:
        if sec <= ceiling:
            return label
    return _DURATION_BUCKETS[-1][0]


def build_duration_buckets(video_rows) -> list[dict]:
    """Per channel: video count, avg views, engagement rate per duration bucket.
    Every bucket is emitted even when empty, so the chart axis is stable."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        groups = defaultdict(list)
        for v in vids:
            groups[_duration_bucket_label(v["duration_sec"])].append(v)
        for label, _ in _DURATION_BUCKETS:
            group = groups.get(label, [])
            views = sum(v["views"] for v in group)
            interactions = sum(v["likes"] + v["comments"] for v in group)
            out.append({
                "channel_handle": handle,
                "snapshot_date": snap,
                "bucket": label,
                "video_count": len(group),
                "avg_views": round(safe_div(views, len(group)), 1),
                "engagement_rate_pct": round(100 * safe_div(interactions, views), 3),
            })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_duration_buckets.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_duration_buckets.py
git commit -m "feat: add build_duration_buckets FRA transform"
```

---

## Task 4: `build_upload_cadence` transform

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py`
- Test: `backend/tests/test_fra_upload_cadence.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_fra_upload_cadence.py`:

```python
from services.integrations.fra_youtube import build_layer1, build_upload_cadence
from tests.fra_fixture import CHANNEL, VIDEOS


def test_upload_cadence_gaps_and_pace():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    r = build_upload_cadence(layer1["video_snapshots"])[0]
    # Published (sorted): 2026-03-01, 04-05, 04-10, 05-02, 05-10.
    # Gaps in days: 35, 5, 22, 8.
    assert r["avg_gap_days"] == 17.5            # (35+5+22+8)/4
    assert r["median_gap_days"] == 15.0         # median of [5, 8, 22, 35]
    assert r["longest_gap_days"] == 35
    # 5 videos across 3 distinct calendar months (Mar, Apr, May).
    assert r["avg_uploads_per_month"] == 1.67   # round(5/3, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_upload_cadence.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_upload_cadence'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/integrations/fra_youtube.py`, add after `build_duration_buckets`:

```python
def build_upload_cadence(video_rows) -> list[dict]:
    """Per channel: upload pacing — uploads per active month and the gaps
    (in days) between consecutive uploads."""
    out = []
    handles = sorted({v["channel_handle"] for v in video_rows})
    for handle in handles:
        vids = [v for v in video_rows if v["channel_handle"] == handle]
        snap = vids[0]["snapshot_date"]
        dates = sorted(_parse_dt(v["published_at"]) for v in vids)
        months = {(d.year, d.month) for d in dates}
        gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        out.append({
            "channel_handle": handle,
            "snapshot_date": snap,
            "avg_uploads_per_month": round(safe_div(len(vids), len(months)), 2),
            "avg_gap_days": round(safe_div(sum(gaps), len(gaps)), 1) if gaps else 0.0,
            "median_gap_days": round(float(median(gaps)), 1) if gaps else 0.0,
            "longest_gap_days": max(gaps) if gaps else 0,
        })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_upload_cadence.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_upload_cadence.py
git commit -m "feat: add build_upload_cadence FRA transform"
```

---

## Task 5: Extend `build_distribution` with the full percentile ladder

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py:103-127`
- Test: `backend/tests/test_fra_distribution.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_fra_distribution.py`:

```python
def test_distribution_full_percentile_ladder():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    r = build_distribution(layer1["video_snapshots"])[0]
    # views sorted: [100, 400, 1000, 3000, 8000]
    assert r["p25_views"] == 400
    assert r["p75_views"] == 3000
    assert r["p95_views"] == 7000            # interpolated 3000 + 0.8*(8000-3000)
    assert r["mean_median_ratio"] == 2.5     # mean 2500 / median 1000
    # Top 10% of 5 videos rounds to 1 video (8000) → 8000 / 12500.
    assert r["top10pct_view_share"] == 0.64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_distribution.py::test_distribution_full_percentile_ladder -v`
Expected: FAIL — `KeyError: 'p25_views'`.

- [ ] **Step 3: Write minimal implementation**

In `build_distribution` (`fra_youtube.py`), add these five keys to the `out.append({...})` dict, immediately after the existing `"p90_views"` line:

```python
            "p25_views": round(percentile(views, 25), 1),
            "p75_views": round(percentile(views, 75), 1),
            "p95_views": round(percentile(views, 95), 1),
            "mean_median_ratio": round(
                safe_div(safe_div(sum(views), len(views)), median(views)), 2),
            "top10pct_view_share": round(safe_div(
                sum(sorted(views, reverse=True)[:max(1, len(views) // 10)]),
                sum(views)), 4),
```

(`median` is already imported in `fra_youtube.py` from `fra_metrics`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_distribution.py -v`
Expected: PASS (both the new test and the pre-existing distribution tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/tests/test_fra_distribution.py
git commit -m "feat: extend FRA distribution with full percentile ladder"
```

---

## Task 6: Wire the new tables into `build_layer2` and the refresh runner

**Files:**
- Modify: `backend/services/integrations/fra_youtube.py:304-321`
- Modify: `backend/services/integrations/fra_youtube_refresh.py:24-35`
- Test: `backend/tests/test_fra_layer2.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_fra_layer2.py`:

```python
def test_layer2_includes_new_metric_tables():
    layer1 = build_layer1([(CHANNEL, VIDEOS)], snapshot_date="2026-05-18")
    layer2 = build_layer2(layer1, history={})
    assert "duration_buckets" in layer2
    assert "tag_analysis" in layer2
    assert "upload_cadence" in layer2
    assert len(layer2["duration_buckets"]) == 7      # one row per bucket
    assert len(layer2["upload_cadence"]) == 1        # one channel-level row
```

If `test_fra_layer2.py` does not already import `build_layer2` / `build_layer1` / the fixture, add at the top:

```python
from services.integrations.fra_youtube import build_layer1, build_layer2
from tests.fra_fixture import CHANNEL, VIDEOS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_fra_layer2.py::test_layer2_includes_new_metric_tables -v`
Expected: FAIL — `assert "duration_buckets" in layer2`.

- [ ] **Step 3: Write minimal implementation**

In `build_layer2` (`fra_youtube.py`), add three entries to the returned dict, after `"catalog_health"`:

```python
        "catalog_health": build_catalog_health(channel_rows, video_rows),
        "duration_buckets": build_duration_buckets(video_rows),
        "tag_analysis": build_tag_analysis(video_rows),
        "upload_cadence": build_upload_cadence(video_rows),
    }
```

In `fra_youtube_refresh.py`, add three entries to the `KEYS` dict, after `"catalog_health"`:

```python
    "catalog_health":       ["channel_handle", "snapshot_date"],
    "duration_buckets":     ["channel_handle", "snapshot_date", "bucket"],
    "tag_analysis":         ["channel_handle", "snapshot_date", "tag"],
    "upload_cadence":       ["channel_handle", "snapshot_date"],
}
```

- [ ] **Step 4: Run the full FRA suite**

Run: `cd backend && .venv/bin/python -m pytest tests/ -k fra -v`
Expected: PASS — all FRA tests, including the new ones and `test_fra_refresh.py` (the refresh runner still upserts every table because each new table now has a `KEYS` entry).

- [ ] **Step 5: Commit**

```bash
git add backend/services/integrations/fra_youtube.py backend/services/integrations/fra_youtube_refresh.py backend/tests/test_fra_layer2.py
git commit -m "feat: wire new FRA metric tables into layer2 + refresh runner"
```

---

## Task 7: Regenerate the committed layer-2 CSVs and `grip.duckdb`

The committed `backend/data/fra_youtube/*.csv` files predate these transforms — they lack the three new tables and the five new `distribution` columns. This task regenerates every layer-2 CSV from the committed layer-1 CSVs (`channel_snapshots.csv`, `video_snapshots.csv`), then re-bakes `grip.duckdb`.

**Files:**
- Create: `backend/rebuild_fra_layer2.py`

- [ ] **Step 1: Write the rebuild script**

Create `backend/rebuild_fra_layer2.py`:

```python
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
```

- [ ] **Step 2: Run the rebuild script**

Run: `cd backend && .venv/bin/python rebuild_fra_layer2.py`
Expected: one `… rebuilt 11 layer-2 tables` line per snapshot_date. `backend/data/fra_youtube/` now contains `duration_buckets.csv`, `tag_analysis.csv`, `upload_cadence.csv`, and a `distribution.csv` carrying the five new columns.

- [ ] **Step 3: Verify the new CSVs**

Run: `cd backend && head -1 data/fra_youtube/distribution.csv data/fra_youtube/duration_buckets.csv data/fra_youtube/tag_analysis.csv data/fra_youtube/upload_cadence.csv`
Expected: `distribution.csv` header includes `p25_views,p75_views,p95_views,mean_median_ratio,top10pct_view_share`; the three new files exist with the documented columns.

- [ ] **Step 4: Re-bake `grip.duckdb`**

Run: `cd backend && .venv/bin/python build_duckdb.py`
Expected: it materialises every `data/*/**.csv` into `grip.duckdb`; the new FRA CSVs become tables `fra_youtube__duration_buckets`, `fra_youtube__tag_analysis`, `fra_youtube__upload_cadence`.

- [ ] **Step 5: Smoke-test the new tables**

Run:
```bash
cd backend && .venv/bin/python -c "import duckdb; con=duckdb.connect('data/grip.duckdb'); print(con.execute(\"SELECT bucket, video_count FROM fra_youtube__duration_buckets ORDER BY snapshot_date DESC LIMIT 7\").fetchall())"
```
Expected: seven `(bucket, count)` tuples for the latest snapshot.

- [ ] **Step 6: Commit**

```bash
git add backend/rebuild_fra_layer2.py backend/data/fra_youtube/
git commit -m "chore: regenerate FRA layer-2 CSVs with new metric tables"
```

Note — if `backend/data/grip.duckdb` is git-tracked (not gitignored), include it in the `git add`; if it is gitignored (rebuilt at deploy/boot), do not.

---

## Self-Review

**Spec coverage** (against §3 of `2026-05-19-fra-metric-coverage-expansion-design.md`):
- §3.1 `duration_buckets` → Task 3 ✓
- §3.2 `tag_analysis` (+ classifier) → Tasks 1–2 ✓
- §3.3 `upload_cadence` → Task 4 ✓
- §3.4 extended `distribution` → Task 5 ✓
- §3.6 pipeline integration (`build_layer2`, `KEYS`, `grip.duckdb` rebuild, pytest) → Tasks 6–7 ✓
- §3.5 (leaderboards, like/comment split, monthly detail, channel age) — no backend change; deliberately deferred to the data-layer plan (Plan 2). Not in scope here.

**Placeholders:** none — every step carries exact code and exact commands.

**Type consistency:** `classify_tag` (Task 1) is consumed by `build_tag_analysis` (Task 2) with a string argument ✓. The three `build_*` names match between their defining task, `build_layer2` (Task 6) and `rebuild_fra_layer2.py` (Task 7) ✓. `KEYS` entries (Task 6) match the table names in `build_layer2`'s dict ✓. The `_LAYER2_TABLES` tuple in Task 7 lists exactly the eight existing + three new layer-2 tables.
