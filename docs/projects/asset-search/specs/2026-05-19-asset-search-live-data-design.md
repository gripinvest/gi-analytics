# Asset Search — Live Data (design spec)

- **Date:** 2026-05-19 · revised 2026-05-19 after an 8-agent review pass.
- **Status:** Draft — for review (S4 deliverable; implementation is S5).
- **Scope:** Make the Asset Search dashboard run on live Metabase data — a daily
  auto-fetch so the dashboard always shows the current feature week, plus
  onboarding of the not-yet-exported event tables.
- **Relation to prior docs:** Second project on the live-data framework. It
  *adapts* the approved Grip Connect spec
  [`docs/specs/2026-05-17-grip-connect-live-data-design.md`](../../../specs/2026-05-17-grip-connect-live-data-design.md)
  — same architecture, materially different fetch shape (§3). It does **not**
  copy it; §3 and §4 enumerate every divergence.
- **Canonical data reference:** [`../data-sources.md`](../data-sources.md) is the
  source-of-truth for which events/tables feed the dashboard and what each
  column means. Where this spec and `data-sources.md` disagree, that doc wins.

---

## 1. Goal

Today the Asset Search dashboard reads CSVs hand-exported from Metabase into
`grip.duckdb` — one CSV per `(feature-week, event)` pair, baked at deploy time.
The data window is frozen at **W1–W6** (2 Apr – 13 May 2026); W7 onward only
appears when someone manually exports and commits it.

The goal: the dashboard reflects the **current feature week** automatically — a
daily fetch that pulls the in-progress week from Metabase and commits it, plus a
manual **Refresh** button — with no hand-exporting and no LLM in the data path.

### In scope

- A deterministic Python fetch module pulling Asset Search event data from
  Metabase by native SQL, windowed by feature week.
- A daily scheduled refresh (durable, git-committed) + a manual refresh endpoint.
- Generalising the existing `integrations/refresh.py` runner — currently
  Grip-Connect-only — into a per-project registry.
- The *design* for onboarding the five not-yet-exported tables (§10) — their
  fetch is registered but gated on `roadmap.md` #2 (see D8).
- Frontend: instant render of the last snapshot, an "as of" marker with a
  staleness warning, a manual Refresh button.

### Out of scope (deferred)

- **Implementation** — that is S5. This spec is the build contract.
- New dashboard exhibits for the payment-stage tables — `roadmap.md` #2.
- A dedicated Metabase service-account API token (personal creds for v1, §13).
- Re-fetching the frozen historical weeks W1–W6 (§11 cut-over).
- A declarative cross-project "integrations" schema — deferred platform-wide.

---

## 2. What already exists

When the Grip Connect live-data spec was implemented it built a **reusable
framework** under `backend/services/integrations/`. Asset Search is the second
project onto it. What is reusable, and what each part actually needs:

| File | Current state | For Asset Search |
|---|---|---|
| `integrations/metabase.py` — `MetabaseClient` | `login()`, `fetch_card()`, saved-card param helpers (`card_param_id`, `gc_name_param`). Plain `httpx`. | **Reuse + extend** — add `run_native_query()` (§6.1). The saved-card helpers are GC-shaped and Asset Search will not call them — the class has two non-overlapping usage modes by design. |
| `integrations/accumulate.py` — `upsert_csv()` | Atomic upsert-by-key CSV writer. | Used by GC. **Asset Search does not use it** — it writes whole week-files atomically (D5). A small `write_csv_atomic()` helper is added instead. |
| `integrations/refresh.py` — `run_refresh()` + CLI | **Grip-Connect-bound**: top-level imports `grip_connect`, a GC-shaped `KEYS` dict, `run_refresh(client, data_dir, partners=…, active_week_start=…)`. The CLI `main()` hardcodes `grip_connect`. | **Refactor into a per-project registry** (D6) — not a small dispatch add. See §8. |
| `routers/refresh.py` | `POST/GET /api/projects/{id}/refresh`, async + polling, per-project lock. Calls `refresh_mod.run_refresh(client, csv_dir)` — passes a **path, not a `project_id`**. | Reused, but **the call site changes** (D6) — see §8. |
| `integrations/transforms.py` | Pure helpers (`to_float`, column detectors). | Reuse the generic ones if needed. |
| `integrations/validate.py` | `validate_north_star` — GC-specific. | **New** Asset Search validators (§14). |
| `.github/workflows/refresh-grip-connect.yml` | Daily cron + commit-back pattern (`cron: "30 3 * * *"`). | **Copy → `refresh-asset-search.yml`** (§9). |
| `frontend/lib/api.ts` | `refreshProject()` / `pollRefresh()` already exist. | Reuse as-is. |
| `frontend/app/projects/[id]/page.jsx` | Fetches the project + renders the dashboard. **It does NOT contain any freshness/refresh logic today.** | The refresh UI must be **built** (§12) — it is not "already wired". |

The current W1–W6 CSVs were produced by running SQL in Metabase and exporting
(the `metabase-connect/` working folder). This spec turns that ad-hoc step into
the deterministic fetch module — the SQL moves into version-controlled query
templates (§6).

---

## 3. Why Asset Search differs from Grip Connect

| Aspect | Grip Connect | Asset Search |
|---|---|---|
| Source unit | 5 saved cards, parameterised by partner | **14** raw event tables — 6 search events + `view_assets` + 2 invest/conversion events + 5 new payment-stage tables (§10) |
| Fetch mechanism | `POST /api/card/{id}/query` | `POST /api/dataset` — native SQL, date-range bound (D1) |
| Granularity | Pre-aggregated row per partner × period | Raw event rows |
| Windowing | Calendar month (MTD/LMTD) | Feature week from the 2 Apr launch (D2) |
| Derived layer | Layer-2 tables computed in Python | None — `assetSearch.js` SQL builders are the derivation layer (D4) |
| Accumulation | Row upsert by `(partner, week)` | Atomic whole-week-file replace (D5) |

GC keeps metric SQL inside Metabase cards owned by the data team — Asset Search
deliberately gives that up (D1): the trade-off is analysed in §17.

---

## 4. Locked decisions

| # | Decision | Choice & rationale |
|---|---|---|
| D1 | **Fetch mechanism** | **Raw native SQL via `POST /api/dataset`**, not saved cards. The dashboard needs raw event rows per `(week, event)`; no saved card returns that. `MetabaseClient` gains `run_native_query(database_id, sql)` (§6.1). **Gated** — see the pre-S5 check in §18. |
| D2 | **Windowing** | **Feature week**, not calendar. W*n* = `[launch + 7·(n−1), launch + 7·n)`, launch = **2 Apr 2026**, IST. `feature_week.py` (§6.4) computes it. |
| D3 | **Re-fetch scope** | The daily job fetches the **current in-progress week + the immediately-prior week** (a trailing 2-week window) to absorb late-arriving events. Older weeks are **frozen** and never fetched. Events arriving >14 days late are accepted data loss (§17, §18). |
| D4 | **Data model** | **Layer-1 only** — raw event tables per `(week, event)`. The `assetSearch.js` query builders already compute every metric live in SQL over the raw views; a layer-2 would be a *second* definition of each metric. (GC's §16 chose Python-computed layer-2 because GC's metric logic already lived in `metabase_fetch.py`; Asset Search's already lives in `assetSearch.js` — "don't duplicate the existing derivation" is the consistent principle, applied to different starting points.) Performance implications: §17. |
| D5 | **CSV unit & accumulation** | One CSV per `(feature-week, event)`. The daily run, for each week in the D3 window, runs the full week's SQL and **atomically replaces the whole CSV** (temp-file + rename). No row-level upsert — re-querying the whole week each run already absorbs late events, and it removes any dependency on a stable per-row key. "Accumulation" is purely additive: new `W{n}` files appear; frozen files never change. |
| D6 | **Runner shape** | Refactor `integrations/refresh.py` into a **per-project registry**: `REGISTRY = {project_id: run_callable}`. GC's current `run_refresh` body becomes `grip_connect.run(client, data_dir)`; Asset Search adds `asset_search.run(client, data_dir)`. Both have the identical signature `run(client, data_dir) -> dict`. `routers/refresh.py:35` changes from `run_refresh(client, csv_dir)` to `run_refresh(project_id, client, csv_dir)` (one line). The GC CLI keeps working — `main()` takes a positional `project_id`, defaulting to `grip_connect`. **Behaviour-preserving for GC is a Phase-2 regression gate** (§16). |
| D7 | **Schedule & commit split** | A GitHub Action on a **daily 12 AM IST** cron (`cron: "30 18 * * *"` UTC). To bound git growth (§17): the **search-event CSVs** (small) are fetched and committed **daily**; the heavy browse/conversion tables (`view_assets`, `invest_now_button_clicked`) are fetched and committed **weekly**, on the week-rollover run only. (`asset_card_clicked` joins the weekly-heavy set once D8 enables it — until then it is not fetched at all.) The §6.2 registry's per-event flags are authoritative. |
| D8 | **New-table onboarding** | The five tables in `data-sources.md` §3/§5 are **registered** in the event registry with their stems and keys (§10), so onboarding is a solved design. But their **daily fetch stays disabled** until `roadmap.md` #2 (the dashboard exhibits that consume them) begins — fetching consumer-less data daily is avoidable cost. Turning each on is a one-line registry flag. |
| D9 | **Credentials** | Personal `METABASE_EMAIL` / `METABASE_PASSWORD` for v1 (already in `backend/.env`). Because the daily job is unattended, a **service-account `X-API-Key` is a Phase-5 prerequisite, not an open-ended follow-up** (§13). |
| D10 | **Test-user exclusion** | Every fetch SQL excludes test users `3, 4, 207871, 207875, 207878, 207879`. The list is **single-sourced** — one `TEST_USERS` constant imported by the fetch module, mirroring `assetSearch.js`'s constant (§6.3). |
| D11 | **Data path** | Deterministic Python only. Claude authors & validates the scripts; never runs extraction at runtime. No LLM in the data path. |

---

## 5. Architecture

```
                ┌───────────────────────────────────────────────────┐
                │  Metabase  ·  database_id 8  ·  schema client_web  │
                └───────────────────────┬───────────────────────────┘
                                        │  POST /api/dataset (native SQL)
                ┌───────────────────────▼───────────────────────────┐
                │  asset_search.run()  (deterministic Python)         │
                │   · resolve current + prior feature week (D2,D3)    │
                │   · per-event SQL template, date-range + test-user  │
                │   · atomic whole-week CSV replace (D5)              │
                └────────┬──────────────────────────────┬────────────┘
   refresh.py REGISTRY   │   {project_id: run_callable}  │  imported by
   standalone CLI ───────┤                               ├─── POST /refresh
                ┌────────▼─────────┐            ┌─────────▼─────────┐
                │ GitHub Action     │            │ POST …/refresh    │
                │ daily 12 AM IST   │            │ (in-container,    │
                │ commits CSVs (D7) │            │  immediate)       │
                │ + alerts on fail  │            └─────────┬─────────┘
                └────────┬──────────┘                      │
                         │                                 │
                ┌────────▼─────────────────────────────────▼────────┐
                │  canonical CSVs  ──►  build_duckdb.py  ──►  DuckDB  │
                │  file:  W{n}_{mmmDD-mmmDD}_{event}.csv              │
                │  table: asset_search__W{n}_{mmmDD_mmmDD}_{event}    │
                └────────────────────────┬───────────────────────────┘
                                         │  /api/projects/asset_search/query
                ┌────────────────────────▼───────────────────────────┐
                │  AssetSearchDashboard.jsx + …Editorial.jsx          │
                │  (assetSearch.js builders run live SQL over views)  │
                └──────────────────────────────────────────────────────┘
```

The dashboard viewer always reads DuckDB, which is already populated.
Extraction never happens on the open path.

---

## 6. The fetch module — `asset_search.py`

A new `backend/services/integrations/asset_search.py`, exposing
`run(client, data_dir) -> dict` (the registry callable, D6) and a
`build_layer1(client, weeks) -> dict[str, list[dict]]` it calls internally.
`run()` owns the whole flow: resolve weeks → fetch → write CSVs → write
`_manifest.json` → return a summary `{status, log, refreshed_at}`.

### 6.1 Metabase native query

`MetabaseClient` gains:

```python
def run_native_query(self, database_id: int, sql: str) -> tuple[list[dict], list[str]]:
    """POST /api/dataset with a native query; return (rows-as-dicts, columns)."""
```

Body: `{"database": <id>, "type": "native", "native": {"query": <sql>}}`.
Response parsing reuses `fetch_card`'s `data.cols` / `data.rows` logic, **but
column names use `name` (the raw DB column), not `display_name`** — the CSV
column headers must be the raw columns the `assetSearch.js` builders reference.
`database_id` is **8** (`data-sources.md`). The SQL is machine-generated from
`feature_week.py` values (not user input), so string interpolation of the date
bounds carries no injection surface — stated explicitly here so reviewers need
not re-derive it.

### 6.2 Event registry

Module-level config. Each entry pins three things: the Metabase **source
table** (the SQL `FROM`), the **CSV stem** (must match what is on disk for
already-exported events), and a **daily** flag (D7/D8):

| Registry key | Source table (`FROM client_web.…`) | CSV stem fragment | Fetched daily? |
|---|---|---|---|
| `initiated` | `asset_search_initiated` | `asset_search_initiated` | yes |
| `query` | `asset_search_query` | `asset_search_query` | yes |
| `result_clicked` | `asset_search_result_clicked` | `asset_search_result_clicked` | yes |
| `empty_state` | `asset_search_empty_state` | `asset_search_empty_state` | yes |
| `cleared` | `asset_search_cleared` | `asset_search_cleared` | yes |
| `suggestion_clicked` | `asset_search_suggestion_clicked` | `asset_search_suggestion_clicked` | yes |
| `assets_page_views` | `view_assets` | `assets_page_views` | weekly (heavy) |
| `invest_now` | `invest_now_button_clicked` | `invest_now_button_clicked` | weekly (heavy) |
| `quick_checkout` | `quick_checkout_invest_clicked` | `quick_checkout_invest_clicked` | yes (small) |
| `payment_page` | `view_payment_page_loaded` | `view_payment_page_loaded` | **off** (D8) |
| `payment_status` | `view_payment_status_page` | `view_payment_status_page` | **off** (D8) |
| `new_user_order` | `new_user_order` | `new_user_order` | **off** (D8) |
| `order_summary` | `order_summary_clicked` | `order_summary_clicked` | **off** (D8) |
| `asset_card_clicked` | `asset_card_clicked` | `asset_card_clicked` | **off** (D8) |

**Critical naming rule.** The on-disk CSV filename is
`W{n}_{mmmDD-mmmDD}_{stem}.csv` — the date range is **hyphen-joined**
(`W4_apr23-apr29_asset_search_query.csv` — verified against the committed
files). `build_duckdb.py` builds the table name as
`{project}__{filename-stem}` with `-` replaced by `_`, so the *table* is
`asset_search__W4_apr23_apr29_asset_search_query` while the *file* keeps the
hyphen. `feature_week.label()` (§6.4) must emit the hyphen form. The six search
events match `groupTables()`'s regex `…_asset_search_(event)$` unchanged; the
non-search stems do not — and must not be added to that regex (D8 / `roadmap.md` #2).

### 6.3 Per-event SQL template

```sql
SELECT *
FROM client_web.<source_table>
WHERE timestamp >= '<week_start>' AND timestamp < '<week_end>'
  AND (user_id IS NULL OR user_id NOT IN (3,4,207871,207875,207878,207879))
```

- `SELECT *` keeps the export column-complete (the chat panel and some
  builders rely on the full Rudder payload). Trade-off — schema drift — is in §17;
  the §14 column-presence validator is the guard.
- `<week_start>`/`<week_end>` are the feature-week bounds. **Their timezone is a
  pre-S5 gate (§18)** — determined from the actual `client_web` column
  definition, not reverse-engineered from the existing exports.
- A table with no `user_id` column (possible for `view_assets`) drops that
  `AND` clause — pinned per table in Phase 1.

### 6.4 Feature-week helper — `feature_week.py`

```python
LAUNCH = date(2026, 4, 2)               # W1 day 1
FIRST_LIVE_WEEK = 7                     # W1–W6 are frozen hand-exports (§11)
def week_of(d) -> int                   # 1-based feature-week number
def bounds(n) -> tuple[datetime, datetime]      # [start, end) for week n
def label(n) -> str                     # "W7_may14-may20" — hyphen-joined
def current_and_prior(today) -> list[int]
    # the D3 window, clamped to >= FIRST_LIVE_WEEK so a frozen week is
    # never returned (prevents the first run from rewriting W6)
```

---

## 7. Data model — layer-1 only

Asset Search stores **only raw event tables**. Every metric definition lives in
`frontend/lib/queries/assetSearch.js` (`sessionOutcomeByWeek`,
`issuerHealthByWeek`, the conversion builders, …), which run live SQL over the
per-week DuckDB views. There is no second place a metric is computed, so there
is **no layer-2 table to keep in sync**.

Consequences:
- The fetch's only job is to land correct, complete raw CSVs per week.
- Onboarding a new feature week is purely additive — new `W{n}_…` CSVs appear,
  `groupTables()` picks them up, every per-week chart extends by one week.
- A new *event type* (the §10 tables) needs query builders + exhibits before it
  surfaces — `roadmap.md` #2, out of scope here.
- The cost of no materialised layer — query latency growing with accumulated
  weeks — is a real trade-off, quantified and bounded in §17.

### Data integrity — no duplication by construction

A refetch must never duplicate or corrupt data: on an analytics surface a
double-counted row is a silently wrong number, which is a critical failure.
The design guarantees this through three mechanisms — it is a structural
property, not a hope:

1. **Whole-file atomic replace — never append or merge (D5).** Each daily run
   queries the *complete* set of rows for a week and atomically rewrites that
   week's CSV (temp file + `os.replace()`). There is no append step and no
   row-merge step, so there is no code path by which a row can land in a file
   twice — a refetch is idempotent (re-running yields a byte-identical file).
   This is precisely why D5 drops `id`-keyed upsert: upsert is the *only*
   mechanism that could double rows (a wrong or unstable merge key appends
   instead of replacing). Removing it removes the failure mode entirely.
2. **Non-overlapping week windows.** The fetch SQL uses a half-open interval
   `timestamp >= week_start AND timestamp < week_end`; consecutive weeks abut
   exactly. Every event belongs to exactly one week-file; the trailing 2-week
   refetch (D3) rewrites two *distinct* files, never the same row's file twice.
3. **`UNION ALL` over disjoint weeks.** `assetSearch.js` unions the per-week
   tables; disjoint inputs that each carry no internal duplicate produce a
   correct, duplicate-free whole.

Guards that keep this true:
- `feature_week.bounds()` has boundary unit tests (`test_feature_week.py`,
  §16 Phase 1 — launch day, week rollovers); a bug producing overlapping
  weeks is caught there and by the §14 validator's "every row's `timestamp`
  is inside the week" check.
- The §14 row-count sanity band (a >10× swing vs the prior week) catches a
  doubled or empty result before cut-over and pages an alert.
- **The DuckDB reload after a manual in-container refresh must be atomic from
  a reader's perspective** — load into a fresh schema and swap it in, or hold
  a brief reader lock — so a dashboard query landing mid-reload never sees a
  half-loaded table. A Phase-3 build requirement (§16). The scheduled path has
  no such risk: it commits to git, redeploys, and a fresh container rebuilds
  DuckDB from scratch.

---

## 8. Components & files

### New

| File | Role |
|---|---|
| `backend/services/integrations/asset_search.py` | Fetch module — registry, SQL templating, `run()`, `build_layer1()`. |
| `backend/services/integrations/feature_week.py` | Feature-week math (§6.4). |
| `backend/data/asset_search/_manifest.json` | `{refreshed_at, tables: {table: {last_refreshed_at}}}` — mirrors GC's manifest schema; drives the "as of" display + the staleness alarm (§15). |
| `.github/workflows/refresh-asset-search.yml` | Daily 12 AM IST cron; commits changed CSVs; **notifies on failure** (§15). |
| `tests/integrations/test_asset_search_fetch.py` | Fetch / SQL-template / stem tests (mocked Metabase). Written in Phase 1. |
| `tests/integrations/test_feature_week.py` | Feature-week boundary tests. Written in Phase 1. |

### Modified

| File | Change |
|---|---|
| `integrations/metabase.py` | Add `run_native_query()` (§6.1). |
| `integrations/refresh.py` | Refactor to a per-project `REGISTRY` (D6): extract GC's body into `grip_connect.run()`, add `asset_search` to the registry, `run_refresh(project_id, client, data_dir)` dispatches, CLI `main()` takes a positional `project_id` (default `grip_connect`). |
| `integrations/grip_connect.py` | Add a `run(client, data_dir)` wrapper around its existing fetch so it matches the registry signature. No behaviour change — Phase-2 regression gate. |
| `integrations/validate.py` | Add Asset Search validators (§14). |
| `routers/refresh.py` | One line: pass `project_id` into `run_refresh` (D6). |
| `tests/integrations/test_refresh_endpoint.py` | Update the `run_refresh` monkeypatch for the new `project_id` argument. |
| `backend/data/asset_search/project.json` | Add `refreshable: true`. Update the stale `"W1-W6"` tag and the "6 weeks" description to not hard-code the window. (No `freshness` field — there is no on-open auto-refresh; see §12.) |
| `frontend/components/dashboards/AssetSearchDashboard.jsx` & `…Editorial.jsx` | Refresh button, refresh-state chip, "as of" marker + staleness warning — both variants (at parity since S1). |

No change expected to `build_duckdb.py` — it bakes every CSV by the
`{project}__{stem}` rule. **Phase-1 check:** confirm DuckDB tolerates per-week
CSVs of the same event with *different column sets* (the `asset_search_cleared`
W1–W3 vs W4+ split, `data-sources.md` §2a) — `read_csv_auto` is column-name
based, so this should hold, but it is verified, not assumed.

---

## 9. Refresh — durable vs immediate

### Scheduled — the durable populator

`.github/workflows/refresh-asset-search.yml`, `cron: "30 18 * * *"` (00:00 IST):
checkout → `pip install` → `python -m services.integrations.refresh asset_search`
→ the module rewrites the in-window CSVs (D7: search events daily, heavy tables
on week-rollover) → commit & push **only if changed**. The push triggers a
redeploy; `build_duckdb.py` bakes the CSVs. Secrets from GitHub Actions secrets.
**On job failure the workflow notifies** (§15) — a silent failed cron is the
single worst outcome for an "auto-fresh" dashboard.

### Manual — the immediate path

`POST /api/projects/asset_search/refresh` → `{job_id}` → background thread runs
`asset_search.run()` in-container → reloads DuckDB via
`db.load_csvs_for_project`. `GET …/refresh/{job_id}` reports `{status, log,
error}`; the frontend polls every 2 s. One refresh per project (existing lock);
a concurrent request gets `409`. In-container writes are ephemeral — the daily
scheduled run reconciles the durable git copy.

### No on-open auto-refresh

Unlike Grip Connect, Asset Search does **not** background-refresh on page open.
The data changes once per day (the cron); between runs a fetch would re-run
heavy native queries to produce a byte-identical result. The dashboard renders
the last snapshot and shows its "as of" time; the user forces an update with the
Refresh button if needed. (This is a deliberate divergence from GC §8 — see §17.)

---

## 10. New-table onboarding (D8)

The five tables from `data-sources.md` §5, registered in §6.2 with their stems.
`data-sources.md` §3b also lists `quick_checkout_opened` and `view_asset_details`
— deferred; not on the §5 recommended-five list.

| Table | Grain | Upsert/CSV note | Consumer |
|---|---|---|---|
| `view_payment_page_loaded` | one payment-screen load | whole-week file (D5) | `roadmap.md` #2 — search→payment-page rate |
| `view_payment_status_page` | one payment result | whole-week file (D5) | #2 — needs a Phase-1 schema check: does it carry a success/fail column? |
| `new_user_order` | one first-ever investment | whole-week file (D5) | #2 — FTI attribution |
| `order_summary_clicked` | one checkout-summary view | whole-week file (D5) | #2 — intermediate checkout step |
| `asset_card_clicked` | one browse-path card click | whole-week file (D5); heavy (~50K/wk) | #2 — browse-vs-search |

Onboarding here is a **design** deliverable — the registry entries, stems, the
SQL template applies unchanged. Their `daily` flag stays **off** (D8): the fetch
*can* pull them but does not until #2's exhibits exist, so the daily job and the
git history are not carrying data nothing reads.

---

## 11. Cut-over plan

W1–W6 are committed hand-exports and **stay exactly as they are** — frozen,
never fetched (D3; `feature_week.current_and_prior()` clamps to
`FIRST_LIVE_WEEK = 7`, so the first daily run cannot rewrite W6). Re-fetching
them would in fact *corrupt* W1–W3: `asset_search_cleared` W1–W3 is a 4-column
legacy export, a fresh `SELECT *` returns the ~99-column current schema.

- The first fetched week is **W7**. From cut-over the dashboard reads W1–W6
  (hand-exports) and W7+ (fetched) transparently — `groupTables()` unions all
  `W{n}` files regardless of origin.
- **Acceptance gate before cut-over:** one-time, re-fetch W6 into a scratch dir
  and compare to the committed `W6_*` CSVs **semantically** — row counts per
  event and the session-outcome funnel totals — not a byte diff (column order
  and the schema split make a byte diff meaningless). A match within tolerance
  confirms the fetch SQL reproduces the established numbers.
- **Rollback:** if a fetched W7 is wrong, revert the W7 commits; the dashboard
  falls back to W1–W6, identical to today.

---

## 12. Frontend behaviour

`frontend/app/projects/[id]/page.jsx` has **no** refresh logic today — it must
be built. It lives in the dashboard component (not the shared page), reading
`project.refreshable` and `project.manifest.refreshed_at`, calling the existing
`refreshProject()` / `pollRefresh()` in `lib/api.ts`.

1. Render the last DuckDB snapshot immediately — never block.
2. Show **"as of HH:MM, DD Mon"** from `_manifest.json`. If it is older than
   ~26 h (a missed daily cron), the marker becomes a visible **staleness
   warning**, not a quiet timestamp.
3. **Refresh button** in the dashboard header — forces a pull; disabled with a
   spinner while a job runs; 60 s cooldown after.
4. Refresh-state chip: idle / `Refreshing…` / done (✓) / error (⚠ opens the log).
5. Applied to **both** dashboard variants — Classic and Editorial are at full
   parity after S1.

**Mobile-first:** all new UI cleared at 375×844 per
[`../../../ideation/mobile-first.md`](../../../ideation/mobile-first.md).

---

## 13. Credentials

- v1: `METABASE_URL` / `METABASE_EMAIL` / `METABASE_PASSWORD` — env vars in
  `backend/.env` (already present) and GitHub Actions secrets.
- A personal login on a **daily unattended job** is a guaranteed future outage
  (password rotation, offboarding). So the dedicated Metabase **service-account
  `X-API-Key` is a Phase-5 prerequisite** (§16), not an open-ended follow-up —
  v1 may *develop* on personal creds but must not *ship the cron* on them
  without either the token or the §15 failure alerting in place.

---

## 14. Validation

`validate.py` gains Asset Search checks, run after a fetch (a `--validate` CLI
flag); a non-empty error list blocks cut-over / pages an alert:

- Expected columns present per event — scoped to the **W4+ full-payload
  schema** for live weeks (the W1–W3 thin schema is frozen and out of scope).
- No test-user IDs (`3,4,207871,…`) in any output.
- No duplicate primary identity within a freshly-fetched week (a sanity check
  on the raw rows).
- Row counts within a sane band vs the prior week — a >10× swing flags.
- Every row's `timestamp` falls inside the week's `[start, end)`.
- `view_assets` sanity: distinct `anonymous_id` vs total rows, to confirm it is
  a visitor table, not raw pageviews (it is the adoption-rate denominator).

---

## 15. Error handling & alerting

- Metabase down / query error / auth failure → the job fails with a per-event
  log line; the dashboard keeps the last good snapshot.
- **Partial success** → keep the fresh events, leave the rest stale, surface
  which failed. Never half-write a week-file (atomic temp-file + rename).
- `401`/`403` → the specific "Metabase auth failed" message (`MetabaseError`).
- **Failure alerting (new — not in the GC spec).** Because the cron is daily and
  unattended:
  - the GitHub Action notifies on failure (Actions failure email at minimum;
    a Slack webhook step preferred);
  - `validate.py` flags a `_manifest.json` `last_refreshed_at` older than ~26 h;
  - the dashboard "as of" marker escalates to a visible warning past that
    threshold (§12). A silently-stale dashboard is worse than an honest
    hand-export — this closes that gap.
- `POST /api/dataset` may enforce a **row cap** — Phase 1 confirms a single
  week's `view_assets` pull returns complete, untruncated (§18).

---

## 16. Build sequence (for S5)

0. **Pre-S5 gate** — verify the §18 blockers, especially native-query
   permission and the timestamp timezone. If native-query is denied, D1 is
   re-opened *before* Phase 1 (the fallback is a material rework — §18).
1. **Phase 1 — fetch core.** `metabase.run_native_query()`, `feature_week.py`,
   `asset_search.py` (registry + SQL template + `run()`/`build_layer1()`) and
   their unit tests. Pin the §18 items against live responses. Run the §11
   acceptance gate (re-fetch W6, semantic match).
2. **Phase 2 — runner.** Refactor `refresh.py` into the per-project registry;
   wrap GC into `grip_connect.run()`; `_manifest.json`; `validate.py` checks.
   **Regression gate:** the existing GC fetch/refresh tests must still pass.
3. **Phase 3 — endpoint.** `POST /api/projects/asset_search/refresh` end-to-end;
   the `routers/refresh.py` one-line change; update the endpoint test. The
   in-container DuckDB reload must be **atomic from a reader's perspective**
   (load into a fresh schema and swap, or a brief reader lock) — a dashboard
   query mid-reload must never see a half-loaded table (§7 Data integrity).
4. **Phase 4 — frontend.** `project.json` `refreshable: true`; Refresh button /
   chip / "as of" + staleness warning on both dashboard variants; mobile audit.
5. **Phase 5 — schedule.** `refresh-asset-search.yml` with failure alerting.
   Service-account `X-API-Key` (§13) lands here, before the cron goes live.
6. **Then `roadmap.md` #2** — flip the §10 tables' `daily` flag on, build their
   query builders + exhibits.

---

## 17. Trade-offs & risks

- **Native SQL gives up the Metabase-card abstraction.** GC's metric SQL lives
  in data-team-owned cards; Asset Search's `SELECT *` SQL lives in this repo
  against data-team-owned tables. A column rename/migration upstream breaks the
  fetch with no signal to the data team. Mitigation: the §14 column validator is
  the early warning; if drift becomes frequent, move to pinned column lists or
  saved-card-per-event (the §18 fallback).
- **`SELECT *` schema drift.** New columns flow in silently; the validator
  catches *removed* required columns, not added/retyped ones. Accepted for the
  payload-completeness the chat panel needs.
- **Git growth.** Raw event CSVs are large (`view_assets` ≈10 MB/week). D7's
  split — search events daily, heavy tables weekly — bounds the daily diff to a
  few small files; the heavy files change once per week. Estimated growth is
  modest, but if `.git` bloat becomes material the heavy tables should move to
  object storage and out of git. Tracked.
- **Daily full-window re-query cost.** Each run re-pulls the *entire* current +
  prior week per event — the simplest correct design (D5), and it absorbs late
  events for free. The cost is repeatedly re-querying unchanged data. **If it
  degrades, the optimization is an incremental fetch:** pull only rows newer
  than a stored watermark and merge into the week-file by the Rudder event
  `id`. This is why D5 dropping `id`-keyed upsert is a *mechanism* decision,
  not a permanent one — `id` remains the natural merge key if incremental
  fetch is later wanted. The catch: incremental fetch is only *correct* if the
  source carries an **ingestion-time** column (`received_at` / `loaded_at`) to
  watermark on — watermarking on the event `timestamp` would silently miss
  late-arriving events (an old `timestamp`, a recent ingestion). So the future
  optimization needs both `id` and an ingestion-time column; Phase 1 records
  whether they exist (§18) while it is inspecting the schema anyway. For v1,
  the full re-query is deliberately chosen for correctness and simplicity.
- **Raw user-level data in git.** Committed CSVs carry `user_id` / `anonymous_id`
  permanently in git history. Accepted for an internal-only analytics tool;
  flagged so a future retention/GDPR decision is explicit, not discovered.
- **Layer-1-only query cost.** Every dashboard load and chat query re-derives
  metrics over the raw views. At ~14 weeks the search tables are ~10⁵–10⁶ rows;
  DuckDB handles this, but latency grows with accumulated weeks. **Mitigation if
  it degrades:** a materialised per-week summary table — i.e. the layer-2 D4
  declined now. D4 is the right call *today* (no duplicate metric definitions);
  this names layer-2 as a known future option, not a closed door.
- **In-container manual-refresh writes are ephemeral** — reconciled by the daily
  cron. **Scheduled commits add git noise** — bounded by commit-on-change + the
  D7 daily/weekly split.
- **Daily redeploy on data commit.** Each data push triggers an app redeploy —
  a data change coupled to a code deploy. Accepted (matches GC); a build failure
  would surface via the same §15 alerting.

---

## 18. Open questions & pre-S5 gates

**Must be checked before S5 Phase 1 locks (a failed check re-opens a decision):**

- **Native-query permission (gates D1).** Confirm the v1 credentials may run
  `POST /api/dataset` native queries against `database_id 8`. This is a
  ~5-minute probe and should be done before S5 starts. If denied, the fallback
  — a date-range-parameterised saved card per event, fetched via `fetch_card` —
  is a **material rework** of §6.2/§6.3 (card IDs replace SQL templates),
  re-estimate Phase 1. Saved-card-per-event also has an upside (data-team
  visibility) and should be weighed, not treated purely as a downgrade.
- **Timestamp timezone (gates §6.3).** Determine the actual storage timezone of
  `client_web.<event>.timestamp` from the column definition — do **not**
  reverse-engineer it from the existing exports (they were ad-hoc SQL and may
  carry their own offset). A wrong guess mis-buckets every event near midnight.
  §16 adds a CI regression test (re-fetch a frozen week, semantic diff) so a
  drift is caught continuously, not just at cut-over.

**Pinned in Phase 1 against live responses:**

- Per-table `user_id` presence (the §6.3 `WHERE` clause; `view_assets` may lack it).
- `POST /api/dataset` row cap — confirm a full week of `view_assets` is not truncated.
- `view_payment_status_page` schema — does it carry a success/fail column?
  (Needed for `roadmap.md` #2, not for this fetch.)
- Presence of a stable Rudder event `id` **and** an ingestion-time column
  (`received_at` / `loaded_at`). Not used by v1's full re-query, but their
  presence is what makes the §17 incremental-fetch optimization available
  later — record it now while inspecting the schema.

**Post-launch tuning (project owner):**

- Trailing-window size (D3). Two weeks is the default; widen if late events
  routinely land >7 days out. Owner decides once fetched-vs-final data exists.
- Whether to keep daily cadence or move to weekly — the feature-week cadence is
  weekly, so a daily run mostly re-churns the in-progress week. The brief
  specifies daily; revisit if the cost (§17) outweighs the ≤1-day freshness gain.
