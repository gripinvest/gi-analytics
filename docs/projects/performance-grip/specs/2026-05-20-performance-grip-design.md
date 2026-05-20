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

Performance Grip exists so that **(a) performance trends survive NR's 8-day
retention** and **(b) there is a single weekly artefact that anchors
leadership review and catches regressions before they compound**. The
dashboard's job is not forensics (NR's native dashboards remain the tool for
that). It anchors a cadence — visible weekly review, demonstrated attention
to performance hygiene — without trying to replicate NR's investigation depth.

**Alternatives considered and rejected:** New Relic Data Plus / longer-retention
SKUs (priced for this account tier and rejected on cost); Google CrUX
(unsuitable for `gi-client-web` — post-login, no public traffic, no CrUX
signal); Cloudflare RUM (not in current edge-routing setup).

**The cron is load-bearing for the entire project's value.** If the daily
fetch silently fails for 8+ days, that data is permanently gone from both
New Relic and our archive. The spec mitigates this through twice-daily
scheduling (§5.1), idempotent merge with workflow concurrency (§4.4, §5.2),
and the empty-result detection in §7. Slack alerts are deferred to v1.5
(see §9) — to be added if a real miss occurs in operation.

---

## 2. Audience and non-goals

**Audience.** Grip Invest leadership, weekly review cadence. Engineers may
glance at this for high-level health, but for actual debugging they use NR's
native UI.

**v1 in-scope.**

- Two web Browser apps: **GI Client Static** (pre-login marketing, SEO-driven)
  and **GI Client Web** (post-login investing platform, conversion-driven).
- **5 trended Web Vitals**: LCP, INP, CLS, FCP, TTFB — each at **p75 and p95**.
  Plus two **supporting context** columns stored but not surfaced as their
  own trendline cards: `page_views` (volume denominator) and `js_errors`
  (quality denominator).
- **Hourly archive** at `(app × raw page URL × device class × IST date × IST hour)`
  grain. Daily rollups computed at query time.
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
    hourly_web_vitals.csv       ← THE archive (page × device × hour × day grain)

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

v1 ships Editorial only; Classic deferred to v1.5.

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
> The discovery step (§11, step 1) **must capture a real NerdGraph response
> fixture** before any parser code is written — see C1 below.

We fetch at **hourly granularity** (IST hour buckets). Three query types per
app per hour-window per run, joined in Python by `(date, hour, app, page_url, device)`:

```sql
-- Q1: Web Vitals timings — both p75 and p95 returned per percentile() call
-- Filter ensures null/empty dimensions are dropped at NR rather than in Python.
SELECT
  percentile(largestContentfulPaint, 75, 95) AS lcp,
  percentile(interactionToNextPaint,  75, 95) AS inp,
  percentile(cumulativeLayoutShift,   75, 95) AS cls,
  percentile(firstContentfulPaint,    75, 95) AS fcp,
  percentile(firstByte,               75, 95) AS ttfb,
  count(*)                                    AS sample_count
FROM PageViewTiming
WHERE appName = 'GI Client Static'
  AND pageUrl IS NOT NULL
  AND deviceType IS NOT NULL
SINCE '2026-05-19 00:00:00' UNTIL '2026-05-19 01:00:00'  -- one IST hour bucket
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT 500

-- Q2: Page-view volume (denominator)
SELECT count(*) AS page_views
FROM PageView
WHERE appName = 'GI Client Static'
  AND pageUrl IS NOT NULL AND deviceType IS NOT NULL
SINCE … UNTIL …  -- same hour window as Q1
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT 500

-- Q3: JS errors per page (deviceType may be sparse — verify in discovery)
SELECT count(*) AS js_errors
FROM JavaScriptError
WHERE appName = 'GI Client Static'
  AND pageUrl IS NOT NULL
SINCE … UNTIL …
WITH TIMEZONE 'Asia/Kolkata'
FACET pageUrl, deviceType
LIMIT 500
```

**Query volume:** per cron run, we fetch only the hours that aren't already
in the CSV. Typical case: a 12-hour window since last run = 12 hours × 3
queries × 2 apps = 72 NRQL calls per run. Sent with bounded parallelism (≤8
concurrent). Discovery (§11) will test whether `TIMESERIES 1 hour` collapses
this to one call per app+query+window without losing facet detail — if so,
12× fewer round-trips.

**C1 — Percentile response shape (KNOWN-WRONG IN PUBLIC DOCS).** NerdGraph
returns `percentile(field, 75, 95)` as a **nested object keyed by percentile**,
not as flat aliased columns. The actual shape (verify in discovery):

```json
{ "lcp": { "75": 2450, "95": 3920 }, "inp": { ... }, ... }
```

The parser must unpack this nested shape — the alias only applies to the
outer metric name. Discovery step 1 captures a real response fixture; the
parser is fixture-driven. **No fetch code lands before the fixture is in
the repo.** If the nested-shape parsing turns out to be fragile, fall back
to one `percentile()` call per percentile (10 queries per metric instead of 5).

**C2 — Facet truncation.** NerdGraph caps `FACET` results at 2000 combinations
per query. With `pageUrl × deviceType` at hourly grain we expect ~400 facets
per app per hour, comfortably under the cap — but the cap is silent. The
runner **probes `uniqueCount(pageUrl)` before the main query** and aborts
with a loud error if the result count ≥ 1900 (warning zone) or 2000 (truncated).
This catches a class of "we silently dropped the long tail" failures that the
empty-result detection in §7 cannot.

### 4.3 Storage schema

`backend/data/performance-grip/hourly_web_vitals.csv` — primary key
`(date, hour, app, page_url, device)`. Filename reflects the hourly grain.

| Column | Type | Example | Notes |
|---|---|---|---|
| `date` | DATE | `2026-05-19` | IST day boundary |
| `hour` | INT | `14` | IST hour-of-day, 0–23 |
| `app` | TEXT | `gi-client-static` \| `gi-client-web` | canonical slug, set in config |
| `page_url` | TEXT | `/assets/cb-bond-abc-2024` | path only; query string stripped |
| `device` | TEXT | `mobile` \| `desktop` \| `tablet` | NR `deviceType` |
| `page_views` | INT | `5247` | denominator (this hour) |
| `js_errors` | INT (nullable) | `2` | from `JavaScriptError` count; nullable because `JavaScriptError` may not carry `deviceType` reliably (verify in discovery) |
| `sample_count` | INT | `5247` | row count from `PageViewTiming` — distinct from `page_views` (`PageView` event); flag low-sample rows in dashboard |
| `lcp_p75_ms` | DOUBLE | `2450` | DOUBLE not INT to accept nulls cleanly in DuckDB |
| `lcp_p95_ms` | DOUBLE | `3920` | |
| `inp_p75_ms` | DOUBLE | `180` | INP may be null on older browsers — DOUBLE accepts |
| `inp_p95_ms` | DOUBLE | `420` | |
| `cls_p75` | DOUBLE | `0.08` | dimensionless |
| `cls_p95` | DOUBLE | `0.21` | |
| `fcp_p75_ms` | DOUBLE | `1100` | |
| `fcp_p95_ms` | DOUBLE | `2200` | |
| `ttfb_p75_ms` | DOUBLE | `320` | |
| `ttfb_p95_ms` | DOUBLE | `780` | |
| `fetched_at` | TIMESTAMP | `2026-05-20T00:30:12+05:30` | last write time for the row |

21 columns. Order-of-magnitude growth: ~200 distinct URLs × 2 devices × 24
hours × 2 apps × 365 days ≈ **7M rows/year**. Still trivial in DuckDB. Daily
rollups are computed at query time in the dashboard layer (no separate
`daily_*.csv` file).

**Why hourly, not daily.** Performance has strong time-of-day patterns — peak
traffic windows degrade LCP/TTFB. Daily aggregation throws this away
irrecoverably; the §12-style "store at the rawest grain, aggregate at query
time" principle applies to time as it does to URLs. Cost is ~24× row count,
which DuckDB handles without notice. See §12 Decisions Log.

### 4.4 Idempotent hourly append

Each cron run identifies which hours are missing from the CSV and fetches
only those. Re-running an hour-window overwrites cleanly:

1. Read existing `hourly_web_vitals.csv` into a DataFrame.
2. Compute the **target window**: from `MAX(date, hour)` already in CSV +1
   hour, up to the latest closed hour (current IST hour - 1).
3. For each `(app, hour)` in the target window:
   - Fetch via NRQL Q1/Q2/Q3 for that one-hour bucket (§4.2).
   - On any per-app, per-hour failure: skip just that `(app, hour)` and
     continue (per-app, per-hour all-or-nothing — does not block other apps
     or other hours).
4. **Drop existing rows** where `(date, hour, app)` is in the freshly-fetched
   set.
5. Append the new rows.
6. Sort by `(date, hour, app, page_url, device)`, write atomically (write to
   `.tmp`, then rename).
7. Update `fetched_at` for written rows.

**Concurrency safety (C3).** The workflow declares
`concurrency: { group: refresh-performance-grip, cancel-in-progress: false }`
in §5.2 so only one run executes at a time. Manual `workflow_dispatch`
backfills queue behind the scheduled run rather than racing it.

This makes manual reruns and twice-daily scheduling safe: rerunning an
already-fetched hour produces identical output (idempotent).

### 4.5 Backfill at first run and after outages

NR retains 8 days of raw events. **On first run, backfill the last 7 complete
days (24 hours each = 168 hour-buckets per app per query type).** This gives
the dashboard ~7 days of hourly trendline on day 1.

The CLI accepts `--since YYYY-MM-DD` for ad-hoc backfill:

```bash
python -m services.integrations.refresh performance_grip --since 2026-05-12
```

The runner expands `--since` into every IST hour bucket from that midnight
through the most recent closed hour, idempotently merging as it goes.
**Validation:** the runner rejects `--since` dates that are malformed,
in the future, or older than 8 days (outside NR retention window). The
GitHub workflow exposes this via `workflow_dispatch.inputs.since` (see
§5.2 for input handling).

**The `--since` mechanism is not just for v1 launch.** It is the canonical
**recovery path** for any missed cron day within the 8-day NR window —
operationally important given the spec's twice-daily schedule (§5.1).

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

### 4.7 Data-layer unknowns

(Cross-referenced from §10 open questions. These are data-layer specific
discovery items; see §10 for the full cross-cutting list.)

The full discovery checklist lives in §10. Items below are the data-layer
subset that must be resolved **before any fetch code lands** — they directly
shape `new_relic.py` and `performance_grip.py`:

- Percentile response shape (C1) — capture real fixture, lock parser
- Facet cap behaviour (C2) — verify `uniqueCount(pageUrl)` probe approach
- Hourly bucketing strategy — single `TIMESERIES 1 hour` query vs 24 per-hour queries
- NR `appName` canonical values — `SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO`
- Region endpoint (US vs EU) — inspect any NR dashboard URL

---

## 5. Cron / deployment

### 5.1 Schedule — twice daily

```yaml
on:
  schedule:
    - cron: "30 19 * * *"   # 01:00 IST — captures previous calendar day's complete 24h
    - cron: "30  7 * * *"   # 13:00 IST — intra-day catch-up + GH Actions drift safety net
```

**Why twice daily.** GitHub Actions scheduled crons are best-effort under
platform load (documented drift of 5-30 min, occasional missed runs). For a
project whose data permanently expires after 8 days, single-cron scheduling
is mismatched to the failure profile. The 13:00 IST run is idempotent — it
re-fetches any hours the 01:00 IST run missed, then proceeds to fetch the
morning's closed hours.

Staggered to a different minute (`30`) than asset-search and fra-youtube
(both `30 18`) to avoid the GitHub-Actions scheduler-drift bucketing of all
midnight-IST crons together. (Earlier draft cited "Render cold-start" — that
rationale was wrong since the daily refresh doesn't call Render.)

### 5.2 Workflow file — `refresh-performance-grip.yml`

Cloned from `refresh-grip-connect.yml` with the changes called out below.

- **Schedule**: twice daily (see §5.1).
- **Env**: `NEW_RELIC_USER_API_KEY` (secret), `NEW_RELIC_ACCOUNT_ID` (repo
  variable, not secret — see §5.4), `NEW_RELIC_REGION` (`env:` literal).
- **Run command**: `python -m services.integrations.refresh performance_grip`
  (with optional `--since` from validated input).
- **`workflow_dispatch.inputs.since`**: optional `YYYY-MM-DD` string.
  Validated in Python before any fetch (see "Input validation" below);
  **never interpolated into a shell `run:` step**.
- **Commit message**: `"chore: refresh Performance Grip data"`.
- **Concurrency group** (C3): `concurrency: { group: refresh-performance-grip, cancel-in-progress: false }` — serialises runs so twice-daily schedule + manual backfill cannot race.
- **Job timeout** (H5): `timeout-minutes: 20` — 72 NRQL calls + commit should
  complete in <5 min; 20 is the loud-failure ceiling.
- **Branch guard** (H8): `if: github.ref == 'refs/heads/main'` on the commit-and-push step.

```yaml
name: Refresh Performance Grip data

on:
  schedule:
    - cron: "30 19 * * *"   # 01:00 IST
    - cron: "30  7 * * *"   # 13:00 IST
  workflow_dispatch:
    inputs:
      since:
        description: "Backfill from date (YYYY-MM-DD). Omit for normal fetch."
        required: false
        type: string

concurrency:
  group: refresh-performance-grip
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      NEW_RELIC_USER_API_KEY: ${{ secrets.NEW_RELIC_USER_API_KEY }}
      NEW_RELIC_ACCOUNT_ID:   ${{ vars.NEW_RELIC_ACCOUNT_ID }}
      NEW_RELIC_REGION:       US
      SINCE:                  ${{ inputs.since }}   # passed via env, not interpolated into shell
    steps:
      - uses: actions/checkout@<sha>     # pin to commit SHA (H7), Dependabot bumps
      - uses: actions/setup-python@<sha> # pin to commit SHA
        with: { python-version: "3.12" }
      - name: Install deps
        run: pip install -r backend/requirements.txt
      - name: Run refresh
        working-directory: backend
        # SINCE is read from env and validated against ^\d{4}-\d{2}-\d{2}$ in Python.
        # An empty SINCE means "fetch latest closed hours".
        run: python -m services.integrations.refresh performance_grip
      - name: Commit refreshed data if changed
        if: github.ref == 'refs/heads/main'
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git pull --rebase
          git add backend/data/performance-grip/
          git diff --staged --quiet || git commit -m "chore: refresh Performance Grip data"
          git push
```

**Input validation (H3).** In the Python runner, `SINCE` from env is
validated against `^\d{4}-\d{2}-\d{2}$`, rejected if in the future, and
rejected if older than 8 days (outside NR retention). The workflow never
interpolates `${{ inputs.since }}` into a `run:` shell line — it flows only
through `env:`. This eliminates the shell-injection vector.

**Per-app, per-hour all-or-nothing (H4).** The runner scopes the
transaction to `(app, hour)`, not to the whole run. A transient failure on
one app's NRQL for one hour does not discard successful fetches for the
other app or other hours — partial success is committed and the failed
`(app, hour)` is logged for retry on the next scheduled run (or via
`--since`).

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

### 5.4 Secrets and config (one-time setup)

Following least-privilege and the principle that public config doesn't
belong in secrets:

| Name | Location | Sensitivity | Notes |
|---|---|---|---|
| `NEW_RELIC_USER_API_KEY` | Repo **secret** | High | Use a User API Key tied to a **dedicated service-account user with a read-only NerdGraph role** (or an Insights Query Key if available — see §10 discovery item). Avoid using an engineer's personal key. **Rotate every 90 days.** |
| `NEW_RELIC_ACCOUNT_ID` | Repo **variable** (`vars.NEW_RELIC_ACCOUNT_ID`) | Low | Numeric account ID; not a credential. Repo variable, not secret, so it's visible in workflow runs for debugging. |
| `NEW_RELIC_REGION` | `env:` literal in workflow | None | `"US"` or `"EU"` — public infrastructure choice; no need to hide. |

`backend/.env.example` documents these for local development; `backend/.env`
is gitignored (verify before first commit). Pre-commit secret scanning
(`detect-secrets` or `gitleaks`) is recommended for the repo to catch the
class of "accidentally committed `.env`" failures.

---

## 6. Editorial dashboard

### 6.1 Information architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Performance Grip                         Last data: 2026-05-19  │
│  [ GI Client Static | GI Client Web ]                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Status: Watch ⚠                                                 │
│  INP on mobile crossed 200ms threshold for 3 of last 7 days.     │
│  All other metrics within Good.                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Cold-start banner (only when MIN(date) < 21 days ago):          │
│  "12 days collected. Week-over-week comparisons become           │
│   meaningful from day 21."                                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Data: 12 days collected · viewing last 7d                       │
│  Window: [ 7d | 14d | 1M | 3M ]                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Week of May 12–18                                               │
│  p75 LCP  2.40s ← 2.52s  (-0.12s, −5%)   ✓ Good                  │
│  p75 INP   180ms ← 168ms  (+12ms, +7%)   ⚠ Watch                 │
│  JS errors / 1K page views:  3.2  (was 2.8 last week, +14%)      │
│  Page views (7d): 423K        Device:  [ All | Mobile | Desktop] │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Routes — Top 5 by week-over-week LCP regression       [show 15] │
│  /checkout                  8K views   LCP 2.6s → 3.1s  (+0.5s)  │
│  /assets/[id]              47K         LCP 2.6s → 2.8s  (+0.2s)  │
│  /kyc/[step]                3K         LCP 2.4s → 2.5s  (+0.1s)  │
│  /                         52K         LCP 2.1s → 2.1s  ( 0.0s)  │
│  /portfolio                 9K         LCP 2.0s → 2.0s  ( 0.0s)  │
│  ────────────────────────────────────────────────────────────    │
│  Other pages               38K views  (+12% WoW bucket size)     │
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

**Sectional grouping (Core Web Vitals vs Secondary Web Vitals).** Google's
framework treats LCP/INP/CLS as the SEO-ranking trio; FCP/TTFB are the
secondary timing metrics. (Renamed from "Supporting metrics" to disambiguate
from `page_views` + `js_errors`, which are denominators / quality context,
not metrics in their own right.) The 3+2 grouping also solves the orphan-card
problem on the desktop grid.

**Mobile-first (375px):** all cards stack to a single column with the
section headers acting as visual breaks. App switcher stays sticky at the
top; **header collapses to a 48px strip after the user scrolls past the
status verdict** (IntersectionObserver, not scroll listener). On mobile,
hoist **LCP + INP** into the hero band immediately under the status verdict;
CLS, FCP, TTFB live in an accordion that opens to the full trendline grid.
This keeps the route drill-down within the first viewport.

### 6.1.1 Status verdict — the 30-second answer (C6)

A single rule-based status block sits directly under the page header. It is
the dashboard's top-line answer to the question "is performance OK this
week?". Three states:

| State | Trigger (rule-based, deterministic) |
|---|---|
| **✓ All Good** | Every CWV metric's p75 stayed within the Good threshold all 7 days. |
| **⚠ Watch** | Any CWV metric's p75 crossed into Needs Improvement on ≥1 day; nothing in Poor. |
| **🚨 Needs Attention** | Any CWV metric's p75 landed in Poor on ≥1 day, OR the week-over-week delta on any metric exceeded ±10%. |

Below the badge: a single short sentence stating *why* — derived
mechanically from the worst-performing metric ("INP on mobile crossed 200ms
threshold for 3 of last 7 days"). **No editorial prose generation; no causal
attribution.** Pure rule output.

This is the single most leadership-actionable surface on the page. The
trendlines below become *evidence for* the verdict, not the verdict itself.

### 6.1.2 Hero band — locked comparison window (C7)

The hero compares **this week (last 7 complete days) vs last week (7 days
prior)** — full ISO weeks, not trailing-rolling. The arithmetic is shown
inline: `p75 LCP this week 2.40s ← last week 2.52s (−0.12s, −5%)`. The
direction-of-good is metric-aware:

- LCP / INP / CLS / FCP / TTFB — **lower is better** (`↓` = forest, `↑` = rust)
- Page views — **higher is better** (`↑` = forest, `↓` = rust)
- JS errors / 1K page views — **lower is better** (`↓` = forest, `↑` = rust)

Color and arrow are never used alone — the change value (`+0.12s`) and the
percent are always shown together with the arrow + color. (Reuses the
existing `DeltaInline` / `goodIsDown` pattern from `AssetSearchDashboardEditorial`.)

**JS errors line.** The hero shows `JS errors / 1K page views` as a single
number with its week-over-week delta. This is **not** part of the status
verdict logic in §6.1.1 — the verdict is Web-Vitals-only. JS errors are
shown for informational context. A 6th trendline card for JS errors is
deferred to v1.5 if leadership asks for the deeper view.

### 6.1.3 Time-window toggle — replaces cold-start banner (H18)

A page-level segmented control selects the visualisation window for all
trendlines and the hero band:

```
[ 7d | 14d | 1M | 3M ]
```

**Default** auto-promotes as data accumulates:

| Data collected (`MAX(date) − MIN(date)` in CSV) | Default window |
|---|---|
| Days 1–13 | 7d |
| Days 14–29 | 14d |
| Days 30+ | **30d (1M)** ← terminal default |

The **90d window does not auto-promote** — it remains an opt-in retrospective
view the user explicitly picks (for quarterly review etc).

A small header caption is always visible:

```
Data: {N} days collected · viewing last {window}
```

This replaces the earlier cold-start banner entirely. The caption gives
context without the apologetic tone of a banner; the toggle gives the user
agency. Window state persists in the URL (`?window=14d`).

### 6.1.4 Route drill-down — promoted up, regression-first sort (H12)

The route table is **the dashboard's most leadership-actionable artifact** —
it answers the question NR can't ("which page got worse this week?"). It
therefore sits **directly under the status verdict**, above the trendline
grid.

- **Top 5 expanded by default.** A `[show 15]` expander reveals the full
  top 15. Beyond that, the "Other pages" footer row aggregates everything
  outside the table (with its WoW bucket-size change shown — see H19).
- **Default sort: week-over-week p75 LCP delta, descending.** Biggest
  regressions float to the top.
- **Sort toggle**: secondary controls for page-views and other metrics'
  WoW deltas.
- **Click a row** → expands to the 30-day per-route LCP trendline
  (sparkline with the same Editorial-token threshold band as the main
  trendline cards).

### 6.2 The trendline atom (`MetricTrendCard.jsx`)

This component is rendered 5× (once per metric). Each chart shows **30 days of
daily-rollup values** — hourly storage aggregates to daily for the trendline
view; hourly detail surfaces only in the hover tooltip and in optional zoom
(deferred).

**Three visual layers, no more (C5):**

1. **Threshold bands** as the chart background — three horizontal bands
   (Good / Needs Improvement / Poor), each bound to an Editorial palette
   token, **not** to raw "green/amber/red":
   - Good `→ var(--ed-forest)`
   - Needs Improvement `→ var(--ed-gold)`
   - Poor `→ var(--ed-rust)`
   - Opacity calibrated empirically against cream paper (`#f2ebdb`) at
     projector resolution — target 8–10% (5% is too subtle, will be
     verified in implementation).
   - Web Vitals thresholds:
     - LCP: ≤2.5s Good / 2.5–4.0s NI / >4.0s Poor
     - INP: ≤200ms Good / 200–500ms NI / >500ms Poor
     - CLS: ≤0.1 Good / 0.1–0.25 NI / >0.25 Poor
     - FCP: ≤1.8s Good / 1.8–3.0s NI / >3.0s Poor
     - TTFB: ≤800ms Good / 800–1800ms NI / >1800ms Poor
2. **p75–p95 spread band** — shaded region between the two percentiles, ~12%
   opacity in `var(--ed-ink)` (neutral, **not** the same hue as the threshold
   bands). The vertical gap is the story; tinting in neutral ink keeps the
   semantic colour channel reserved for the thresholds.
3. **p75 line** — solid, `var(--ed-ink)`, ~1.5px. The headline number.

**Explicitly dropped from the earlier 5-layer design:**

- Horizontal axis gridlines — the threshold bands provide the y-context.
- Week-boundary vertical gridlines — the x-axis tick marks at week starts do
  the same job. (Optional dotted week markers at 12% opacity may be added
  in implementation if leadership review surfaces a need.)

**Y-axis**: **fixed scale anchored to thresholds**, not auto-scaled. Range
is `[0, 1.5 × amber_boundary]` per metric. This keeps the Good→NI boundary
in the same visual position week to week — leadership comprehension wins over
data-zoom precision. Without this, an LCP consistently around 2.3s would
zoom in tight and the 2.5s boundary would visually scream "near the cliff"
when comfortably in Good.

**Tap/hover tooltip**: exact `p75_ms`, `p95_ms`, `sample_count`, `page_views`,
and `hour_breakdown` (sparkline of hourly values for the hovered day,
exploiting the hourly storage grain) for that day.

**Small inline legend** placed top-left of each chart (matches existing
`edLegendProps`): `── p75   ░░ p75–p95 spread`. Threshold bands are visually
obvious; no separate legend needed.

**Tabular numerals.** All numeric values use `font-variant-numeric: tabular-nums`
combined with `var(--ed-mono)` (IBM Plex Mono). The CSS property is what
actually prevents column-shift; the font alone isn't sufficient. Per-metric
unit choice is locked: LCP/FCP in seconds (`2.40s`); INP/TTFB in milliseconds
(`180ms`); CLS dimensionless (`0.08`). Mixing seconds and ms within a single
metric column is forbidden — would defeat tabular numerals.

**Implementation hint** (for the plan): Recharts 2.12.7 provides `<ReferenceArea>`
for threshold bands, `<Area>` (with `dataKey` for p95 and `baseLine` for p75) for
the spread band, `<Line>` for p75. Disable Area animation after initial mount
(`isAnimationActive={false}` post-load) to avoid SVG-path morph jank on device
toggle.

### 6.3 Cold-start handling — folded into the window toggle

**The dedicated cold-start banner has been removed.** Its job is now done
by two existing elements working together (see §6.1.3):

- The **header caption** — `Data: {N} days collected · viewing last {window}` —
  always visible, gives the "this is week N" context without an apologetic tone.
- The **auto-promoting default** on the window toggle — defaults to the
  shortest window that has data, growing automatically to 7d → 14d → 30d.
  Trendlines are never thin-but-empty in their default state.

The banner-and-trigger machinery is gone; the toggle and caption are
deterministic and always present, regardless of data age.

### 6.4 Route drill-down — see §6.1.4

This section's design has been promoted into the page-IA itself — the table
now sits **above** the trendline grid, directly under the status verdict.
See §6.1.4 for the IA position and sort behaviour. This section retains the
implementation-detail notes:

- **`route_patterns.csv`** file format: `pattern_regex,label,sort_priority`.
  Lookup is first-match-wins, priority-ordered.
- Default collapsed past Top 5; `[show 15]` reveals the full top 15
  expander. The "Other pages" footer row is always present and aggregates
  every URL not matched by a top-15 pattern.
- The "Other pages" row shows its **week-over-week bucket-size change**
  (e.g., `+12% WoW`) — engineering signal that traffic is dispersing or the
  patterns file needs updating. Not a leadership-verdict input.
- Expand affordance: Lucide `ChevronDown` SVG icon, not a Unicode glyph.
- Click a row → expands to a 30-day per-route LCP-p75 sparkline with the
  same Editorial-token threshold band as the main trendline cards.

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
| NRQL transient (5xx, timeout) | HTTP status / timeout | Retry 3× with exponential backoff (1s, 4s, 16s) **with ±25% jitter**, capped at 30s. |
| Auth failure (401, 403) | HTTP status | Fail loud, no retry. GitHub email surfaces it. Logged exception is **scrubbed of `Api-Key`/`Authorization` headers** before it lands in Actions logs. |
| Schema mismatch (NRQL columns missing) | KeyError on response parsing | Fail with the missing column name in the log line. Most likely the percentile-nested-shape parser (§4.2 C1) hitting an unexpected response — re-run against fixture to confirm. |
| Facet-limit truncation (C2) | `LIMIT MAX` returned ≥1900 buckets | Loud failure. Either narrow the scope or paginate. Empty-result detection does not catch this — it's the inverse problem (too much, silently dropped). |
| Empty result for an `(app, hour)` window | Q1 (timings) OR Q2 (page views) returned 0 rows for that bucket | Fail just that `(app, hour)` write; continue with other apps/hours. **`JavaScriptError == 0` is normal** and never a failure (low-traffic Sundays produce legitimate zero JS errors). |
| Partial failure within an `(app, hour)` window (Q1 ok, Q2 fails) | Per-query exception caught | All-or-nothing **per `(app, hour)`** — not per run. The failed `(app, hour)` is skipped and logged for retry on next scheduled run or via `--since`. Other apps' and other hours' successful fetches commit normally. |
| Bot/crawler noise | Inspection of `userAgent` distribution at discovery time | Filter at NRQL `WHERE` if `userAgent` is queryable on `PageViewTiming`; else accept in v1, refine in v1.5. |
| Workflow runs racing each other | n/a — prevented at workflow level | `concurrency: { group: refresh-performance-grip, cancel-in-progress: false }` (see §5.2). Manual `workflow_dispatch` queues behind the scheduled run. |

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
| v1.5 | **Slack alert on workflow failure** | First real miss in operation (or after 60 days without one, as preventive) — the spec defers this on the basis that twice-daily cron + idempotent recovery + GH email already cover the failure window. If operation proves otherwise, add the webhook. |
| v1.5 | Classic dashboard surface | After ~30 days of data when we know the data shape feels stable |
| v1.5 | Improve `route_patterns.csv` from observed traffic | Week 4 of operation |
| v1.5 | Cross-app side-by-side status pills in hero | Once leadership asks the obvious comparison question (likely first review) |
| v1.5 | Print stylesheet / `?print=1` route | When dashboard is first screenshotted into a deck |
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

**Hard gate before step 2:** step 1 must produce real NerdGraph response
fixtures committed to `backend/tests/fixtures/new_relic/`. No fetch code
lands before those fixtures exist.

1. **Discovery NRQL session** — see §10 checklist. Capture real fixtures for
   each query type into `backend/tests/fixtures/new_relic/`. Lock app names,
   region, percentile response shape (C1), bucketing strategy, schema columns.
2. **`new_relic.py`** — minimal NerdGraph client. Retry/backoff with jitter.
   `Api-Key` header scrubbing on exception logging.
3. **`performance_grip.py`** — hourly fetch + merge + write. Parser unit
   tests built against the §1 fixtures. `uniqueCount(pageUrl)` cap probe.
4. **Register in `refresh.py` REGISTRY**; standalone CLI works with
   `--since` input validation (regex + future-date + retention-window rejection).
5. **`project.json` + `route_patterns.csv` skeleton.**
6. **GitHub workflow** — `refresh-performance-grip.yml` with twice-daily
   schedule, `concurrency` group, `timeout-minutes`, branch guard, SHA-pinned
   actions, env-flow for `SINCE`.
7. **Secrets / variables** added to repo: `NEW_RELIC_USER_API_KEY` (secret),
   `NEW_RELIC_ACCOUNT_ID` (variable).
8. **First `workflow_dispatch` run with `since=7days_ago`** — populates the
   initial 7-day × 24-hour window (matches §4.5). Verify rows in DuckDB.
9. **Dashboard component scaffolding** — `PerformanceGripDashboardEditorial.jsx`
   + sub-components. Wired to `hourly_web_vitals.csv` via the existing query
   layer (daily rollup computed at query time).
10. **Status verdict block** — rule-based logic (§6.1.1), positioned at top
    of dashboard. **Build this before the trendline atom** so the
    leadership 30-second test passes on day 1.
11. **`MetricTrendCard.jsx`** — three-layer chart per §6.2 with Editorial-token
    threshold bands at calibrated opacity, neutral-ink spread band, fixed
    threshold-anchored Y-axis. Recharts `ReferenceArea` + `Area` + `Line`.
12. **Hero band** with locked week-over-week comparison (§6.1.2).
13. **Section grouping + cold-start banner + route drill-down with sparkline expand.**
14. **Manual UAT** at 375px (mobile), 1280px (laptop), 1920px (TV/projector).
    Verify threshold-band opacity at projector resolution.
15. **First scheduled cron run** — confirm 01:00 IST execution lands. After
    12 hours, confirm 13:00 IST catch-up run is also fine and produces
    no duplicate rows.
16. **Spot-check against NR native dashboard** for the same hour range
    (allow ±2% sampling variance).

---

## 12. Decisions log

Concrete decisions captured during brainstorming, with the alternative
considered for each (so future readers can re-litigate if context changes):

| Decision | Alternative considered | Why this way |
|---|---|---|
| NRQL via NerdGraph | Metrics REST, Insights Query API | Insights deprecated; Metrics REST is for dimensional metrics not browser events |
| Per (page × device × **hour** × day) grain | Daily aggregate; or site-wide rollup | Cannot be un-aggregated retroactively. Hourly preserves time-of-day patterns (peak-hour LCP degradation) the same way per-URL grain preserves per-page patterns. Cost is 24× rows (~7M/yr), trivial in DuckDB. |
| Raw URL stored, patterns applied in UI; PII risk accepted | Collapse to patterns at fetch; or hash URLs | Repo is private; retroactive grouping ability preserved. **Accepted risk:** logged-in URLs may carry user/order/KYC IDs in path segments. Mitigations: regular repo-access audits; BFG/`filter-repo` scrub before any public-repo transition. If the repo ever leaves private status, this decision is invalidated. |
| p75 + p95 both stored | p75 only | p75–p95 spread is the early-warning signal for slow-tail regressions (LCP looks fine at p75 but the spread widens before users notice). The spread band is the chart's most opinionated visual; it requires both percentiles. |
| Spread band visual (p75 → p95) | Two separate lines (p75 solid, p95 dashed) | One visual object beats two; story is the *gap*, not the two points |
| Threshold bands behind line **+ rule-based status verdict above** | Bands alone; or status pill alone | Bands convey continuous "where in the zone" information; verdict gives the discrete 30-second answer. The two work together — bands answer "how close to next zone?", verdict answers "is everything OK?". |
| Section grouping (Core / Secondary Web Vitals) | Equal 5-card grid | Avoids orphan-card layout; semantically meaningful per Google's framework |
| Device toggle page-level, **default Mobile** | Per-chart device split; or default All | 2 lines + bands per chart already at cognitive limit; 4 lines unreadable. Mobile-default because Grip Invest is mostly-mobile Indian fintech traffic. |
| Editorial only in v1 | Editorial + Classic | Editorial-first forces sharper IA decisions per metric. Classic table can hide the design question behind "just put numbers in cells"; build Editorial first, learn from it, Classic in v1.5. |
| 7-day backfill at first run | Start fresh from tomorrow | Free history; gives day-1 dashboard something to show. `--since` mechanism doubles as canonical recovery path for any missed cron day. |
| **Hourly storage**, daily rollup at query time | Daily-only storage | Time-of-day patterns are one-way doors. Hourly costs ~24× rows (still trivial DuckDB); preserves optionality for "peak-hour vs off-peak" analysis. |
| **Twice-daily cron** (01:00 + 13:00 IST) | Single daily run | GH Actions cron drifts 5-30 min and can silently skip under platform load. Single-cron mismatched to the 8-day data-loss ceiling. Twice-daily halves the missed-day probability for zero infra change. |
| `since` workflow_dispatch input, validated in Python via env | Manual code edit; or shell-interpolated input | Backfill / outage recovery requires this mechanism anyway. `env:` flow + Python regex validation eliminates the shell-injection vector. |
| **No Slack alerts in v1; deferred to v1.5 trigger** | Slack on failure | Reviewers strongly pushed for Slack given the 8-day data-loss ceiling. User decision: ship without; add at first real miss. The twice-daily cron + idempotent merge + `--since` recovery + GH email + dashboard staleness banner are the layered mitigations until then. **This is the closest-call decision in the spec.** |
| No separate freshness-check workflow | Daily "is data fresh?" cron | Novel infrastructure; existing layers cover the failure modes within the 8-day NR retention window. |
| "Other pages" bucket label | "Unmatched" / "Uncategorised" | Leadership-readable; engineering-speak avoided |
| **Status verdict block at top of dashboard** (rule-based, deterministic) | Numerical hero only | Spec rejected an earlier "no headline badge" stance after the requirements-analyst review. The verdict answers the 30-sec test ("is performance OK this week?") without violating "no editorial prose" — it's pure rule output. |
| **Week-over-week (ISO weeks) as the locked comparison window** | Trailing 7-day vs prior 7-day; or vs yesterday | Dashboard cadence is weekly review; comparisons should match. Ambiguous "↓ 0.12s" with undefined window was a CRITICAL finding (C7). |
| **Y-axis fixed scale anchored to thresholds**, not auto-scaled | Auto-scaled with headroom | Auto-scale + absolute thresholds fight each other (LCP 2.3s zoomed tight visually screams "near the cliff" at 2.5s boundary). Fixed scale makes threshold position stable across weeks, supports leadership-comprehension over data-zoom precision. |
| **NR alternatives priced and rejected** before commitment | Build without pricing | The whole project's premise (NR's 8-day retention isn't enough) is checked. NR Data Plus / equivalent SKUs evaluated and rejected on cost; CrUX unsuitable for post-login data; Cloudflare RUM not in current edge setup. |
| **Route drill-down promoted above trendline grid; default Top 5; sort by week-over-week p75 LCP delta** | Bury below grid; Top 15 by page views | The drill-down's WoW LCP column answers the question NR can't ("which page got worse?") and is the dashboard's single most leadership-actionable surface. Promoting it up + regression-first sort matches the actual leadership question. |
| **JS errors shown as a hero number only; not in status verdict; 6th card deferred to v1.5** | Full integration (verdict + hero + 6th card); or invisible | Compromise position: surface the number for informational context without complicating the verdict (which stays Web-Vitals-only). 6th card adds layout cost and a non-standard threshold (no Google equivalent); ship if/when leadership asks. |
| **Window toggle `[ 7d \| 14d \| 1M \| 3M ]` with auto-promote stopping at 30d; data-age caption in header** | Cold-start banner alone; or toggle with auto-promote to 3M; or toggle with no auto-promote | The toggle replaces cold-start handling entirely — it's the deterministic, always-present mechanism. Auto-promote stops at 30d so 90d remains a deliberate retrospective view (not a quietly-default-shifted state). Caption gives context without an apologetic banner. |
| **"Other pages" row stays in table with WoW bucket-size delta**; not elevated to verdict | Elevate to verdict at >30% threshold; or drop from view; or current spec (no WoW) | Engineering signal stays visible; doesn't pollute the leadership verdict. WoW delta gives the patterns-file-staleness signal without an admin pane. |
