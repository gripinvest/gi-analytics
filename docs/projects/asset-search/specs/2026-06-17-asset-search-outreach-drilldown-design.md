# Asset Search — Outreach Drill-down + Raw Export

**Date:** 2026-06-17
**Branch:** `feat/asset-search-outreach-drilldown`
**Status:** Design — pending user review

## 1. Context & motivation

The growth team asked whether we can produce a report with:

> User id, date, search keyword, result keywords, clicked results, invested

In discussion two distinct needs surfaced:

1. **The fields report** — a row-level export they can pivot in Excel.
2. **"How do we access historical data?"** — growth finds the current dashboard
   (weekly *aggregates*) hard to read at the individual level. They want to see
   *what a specific user did over time* to take an accurate outreach call.

The Asset Search **Editorial** dashboard already has an Outreach section
(`AssetSearchOutreachSection.jsx` + `lib/queries/outreach.js`) — a CS-facing
workbench listing every `user × issuer` pair from failed searches the registry
maps to a known issuer. It deliberately carries **`user_id` only, no PII**
(email/name/phone kept off the auth-light web tier; CS joins `user_id` to CRM).

This feature extends that section with a per-user drill-down and a raw export.

## 2. Data foundation (verified against W4–W10)

Source: `backend/data/asset_search/` weekly tables, served through the existing
DuckDB query layer (`unionAll` + test-user `EXC` + `colsWithEngineVersion`
patterns in `lib/queries/`).

Verified facts (not assumptions):

- **Search is login-gated.** `asset_search_initiated`, `_query`, and
  `_result_clicked` events have **0.0% null `user_id`** — every searcher has an
  account id. `anonymous_id` is the Segment/Rudderstack *device-level* base id
  present on every event for every visitor; it coexists with `user_id` on 100%
  of search events. Null `user_id` (1.2%) appears only on `assets_page_views`
  (the page is viewable pre-login). → **Keying on `user_id` loses nothing.**
- **`investment_status` is a per-event base trait** (boolean `True`/`False`,
  100% populated) stamped server-side. It **first appears in W4** — W1–W3
  events predate it.
- **Clicked items are asset *codes*** (`clicked_asset_name` = e.g.
  `RCBUG260602`; `clicked_asset_id` = numeric DB id; `clicked_asset_type` =
  `bonds`/`high_yield_fd`/`sdi`). **No human-readable asset name exists** in
  this dataset or in `ISSUER_MAP`.
- **"Results shown" is not logged** — only `results_count` (a number). Result
  asset names exist only for results that were *clicked*.
- **Keywords are raw typed strings, including partials** ("Govt b", "Treas",
  "15 per") — search-as-you-type. `is_refinement` distinguishes refinements.
- `ISSUER_MAP` resolves **search keyword → issuer name** for ~11 curated
  issuers (keyword-prefix match). It does **not** resolve clicked asset codes.
- **GC vs platform user is cleanly distinguishable.** `gc_name`/`gc_id`
  populated ⇒ a **Grip Connect (partner) user**, and `gc_name` names the partner
  ("ET money", "Mobikwik", "Paisa Bazaar", …); empty ⇒ a **direct platform
  user**. ~17% GC in W10. `external_user_id` (the partner's user id) is
  populated for exactly the GC rows. Matters for outreach: GC users are often
  reached via the partner, not directly.

### Field feasibility

| Requested field | Verdict | Source |
|---|---|---|
| User id | ✅ build now | `user_id` (100% on search events) |
| date | ✅ build now | `timestamp` |
| search keyword | ✅ build now | `query_text` |
| clicked results | ✅ build now | `clicked_asset_name` (code), joined via shared `query_text` |
| invested | ✅ build now (W4+) | `investment_status` boolean |
| result keywords | ⛔ pending growth | only `results_count` logged; "shown" names not captured |

## 3. Decisions locked (with the user)

- **`user_id` only — no PII.** Matches the existing outreach convention.
- **Two surfaces:** per-user history modal (**primary**) + raw CSV export
  (**secondary**, for Excel/bulk).
- **Keep the full outreach table** — add a click-to-open modal on top; do **not**
  trim columns.
- **Modal content = summary scorecard (top) + chronological search timeline
  (below)** — a mix of stats-first and narrative.
- **Scope `invested` to W4+;** earlier weeks carry `invested = unknown`.
- **Add a user-source identifier (GC vs platform) to both the base outreach
  table and the modal — secondary.** Derived from `gc_name` (present ⇒
  `GC · <partner>`, empty ⇒ `Platform`).
- Mobile-first (standing rule for grip-analytics UI); match the existing
  Editorial / data-dense conventions in `AssetSearchOutreachSection`.

### Real-data-only + loading clarity (added per user, 2026-06-17)

Now that V2 is live, the dashboard must not show dummy/sample numbers. The
underlying pain is **ambiguous loading**: live sections show skeletons while
fetching, but the mock-backed sections (the V1-vs-V2 cutover strip and the
outreach section) render sample numbers immediately with no loading affordance,
so mid-load the dashboard looks inconsistent and people panic (the only signal
is an easy-to-miss top-right sample/live badge). Fix: both sections become
**three-state — loading skeleton → live data → "waiting for live data" pending
panel**, never mock. Remove the mock datasets (`engineHealthMockSample`,
`engineOutcomeMockSample`, `outreachMockSample`) and their dead exports. Bundled
into the Phase-1 deploy with the modal.

### Delivery sequencing (per user)

Ship in two phases, with a hard checkpoint between them:

1. **Phase 1 — drill-down modal only.** Build + verify the per-user history
   modal on the outreach table. **Commit and deploy to `main`** before any CSV
   work. (Note: org move may have broken Vercel/Render auto-deploy — confirm the
   deploy actually lands; a manual trigger may be needed.)
2. **Phase 2 — raw CSV export.** Only after Phase 1 is on `main` and deployed.

## 4. Surface 1 — Per-user history modal (primary)

**Trigger:** click a row (the `user_id`) in the existing outreach table.

**Content:**
- **Header / scorecard:** `user_id`, invested (Yes/No), KYC status
  (`obpp_kyc_status`), **user source** (Platform, or `GC · <partner name>` —
  secondary), active date range, and totals — searches, distinct keywords,
  result-clicks, zero-result searches, notify-me clicks.
- **Chronological search timeline:** one entry per search — date, keyword
  (→ issuer via `ISSUER_MAP` where it maps), `results_count` (or a "dead-end"
  flag when 0), assets clicked shown as `type · code`, refinement flag.
- **Issuer interest** (secondary): which issuers the user's searches map to.

**Data flow:** a per-user DuckDB query fired **on row-click** (single filtered
scan over the weekly tables, `WHERE user_id = ?`), not preloaded for all users.
Reuses the established `unionAll` builders.

**Readability note:** clicked assets display as `type · code` until/unless an
asset-master catalog is sourced (see §7).

## 5. Surface 2 — Raw CSV export (secondary)

A download button on the Outreach section producing a flat, row-level CSV of the
clean columns, `user_id` only, test users excluded, scoped W4+.

**Grain — v1 ships Grain A by default; B is a config flip once growth confirms.**
The builder takes a `grain` param so we don't block the build on growth's choice
(samples for both were generated for them to react to):
- **Grain A (v1 default) — one row per search query:** `user_id, date,
  search_keyword, results_count, clicked_results, invested`. Most raw/flexible.
- **Grain B — one row per user × keyword:** `user_id, search_keyword,
  times_searched, first_date, last_date, clicked_results, invested`.

Samples live at (outside the repo, for sharing):
`/Users/purujit/grip/grip-code/grip_analytics/asset_search_report_samples/`
(generated by `generate_samples.py`; validated — `invested=True` = 39.4%,
matching the independently-measured W10 rate of 39.3%).

Serialization is client-side from the query result; `query_text` and the
`clicked_results` list are CSV-escaped (commas/quotes/newlines).

## 6. Pending growth-team inputs (none block the core build)

1. **"result keywords" definition** — assets *shown* (not logged; needs new
   instrumentation or offline replay), *clicked* (already have, == clicked
   results), or *count* (`results_count`). Adds/changes a column later.
2. **Confirm `investment_status` semantics** — ever-invested vs currently-active.
3. **Accept W1–W3 carry `invested = unknown`** (or scope export to W4+).
4. **Pick grain A or B** for the CSV (samples ready).

## 7. Open enrichment (out of scope for v1)

- **Asset code → readable name catalog.** Would require an asset-master source
  (backend / Metabase). Until then both surfaces show codes (+ type).

## 8. Components & files

- `frontend/lib/queries/outreach.js` — new builders:
  - `userSearchHistory({ tables, userId })` — timeline + per-user aggregates.
  - `rawSearchExport({ tables, grain })` — the flat export (NULL-projects
    `investment_status` for pre-W4 weeks, same trick as `engine_version`).
- `frontend/components/dashboards/AssetSearchOutreachSection.jsx` — add row-click
  handler → modal; add the CSV download button.
- New `UserSearchHistoryModal` component (scorecard + timeline), mobile-first,
  matching existing Editorial/data-dense styling.

## 9. Error handling

- Missing tables → builder returns `null` SQL → existing empty/pending state.
- Pre-W4 rows → `invested = unknown` (coalesced from NULL projection).
- CSV escaping for free-text fields.

## 10. Testing

- Builder output reconciles with `10_daily_funnel_summary.csv` (e.g. total
  query rows, result-click counts) and with the validated sample script.
- Frontend smoke: modal opens for a known `user_id` and renders timeline;
  download produces the expected header + non-zero rows.

## 11. Out of scope (YAGNI)

- Accessibility / SEO focus (internal tool — but don't regress existing a11y
  patterns in the component).
- "result keywords (shown)" column, readable asset names, any PII/email.
