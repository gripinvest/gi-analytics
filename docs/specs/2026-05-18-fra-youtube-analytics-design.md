# FRA YouTube Analytics — Design Spec

- **Date:** 2026-05-18
- **Author:** Puru (with Claude)
- **Status:** Approved — ready for implementation planning
- **Project id:** `fra_youtube`

## 1. Summary

A new project inside the grip_analytics platform that tracks the health of the
**Fixed Returns Academy** YouTube channel (`@FixedReturnsAcademy`, Grip Invest's
own channel). It is an *opinionated health tracker for one channel* — not a
generic comparison tool. It recreates the analytical depth of the Feb 2026
"YouTube Channel Competitive Analysis" PDF, FRA-focused, refreshes daily off the
YouTube Data API v3, and pairs every metric with a verdict and an action item.

It is deliberately narrower than `hikaku` (a separate, larger product for
generic two-channel comparison). This project answers one question: *is FRA
getting healthier, and what should we do this week.*

The design clones the platform's existing **Grip Connect** pattern: a
`refreshable` project whose canonical data is populated by a daily GitHub
Action that runs a Python refresh runner and commits CSVs back to the repo
(Render's container disk is ephemeral; git is the durable store — see
`2026-05-17-grip-connect-live-data-design.md` §8).

## 2. Goals and non-goals

**Goals (v1)**
- Daily, automated snapshot of FRA's channel + per-video stats via YouTube Data API v3.
- Persisted snapshot history so the tracker can show *true deltas* (week-over-week
  view velocity, subscriber velocity, decline detection) — something the source
  PDF structurally could not, since the Data API only returns lifetime totals.
- A tabbed dashboard recreating the PDF's metric sections, FRA-only.
- AI-generated narrative insights (strengths / weaknesses / recommendations /
  verdict), refreshed with the data.
- "Ask the data" chat over the YouTube tables (reuses the platform's existing
  Claude-SQL loop).

**Non-goals (deferred)**
- Competitor comparison tab (FRA vs Wint Wealth and others). The data schema
  carries a `channel_handle` column so this is additive, not a rewrite.
- YouTube Analytics API integration (retention, impressions CTR, traffic
  sources, subs gained/lost). Requires YouTube-team approval; until then those
  metrics are shown as an explicitly locked panel.
- An editorial dashboard variant. v1 ships the classic tabbed dashboard only;
  the dashboard registry supports adding editorial later, as Asset Search did.

## 3. Background: the 7 levers of channel health

Industry-standard YouTube channel-health tracking rests on seven levers. This
table records which are measurable with the v1 data source and which wait on
the Analytics API. The UI is honest about the gap (platform principle: say
"not instrumented" when true).

| Lever | Measures | Data API v3 (v1) | Needs Analytics API |
|---|---|---|---|
| 1. Discovery / reach | Is YouTube surfacing the channel | Partial — view-accumulation rate, 1K/10K breakout rate, Gini concentration | Impressions, impressions CTR, traffic-source split |
| 2. Retention | Do viewers keep watching | Not measurable — the blind spot | Avg % viewed, retention curves, Shorts swipe-away |
| 3. Engagement | Does the audience react | Full — like rate, comment rate | Shares, saves |
| 4. Audience growth | Net subscriber health | Partial — net subs/day from snapshot deltas | Subs gained vs lost, returning vs new viewers |
| 5. Cadence | Upload consistency | Full | — |
| 6. Content-market fit | Which topics/formats/durations/titles win | Full | — |
| 7. Catalog health | Threshold coverage, freshness, evergreen accumulation | Full (snapshots make it real) | — |

**North-star metric:** the **1K-view breakout rate** — the share of recent
uploads that cross 1,000 views within N days of publishing. The PDF's "discovery
crisis" (75% of FRA videos never cross 1K) becomes the channel's headline KPI;
snapshot history makes the "within N days" qualifier real.

## 4. Architecture

```
GitHub Actions (daily cron, 00:00 IST)  ──▶  fra_youtube_refresh runner (Python, deterministic)
        │                                          │ pulls Data API v3, classifies, derives
        │                                          ▼
        └── commits CSVs ──▶  backend/data/fra_youtube/*.csv   (git = durable snapshot store)
                                          │ baked by build_duckdb.py at deploy
                                          ▼
                                     DuckDB tables ──▶ "Ask the data" chat (existing Claude-SQL loop)
                                          │
                              FraYoutubeDashboard.jsx ──/query──▶ tabbed dashboard
                                          │
                              insights endpoint + Claude ──▶ AI narrative (cached per snapshot_date)
```

Single language end-to-end (Python for the data path), raw data stays queryable
in DuckDB, git is the audit trail. The whole thing is a near-clone of the Grip
Connect live-data pipeline with the Metabase client swapped for a YouTube client.

### 4.1 Why this fits the platform unchanged

Confirmed by reading the existing code:

- **Project page needs no route work.** `frontend/app/projects/[id]/page.jsx`
  already renders any project: it reads `project.json`, selects a dashboard from
  the `components/dashboards` registry by the `dashboard_component` key, and
  falls back to `GenericDashboard`. FRA = a new data dir + `project.json` + one
  dashboard component + one registry entry.
- **Refresh runner pattern exists.** `services/integrations/refresh.py` is a
  runner with two entry points (the in-app refresh endpoint and standalone
  `python -m`). `services/integrations/accumulate.upsert_csv(path, rows, key)`
  already does atomic snapshot upserts on a natural key. Grip Connect's
  layer1 (raw fetch) / layer2 (derived tables) split is the model.
- **Scheduling pattern exists.** `.github/workflows/refresh-grip-connect.yml`
  is a daily cron Action that runs the refresh and commits CSVs back.
- **DuckDB loading is automatic.** `services/duck.py` materialises every
  `data/<project>/*.csv` into a table `{project_id}__{filename_stem}`;
  `build_duckdb.py` bakes them into a prebuilt `.duckdb` file at deploy time.

## 5. Data source

YouTube **Data API v3** only, for v1. An API key, no OAuth. This is the same
source the Feb 2026 PDF used — confirmed sufficient for every metric the PDF
contains. The PDF's "monthly views" are a reconstruction: each video's lifetime
view count attributed to its publish month. v1 keeps that reconstruction *and*
adds true snapshot deltas on top.

Quota: a full channel pull is ~500 of the 10,000 daily quota units. Daily
refresh is comfortably within budget.

Analytics API (OAuth, owner-only) is deferred until YouTube-team approval; the
architecture leaves room for it (see §11).

## 6. Refresh pipeline (deterministic, no AI)

New modules under `backend/services/integrations/`:

- **`youtube.py`** — YouTube Data API v3 client, the analog of `metabase.py`.
  Functions `resolve_channel(handle, api_key)` and
  `fetch_all_videos(uploads_playlist_id, api_key)`, ported from `hikaku`'s
  `src/lib/youtube/client.ts`. The only module that performs network I/O.
- **`fra_youtube.py`** — the analog of `grip_connect.py`. Holds:
  - `CHANNELS` config — v1 has FRA only (`@FixedReturnsAcademy`); the structure
    accommodates additional handles for the future competitor tab.
  - `build_layer1(client, channels)` — raw snapshot rows + per-video keyword
    classification.
  - `build_layer2(layer1, history)` — derived metric tables (see §7.2). Pure
    functions, unit-tested, with `hikaku`'s `lib/youtube` modules as the formula
    spec.
- **`fra_youtube_refresh.py`** — the refresh runner, a sibling of `refresh.py`.
  Fetches → classifies → derives → upserts CSVs via `accumulate.upsert_csv` →
  writes `_manifest.json`. Two entry points: standalone `python -m` (used by the
  GitHub Action) and importable.

### 6.1 Classification

`build_layer1` assigns each video, deterministically from its title/tags:

- **Content category** — the PDF's taxonomy: Income Strategy, Taxation, Bond
  Basics, Bond Types, Asset Comparison, Risk/Safety, Myths/Mistakes, FD
  Comparison, Macro/RBI, Grip Platform, Shorts, Comparison, Educational, Other.
- **Title-pattern flags** — `is_question_title`, `has_rupee_or_number`,
  `has_emoji`, `title_length`.

Keyword rules are recorded in the spec's appendix during implementation and
covered by unit tests. "Other" is the fallback category.

### 6.2 Scheduling

`.github/workflows/refresh-fra-youtube.yml` — a clone of
`refresh-grip-connect.yml`:
- `schedule: cron: "30 18 * * *"` — 00:00 IST daily.
- `workflow_dispatch` — the manual "refresh now" path.
- Runs `python -m services.integrations.fra_youtube_refresh`, then commits
  `backend/data/fra_youtube/` back to the repo.
- `YOUTUBE_API_KEY` supplied as a GitHub Actions secret; also added to
  `render.yaml` as a `sync: false` env var for the in-app path.

The manual "refresh now" button dispatches this same workflow (via the GitHub
API), so scheduled and manual refresh share one durable path.

## 7. Data model

All CSVs live in `backend/data/fra_youtube/`. Every row carries `snapshot_date`
(the refresh date, IST) and `channel_handle`.

### 7.1 Layer 1 — raw snapshots

- **`channel_snapshots.csv`** — one row per refresh.
  Key: `(channel_handle, snapshot_date)`.
  Columns: `channel_handle, snapshot_date, channel_id, title, subscribers,
  total_views, video_count, joined_date`.
- **`video_snapshots.csv`** — one row per (video, refresh).
  Key: `(video_id, snapshot_date)`.
  Columns: `channel_handle, snapshot_date, video_id, title, published_at,
  views, likes, comments, duration_sec, tags, category, is_question_title,
  has_rupee_or_number, has_emoji, title_length`.

`upsert_csv` makes a same-day re-run idempotent and lets a later refresh
correct an earlier row. History accumulates indefinitely.

### 7.2 Layer 2 — derived metric tables

Computed each refresh from the latest layer-1 snapshot plus history. Small
tables the dashboard reads directly via the `/query` endpoint:

- **`overview.csv`** — channel headline figures + week-over-week deltas
  (subscribers, total views, video count, avg/median views per video, avg
  duration).
- **`monthly_views.csv`** — views by publish month (PDF reconstruction) plus
  the real total-views trend line from snapshot history.
- **`category_mix.csv`** — per content category: video count, % of library,
  avg views, performance vs channel mean.
- **`engagement_breakdown.csv`** — engagement / like / comment rate, broken out
  overall, by duration bucket, and by category.
- **`posting_patterns.csv`** — upload frequency, gap regularity, views by
  posting day and hour (IST), duration-bucket performance.
- **`title_patterns.csv`** — performance by title pattern (question opener,
  ₹/number, emoji, length bucket) and top tags.
- **`distribution.csv`** — Gini coefficient, view percentiles (P10–P95),
  viral-threshold ladder (≥1K / ≥10K / ≥100K), 1K-breakout rate of recent
  uploads (the north-star).
- **`catalog_health.csv`** — last-30-days vs all-time averages, freshness
  delta, subscriber efficiency (views per subscriber).

### 7.3 `project.json`

Mirrors Grip Connect's:

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
  "chat_context": "<describes the fra_youtube__* tables for the chat>"
}
```

## 8. Dashboard

`frontend/components/dashboards/FraYoutubeDashboard.jsx` — classic tabbed
dashboard, registered as `FraYoutube` in `components/dashboards/index.js`.
Built on the existing design system primitives (`Card`, `Stat`, `Tabs`,
`Badge`, Recharts `chartPalette`); queries layer-2 tables via the existing
`POST /api/projects/fra_youtube/query` SQL endpoint.

Eight tabs — an Overview plus one tab per lever — each section ending in a
**verdict + action item**:

1. **Overview** — headline stats with week-over-week snapshot deltas, plus the
   AI verdict summary.
2. **Discovery** — the north-star 1K-breakout rate, Gini, top-10% view share,
   viral-threshold ladder.
3. **Growth** — monthly views by publish month and the real total-views trend
   line from snapshots; lifecycle phase.
4. **Content fit** — category-mix table with best/worst flagged.
5. **Engagement** — overall / like / comment rate, by duration, by category.
6. **Cadence** — upload frequency, gap regularity, best days/hours, duration
   strategy.
7. **Titles & SEO** — title-pattern performance and top tags.
8. **Catalog** — last-30-days vs all-time, freshness delta, subscriber efficiency.

A **Retention** panel is shown as an explicitly locked "unlocked with the
Analytics API" state, honest about lever 2 being dark in v1.

The `_manifest.json` `last_refreshed_at` drives an "as of" marker.

## 9. AI insights

A small backend endpoint runs Claude over the layer-2 tables and produces the
PDF's sections 11–13 live: strengths, weaknesses, recommendations, head-to-head
verdict — each recommendation tied to a lever and a metric. Generated once per
`snapshot_date` and cached; kept separate from the deterministic refresh runner
so that refresh stays AI-free (platform principle: scripts, not AI, for data
extraction).

## 10. Chat

No new chat code. The `fra_youtube__*` tables are materialised in DuckDB like
any other project; the existing Claude-writes-SQL loop in `services/claude.py`
answers natural-language questions, guided by `project.json`'s `chat_context`.

## 11. Extensibility (deferred work, designed-for)

- **Competitor tab** — `channel_handle` is already a column on every row.
  Adding Wint Wealth (and a configurable list) is: more handles in `CHANNELS`,
  competitor rows in the same CSVs, and a comparison tab in the dashboard.
- **Analytics API** — when YouTube-team approval lands, an `analytics.py`
  integration adds owner-only metrics (retention, impressions CTR, traffic
  sources, subs gained/lost). These populate the locked Retention panel and
  enrich Discovery and Audience-growth. No change to the v1 data path.
- **v1.1 metric refinements (deferred during implementation planning).** The
  following §7.2 sub-fields are not built in v1; the eight v1 tables cover the
  core of every lever and the AI-insights narrative compensates in the interim:
  a title-length-bucket grouping and a top-tags aggregation in `title_patterns`;
  upload-frequency / inter-upload-gap-regularity rows in `posting_patterns`
  (v1 ships posting day/hour only); and an explicit lifecycle-phase label.
  The Growth tab's real total-views trend line is served in v1 directly from
  the `channel_snapshots` history table, so `monthly_views` carries only the
  publish-month reconstruction.
- **North-star definition (v1).** `breakout_1k_rate` is computed as the share of
  videos *published in the trailing 30 days* with ≥1,000 views — a single-pull
  proxy. Once snapshot history matures it can be tightened to a true
  N-days-after-publish window (see §14).

## 12. Testing

- **`fra_youtube` metrics (`build_layer1` / `build_layer2`)** — unit tests
  against fixture snapshots; each formula checked against known values, using
  `hikaku`'s `src/lib/youtube` test fixtures as a reference.
- **`youtube.py` client** — tested against a recorded API response fixture;
  tests never hit the live API.
- **Refresh runner** — tests the fetch → classify → derive → upsert flow with a
  mocked client, mirroring `backend/tests/test_grip_connect.py` and
  `test_refresh_runner.py`.

## 13. Deploy flow

GitHub Action at 00:00 IST → refresh runs → commits CSVs → Render auto-redeploys
→ `build_duckdb.py` bakes the new CSVs → fresh data live in ~2-3 minutes.
Manual refresh dispatches the same workflow. One durable path; the brief
deploy-coupling lag is acceptable for a daily tracker and surfaced honestly in
the UI as a "refresh queued" state.

## 14. Open implementation details

Settled during implementation planning, not blockers:

- The exact keyword rules for content-category classification (appendix).
- The N-day window for the 1K-breakout north-star (proposal: 14 days).
- Whether the refresh runner extends `refresh.py` or stays a fully separate
  module (proposal: separate, to keep the Metabase and YouTube paths decoupled).
