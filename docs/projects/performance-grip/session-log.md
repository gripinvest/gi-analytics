# Performance Grip — session log

Append new dated entries at the top each session.

---

## 2026-05-21 — v1 dashboard LIVE + post-launch fixes · HANDOFF for next session

> **START HERE if you're picking this project up fresh.** This entry is the
> directed handoff: current state, what's deployed, known issues, and the
> exact next task with how to begin it.

### TL;DR — where things stand

Performance Grip **v1 is live**: the archive pipeline (Plan 1) and the
Editorial dashboard (Plan 2) are both built, merged to `main`, and deployed.
Dashboard route: **`/projects/performance_grip`**. The twice-daily cron is
populating the archive; 8 days were backfilled. After first render, several
real bugs were found and fixed (see below). **The agreed next task is
new-metrics planning** — not yet started.

### What is built and live

- **Archive (Plan 1)** — `backend/services/integrations/{new_relic,performance_grip}.py`
  fetch NR Web Vitals via NerdGraph, Path C split-query (raw URLs + collapsed
  patterns), idempotent hourly writes to `backend/data/performance_grip/hourly_web_vitals.csv`,
  baked into DuckDB table `performance_grip__hourly_web_vitals` by `build_duckdb.py`.
- **Cron** — `.github/workflows/refresh-performance-grip.yml`, twice daily
  (01:00 + 13:00 IST), commits data back to `main`.
- **Dashboard (Plan 2)** — `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx`
  + `performance-grip/` sub-components. Editorial style. Registered in
  `dashboards/index.js` as `PerformanceGripEditorial`.
- **Data captured (v1):** 7 points per (date, hour, app, page_url, device) —
  LCP, INP, CLS, FCP, TTFB (p75 + p95), page_views, js_errors. **All timing
  values are milliseconds** (see units note below).

### Merged this session (PR-by-PR — all on `main`)

| PR | What |
|----|------|
| #72 | Plan 1 archive merged |
| #80 | Plan 2 dashboard plan (doc) |
| #81 | Plan 2 dashboard built (8 phases) |
| #83 | **fix:** `runQuery` was called with the wrong signature — dashboard showed "no data" |
| #84 | **fix:** NR returns LCP/INP/FCP/TTFB in **seconds**; columns are `_ms`; converted ×1000 at fetch + migrated the 8 archived days |
| #85 | **fix:** clamp NR outliers (INP up to 250k ms, CLS up to 6) + drop low-sample rows + surface "N extreme set aside"; fixed hero `NaN` delta |
| #86 | p95 number shown explicitly on metric cards |
| #87 | **p95 is now the headline metric** (fintech priority — slow tail); p75 demoted to secondary, still shown |
| #88 | **Page Detail panel** — route dropdown → full-width per-metric trendlines + per-page summary |

### Known issues / watch items (not blocking, but real)

- **TTFB reads ~0 everywhere** — NR `firstByte` may not be populated for these
  apps. Investigate, or drop TTFB from the dashboard. (Flagged since Phase 0.)
- **Verdict reads harsh** — p95 is now judged against Web-Vitals thresholds
  that are officially p75-defined, so the status verdict is stricter than
  Google's standard. Intended for a fintech, but know it's deliberate.
- **Deploy lag** — Render (backend) + Vercel (frontend) auto-deploy on push to
  `main`, a few minutes each. "No data" / stale numbers right after a merge =
  deploy not finished yet, not a bug.
- **`/assetagreement`, `/assetdetails`** (gi-client-web) — collapse patterns
  configured but **zero traffic** in the archive, so they don't appear in the
  route table. Not a bug. Worth confirming with the gi-client-web owner
  whether those routes are still live + NR-Browser-instrumented.
- **NR key is a personal User API Key** — migrate to a service-account user
  with a read-only NerdGraph role before this is considered production-hard.
- **`--require-hashes`** is only on the performance-grip pip install; the
  other 3 projects' workflows are not yet hardened (roadmap item).
- **Backfill is slow** — a 7-day backfill ran ~33 min serially (~6k NRQL
  calls). Bounded parallelism in the fetch loop is a v1.5 candidate; matters
  before the next big backfill.

### NEXT TASK — new-metrics planning (user-confirmed, NOT started)

The user wants to expand beyond the 7 v1 data points. Three streams, in
priority order:

1. **AJAX / API latency + error rate** (NR Browser `AjaxRequest` event — same
   fetch pipeline, cheap). The "app feels slow" signal — high value for a fintech.
2. **Connection-type + geo segmentation** (NR Browser — same pipeline). Split
   vitals by 4g/3g/wifi and region.
3. **Synthetics uptime** — API + infra uptime % (NR Synthetics — a new source).

**The user explicitly raised an architecture question that MUST be answered in
this planning:** *how do new metrics sync with the existing data without
polluting it — now and as more metrics get added later?*

The agreed answer-in-principle (write it up properly): **additive-only,
grain-keyed tables.** Never repurpose or rename a column in
`hourly_web_vitals.csv`. New data sharing the `(date, hour, app, page_url,
device)` grain → new columns. New data with a different grain (connection-type
adds a dimension; Synthetics is per-monitor, not per-page) → a **new CSV → new
DuckDB table** (`build_duckdb.py` auto-bakes any CSV). One fetch module per
stream; all land via the same cron → commit → rebuild. Old data stays valid,
no migrations.

### How to start the next session

1. Read this entry, then `specs/2026-05-20-performance-grip-design.md` and
   `data-sources.md` (the latter has the NR query idiom + verified facts).
2. **Phase-0-style discovery first** — query the live NR account to confirm
   what each of the 3 streams actually exposes: the `AjaxRequest` event schema
   + fields; whether geo/`connectionType` fields are populated on `PageView`;
   **whether any NR Synthetics monitors even exist** for the APIs. NR creds:
   `backend/.env` has `NEW_RELIC_API_KEY`; account `4002804`, region `US`.
   Query via the python+httpx idiom documented at the bottom of `data-sources.md`
   (NerdGraph `POST https://api.newrelic.com/graphql`). Do NOT write fetch code
   before discovery confirms the data shape — that discipline is why Plan 1
   went smoothly and skipping it caused the Plan-2 unit bug (#84).
3. Design the additive schema per the principle above; write a short spec +
   plan (scaled-down — this is a v1.5/v2 increment, not a greenfield project).
4. Then execute (subagent-driven, same as Plans 1 & 2).

### Environment / infra quick-reference

- **NR:** account `4002804`, US region. `api.newrelic.com/graphql`. User API
  Key in `backend/.env` (`NEW_RELIC_API_KEY`), GitHub repo secret
  `NEW_RELIC_API_KEY`, repo variable `NEW_RELIC_ACCOUNT_ID`.
- **Backend:** Render, `grip-analytics-api.onrender.com`. `/health` is
  unauthenticated (lists DuckDB tables); `/query` needs basic auth.
  `build_duckdb.py` runs in the Render build command.
- **Frontend:** Vercel, `grip-analytics-psi.vercel.app`. Queries the backend
  through `/api/proxy`. `runQuery(projectId, sql, limit)` in `lib/api.ts` —
  **note the 3-arg signature** (getting this wrong was bug #83).
- **NR apps:** `gi_client_static_prod`, `gi_client_web_prod`.
- **Worktree mandate:** every edit task uses a dedicated git worktree off
  latest `origin/main`. Clean up merged worktrees with `git worktree remove`.

### Key files

| Area | Path |
|------|------|
| Spec | `docs/projects/performance-grip/specs/2026-05-20-performance-grip-design.md` |
| Data sources / NR facts | `docs/projects/performance-grip/data-sources.md` |
| Roadmap | `docs/projects/performance-grip/roadmap.md` |
| Fetch — NR client | `backend/services/integrations/new_relic.py` |
| Fetch — project module | `backend/services/integrations/performance_grip.py` |
| Archive CSV | `backend/data/performance_grip/hourly_web_vitals.csv` |
| Path C pattern config | `backend/data/performance_grip/route_patterns.csv` |
| Cron workflow | `.github/workflows/refresh-performance-grip.yml` |
| Dashboard | `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx` |
| Dashboard sub-components | `frontend/components/dashboards/performance-grip/` |
| Query module | `frontend/lib/queries/performanceGrip.js` |

---

## 2026-05-21 — Path C architecture decided + route_patterns.csv locked (Session 3 continued)

**Where the project stands at session end:**

Pre-execution validation surfaced a critical issue: web app has 4,882 unique
URLs in 24h (99% partner-webview UUIDs), saturating NerdGraph's 5000-facet cap.
The original K2 decision ("store raw URLs") would have silently truncated data.

**K2 flipped to Path C.** Decision committed in spec §12 and validated against
real production data.

### Path C architecture (final)

For each `(app, hour)` window, the fetcher runs:

1. **Raw query** — `FACET pageUrl, deviceType LIMIT MAX` with `WHERE pageUrl
   NOT LIKE` clauses excluding all collapse patterns AND all deprecated paths.
   Yields ~30 raw rows for named pages.
2. **N collapse queries** — one per pattern (4 for web, 5+1 for static). Each
   `WHERE pageUrl LIKE 'pattern' FACET deviceType` (no pageUrl facet). Yields
   1-3 rows per pattern (one per active device), with `page_url` set to the
   pattern label.

**Validation result on live web-app data:**
- Coverage: 19,438 / 19,415 samples (~0.1% delta = excluded deprecated paths)
- Facet count: 4899 → 30 raw + ~12 aggregate (99% headroom recovered)
- Per-query latency: ~1.5s; 12-hour catch-up fits in 4-6 minutes

### Pattern config locked

[`backend/data/performance_grip/route_patterns.csv`](../backend/data/performance_grip/route_patterns.csv)
is the single source of truth for both fetch logic (`collapse_at_fetch`,
`exclude` columns) and dashboard rendering (`sort_priority`).

**Excluded routes** (deprecated; not fetched at all):
- web: `/kyc/*`, `/kyc`, `/external/*`, `/vault`, `/my-transactions`,
  `/account-inactive`, `/authenticate`, `/referral-dashboard`,
  `/health`, `/grip-icons`, `/persona-results`, `/qa-config-editor`
- static: `/health-static`, `/sitemap*`, `/api/*`

**Collapse-at-fetch patterns:**
- web: `/external-ui/[uuid]`, `/checkout/[uuid]`, `/assetdetails/[id]`,
  `/assetagreement/[id]`
- static: `/blog/[slug]`, `/category/[slug]`, `/product-detail/[slug]`,
  `/marketing/[url]`, `/faq/[type]/...`, `/[slug]` (top-level CMS catch-all)

**Stored raw:** everything else (~30 named pages per app).

### Plan changes applied

- Task 2.10 NRQL builders split into `_nrql_q1_raw` / `_nrql_q1_collapse`
  (and same for Q2, Q3). Back-compat shim `_nrql_q1` retained for older tests.
- New helper `load_route_patterns(csv_path)` reads the CSV into the config dict
  the orchestrator uses.
- `run()` orchestrator updated to iterate collapse patterns per `(app, hour)`.
- New helper `parse_collapse_response(rows, label, metric_type)` converts
  single-FACET (deviceType-only) responses into the schema-matching row shape
  with `page_url = label`.

### Fixtures captured at production scale

- `Q1_pageviewtiming_response_giweb_raw.json` — Path C raw query, 24h, web app
- `Q1_pageviewtiming_response_giweb_collapse_external-ui.json` — example collapse-pattern response

### Pick up next — Phase 1 (subagent execution is unblocked)

Start a new Claude session and say:

> "Resume Performance Grip subagent execution. Plan 1 at
> `docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md`.
> Phase 0 complete + Path C architecture locked. Dispatch implementer for
> Task 1.1."

The implementer follows the plan task-by-task. Phase 2 tasks (2.3, 2.4, 2.5,
2.10) reflect the Path C split; the implementer must read
`route_patterns.csv` at the start of `run()` and follow the split-query
logic per spec §12.

---

## 2026-05-21 — Phase 0 discovery COMPLETE (Session 3)

**Where the project stands at session end:**

All Phase 0 hard gates and supporting tasks executed via direct NerdGraph
HTTP calls (no GraphiQL UI needed — the API is just a POST to
`api.newrelic.com/graphql`). Fixtures committed; data-sources.md filled in.

| Task | Finding | Status |
|---|---|---|
| 0.1 — Auth | NEW_RELIC_API_KEY in primary `.env`; verified | ✅ |
| 0.2 — App names | `gi_client_static_prod`, `gi_client_web_prod` | ✅ Locked in `APP_CONFIG` |
| 0.3 — Q1 fixture + CA2 | **CA2 confirmed:** `timingName` discriminator IS required. Variant A inflates `sample_count` ~5×. Production query uses `filter()`-wrapped form. Plan Task 2.10 `_nrql_q1` updated. | ✅ Fixture saved (56 facets, 25.8K) |
| 0.4 — Q2 fixture | 75 facets in a 1-hour window | ✅ Fixture saved (10.8K) |
| 0.5 — Q3 fixture + deviceType | **CA3 disconfirmed for this account:** Q3 `deviceType` is 100% populated. Keep `FACET pageUrl, deviceType` as specced. | ✅ Fixture saved (18.7K, 128 facets) |
| 0.6 — Field names | INP populated; `firstByte` confirmed for TTFB; all 5 Web Vitals present | ✅ Documented |
| 0.7 — TIMESERIES | **DECISION: use TIMESERIES.** Works cleanly with FACET; `LIMIT` caps facets only (not facet×bucket). Reduces NRQL call volume by ~24× vs per-hour. | ✅ Fixture saved (5K) |
| 0.8 — Bot filter | `userAgent` IS queryable BUT bot filter matched 0 / 53,315 events. NR Browser pre-filters bots. **Omit WHERE in production.** | ✅ Documented |

**Other findings worth flagging:**

- `pageUrl` is a full absolute URL (`https://www.gripinvest.in/corporate-bonds`) — `clean_url` handles via `urlparse`.
- Percentile response shape: nested `{lcp: {"75": v, "95": v}, ...}` — confirms public docs, parser locks against this.
- Some URLs are Google-Translate proxied (`www-gripinvest-in.translate.goog`) — will collapse to original path after clean_url.
- TTFB values mostly 0.0 in discovery — investigate during dashboard work; may need different field.
- INP values in seconds (0.04, 0.088) — unit conversion to ms needed in parser or display.
- Plan Task 2.10 `_nrql_q1` updated with `filter()` wrappers + canonical app names.

**Plan changes applied during Phase 0:**

- `APP_CONFIG` literals now use `gi_client_static_prod` / `gi_client_web_prod` (not the GUI display names).
- `_nrql_q1` rewritten with `filter(percentile, WHERE timingName)` per metric.

**Pick up next — Phase 1 (Subagent execution can begin):**

Start a new Claude session and say:

> "Resume Performance Grip subagent execution. Plan 1 at
> `docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md`.
> Phase 0 complete; all fixtures and data-sources.md committed. Dispatch
> implementer for Task 1.1 (NewRelicClient skeleton)."

The new session will invoke `superpowers:subagent-driven-development` and
work through Phases 1–6 task-by-task with continuous execution. Phase 5.2
secret push (`gh secret set`) and Phase 6 verification will still need you
to be present briefly.

---

## 2026-05-21 — Plan + reviews complete; Phase 0 handoff to user (Session 2 end / Session 3 start)

**Where the project stands at session end:**

Design + plan are fully complete and reviewed:

| Artifact | Status |
|---|---|
| Spec — [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md) | ✅ Authored, 8-pass reviewed, 7 CRITICALs + most HIGHs + 6 MEDIUMs applied |
| Spec review findings — [`specs/2026-05-20-performance-grip-review-findings.md`](./specs/2026-05-20-performance-grip-review-findings.md) | ✅ Committed; deferred MEDIUMs noted |
| Plan 1 (Archive) — [`plans/2026-05-20-performance-grip-archive-plan.md`](./plans/2026-05-20-performance-grip-archive-plan.md) | ✅ 2,650 lines; 6-pass reviewed; 10 CRITICALs + 15 KISS-survived HIGHs/DAs applied |
| Plan 1 review findings — [`plans/2026-05-20-performance-grip-archive-plan-review-findings.md`](./plans/2026-05-20-performance-grip-archive-plan-review-findings.md) | ✅ Committed; 8 HIGHs skipped with rationale, MEDIUMs deferred to implementation |
| README — [`README.md`](./README.md) | ✅ Up-to-date with hourly grain decision |
| `data-sources.md`, `roadmap.md` | ⏳ Will be created during Phase 0 + Phase 3 execution |
| **Plan 2 (Editorial dashboard)** | ⏳ Will be written after Plan 1 has run for ~7 days (so dashboard work calibrates against real data) |

**Decisions made and locked in:**

- K1: Slack alerts **deferred to v1.5** — added if a real miss occurs in operation
- K2: Raw URLs in CSV — **PII risk accepted** in private repo; mitigations documented
- K3: **Hourly grain** + **twice-daily cron** (01:00 + 13:00 IST)
- Q1: NR alternatives priced and rejected (Data Plus too costly; CrUX unsuitable for post-login)
- CA1: Only **User API Key** works with NerdGraph (Insights Query Keys don't). Auth confirmed against account 4002804 / US region.

**Pick up next — Phase 0 manual NR UI work (HUMAN-ONLY; no subagent can do this):**

Three Phase 0 tasks must complete BEFORE subagent execution can begin at Phase 1:

1. **Task 0.2** — Run `SELECT uniques(appName) FROM PageViewTiming SINCE 1 day AGO` in NR GraphiQL Explorer. Document the two canonical `appName` values in `data-sources.md`. These lock `APP_CONFIG` in plan Task 2.10.
2. **Task 0.3 (HARD GATE)** — Run the Q1 query AND its `timingName`-discriminated variant (CA2 verification). Compare `sample_count` between the two shapes. Save the correct response to `backend/tests/fixtures/new_relic/Q1_pageviewtiming_response.json`. Document the actual percentile response shape verbatim in `data-sources.md`. This locks the parser in plan Task 2.3.
3. **Task 0.7 (HARD GATE)** — Test `TIMESERIES 1 hour` against Q1. Verify response shape and facet-cap behaviour. Default decision is TIMESERIES; only fall back to per-hour queries if facet cap interacts badly. Document the choice in `data-sources.md`.

Other Phase 0 tasks (0.4 Q2 fixture, 0.5 Q3 + deviceType availability, 0.6 INP/TTFB field names, 0.8 bot filtering check) can run in parallel with Phase 1 — they must complete before Task 2.10 ships, but don't block client/parser code.

After committing the three hard-gate outputs, **start a new Claude session** and say something like:

> "Resume Performance Grip subagent execution. Plan 1 archive at
> docs/projects/performance-grip/plans/2026-05-20-performance-grip-archive-plan.md.
> Phase 0 hard gates (0.2, 0.3, 0.7) are complete. Dispatch implementer for Task 1.1."

The new session will invoke `superpowers:subagent-driven-development` and dispatch fresh implementer + spec-reviewer + code-quality-reviewer subagents per task, following the plan task-by-task with continuous execution.

**Commit history on `performance-grip-design` branch:**

```
docs(performance-grip): apply 15 KISS-survived HIGH/DA findings
docs(performance-grip): apply all 10 CRITICAL plan-review findings
docs(performance-grip): triage findings from 6-pass plan review
docs(performance-grip): implementation plan 1 — archive (backend + cron)
docs(performance-grip): apply remaining HIGHs + high-value MEDIUMs
docs(performance-grip): apply dashboard HIGH findings (H12, H13, H18, H19)
docs(performance-grip): apply CRITICAL findings + K3 hourly grain
docs(performance-grip): triage findings from 8-pass parallel review
docs(performance-grip): brainstormed v1 design spec + project README
```

**Local environment state:**

- `backend/.env` contains a working `NEW_RELIC_API_KEY` (User API Key, already auth-tested against NerdGraph).
- `NEW_RELIC_ACCOUNT_ID=4002804`, `NEW_RELIC_REGION=US`.
- Worktree: `.claude/worktrees/performance-grip-design` on branch `performance-grip-design` (off `origin/main`).
- No code committed yet — only docs (spec, plan, review findings, README, this session log).
