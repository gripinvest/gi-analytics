# FRA Editorial Dashboard — Design Spec

- **Date:** 2026-05-18
- **Status:** Approved — ready for implementation
- **Scope:** the editorial-theme rendering of the `fra_youtube` project dashboard. Classic-theme rewrite is a deferred follow-up.

## 1. Goal

Build a bespoke, single-scroll **"Weekly Report"**-style editorial dashboard for the FRA YouTube project, register it as `FraYoutube.editorial` (editorial is the project default), and fix the AI-insights endpoint. It replaces the current tabbed classic-only rendering with a scrolling report that matches the platform's editorial standard (Grip Connect).

## 2. Context

- FRA currently registers only `FraYoutube: { classic: FraYoutubeDashboard }` — a tabbed classic component. In editorial mode the project falls back to `GenericDashboard`. **That fallback is the visible defect.**
- Editorial / classic are **themes**, switched per user preference (`useDesign()` on the project page). A project should ship both renderings, like Asset Search does. This spec delivers editorial; classic is deferred.
- Editorial design system: `frontend/app/editorial.css` — `ed-masthead / ed-headline / ed-section-no / ed-overline / ed-lede / ed-prose / ed-pullnum / ed-stat-num / ed-num`, `ed-rule*`, `ed-figure`, `ed-dropcap`, `ed-set` staggered entrance animation, `ed-skeleton`. Accents: rust (negative), forest (positive), gold (highlight). Fonts: Fraunces (display), Newsreader (body), IBM Plex Mono (figures). `prefers-reduced-motion` already handled.
- Reference implementation: `frontend/components/dashboards/GripConnectDashboardEditorial.jsx` — the editorial idiom (masthead, ruled exhibits, `runQuery`).
- Data: 10 layer-2 tables in DuckDB (`fra_youtube__*`), one committed snapshot (2026-05-18, 203 videos).

## 3. Files

- **New** `frontend/lib/queries/fraYoutube.js` — SQL query specs + a theme-agnostic data hook, extracted from the inline `useFraYoutube` in the current dashboard so the deferred classic rewrite can reuse it.
- **New** `frontend/components/dashboards/FraYoutubeDashboardEditorial.jsx` — the editorial dashboard.
- **Modify** `frontend/components/dashboards/index.js` — register `FraYoutube: { classic: FraYoutubeDashboard, editorial: FraYoutubeDashboardEditorial }`.
- **Modify** `backend/routers/fra_insights.py` — AI-insights fix (§7).

## 4. The Growth data fix

`channel_snapshots` holds one row today and grows by one per daily refresh — a snapshot-delta trend cannot show history retroactively. The history is reconstructable: each video carries `published_at` + lifetime views. The Growth section adds a **cumulative library-views** series via a window function over `monthly_views` (no backend change — `/query` permits `SELECT`):

```sql
SELECT month, total_views,
       SUM(total_views) OVER (ORDER BY month) AS cumulative_views
FROM fra_youtube__monthly_views
WHERE snapshot_date = (SELECT max(snapshot_date) FROM fra_youtube__monthly_views)
ORDER BY month
```

≈10 monthly points (Jul 2025 → now). **Honest caveat shown in the UI:** this is the cumulative lifetime views of videos *published through* month M — a library-accumulation proxy, not the channel's true total view count on that date (older videos keep accruing). The real `channel_snapshots` trend layers on top and grows daily from here.

## 5. Sections (single scroll, editorial exhibits)

Numbered editorial sections (`ed-section-no`), in narrative order. No tabs. A thin sticky section-nav (jump links, `ed-section-link` style) is acceptable as a table-of-contents rail but is optional polish.

1. **Masthead** — "The FRA Weekly" treatment: channel name + handle, dateline (as-of date), the AI headline verdict set as an `ed-lede`.
2. **At a glance** — subscribers / total views / videos / avg & median views / avg duration, with week-over-week delta ticks (rust ▼ / forest ▲). `ed-stat-num`.
3. **Discovery** — the north-star **1K-breakout rate** as an `ed-pullnum`; the viral-threshold ladder (≥1K / ≥10K / ≥100K) as a stepped exhibit; a view-distribution histogram (log-scaled buckets) conveying concentration / the Gini story.
4. **Growth** — cumulative library-views **area chart** (§4, ≈10 points) + monthly-views **bar chart**; both in `ed-figure` frames with `ed-caption`.
5. **Content fit** — category mix as a **scatter plot** (video count × avg views per category) — surfaces the "most-produced vs best-performing" story at a glance — with a ruled table beneath.
6. **Engagement** — **diverging bars** (engagement rate vs channel mean) by category.
7. **Cadence** — **bar charts** by IST posting day and hour.
8. **Titles & SEO** — horizontal **bars**, title-pattern average views.
9. **Catalog health** — recent-30d vs all-time paired stats, freshness delta, subscriber efficiency.
10. **AI Insights** — verdict + strengths / weaknesses / recommendations, editorial-styled lists.

The locked **Retention / Analytics-API panel is removed** — it returns naturally if the Analytics API is integrated later, with no placeholder in the interim.

## 6. Charts & micro-animations

- **Charts:** Recharts (already a dependency). Editorial palette — ink marks on paper with rust/forest/gold accents, **not** the classic navy/teal `chartPalette`. Axes/grid use `--ed-rule-faint`; tooltips are paper-on-ink. Every chart sits in an `.ed-figure` frame with an `ed-caption`.
- **Micro-animations (built with the `emil-design-eng` skill — subtle, restrained):**
  - Section reveal: `ed-set` staggered fade-up, driven on scroll via an IntersectionObserver so sections "set" as they enter the viewport.
  - Hero numbers: a brief count-up on the §3 pull-number on first reveal.
  - Charts: restrained Recharts series easing.
  - Hover: figure-rule and delta-tick emphasis.
  - Everything gated by `prefers-reduced-motion` (the CSS already disables `ed-set` / `ed-skeleton` under it; new JS animations must check it too).

## 7. AI insights fix

The endpoint returns its `_FALLBACK` payload → the Claude call is throwing. The env var is already shared (`ANTHROPIC_API_KEY`); the divergence from the working chat is that `fra_insights.py` constructs its own `Anthropic(...)` client and hardcodes `claude-sonnet-4-6`. Fix:

- Import and reuse `services.claude.client` (the proven module-level Anthropic client) instead of constructing a new one.
- Use the chat's model constants (`services.claude.MODEL_CHOICES` / `MODEL_FALLBACK`) rather than a hardcoded model id, so insights runs on exactly what "Ask the data" runs on.
- Stop silently swallowing: log the real exception server-side and include a short `error` string in the response payload (alongside the fallback verdict) so a failure is diagnosable from the UI.
- Verify against the live key before shipping.

## 8. Out of scope

Classic-theme rewrite (deferred follow-up), the backend metric pipeline, the refresh runner, the 10 layer-2 tables, and the "Ask the data" chat — all unchanged.

## 9. Testing

- `fra_insights.py` — keep and extend the existing pytest tests (the no-data path, `_extract_json`); add coverage that the shared client is used.
- Editorial dashboard — `npm run build` must pass; visual verification against the live snapshot. No unit tests for JSX, per repo convention.
