# Asset Search — session log

Where the project stood at the end of each working session. Newest first.
Read the top entry when starting a new session. Supersedes the old loose
`AGENT_CONTEXT.md` handoff.

---

## 2026-05-19 — S3: Metabase data validation

**Status:** S3 complete — branch `feat/asset-search-data-validation`, PR open.
Build-irrelevant (backend Python + docs only; `next build` untouched). Backend
tests: 66 pass.

### Shipped

- **`backend/services/integrations/validate_asset_search.py`** — a deterministic
  validation harness. 23 checks re-compute every dashboard data point (every
  `assetSearch.js` + `conversion.js` builder, plus raw event-table volumes)
  from the local W1–W6 CSVs and, in `metabase` mode, from the live `client_web`
  schema, then diff under a two-tier verdict policy (exact → CONFIRMED /
  ≤5 rows·0.5%·0.3pp → MINOR DRIFT / larger → DISCREPANT). One SQL body per
  check, run as DuckDB tables locally and CTEs on Metabase; each Metabase
  relation is anchored to its CSV's exact UTC timestamp window.
- **`metabase.py`** — added `run_sql()` for ad-hoc native queries (`/api/dataset`).
- **`metabase-validation-report.md`** — the validation report (committed).
- **`data-sources.md` §0/§6 corrected** — see F1.
- Tests: `run_sql`, the two-tier classifier, row diffing, the ported issuer SQL.

### Finding F1 — data-sources.md §0 overstated every W1–W6 row count

§0 claimed `query` 29,582 etc. Those totals were summed from `metabase-connect/`,
which holds **two** W6 exports — a superseded partial (`W6_may07-may11`) and the
full week (`W6_may07-may13`) — and the partial was added on top of the full
week. The dashboard's deployed data (`backend/data/asset_search/`, full W6 only)
was always correct; only the doc was wrong. Verified exactly for all six events
(e.g. 26,544 + 3,038 = 29,582). §0 corrected; the harness's §0 check is now a
regression guard.

### Pending — the credentialed Metabase run

Per S3 discipline the live-Metabase diff is **not** run interactively. Every
local↔Metabase check in the report is `PENDING`. To complete validation, run
(CI or operator, creds in `backend/.env`):

```
cd backend && python -m services.integrations.validate_asset_search
```

That fills the Metabase column and the verdicts. First run may need two
calibration pins (documented in the report's "Method" section): the `timestamp`
column is assumed naive-UTC, and `user_id` is cast TEXT→DOUBLE — both fail loud
as a SQL error if wrong, never silently.

### Follow-ups (same PR)

- **Internal-consistency tier** — 7 invariant checks on the local data alone
  (no Metabase, no credentials): funnel buckets exhaustive, ZRR/refinement
  bounded, by-tab split reconciles, issuer roll-ups bounded, position clicks
  bounded, funnel monotonic. All 7 **CONFIRMED** — the dashboard numbers are
  mathematically sound. This is the validation that needs no production access.
- **Read-only guard** — the harness prefers a read-only `METABASE_API_KEY`
  over a session login, and `assert_read_only()` rejects anything that is not
  a single bare `SELECT`/`WITH`. The credentialed run is provably incapable of
  writing to Metabase; scope the key read-only in Metabase as defence-in-depth.
- The 10 stale `W6_may07-may11_*` partial exports were moved to Trash from
  `metabase-connect/` (not git-tracked) so the F1 double-count cannot recur.

### When resuming

S3 is done. Next per `sessions/README.md`: S1 / S2 / S4 (parallel-safe), then
S5. The harness's `MetabaseClient.run_sql`, API-key auth and window-anchoring
code is reusable by the S5 fetch pipeline.

---

## 2026-05-19 — S2: shared UI fixes (sign-out / theme-switcher overlap)

**Status:** done — branch `feat/shared-ui-fixes`, [PR #50](https://github.com/purujit-grip/grip-analytics/pull/50)
open to `main`, `next build` clean, browser-verified.

### Shipped

- **New `<PageChrome />`** (`frontend/components/PageChrome.jsx`) wraps Sign out
  + the design switcher in one fixed top-right flex container (`gap-2`). The two
  controls used to be independently `fixed`-positioned, with Sign out pinned at
  a hard-coded `right-[182px]` guess of the switcher's width — the wider
  editorial mono font pushed them into each other. A flex row can't overlap at
  any breakpoint; the magic number is gone.
- `DesignSwitcher` / `SignOut` are now placement-agnostic (no self-positioning);
  `PageChrome` is the single source of truth for chrome layout.
- **Touch targets raised to ≥44 px** — pill buttons and Sign out get
  `min-h/min-w` 44 px with inline-flex centring (were ~26 px). Press feedback
  (`active:scale-0.97`), exact transition properties, `motion-reduce` fallbacks.
- All four call sites (home + project page, Editorial + Classic) render
  `<PageChrome />`.

### Chrome / page-content clearance (audit finding — fixed here)

At 375 px the fixed chrome cluster (~62 px tall) overlapped page content that
reserved no top space for it: the Classic `PageHeader` breadcrumb/title, and the
Editorial dashboard's "BACK TO INDEX" link. The editorial graze was introduced
by S2 itself — the ≥44 px touch-target pill is taller than the old chrome, which
used to clear that link.

Fixed by adding `pt-20` (mobile only; `sm:` reverts) to all four page-shell
containers in `app/page.jsx` and `app/projects/[id]/page.jsx`.

> Scope note: this clearance does **not** belong to S1. S1 (PR #49) only touched
> the dashboard component (`AssetSearchDashboard.jsx`) and its queries — never
> the page shells where the fixed chrome and the collision live. Chrome layout
> is S2's, so the fix is here.

### Verified

Headless-Chromium check at 375 px and desktop, both designs, both pages —
**8/8 page × design × breakpoint checks pass**: Sign out and the pill never overlap,
8 px gap between them, all interactive elements ≥44 px, cluster fits the 375 px
viewport, and the chrome clears every breadcrumb / heading / masthead caption.
`next build` clean.

---

## 2026-05-19 — S1: Classic dashboard parity (PR open)

**Status:** S1 complete — [PR #49](https://github.com/purujit-grip/grip-analytics/pull/49)
open to `main` (branch `feat/asset-search-classic-parity`), `next build` clean.

The Classic Asset Search dashboard is **un-deprecated** and back to full data
parity with Editorial. Both renderings now read the same query builders, so they
always show identical numbers.

- Removed the `@deprecated` JSDoc banner from `AssetSearchDashboard.jsx`.
- Registered `sessionOutcomeByWeek` / `sessionOutcomeByIssuerWeek` in Classic's
  query specs.
- Overview: added a **Search Success Rate** headline stat (51.9%, W1–W6) and a
  **Search-outcome funnel** chart (Success / Relevance gap / Dead end) mirroring
  Editorial's Fig 3.
- Issuers: `buildIssuers` now joins the live per-issuer outcome rows; issuer
  cards show a Success rate, the detail panel shows the per-issuer outcome
  funnel — replacing the cleared-event "true abandonment vs relevance gap"
  reconstruction.
- `assetSearch.js`: deleted the legacy `ISSUER_MAP.abandoned`/`relgap` arrays
  (nothing reads them now); `METRIC_DEFS.abandoned`/`relgap` → `successRate` /
  `relevanceGap` / `deadEnd`; reworded cleared-event copy throughout.
- **Verified live:** Classic and Editorial both show **51.9%** search success
  rate; per-issuer funnel buckets sum to 100%. Audited at 375 px and 1280 px —
  no horizontal scroll, charts + legends render, issuer cards stack cleanly.

`search_analytics/reconstruct_abandonment.py` is now fully unreferenced (the
funnel superseded it); retiring that file is left to a follow-up — out of S1's
scope.

---

## 2026-05-18 — session planning

**Status:** PR #42 **merged & deployed.** Next work is broken into 5 scoped
sessions — see [`sessions/README.md`](./sessions/README.md). Each is its own
worktree / branch / PR; S1–S4 are parallel-safe, S5 follows S4.

- **S1** — Classic dashboard: un-deprecate + session-outcome funnel parity + mobile-first
- **S2** — Shared UI fixes: sign-out / theme-switcher overlap
- **S3** — Validate Asset Search data points against Metabase
- **S4** — Asset Search live-data design spec (Metabase fetch + daily cron)
- **S5** — Asset Search live-data implementation

Decisions locked: Classic → full parity with Editorial; Metabase creds are in
`backend/.env`; live-data work adapts (not copies) the Grip Connect spec.

---

## 2026-05-18 — session-outcome funnel (PR #42, merged)

### Shipped — PR #42 (`feat/asset-search-dashboard-updates`)

https://github.com/purujit-grip/grip-analytics/pull/42 · 9 commits · rebased on
`main`, build-clean.

- **Session-outcome funnel** — the new primary metric. Every searched session
  classified once: Success / Relevance-gap / Dead-end, live from
  `asset_search_query` + `asset_search_result_clicked`. Overall (Editorial
  Overview, Fig 3) + per-issuer (Issuers section). Search Success Rate ~52%→59%.
- Retired the `asset_search_cleared` abandonment reconstruction from the
  maintained dashboard (understated failure ~10×; W1–W3 lacked the payload).
- Full **W6** data (7–13 May); "partial week" copy removed; masthead date range
  + feature-week glossary.
- Interactive **SORT BY** control on the issuer list (default: Searches).
- **Classic dashboard deprecated** (`@deprecated`); Editorial is maintained.
- **Project doc structure** — `docs/projects/<project>/` + `docs/architecture/`;
  new repo `CLAUDE.md` defining the project- vs platform-level pattern.

### Where we stand / in flight

- **PR #42** — open, base `main`. Squash-merge recommended (history contains the
  reconstruction commits later retired).
- **Localhost validation pending** — the post-funnel dashboard has not been
  eyeballed rendered. Before merge: `npm run dev` from the worktree, open
  `/projects/asset_search` Editorial, check Fig 3 funnel + Issuers tab + III·b.
- **Worktree** at `grip_analytics/wt-asset-search/` on branch
  `feat/asset-search-dashboard-updates`. `ExitWorktree` to clean up after merge.

### When resuming — pick up from

1. If #42 merged → **roadmap item #1: Asset Search live data** — Metabase fetch
   via the `backend/services/integrations/` framework (apply the approved Grip
   Connect spec). **Blocker:** `METABASE_EMAIL` / `METABASE_PASSWORD` creds.
2. If #42 not merged → finish localhost validation, then merge.
3. Then roadmap #2 — export `view_payment_page_loaded` + `view_payment_status_page`
   for payment-stage conversion; roadmap #3 — cross-day attribution (doable now).

See [`roadmap.md`](./roadmap.md) for the full next-steps detail.

### Context not visible in the code

- The reconstruction (`search_analytics/reconstruct_abandonment.py`, the
  `ISSUER_MAP.abandoned/relgap` arrays) is **legacy** — superseded by the funnel.
  Don't build on it. The arrays stay only because the deprecated Classic
  dashboard still reads them.
- The 8-step review ran *before* the funnel build; the funnel was build-validated
  and its SQL validated against real data, but not re-reviewed end-to-end.
- A concurrent agent works on **Grip Connect** in this repo — always work in a
  dedicated worktree (standing mandate).
- No live Metabase connection this session — claims were validated against the
  local W1–W6 CSV exports in `metabase-connect/`.
- Data window is W1–W6 (through 13 May); W7+ not yet exported.
