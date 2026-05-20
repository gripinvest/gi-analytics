# Performance Grip — design spec

**Date:** 2026-05-20
**Status:** Brainstormed; pending implementation plan
**Owner:** Puru

> Performance Grip is a leadership-facing weekly performance-hygiene dashboard,
> backed by a daily archive of Web Vitals data that outlives New Relic's
> 8-day retention window. v1 prioritises visible continuity (daily trendlines)
> over interpretation. Forensics stays in native New Relic.

---

## 1. Why this project

New Relic Standard plan retains raw browser events (incl. Web Vitals) for **8
days**. Leadership wants visibility into web performance trends over **months
to quarters**, not days. Without an archive, week-over-week and month-over-month
comparisons are impossible — the source data has already aged out.

Performance Grip exists to **persist the numbers before they expire** and
present them in a leadership-grade weekly review surface. The dashboard's job
is not forensics (NR's native dashboards remain the tool for that). The
dashboard's job is *demonstrating attention* — showing that performance is
being tracked, trending visibly, with enough rigour to anchor weekly check-ins
and reassure leadership that engineering is paying attention.

**The cron is load-bearing for the entire project's value.** If the daily
fetch silently fails for 8+ days, that data is permanently gone from both
New Relic and our archive. Failure-loudness is not a nice-to-have.

---

## 2. Audience and non-goals

**Audience.** Grip Invest leadership, weekly review cadence. Engineers may
glance at this for high-level health, but for actual debugging they use NR's
native UI.

**v1 in-scope.**

- Two web Browser apps: **GI Client Static** (pre-login marketing, SEO-driven)
  and **GI Client Web** (post-login investing platform, conversion-driven).
- Web Vitals + supporting metrics: LCP, INP, CLS, FCP, TTFB at p75 and p95;
  page-view count; JS error count.
- Daily archive at `(app × raw page URL × device class × date)` grain.
- Editorial dashboard surface only.

**v1 explicitly out of scope.**

| Item | Why deferred | Target |
|---|---|---|
| Mobile app metrics (NR Mobile product) | Different NR product, different metrics, different shape — would dilute v1 | v2 |
| Classic dashboard surface | Editorial-only is the user's stated v1 priority; Classic when we know what data shape feels like | v1.5 |
| Editorial prose / causal attribution | Requires deploy correlation we don't have; symptom-without-cause prose is worse than a clean chart | v3+ |
| Threshold alerts (LCP > Xs → Slack) | Premature; learn the baseline first | v2 |
| Cross-app comparison charts | Visual complexity high, value unclear before v1 lands | v2+ |
| PDF / CSV export for slide decks | Leadership convenience, not core value | v2 |
| Historical "as of" date picker | Useful for retros, not weekly hygiene | v2 |
| Backfill beyond 8 days | Hard ceiling — NR's retention. Data before launch is permanently lost. | N/A (acknowledged) |

**Not negotiable.** No Slack alerts (matches the FRA/Grip Connect pattern, not
the asset-search outlier); GitHub Actions' built-in email-on-failure remains
the default alerting layer.

---

## 3. Architecture overview

Performance Grip slots into the existing multi-project frame without any
platform-level changes:

```
backend/
  data/performance-grip/
    project.json
    route_patterns.csv          ← config: regex → pattern label (hand-curated)
    daily_web_vitals.csv        ← THE archive (page × device × day grain)

  services/integrations/
    performance_grip.py         ← NEW: project fetch module
    new_relic.py                ← NEW: shared NerdGraph client (mirrors metabase.py)
    refresh.py                  ← MODIFIED: +1 line in REGISTRY

frontend/
  components/dashboards/
    PerformanceGripDashboardEditorial.jsx     ← the dashboard
    performance-grip/                          ← sub-component dir (grows as needed)
      HeroHeadline.jsx
      MetricTrendCard.jsx                      ← the trendline atom (reused 5×)
      MetricTrendGrid.jsx                      ← CWV + Supporting grouping
      AppSwitcher.jsx
      DeviceToggle.jsx
      RouteDrilldown.jsx
      ColdStartBanner.jsx
    index.js                                   ← +1 export

docs/projects/performance-grip/
  README.md
  session-log.md
  data-sources.md             ← actual NRQL queries + schema after discovery
  roadmap.md
  specs/2026-05-20-performance-grip-design.md  ← this file

.github/workflows/
  refresh-performance-grip.yml                  ← near-byte-clone of refresh-grip-connect.yml
```

Three new fetch-layer files (`performance_grip.py`, `new_relic.py`, workflow).
Single line added to `refresh.py`'s REGISTRY. Standard project-scoped frontend.
Editorial only in v1; Classic deferred.

---

## 4. Data layer

### 4.1 Fetch mechanism — NRQL via NerdGraph (GraphQL)

NerdGraph is the only sane choice. NR's Insights Query API is deprecated;
Metrics REST is for pre-aggregated dimensional metrics (not browser events).
Auth via **User API Key**; one POST to
`https://api.newrelic.com/graphql` (US region) or `https://api.eu.newrelic.com/graphql`
(EU region) per query.

`new_relic.py` is the shared client (mirrors `metabase.py`'s shape):

```python
class NewRelicClient:
    def __init__(self, user_api_key: str, account_id: int, region: str = "US"): ...
    def nrql(self, query: str) -> list[dict]:
        """Execute one NRQL query via NerdGraph, return facet rows."""
```

### 4.2 NRQL query shapes — sketched, discovery required

> **⚠️ Implementation gate.** Real query shapes will be locked only after a
> discovery NRQL session against the live NR account. Column names below
> reflect public NR documentation but may differ in this account's schema.

Three queries per app per run, joined in Python by `(app, page_url, device, date)`:

```sql
-- Q1: Web Vitals timings — both p75 and p95 returned by a single percentile() call
SELECT
  percentile(largestContentfulPaint, 75, 95) AS lcp,
  percentile(interactionToNextPaint,  75, 95) AS inp,
  percentile(cumulativeLayoutShift,   75, 95) AS cls,
  percentile(firstContentfulPaint,    75, 95) AS fcp,
  percentile(firstByte,               75, 95) AS ttfb
FROM PageViewTiming
WHERE appName = 'GI Client Static'
SINCE '2026-05-19 00:00:00' UNTIL '2026-05-20 00:00:00' WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT MAX

-- Q2: Page-view volume (denominator)
SELECT count(*) AS page_views
FROM PageView
WHERE appName = 'GI Client Static'
SINCE ... UNTIL ... WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT MAX

-- Q3: JS errors per page
SELECT count(*) AS js_errors
FROM JavaScriptError
WHERE appName = 'GI Client Static'
SINCE ... UNTIL ... WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT MAX
```

Six NRQL calls per daily run (3 queries × 2 apps). Sent in parallel.

**Note on `percentile(field, 75, 95)`.** NRQL's `percentile()` accepts multiple
percentile arguments natively and returns each as an aliased sub-field
(`lcp.75` and `lcp.95`). Zero extra round-trips for the p95 ask.

### 4.3 Storage schema

`backend/data/performance-grip/daily_web_vitals.csv` — primary key
`(date, app, page_url, device)`:

| Column | Type | Example | Notes |
|---|---|---|---|
| `date` | DATE | `2026-05-19` | IST day boundary |
| `app` | TEXT | `gi-client-static` \| `gi-client-web` | canonical slug, set in config |
| `page_url` | TEXT | `/assets/cb-bond-abc-2024` | path only; query string stripped |
| `device` | TEXT | `mobile` \| `desktop` \| `tablet` | NR `deviceType` |
| `page_views` | INT | `47823` | denominator |
| `js_errors` | INT | `12` | from `JavaScriptError` count |
| `lcp_p75_ms` | INT | `2450` | |
| `lcp_p95_ms` | INT | `3920` | |
| `inp_p75_ms` | INT | `180` | |
| `inp_p95_ms` | INT | `420` | |
| `cls_p75` | FLOAT | `0.08` | dimensionless |
| `cls_p95` | FLOAT | `0.21` | |
| `fcp_p75_ms` | INT | `1100` | |
| `fcp_p95_ms` | INT | `2200` | |
| `ttfb_p75_ms` | INT | `320` | |
| `ttfb_p95_ms` | INT | `780` | |
| `fetched_at` | TIMESTAMP | `2026-05-20T00:30:12+05:30` | last write time for the row |

20 columns. Tiny rows. Order-of-magnitude growth: ~200 distinct URLs × 2 devices
× 2 apps × 365 days ≈ 290K rows/year — DuckDB territory, not a scaling concern.

### 4.4 Idempotent daily append

Re-running for a date overwrites cleanly:

1. Read existing `daily_web_vitals.csv` into a DataFrame.
2. Fetch yesterday's data via NRQL (6 queries, parallel).
3. Drop existing rows where `date == yesterday AND app IN (target_apps)`.
4. Append the new rows.
5. Sort by `(date, app, page_url, device)`, write atomically (write to
   `.tmp`, then rename).
6. Update `fetched_at` for written rows.

This makes manual reruns safe (`workflow_dispatch` retries don't double-write),
and supports the backfill flow (§4.5).

### 4.5 Backfill at first run

NR retains 8 days of raw events. **On first run, fetch the last 7 complete
days, not just yesterday.** The Editorial dashboard then has 1 week of
trendline on day 1 — enough that charts aren't a single dot.

The CLI accepts `--since YYYY-MM-DD` for ad-hoc backfill:

```bash
python -m services.integrations.refresh performance_grip --since 2026-05-12
```

This fetches `--since` through yesterday inclusive, day by day, and idempotently
merges each day's rows. The GitHub workflow exposes the same via
`workflow_dispatch.inputs.since`.

### 4.6 URL cleanup rules (the only transformation at fetch time)

To keep raw URLs raw without exploding the row count on UTM-tagged variants:

1. **Strip query strings.** `/checkout?utm_source=email` → `/checkout`.
2. **Strip URL fragments.** `/page#section` → `/page`.
3. **Normalise trailing slashes.** `/about/` → `/about` (except root `/`).
4. **Preserve case by default.** Do **not** lowercase URLs at fetch — the
   site may treat `/Pages` and `/pages` as distinct, and we can't recover the
   distinction once collapsed. If discovery shows the routing layer is
   case-insensitive (e.g. all observed URLs are lowercase already), reconsider
   in implementation.
5. **No path collapsing.** `/assets/cb-bond-abc-2024` stays as-is — collapsing
   to `/assets/[id]` happens *in the dashboard via `route_patterns.csv`*, not
   at fetch.

### 4.7 Verify-at-implementation list

These are accepted as discoverable during implementation, not blocking the spec:

| Unknown | Discovery action |
|---|---|
| Exact NR `appName` values | First impl task: `SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO` |
| Whether `userAgent` is queryable on `PageViewTiming` for bot filtering | Discovery NRQL; if not available, accept noise in v1, add patterns later |
| NR account region (US vs EU endpoint) | Inspect any NR dashboard URL — region is in the subdomain |
| Whether `interactionToNextPaint` is populated (rolled out 2024-Q1, may need NR Browser agent ≥ v1.231) | Spot-check via NR UI before relying on the column |
| Actual top URLs and traffic distribution | Seed `route_patterns.csv` from observed week-1 data |

---

## 5. Cron / deployment

### 5.1 Schedule

```yaml
cron: "45 18 * * *"   # 00:15 IST daily
```

Staggered 15 min after asset-search and fra-youtube (both `30 18`). Avoids the
Render cold-start spike and the GitHub-Actions scheduler-drift collision.

### 5.2 Workflow file — `refresh-performance-grip.yml`

Near-byte clone of `refresh-grip-connect.yml`. Diffs:

- **Env**: `NEW_RELIC_USER_API_KEY`, `NEW_RELIC_ACCOUNT_ID`, `NEW_RELIC_REGION`
  in place of the Metabase trio.
- **Run command**: `python -m services.integrations.refresh performance_grip`.
- **`workflow_dispatch` inputs**: optional `since: "YYYY-MM-DD"` for manual
  backfill within the 8-day window.
- **Commit message**: `"chore: refresh Performance Grip data"`.

```yaml
on:
  schedule: [{cron: "45 18 * * *"}]
  workflow_dispatch:
    inputs:
      since:
        description: "Backfill from date (YYYY-MM-DD). Omit for daily."
        required: false
        type: string
```

### 5.3 Failure handling

Three lines of defence, all using existing infrastructure:

1. **GitHub Actions email-on-failure** (built-in, automatic). Primary alert.
2. **Empty-result detection.** The runner exits non-zero if a successful
   NRQL fetch returned zero rows for the target date — catches the "auth
   silently lost scope, NR app renamed, account migrated regions" failure
   modes that produce successful HTTP responses but no data.
3. **Visible last-fetch timestamp in the dashboard header.** Social-pressure
   layer — leadership sees `"Last data: 2026-05-17"` 3 days stale and asks.

**No Slack alerts.** Matches the FRA YouTube and Grip Connect baseline.
**No separate freshness-check workflow.** Novel infrastructure not warranted
when the three layers above already cover the failure modes within NR's
8-day retention window.

### 5.4 Secrets to add (one-time setup)

In GitHub repo secrets and `backend/.env.example` (gitignored `.env` for local):

| Secret | Value |
|---|---|
| `NEW_RELIC_USER_API_KEY` | NR User API Key with NerdGraph access scope |
| `NEW_RELIC_ACCOUNT_ID` | Numeric account ID |
| `NEW_RELIC_REGION` | `"US"` or `"EU"` |

---

## 6. Editorial dashboard

### 6.1 Information architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Performance Grip                         Last data: 2026-05-19  │
│  [ GI Client Static | GI Client Web ]                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Cold-start banner (only when MIN(date) < 21 days ago):          │
│  "12 days collected. Week-over-week comparisons become           │
│   meaningful from day 21."                                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  This Week                                                       │
│  p75 LCP   2.40s  ↓ 0.12s     p75 INP   180ms  ↑ 12ms            │
│  Page views (7d): 423K        Device:  [ All | Mobile | Desktop] │
└──────────────────────────────────────────────────────────────────┘

═══ Core Web Vitals ═══════════════════════════════════════════════
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ LCP             │  │ INP             │  │ CLS             │
│  p75: 2.40s     │  │  p75: 180ms     │  │  p75: 0.08      │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │ trendline │  │  │  │ trendline │  │  │  │ trendline │  │
│  │ + bands   │  │  │  │ + bands   │  │  │  │ + bands   │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
└─────────────────┘  └─────────────────┘  └─────────────────┘

═══ Supporting metrics ═══════════════════════════════════════════
┌─────────────────────────┐  ┌─────────────────────────┐
│ FCP                     │  │ TTFB                    │
│  p75: 1.10s             │  │  p75: 320ms             │
│  ┌─────────────────┐    │  │  ┌─────────────────┐    │
│  │ trendline       │    │  │  │ trendline       │    │
│  │ + bands         │    │  │  │ + bands         │    │
│  └─────────────────┘    │  │  └─────────────────┘    │
└─────────────────────────┘  └─────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Routes (top 15 by page views, last 7 days)        [expand] ▾    │
│  /                              52K views  LCP 2.1s  INP 165ms   │
│  /assets/[id]                   47K        LCP 2.6s  INP 190ms   │
│  /checkout                       8K        LCP 2.4s  INP 220ms   │
│  ...                                                              │
│  Other pages (38K views)                    —         —          │
└──────────────────────────────────────────────────────────────────┘
```

**Sectional grouping (Core Web Vitals vs Supporting metrics)** is semantically
meaningful — Google's framework treats LCP/INP/CLS as the SEO-ranking trio,
FCP/TTFB as supporting. The grouping also solves the orphan-card problem (5
cards don't divide evenly into 2 or 3 columns) by giving the layout a natural
3+2 shape.

**Mobile-first (375px):** all cards stack to a single column with the section
headers acting as visual breaks. App switcher and device toggle stay sticky
at the top.

### 6.2 The trendline atom (`MetricTrendCard.jsx`)

This component is rendered 5× (once per metric). Each chart shows:

- **30-day window** of daily values (default; expandable later).
- **p75 solid line** — the headline number ("typical user").
- **p75 → p95 spread band** — shaded region between the two percentiles, ~15%
  opacity, same hue as the p75 line. Communicates slow-tail spread as a single
  visual object rather than two competing lines.
- **Web Vitals threshold bands** as the chart background:
  - LCP: ≤2.5s green / 2.5–4.0s amber / >4.0s red
  - INP: ≤200ms green / 200–500ms amber / >500ms red
  - CLS: ≤0.1 green / 0.1–0.25 amber / >0.25 red
  - FCP: ≤1.8s green / 1.8–3.0s amber / >3.0s red
  - TTFB: ≤800ms green / 800–1800ms amber / >1800ms red
  - Bands are very subtle (~5% opacity) — they communicate "this is good /
    needs improvement / poor" without competing with the data.
- **Week-boundary vertical gridlines** at low opacity (~10%).
- **Y-axis** auto-scaled to fit the data with ~20% headroom; threshold bands
  may extend slightly above the data range.
- **Tap/hover tooltip**: exact `p75`, `p95`, `sample_count` for that day.
- **Small inline legend** (top-right of each chart): `── p75   ░░ p75–p95 spread`.

**Tabular numerals** (IBM Plex Mono) for all numbers — prevents layout
shift as values change.

### 6.3 Cold-start handling

Three banner states keyed off `MIN(date)` in the loaded data:

| Data age | Banner text |
|---|---|
| 1–7 days | `"{N} days collected since launch ({date}). Trendlines will fill in over the coming weeks."` |
| 8–20 days | `"{N} days collected. Week-over-week comparisons become meaningful from day 21."` |
| 21+ days | (no banner) |

Trigger is derived, not stored. Removing the banner is automatic.

### 6.4 Route drill-down

Below the trendline grid: a collapsible table.

- **Top 15 routes by 7-day page views**, descending.
- Columns: route pattern, page views (7d), p75 of each metric, week-over-week
  LCP delta (the canonical regression-spotting column).
- Route labels resolved via `route_patterns.csv`:
  - File format: `pattern_regex,label,sort_priority`
  - Lookup: first match wins (priority-ordered).
- The bottom row is **"Other pages"** (not "Unmatched" — leadership-readable).
  Its definition: every URL not in the top 15 patterns by 7-day page views,
  rolled together. Includes both *unmatched* URLs (no pattern hit) and *matched
  patterns that fell outside the top 15*. Its page-view count is itself a
  health signal — if it grows large relative to the top 15, either traffic
  is dispersing or the patterns file needs updating.
- Click a row → expand to show that route's own 30-day LCP-p75 sparkline.
- Default collapsed; opens with a `▾` affordance.

### 6.5 Device toggle (page-level, not per-chart)

A single page-level segmented control: `[ All | Mobile | Desktop ]` in the
hero section. Filters every chart and the drill-down table. Tablet rolled
into "All" only (web traffic is mobile/desktop-dominated; tablet noise
isn't worth a fourth toggle state in v1).

Per-chart device split was considered and rejected: putting 4 lines on each
chart (p75-mobile, p95-mobile, p75-desktop, p95-desktop, plus threshold bands)
makes each card unreadable at a glance. Pulling device to a page-level filter
keeps each chart at constant cognitive load regardless of scope.

### 6.6 Out of scope (v1 dashboard)

- Editorial prose copy beyond the one-line metric definitions ("LCP — time
  until the largest visible element loads").
- Causal attribution ("LCP regressed because of deploy X").
- Cross-app comparison ("Static vs Web on the same chart").
- Threshold-breach alerts.
- PDF / CSV export.
- Date-range picker (locked to "last 30 days" in v1).
- Historical "as of" view.

---

## 7. Error handling and observability

| Failure mode | Detection | Response |
|---|---|---|
| NRQL transient (5xx, timeout) | HTTP status / timeout | Retry 3× with exponential backoff (1s, 4s, 16s) inside `new_relic.py`. |
| Auth failure (401, 403) | HTTP status | Fail loud, no retry. GitHub email surfaces it. |
| Schema mismatch (NRQL columns missing) | KeyError on response parsing | Fail with the missing column name in the log line. |
| Empty result for yesterday | `len(new_rows) == 0` for target date | Exit non-zero. The most insidious silent-failure mode. |
| Partial failure (Q1 ok, Q2 fails) | Per-query exception caught | Do **not** write partial data. All-or-nothing per day. Archive stays consistent. |
| Bot/crawler noise | Inspection of `userAgent` distribution at discovery time | Filter at NRQL `WHERE` if `userAgent` is queryable; else accept in v1, refine in v1.5. |

**Logging.** Structured one-line-per-event in stdout, visible in GitHub
Actions output:

```
[performance_grip] fetched lcp+inp+cls+fcp+ttfb: 184 rows (gi-client-static, 2026-05-19) — 1.2s
[performance_grip] fetched page_views: 184 rows (gi-client-static, 2026-05-19) — 0.4s
[performance_grip] fetched js_errors: 12 rows (gi-client-static, 2026-05-19) — 0.3s
[performance_grip] merged: 184 rows for date=2026-05-19 app=gi-client-static
[performance_grip] write: 12647 total rows → daily_web_vitals.csv
```

No external observability stack. Matches existing project pattern.

---

## 8. Testing

**Unit tests** (`backend/tests/test_performance_grip.py`):

1. NerdGraph response → DataFrame parsing (against a captured JSON fixture).
2. URL cleanup function (query-string stripping, trailing-slash, fragment, casing).
3. Idempotent merge logic (existing rows for `date+app` are replaced cleanly,
   not duplicated).
4. Empty-result detection (returns non-zero status code).

**Integration smoke test** (one-time on first deploy, documented checklist
in `data-sources.md`):

1. Trigger `workflow_dispatch` with `since=8days_ago`.
2. Verify 8 days × ~200 routes × 2 devices × 2 apps ≈ 6.4K rows appended.
3. Manually compare day-N values against NR's native Browser dashboard for
   the same date range. Allow ±2% for sampling differences.
4. Verify the dashboard renders for both apps with the cold-start banner.

**No frontend unit tests.** Matches existing dashboard convention; UI
correctness is validated by inspection.

---

## 9. Future work (post-v1, in rough priority order)

| Version | Item | Trigger |
|---|---|---|
| v1.5 | Classic dashboard surface | After ~30 days of data when we know the data shape feels stable |
| v1.5 | Improve `route_patterns.csv` from observed traffic | Week 4 of operation |
| v2 | Mobile app metrics (NR Mobile product) | Separate effort, separate spec |
| v2 | Threshold-breach Slack alerts | Once baseline understood (~3 months of data) |
| v2 | PDF export for leadership decks | On request |
| v2 | Cross-app comparison view | On request |
| v3 | Editorial prose / weekly summary copy | Only when we have deploy correlation data |
| v3 | Causal attribution (link regressions to deploys) | Requires deploy-tracking integration |

---

## 10. Open questions / discovery checklist

These are accepted as resolvable during implementation; none block the spec.

- [ ] **NR app names** — run `SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO`
      to lock the canonical names. Likely `"GI Client Static"` and `"GI Client Web"`,
      possibly suffixed.
- [ ] **NR region** — confirm US vs EU; sets the GraphQL endpoint.
- [ ] **INP availability** — confirm `interactionToNextPaint` is populated
      (depends on NR Browser agent version, rolled out 2024-Q1).
- [ ] **TTFB field name** — `firstByte` per docs, but some accounts have
      `connectionSetupDuration` instead. Verify by inspecting `keyset()` on
      `PageViewTiming`.
- [ ] **Bot filtering surface** — is `userAgent` queryable on `PageViewTiming`?
      If not, what attributes are available for bot exclusion?
- [ ] **Tablet share** — if tablet traffic is <2% of total, fold into "All"
      only as planned. If higher, reconsider the device toggle.
- [ ] **Initial `route_patterns.csv`** — seed from week-1 observed URLs sorted
      by `page_views`. ~15–25 patterns covering 90%+ of traffic is the target.

---

## 11. Implementation order (rough — detailed plan in writing-plans next)

1. **Discovery NRQL** — manual session against live NR. Capture sample
   responses to fixtures. Lock app names, schema columns, region.
2. **`new_relic.py`** — minimal NerdGraph client with retry/backoff.
3. **`performance_grip.py`** — fetch + merge + write, with the schema from
   step 1. Backed by fixtures from step 1 for unit tests.
4. **Register in `refresh.py` REGISTRY**; standalone CLI works.
5. **`project.json` + `route_patterns.csv` skeleton.**
6. **GitHub workflow** — `refresh-performance-grip.yml`.
7. **Secrets** added to repo (manual one-time).
8. **First workflow_dispatch run with `since=7days_ago`** — populates the
   initial 7-day window (matches §4.5). Verify in DuckDB.
9. **Dashboard component scaffolding** — `PerformanceGripDashboardEditorial.jsx`
   + sub-components. Wired to `daily_web_vitals.csv` via the existing query layer.
10. **`MetricTrendCard.jsx`** with threshold bands, spread band, hover, mobile responsive.
11. **Hero + grouping + drill-down + cold-start banner.**
12. **Manual UAT** at 375px and desktop.
13. **First scheduled cron run** — confirm midnight IST execution lands.
14. **Spot-check against NR native dashboard** for the same date range.

---

## 12. Decisions log

Concrete decisions captured during brainstorming, with the alternative
considered for each (so future readers can re-litigate if context changes):

| Decision | Alternative considered | Why this way |
|---|---|---|
| NRQL via NerdGraph | Metrics REST, Insights Query API | Insights deprecated; Metrics REST is for dimensional metrics not browser events |
| Per (page × device × day) grain | Site-wide rollup; route-pattern collapsed at fetch | Cannot be un-aggregated retroactively; raw grain preserves optionality |
| Raw URL stored, patterns applied in UI | Route patterns at fetch | Storage at the rawest grain that's not noise; patterns evolve, raw stays |
| p75 + p95 both stored | p75 only | Leadership specifically asked for p95 |
| Spread band visual (p75 → p95) | Two separate lines (p75 solid, p95 dashed) | One visual object beats two; story is the *gap*, not the two points |
| Threshold bands behind line | Headline traffic-light badge per metric | Background bands always present; badge would duplicate the chart's signal |
| Section grouping (CWV / Supporting) | Equal 5-card grid | Avoids orphan-card layout; semantically meaningful per Google's framework |
| Device toggle page-level | Per-chart device split | 2 lines + bands per chart already at cognitive limit; 4 lines unreadable |
| Editorial only in v1 | Editorial + Classic | User priority; Editorial layout absorbs drill-down |
| 7-day backfill at first run | Start fresh from tomorrow | Free history; gives day-1 dashboard something to show |
| `since` workflow_dispatch input | Manual code edit to backfill | One-line addition; supports the unique data-loss-on-outage profile |
| No Slack alerts | Slack on failure | FRA YouTube and Grip Connect don't have them; asset-search is the outlier; keep the baseline |
| No separate freshness-check workflow | Daily "is data fresh?" cron | Novel infrastructure; existing layers (GH email + dashboard timestamp + empty-result detection) cover the failure modes |
| "Other pages" bucket label | "Unmatched" / "Uncategorised" | Leadership-readable; engineering-speak avoided |
