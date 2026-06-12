# Asset Search — roadmap

## Done

- **Session-outcome funnel** — Success / Relevance-gap / Dead-end, computed live
  from `asset_search_query` + `asset_search_result_clicked`. Overall (Editorial
  Overview, Fig 3) and per-issuer (Issuers section). Replaced the
  `asset_search_cleared`-based abandonment reconstruction.
- **Full W6 data** — W6 is a complete feature week (7–13 May); dashboard copy,
  date range and the week glossary updated.
- **Classic dashboard deprecated** — `@deprecated`; Editorial is the maintained
  variant.
- **Interactive issuer sort** — SORT BY: Searches (default) / Worst success /
  Failed searches / Zero-result rate.
- Masthead reporting period + feature-week glossary.
- **V2 instrumentation hooks landed in the dashboard ahead of the
  gi-client-web PT-37900 release** (see [`data-sources.md`](./data-sources.md)
  §§ 2d, 2e for event schemas):
  - **Engine Cutover strip** in Overview — V1 vs V2 side-by-side on
    success rate, dead-end rate, ZRR, refinement, total queries.
    Renders projected sample numbers until events flow; auto-switches
    to live data on first V2 row arrival (`engineDataState()` helper).
  - **Outreach section** (CS-facing, §VI) — per-user Notify Me queue
    from `asset_search_notify_me_clicked`. Filter / status / search
    bar + sortable contact table + CSV export. localStorage-backed
    status tracking (`new → contacted → converted`) so CS works
    without a CRM integration. Deep-link `?section=outreach`.
  - Query builders for the new events in `lib/queries/outreach.js`
    + `lib/queries/engineComparison.js`. Both follow the same
    "mock until events flow, then auto-switch" pattern.
- **Grip Connect vs own-platform dimension** — every search event carries
  `gc_id` / `gc_name` (the global `trackEvent` stamp from gi-client-web
  `utils/gtm.ts`): GC = `gc_id` set (a partner journey — ET money, Mobikwik, …),
  own platform = empty. Segment builders (`gcOverview`, `gcMixByWeek`,
  `gcFunnelBySegment`, `byPartner`, `topPartnerTerms` in `assetSearch.js`, gated
  by `Q.hasGcWeeks` / restricted to GC-capable weeks via `gcScope`) feed a shared
  `AssetSearchGCSection` — rendered as a "Grip Connect" tab (Classic) / §
  (Editorial) — plus a `GCComparisonCard` on each Overview so the split is visible
  alongside the headline metrics. Covers **W4 (Apr 23) onward** only — `gc_id` is
  absent from the W1–W3 thin exports. First read: GC is **13.7%** of queries but
  **57.8% ZRR vs 33%** own-platform and a **40.5% vs 59.5%** click-rate — partner
  journeys hit far more dead-ends. Segment definition in
  [`data-sources.md`](./data-sources.md) § 2f.

## Why the metric changed — keep this context

The earlier metric split `asset_search_cleared` events into "true abandonment"
(zero results) vs "relevance gap" (results, no click). Two problems:

1. **It understated search failure ~10×.** Most users who fail a search don't
   *clear* the bar — they just leave. `cleared` only sees a sliver of failure.
2. **The W1–W3 export lacks the payload** (`had_results` / `any_result_clicked`)
   — see [`data-sources.md`](./data-sources.md) §0 — so W1–W3 had to be
   reconstructed by joining clears to the last query, which double-counted
   sessions and undercounted abandonment.

The session-outcome funnel (`query` + `result_clicked`, classify each session
once) is exact for all weeks, mutually exclusive by construction, and reflects
real outcomes. `cleared` is now a secondary friction signal only.
`search_analytics/reconstruct_abandonment.py` is legacy — superseded.

## Next

### 1. Asset Search live data — Metabase fetch pipeline 🔴

Today the dashboard reads CSVs hand-exported into `grip.duckdb`. Asset Search
should pull **current** Metabase numbers automatically — exactly what the
**approved Grip Connect spec** designs:
`docs/specs/2026-05-17-grip-connect-live-data-design.md`.

Apply that same pattern — Asset Search becomes the second project on the shared
`backend/services/integrations/` framework:

- `integrations/metabase.py` — REST client: `POST /api/session` → token, then
  `POST /api/card/{id}/query`. No browser automation; plain `requests`.
- `integrations/asset_search.py` — per-card fetch + upsert-by-key into the
  canonical CSVs under `backend/data/asset_search/`.
- Reuse `integrations/refresh.py` (CLI + `POST /api/projects/{id}/refresh`) and
  `validate.py`.
- A scheduled GitHub Action commits refreshed CSVs (history lives in git).
- `project.json` gets `refreshable: true` + a freshness window.

This is also how the §5 export backlog in `data-sources.md`
(`view_payment_page_loaded`, `view_payment_status_page`, `new_user_order`, …)
should be pulled — as Metabase cards through the fetch module, not hand-exported.

**Blocker:** `METABASE_EMAIL` / `METABASE_PASSWORD` env vars. Metabase URL is
`https://metabase.gripinvest.in`; login via `POST /api/session`. v1 uses
personal creds; rotate to a service-account API token (`X-API-Key`) after.

**Discipline:** deterministic Python only — Claude authors and validates the
fetch scripts, never runs extraction at runtime; no LLM in the data path.

### 2. Payment-stage conversion 🔴 (export-gated)

Once `view_payment_page_loaded` + `view_payment_status_page` are exported (via
#1): search → payment-page rate, true completion rate, and value-weighted
search-vs-browse deal size. Each is a query builder + a Conversion-tab exhibit.

### 3. Cross-day attribution 🟡 (doable now)

Current search CVR is same-day only. Add a 7-day attribution window via an
`anonymous_id` join across dates — needs no new export.

### 4a. Backfill the GC dimension into W1–W3 🟡 (investigate — later)

`gc_id` / `gc_name` only exist from **W4 (Apr 23)** — the W1–W3 CSVs are narrow
hand-exports that predate the wide `SELECT *` format, so GC segmentation starts
at W4 (`GC_MIN_WEEK = 4` in `assetSearch.js`). But the global `trackEvent` GC
stamp has been on *every* event since well before launch, so the **raw Rudder
tables for Apr 2–22 should still carry `gc_id`**. If retention covers that
window, a re-fetch of W1–W3 via the #1 Metabase pipeline (wide `SELECT *`) would
widen those CSVs and let `GC_MIN_WEEK` drop to 1 — giving full-history GC
segmentation. Action when picked up: (a) verify Rudder retention for Apr 2–22;
(b) if present, re-fetch W1–W3 wide and lower `GC_MIN_WEEK`; (c) if the rows are
gone, GC history simply starts at W4 (acceptable — documented in the section
copy). Unlocked by #1; also relevant to the `invest_now_button_clicked` prune
(currently 4 cols, no `gc_id`) — widen it there to enable GC-split conversion.

### 4. Daily-granularity dashboard views 🟡 (its own project)

Today the dashboard is entirely week-grained — `groupTables()`, every
`assetSearch.js` / `conversion.js` builder, and every chart aggregate by
feature week. Per-day views (daily trend lines, day-of-week patterns) are a
genuine analytics improvement, but a real project: it means re-grained CSVs +
reworking every builder, and a migration plan for the **frozen W1–W6 weekly
CSVs** (the W1–W3 thin schema cannot be re-fetched). The live-data fetch
pipeline (#1) is unaffected — it already fetches at a fine grain internally;
this item is purely about what the dashboard *shows*. Scope it separately.

## Open decisions

- `view_payment_status_page` schema — does it carry a success/fail column?
  Confirm before building the completion metric.
- Per-issuer outcome attribution — a session that searches two issuers is
  counted under each (matches the existing `sessions` convention); revisit if
  cross-issuer double-counting becomes material.
- W7+ data — W7 (14 May onward) is not yet exported; #1 makes this automatic.
