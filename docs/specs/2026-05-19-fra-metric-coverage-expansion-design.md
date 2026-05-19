# FRA Metric Coverage Expansion — Design Spec

- **Date:** 2026-05-19
- **Status:** Approved — ready for implementation planning
- **Scope:** the FRA YouTube project — deeper analytical metrics, and a restructure of both dashboard renderings (editorial + classic) from a single scroll into an Overview tab + four themed deep-dive tabs + an AI Insights tab. FRA channel only; the competitive (Wint Wealth) channel is explicitly out of scope.

## 1. Goal

The FRA dashboards currently surface a fraction of what the channel's own data supports. The competitive-analysis report (`docs/specs` reference material) demonstrates the achievable depth — per-video leaderboards, duration-bucket performance, tag/SEO analysis, full distribution percentiles. The pipeline already *fetches* everything needed; `fra_youtube__video_snapshots` stores per-video `title, published_at, views, likes, comments, duration_sec, tags, category`. The gap is in *derived metrics* and in *surfacing*.

This project (a) adds the missing metrics as new backend layer-2 tables, and (b) restructures both dashboards so a single Overview tab carries the whole report while four deep-dive tabs carry the expanded depth.

## 2. Context

- The FRA pipeline (`backend/services/integrations/fra_youtube.py`) builds 10 layer-2 tables from layer-1 channel/video snapshots; CSVs land in `backend/data/fra_youtube/` and `backend/build_duckdb.py` bakes them into `grip.duckdb` as `fra_youtube__{stem}`.
- `/query` is `SELECT`/`WITH`-only — but new *metrics* belong in deterministic-Python transforms (the repo's data discipline), not ad-hoc frontend SQL. The existing 10 tables set that pattern.
- Two dashboard renderings exist as user-switchable **themes**: `FraYoutubeDashboardEditorial.jsx` (the "FRA Weekly" report — the **default**) and `FraYoutubeDashboard.jsx` (classic — secondary). Both are single-scroll today and share the data layer `frontend/lib/queries/fraYoutube.js`.
- Both files are mega-files (editorial ~1400 lines). The restructure is also the opportunity to break them into focused units.

## 3. Backend — new and extended metric tables

New transforms in `backend/services/integrations/fra_youtube.py`, written as CSVs to `backend/data/fra_youtube/`, baked into `grip.duckdb`. Each carries `channel_handle` + `snapshot_date` like the existing tables.

### 3.1 `fra_youtube__duration_buckets` (new)

`build_duration_buckets(video_rows)` — one row per duration bucket.

| Column | Notes |
|--------|-------|
| `bucket` | `0–30s`, `30–60s`, `1–2m`, `2–5m`, `5–10m`, `10–20m`, `20m+` |
| `video_count` | videos whose `duration_sec` falls in the bucket |
| `avg_views` | mean `views` of those videos |
| `engagement_rate_pct` | mean of `(likes + comments) / views * 100` over those videos |

Bucket boundaries are max-inclusive — a video falls in the first bucket whose ceiling it does not exceed (a 30 s video → `0–30s`); the last bucket is open-ended. Powers Content & Format's duration analysis and the engagement-by-duration read.

### 3.2 `fra_youtube__tag_analysis` (new)

`build_tag_analysis(video_rows)` — one row per distinct tag, ranked by frequency, capped at the top 30.

| Column | Notes |
|--------|-------|
| `tag` | a single tag (the `tags` field is a comma-joined string; split and trimmed) |
| `frequency` | number of videos carrying the tag |
| `tag_type` | keyword classifier — one of `product`, `aspirational`, `platform`, `brand`, `educational`, `other`. A deterministic keyword-rule function next to the existing category classifier. |

Powers Cadence & SEO's tag/SEO analysis.

### 3.3 `fra_youtube__upload_cadence` (new)

`build_upload_cadence(video_rows)` — a single channel-level row, computed from video `published_at` dates.

| Column | Notes |
|--------|-------|
| `avg_uploads_per_month` | total videos ÷ months active |
| `avg_gap_days` | mean gap between consecutive uploads |
| `median_gap_days` | median gap between consecutive uploads |
| `longest_gap_days` | largest gap between consecutive uploads |

Powers Cadence & SEO's pacing read.

### 3.4 `fra_youtube__distribution` (extended)

Extend the existing `build_distribution` transform with five columns: `p25_views`, `p75_views`, `p95_views`, `mean_median_ratio` (`avg_views / median_views`), `top10pct_view_share` (share of total views held by the top 10% of videos). Existing columns (`p10_views`, `p50_views`, `p90_views`, `gini`, `videos_ge_*`, `breakout_1k_rate`, …) are unchanged.

### 3.5 No backend change — surfaced from existing tables

These need no new transform; the data is already present and the frontend simply queries or surfaces it:

- **Per-video leaderboards** — `fra_youtube__video_snapshots` already stores `title, published_at, views, likes, comments, category`. New frontend query specs sort it (`ORDER BY views DESC` and by engagement rate, `LIMIT 10`).
- **Like-rate vs comment-rate split** — `fra_youtube__engagement_breakdown` already has `like_rate_pct` / `comment_rate_pct` and an `overall` dimension row; surfaced.
- **Monthly detail** — `fra_youtube__monthly_views` already has `video_count` and `avg_views` per month; MoM % is computed client-side.
- **Channel age** — `fra_youtube__channel_snapshots.joined_date`; surfaced in the masthead.

### 3.6 Pipeline integration

The refresh runner picks up the new transforms; `build_duckdb.py` bakes the new tables (table naming `fra_youtube__{stem}` is automatic from the CSV stem); the committed `grip.duckdb` is rebuilt. Each new transform and the extended `build_distribution` gets a pytest test in the existing `backend/tests/test_fra_*` suite.

## 4. Frontend — the tab restructure

### 4.1 Navigation

Both dashboards become tabbed. Six tabs, fixed order:

1. **Overview** · 2. **Reach & Growth** · 3. **Content & Format** · 4. **Audience** · 5. **Cadence & SEO** · 6. **AI Insights**

Classic reuses the existing `@/components/ui` `Tabs`. Editorial gets a tab strip styled in the "Weekly" idiom (mono labels, ruled, in the spirit of the existing `ed-section-link` rail); the masthead stays above the tab bar, persistent.

### 4.2 File organization

The two mega-files become thin **shells** — tab state, the themed tab bar, and rendering of the active tab. Tab content moves into focused per-theme components:

```
frontend/components/dashboards/
  FraYoutubeDashboard.jsx            ← classic shell (tab nav only)
  FraYoutubeDashboardEditorial.jsx   ← editorial shell (masthead + tab nav)
  fra/
    helpers.js                       ← shared formatters, chart configs, small hooks
    classic/
      OverviewTab.jsx  ReachGrowthTab.jsx  ContentFormatTab.jsx
      AudienceTab.jsx  CadenceSeoTab.jsx   InsightsTab.jsx
    editorial/
      OverviewTab.jsx  ReachGrowthTab.jsx  ContentFormatTab.jsx
      AudienceTab.jsx  CadenceSeoTab.jsx   InsightsTab.jsx
```

`frontend/lib/queries/fraYoutube.js` stays the single shared data layer and gains the new query specs (§4.4). Editorial and classic remain genuinely separate renderings — no cross-theme component sharing; `helpers.js` is per-theme-agnostic utility only (number/date formatters, the `computeTrend` consumers' formatting), not rendering.

### 4.3 Tab contents

- **Overview** — the entire current single-scroll report, every section at its current depth: masthead, At a glance (7 figures, day/week deltas), Discovery, Growth, Content fit, Engagement, Cadence, Titles & SEO, Catalog health. The AI section is condensed to the verdict + top-3 action items. Each section links ("connects") to its deep-dive tab.
- **Reach & Growth** — Discovery + Growth + Catalog health in full, plus: full percentile ladder (P25/P75/P95, mean-median ratio, top-10% view share), monthly detail with MoM %.
- **Content & Format** — Content fit in full, plus: duration-bucket performance, per-video leaderboards (top by views and by engagement).
- **Audience** — Engagement in full, plus: like-rate vs comment-rate split, engagement by video duration.
- **Cadence & SEO** — Cadence + Titles & SEO in full, plus: upload cadence & gap stats, tag-frequency / SEO analysis.
- **AI Insights** — the full verdict + strengths / weaknesses / recommendations.

Both themes render all six tabs. Editorial is built first (it is the default); classic follows.

### 4.4 New data-layer query specs (`fraYoutube.js`)

- `durationBuckets`, `tagAnalysis`, `uploadCadence` — `SELECT * FROM fra_youtube__{table} WHERE snapshot_date = (latest)`.
- `topVideosByViews` — `SELECT title, published_at, views, likes, comments, category FROM fra_youtube__video_snapshots WHERE snapshot_date = (latest) ORDER BY views DESC LIMIT 10`.
- `topVideosByEngagement` — same, ordered by `(likes + comments) / NULLIF(views, 0) DESC`.
- `engagementOverall` — `SELECT * FROM fra_youtube__engagement_breakdown WHERE dimension = 'overall' AND snapshot_date = (latest)`.
- `distribution` is unchanged as a spec — it picks up the five new columns automatically (`SELECT *`).

## 5. Build order

One spec, one phased implementation plan:

1. **Backend** — the three new transforms, the `build_distribution` extension, pytest tests, `grip.duckdb` rebuild.
2. **Data layer** — the new query specs in `fraYoutube.js`.
3. **Editorial restructure** — shell + six editorial tab components (editorial is the default).
4. **Classic restructure** — shell + six classic tab components.
5. **Verify** — `pnpm build`, plus a visual pass over both themes at desktop and 375 px.

Phases 3 and 4 are each substantial; they may ship as separate PRs off this one spec to keep reviews tractable.

## 6. Out of scope

- The competitive (Wint Wealth) channel — no second channel in the pipeline; head-to-head comparison is a separate future project.
- Lifecycle-phase segmentation (launch/plateau/decline) and estimated monthly earnings — noted in the gap analysis but not included (YAGNI / not a real API metric).
- The YouTube Analytics API (retention, traffic sources) — the locked panel stays as-is.
- The backend refresh runner and the layer-1 fetch — unchanged; the new transforms are deterministic Python over data already collected.

## 7. Testing

- **Backend** — pytest coverage for `build_duration_buckets`, `build_tag_analysis`, `build_upload_cadence`, and the extended `build_distribution`, in the existing `backend/tests/test_fra_*` suite. Bucket-boundary edges, the tag classifier, gap math, percentile values against a known fixture.
- **Frontend** — `pnpm build` must pass; visual verification of all six tabs in both themes against the live snapshot. No unit tests for JSX, per repo convention.
