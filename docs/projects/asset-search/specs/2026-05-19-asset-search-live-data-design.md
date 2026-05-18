# Asset Search — Live Data (design spec)

- **Date:** 2026-05-19
- **Status:** Draft — for review (S4 deliverable; implementation is S5)
- **Scope:** Make the Asset Search dashboard run on live Metabase data — a daily
  auto-fetch so the dashboard always shows the current feature week, plus
  onboarding of the not-yet-exported event tables.
- **Relation to prior docs:** This is the **second project** on the live-data
  framework. It *adapts* the approved Grip Connect spec
  [`docs/specs/2026-05-17-grip-connect-live-data-design.md`](../../../specs/2026-05-17-grip-connect-live-data-design.md)
  — same architecture, but a materially different fetch shape (see §3). It does
  **not** copy it.
- **Canonical data reference:** [`../data-sources.md`](../data-sources.md) is the
  source-of-truth for which events/tables feed the dashboard and what each
  column means. Where this spec and `data-sources.md` disagree, the data-sources
  doc wins — it is kept current; this spec is dated.

---

## 1. Goal

Today the Asset Search dashboard reads CSVs hand-exported from Metabase into
`grip.duckdb` — one CSV per `(feature-week, event)` pair, baked at deploy time.
The data window is frozen at **W1–W6** (2 Apr – 13 May 2026). W7 onward only
appears when someone manually exports and commits it.

The goal: the dashboard reflects the **current feature week** automatically — a
daily fetch that pulls the in-progress week from Metabase and commits it, plus a
manual **Refresh** button — with no hand-exporting and no LLM in the data path.

### In scope

- A deterministic Python fetch module that pulls Asset Search event data from
  Metabase by **native SQL query**, windowed by feature week.
- Onboarding the five not-yet-exported tables from
  [`data-sources.md`](../data-sources.md) §3/§5 into the fetch.
- A refresh path: scheduled (durable, git-committed) + manual button (immediate).
- Generalising the existing `integrations/refresh.py` runner — currently
  Grip-Connect-only — to dispatch per project.
- Frontend: instant render of the last snapshot, non-blocking background
  refresh, an "as of" marker, a Refresh button (mirrors Grip Connect).

### Out of scope (deferred)

- **Implementation** — that is S5. This spec is the build contract.
- New dashboard exhibits for the payment-stage tables — that is `roadmap.md`
  item #2; this spec only covers *fetching* those tables so #2 is unblocked.
- A dedicated Metabase service-account API token (personal creds for v1, §13).
- Re-fetching the frozen historical weeks W1–W6 (already exported; never pulled
  again — see §3, decision D3).
- A declarative cross-project "integrations" schema — deferred platform-wide,
  same as the GC spec.

---

## 2. Background — what already exists

When the Grip Connect live-data spec was implemented, it built a **reusable
framework** under `backend/services/integrations/`. Asset Search is the second
project onto it, so most of the plumbing is already done:

| File | What it gives Asset Search | Reuse? |
|---|---|---|
| `integrations/metabase.py` — `MetabaseClient` | `login()` via `POST /api/session`; `fetch_card()`; param helpers. Plain `httpx`, no browser. | **Reuse + extend** — add a native-query method (§4). |
| `integrations/accumulate.py` — `upsert_csv()` | Atomic upsert-by-natural-key CSV writer (temp-file + rename). | **Reuse as-is.** |
| `integrations/refresh.py` — `run_refresh()` + CLI | The fetch→accumulate→manifest runner and `python -m` entry point. | **Reuse, but generalise** — currently hard-imports `grip_connect`; must dispatch per project (§5). |
| `integrations/transforms.py` | Pure helpers (`to_float`, column detectors). | Reuse the generic ones. |
| `integrations/validate.py` | `validate_north_star` is GC-specific. | **New** Asset Search validators (§12). |
| `routers/refresh.py` | `POST /api/projects/{id}/refresh` + `GET …/refresh/{job_id}`, async + polling, per-project lock. Already keyed by `project_id`. | **Reuse as-is** once `refresh.py` dispatches per project. |
| `.github/workflows/refresh-grip-connect.yml` | The daily-cron + commit-back pattern. | **Copy → `refresh-asset-search.yml`.** |

There is also an informal precedent: the current W1–W6 CSVs were produced by
running SQL in Metabase and exporting (the `metabase-connect/` working folder).
This spec turns that ad-hoc step into the deterministic fetch module — the SQL
moves into version-controlled query templates (§7).

---

## 3. Why Asset Search differs from Grip Connect

Grip Connect fetches **5 saved Metabase cards** that each return a small,
pre-aggregated partner × period table. Asset Search is structurally different,
and the spec is shaped by that:

| Aspect | Grip Connect | Asset Search |
|---|---|---|
| Source unit | 5 saved cards, parameterised by partner | ~11 **raw event tables** (6 search events + `view_assets` + 2 invest events + the new payment tables) |
| Fetch mechanism | `POST /api/card/{id}/query` | `POST /api/dataset` — **native SQL**, parameterised by date range (D1) |
| Granularity | One pre-aggregated row per partner × week | **Raw event rows**, one per tracked event |
| Windowing | Calendar month (MTD/LMTD) | **Feature week** from the 2 Apr launch (D2) |
| Derived layer | Layer-2 tables computed in Python | **None** — the dashboard's `assetSearch.js` SQL builders *are* the derivation layer (D4) |
| Accumulation unit | Row upsert by `(partner, week)` | Per-`(feature-week, event)` CSV file (D5) |

These differences are captured as locked decisions in §4.

---

## 4. Locked decisions

| # | Decision | Choice & rationale |
|---|---|---|
| D1 | **Fetch mechanism** | **Raw native SQL via `POST /api/dataset`**, not saved card IDs. The dashboard needs raw event rows per `(week, event)`; no saved card returns that, and the existing CSVs were themselves SQL exports. `MetabaseClient` gains a `run_native_query(database_id, sql)` method (§6). |
| D2 | **Windowing** | **Feature week**, not calendar. W*n* = `[launch + 7·(n−1), launch + 7·n)` where launch = **2 Apr 2026**, in IST. A small `feature_week.py` helper computes the current week number and its `[start, end)` timestamps. |
| D3 | **Re-fetch scope** | Daily job fetches the **current in-progress week + the immediately-prior week** (a trailing 2-week window) to absorb late-arriving Rudder events; weeks older than that are **frozen** — W1–W6 are already exported and are never re-fetched. |
| D4 | **Data model** | **Layer-1 only** — raw event tables per `(week, event)`. Asset Search needs no layer-2 derived tables: the dashboard's query builders in `frontend/lib/queries/assetSearch.js` already compute every metric live via SQL over the raw DuckDB views. This is the key divergence from the GC spec's §7. |
| D5 | **CSV unit & accumulation** | One CSV per `(feature-week, event)`, named exactly as today: `W{n}_{mmmDD_mmmDD}_asset_search_{event}.csv` (and analogously for non-search events). The fetch **replaces the whole week-file** for each week in the D3 window. Within that, rows are upserted by the Rudder event **`id`** so a re-fetch is idempotent and late events merge cleanly (`accumulate.upsert_csv`, key `["id"]`). Pinning that `id` is reliably exported is a Phase-1 task (§17). |
| D6 | **Runner shape** | Generalise `integrations/refresh.py`: `run_refresh` dispatches on `project_id` to a per-project fetch module (`grip_connect.py`, new `asset_search.py`). The `routers/refresh.py` endpoint already passes `project_id` — no router change needed beyond the dispatch. |
| D7 | **Schedule** | A GitHub Action on a **daily 12 AM IST** cron (`cron: "30 18 * * *"` UTC) fetches, then commits changed CSVs. History lives in git — same durability model as GC §8. |
| D8 | **New tables** | The five tables in `data-sources.md` §3/§5 (`view_payment_page_loaded`, `view_payment_status_page`, `new_user_order`, `order_summary_clicked`, `asset_card_clicked`) are onboarded as additional per-week event CSVs through the same fetch. Consuming them in the dashboard is `roadmap.md` #2 — out of scope here. |
| D9 | **Credentials** | Personal `METABASE_EMAIL` / `METABASE_PASSWORD` for v1 (already in `backend/.env`); rotate to a service-account `X-API-Key` later (§13). |
| D10 | **Test-user exclusion** | Every fetch SQL excludes test users `3, 4, 207871, 207875, 207878, 207879` in its `WHERE` clause — the same set the query builders already exclude. |
| D11 | **Data path** | Deterministic Python only. Claude authors & validates the fetch/validation scripts; it never runs extraction at runtime. No LLM in the data path. |

---

## 5. Architecture

```
                ┌───────────────────────────────────────────────┐
                │  Metabase  ·  database_id 8  ·  schema client_web │
                └───────────────────────┬───────────────────────────┘
                                        │  POST /api/dataset (native SQL)
                ┌───────────────────────▼───────────────────────────┐
                │  asset_search.py  (deterministic Python fetch)      │
                │   · resolve current + prior feature week (D2,D3)    │
                │   · per-event SQL template, date-range bound        │
                │   · exclude test users (D10)                        │
                │   · write/replace W{n}_…_{event}.csv  (D5)          │
                └────────┬──────────────────────────────┬────────────┘
       refresh.py runner │   (dispatches by project_id)  │ imported by
       standalone CLI ───┤                               ├─── POST /refresh
                ┌────────▼─────────┐            ┌─────────▼─────────┐
                │ GitHub Action     │            │ POST …/refresh    │
                │ daily 12 AM IST   │            │ (in-container,    │
                │ commits CSVs (D7) │            │  immediate)       │
                └────────┬──────────┘            └─────────┬─────────┘
                         │                                 │
                ┌────────▼─────────────────────────────────▼────────┐
                │  canonical CSVs  ──►  build_duckdb.py  ──►  DuckDB  │
                │  table = asset_search__W{n}_{range}_asset_search_…  │
                └────────────────────────┬───────────────────────────┘
                                         │  /api/projects/asset_search/query
                ┌────────────────────────▼───────────────────────────┐
                │  AssetSearchDashboard.jsx + …Editorial.jsx          │
                │  (assetSearch.js builders run live SQL over views)  │
                └──────────────────────────────────────────────────────┘
```

**Key property (unchanged from GC):** the dashboard viewer always reads DuckDB,
which is already populated. Extraction never happens on the open path.

---

## 6. The fetch module — `asset_search.py`

A new `backend/services/integrations/asset_search.py`, parallel to
`grip_connect.py`. It exposes a `build_layer1(client, weeks)` and a project
`run()` entry the generalised `refresh.py` calls.

### 6.1 Metabase native query

`MetabaseClient` gains one method:

```python
def run_native_query(self, database_id: int, sql: str) -> tuple[list[dict], list[str]]:
    """POST /api/dataset with a native query; return (rows-as-dicts, columns)."""
```

Body shape: `{"database": <id>, "type": "native", "native": {"query": <sql>}}`.
Response parsing reuses the existing `fetch_card` logic (`data.cols` /
`data.rows`). `database_id` is **8** (`data-sources.md` header). Native-query
permission for the v1 credentials must be confirmed in Phase 1 (§17).

### 6.2 Event registry

Module-level config — adding an event or a column is a config edit:

```
EVENTS = {
  # search events (the 6 the dashboard uses today)
  "initiated":            "asset_search_initiated",
  "query":                "asset_search_query",
  "result_clicked":       "asset_search_result_clicked",
  "empty_state":          "asset_search_empty_state",
  "cleared":              "asset_search_cleared",
  "suggestion_clicked":   "asset_search_suggestion_clicked",
  # browse denominator + conversion (already exported, kept fresh)
  "assets_page_views":    "view_assets",
  "invest_now":           "invest_now_button_clicked",
  "quick_checkout":       "quick_checkout_invest_clicked",
  # NEW — onboarded by this spec (D8)
  "payment_page":         "view_payment_page_loaded",
  "payment_status":       "view_payment_status_page",
  "new_user_order":       "new_user_order",
  "order_summary":        "order_summary_clicked",
  "asset_card_clicked":   "asset_card_clicked",
}
```

The CSV/table **stem** for each is the existing convention, e.g. the `query`
event for W7 → `W7_may14_may20_asset_search_query.csv` →
`asset_search__W7_may14_may20_asset_search_query`. Non-search events keep their
own table name in the stem (e.g. `…_view_assets`). `groupTables()` in
`assetSearch.js` already parses `W(\d+)_…_asset_search_{event}$`; the six search
events match it unchanged. The new tables (D8) are fetched but not yet parsed by
`groupTables` — wiring them into query builders is `roadmap.md` #2.

### 6.3 Per-event SQL template

One parameterised template, filled per event per week:

```sql
SELECT *
FROM client_web.<event_table>
WHERE timestamp >= '<week_start_ist>' AND timestamp < '<week_end_ist>'
  AND (user_id IS NULL OR user_id NOT IN (3,4,207871,207875,207878,207879))
```

Notes:
- `SELECT *` keeps the export column-complete (the dashboard and chat both rely
  on the full Rudder payload — e.g. `asset_search_cleared`'s W4+ columns).
- Timestamps are the IST feature-week bounds from `feature_week.py`. If the
  source stores UTC, the template shifts by +5:30 — pinned in Phase 1 against a
  real response (the existing exports already encode an IST day; match them).
- High-volume tables (`view_assets` ≈ 520K rows total, `asset_card_clicked`
  ≈ 370K) are bounded to a single feature week per query, which keeps each pull
  to tens of thousands of rows.

### 6.4 Feature-week helper — `feature_week.py`

```python
LAUNCH = date(2026, 4, 2)          # W1 day 1
def week_of(d: date) -> int            # 1-based feature-week number for a date
def bounds(n: int) -> tuple[datetime, datetime]   # [start, end) IST for week n
def label(n: int) -> str               # "W7_may14_may20" — the CSV stem fragment
def current_and_prior(today) -> list[int]   # the D3 trailing window
```

The label format must reproduce the existing stems exactly (lower-case month,
zero-padded day, underscore-joined) so `build_duckdb.py`'s `{project}__{stem}`
naming and `groupTables()`'s regex keep working.

---

## 7. Data model — layer-1 only

Unlike Grip Connect (raw cards + a derived layer-2), Asset Search stores **only
raw event tables**. The dashboard's metric definitions live entirely in
`frontend/lib/queries/assetSearch.js` — `sessionOutcomeByWeek`,
`issuerHealthByWeek`, `queryHealthByWeek`, the conversion builders, etc. — which
run live SQL over the per-week DuckDB views. There is no second place a metric
is computed, so there is **no layer-2 table to keep in sync**.

Consequences:
- The fetch's only job is to land correct, complete raw CSVs. Correctness of
  *metrics* is already covered by the (unchanged) query builders.
- Onboarding a new feature week is purely additive — new `W{n}_…` CSVs appear,
  `groupTables()` picks them up, every per-week chart extends by one week with
  no dashboard code change.
- A new *event type* (the D8 tables) needs new query builders + exhibits before
  it surfaces — that work is `roadmap.md` #2, deliberately out of scope here.

**Accumulation (D5):** the unit is the week-file. The daily run rewrites the
current and prior week files from a fresh query; `upsert_csv` keyed on the
Rudder `id` makes a re-fetch idempotent and merges any late events. Frozen
weeks (W1–W6) are never touched.

---

## 8. Components & files

### New

| File | Role |
|---|---|
| `backend/services/integrations/asset_search.py` | Asset Search fetch module — event registry, SQL templating, per-week CSV writes. |
| `backend/services/integrations/feature_week.py` | Feature-week math (§6.4). |
| `backend/data/asset_search/_manifest.json` | Per-table `last_refreshed_at` — drives the freshness check. |
| `.github/workflows/refresh-asset-search.yml` | Daily 12 AM IST cron; commits changed CSVs (§10). |
| `tests/integrations/test_asset_search_fetch.py` | Fetch + windowing + week-label tests (mocked Metabase). |
| `tests/integrations/test_feature_week.py` | Feature-week boundary tests. |

### Modified

| File | Change |
|---|---|
| `backend/services/integrations/metabase.py` | Add `run_native_query(database_id, sql)` (§6.1). |
| `backend/services/integrations/refresh.py` | Generalise `run_refresh` to dispatch per `project_id` (D6); register `asset_search`. |
| `backend/services/integrations/validate.py` | Add Asset Search validators (§12). |
| `backend/data/asset_search/project.json` | Add `refreshable: true` + `freshness` (60-min window), mirroring Grip Connect. |
| `backend/.env.example` | Already documents `METABASE_*` (from GC) — confirm only. |
| `frontend/lib/api.ts` | `refreshProject()` / `pollRefresh()` already exist (GC) — reuse, no change. |
| `frontend/app/projects/[id]/page.jsx` | On-open freshness check already wired generically (GC) — confirm it fires for `asset_search`. |
| `frontend/components/dashboards/AssetSearchDashboard.jsx` & `AssetSearchDashboardEditorial.jsx` | Refresh button, refresh-state chip, "as of" marker — both variants (they are at parity, S1). |

No change expected to `build_duckdb.py` — it bakes every CSV under
`backend/data/<project>/` by the `{project}__{stem}` rule; new week CSVs are
picked up automatically.

---

## 9. Refresh — durable vs immediate

Mirrors GC §8; reconciles "in-container, $0" with "accumulate history in git".

### Scheduled — the durable populator

`.github/workflows/refresh-asset-search.yml`, `cron: "30 18 * * *"` (00:00 IST):
checkout → `pip install -r backend/requirements.txt` →
`python -m services.integrations.refresh asset_search` → the module rewrites the
current + prior week CSVs → commit & push **only if changed**. The push triggers
a redeploy; `build_duckdb.py` bakes the accumulated CSVs. Secrets
(`METABASE_EMAIL` / `METABASE_PASSWORD`) come from GitHub Actions secrets.

### Manual — the immediate path

`POST /api/projects/asset_search/refresh` → `{ job_id }` → background thread runs
the same fetch in-container → reloads DuckDB via `db.load_csvs_for_project`.
`GET …/refresh/{job_id}` reports `{ status, log, error }`; the frontend polls
every 2 s. One refresh per project at a time (existing module-level lock); a
concurrent request gets `409` with the running `job_id`. In-container writes are
ephemeral — the daily scheduled run reconciles the durable git copy.

### On-open background refresh

Page open never blocks. If `_manifest.json`'s `last_refreshed_at` is >60 min old,
the page fires `POST /refresh` in the background and updates in place. This is
the generic behaviour already built for GC in `app/projects/[id]/page.jsx`; it
activates for Asset Search once `project.json` has `refreshable: true`.

---

## 10. New-table onboarding (D8)

The five tables from `data-sources.md` §3/§5, fetched by the same per-event SQL
template (§6.3):

| Table | Grain | Why (ties to `roadmap.md`) |
|---|---|---|
| `view_payment_page_loaded` | one row per payment-screen load | #2 — search→payment-page rate; `asset_id` joins `result_clicked.clicked_asset_id`; `payble_amount` enables value-weighting |
| `view_payment_status_page` | one row per payment result | #2 — closest signal to true completion. **Phase-1 schema check:** confirm it carries a success/fail column |
| `new_user_order` | one row per first-ever investment | FTI attribution to search |
| `order_summary_clicked` | one row per checkout summary view | intermediate checkout step |
| `asset_card_clicked` | one row per browse-path card click | browse-vs-search comparison at asset level |

Onboarding here means **the fetch pulls them into per-week CSVs**. They are not
yet in `groupTables()`'s event list and have no query builders — surfacing them
on the dashboard is `roadmap.md` #2, a separate effort. Fetching them now means
#2 starts with data already on hand.

---

## 11. Frontend behaviour

Reuses the generic live-data UI built for Grip Connect:

1. Render the last DuckDB snapshot immediately — never block.
2. Read `_manifest.json` `last_refreshed_at`; >60 min → background refresh, poll,
   update in place; ≤60 min → show "as of HH:MM".
3. **Refresh button** in the dashboard header (60 s cooldown).
4. Refresh-state chip: idle / `Refreshing…` / done (✓) / error (⚠ opens the log).
5. Applied to **both** dashboard variants — Classic and Editorial are at full
   parity after S1, so the button + chip + "as of" marker land in both.

**Mobile-first:** all new UI cleared at 375×844 per
[`../../../ideation/mobile-first.md`](../../../ideation/mobile-first.md) —
touch targets ≥44 px, refresh controls reachable, no horizontal page scroll.

---

## 12. Validation

Claude authors and periodically validates these scripts — it does not run
extraction. Two layers:

- **Deterministic checks in code** (`validate.py`, a `--validate` CLI flag):
  - expected columns present per event (the dashboard's required columns:
    `query_text`, `results_count`, `is_refinement`, `context_session_id`,
    `result_position`, …);
  - no test-user IDs (`3,4,207871,…`) leaked into any output;
  - row counts within a sane band vs the prior week (a 10× swing → flag);
  - the week's `timestamp` values all fall inside the week's `[start, end)`;
  - `results_count` non-negative; percentages, where derived, in 0–100.
- **Periodic eyeball:** the first run must reproduce the **W1–W6 numbers** the
  current CSVs already produce before cut-over — re-fetch W6 and diff against the
  committed `W6_*` CSVs (row counts and the session-outcome funnel totals).

---

## 13. Credentials

- v1: `METABASE_URL`, `METABASE_EMAIL`, `METABASE_PASSWORD` — env vars in
  `backend/.env` (already present, used by Grip Connect) and GitHub Actions
  secrets. Login via `POST /api/session`.
- Never committed; `.env` stays git-ignored.
- **Follow-up:** rotate to a dedicated Metabase service-account API token
  (`X-API-Key`) once the pipeline is validated, so the platform does not depend
  on one person's personal login. Tracked, not done in v1.

---

## 14. Error handling

Mirrors GC §12:

- Metabase down / query error / auth failure → the refresh job fails cleanly
  with a per-event log line; the dashboard keeps the last good snapshot.
- **Partial success** (e.g. 11 of 14 events OK) → keep the fresh ones, leave the
  rest stale, surface which failed. Never half-write a week-file.
- `401`/`403` from Metabase → the specific "Metabase auth failed" message
  (`MetabaseError` already does this), not a generic HTTP error.
- Each week-file write is atomic (`upsert_csv` temp-file + rename) — a crash
  mid-write leaves the prior CSV intact.

---

## 15. Testing

- **Fetch module:** unit tests against a **mocked `MetabaseClient`** (canned
  `/api/dataset` JSON) → assert per-week CSV shape, the test-user `WHERE` clause,
  and the week-label stem.
- **Feature-week math:** boundary tests — launch day, week rollovers, the
  current/prior window, the `label()` stem format.
- **Accumulation:** a second fetch upserts by Rudder `id` — new rows appended, a
  re-sent event de-duplicated, frozen weeks untouched.
- **Validation checks:** tested with good and deliberately-bad input.
- **Refresh endpoint:** job lifecycle, the 409-on-concurrent case (already tested
  for GC — extend the fixture to `asset_search`).
- **Frontend:** stale → background-refresh → update-in-place; the error chip;
  mobile audit at 375 px — on both dashboard variants.

---

## 16. Build sequence (for S5)

1. **Phase 1 — fetch core.** `metabase.run_native_query()`, `feature_week.py`,
   `asset_search.py` with the event registry + SQL template. Run against live
   Metabase; **pin** the open items in §17 (timezone, Rudder `id`, native-query
   permission, `view_payment_status_page` schema). Confirm a re-fetch of W6
   reproduces the committed CSVs.
2. **Phase 2 — runner + accumulation.** Generalise `refresh.py` to dispatch per
   project; wire `_manifest.json`; `validate.py` Asset Search checks.
3. **Phase 3 — endpoint.** Confirm `POST /api/projects/asset_search/refresh`
   works end-to-end (router is already generic); DuckDB reload.
4. **Phase 4 — frontend.** `project.json` `refreshable: true` + `freshness`;
   Refresh button / chip / "as of" on both dashboard variants; mobile audit.
5. **Phase 5 — schedule.** `refresh-asset-search.yml` on the 12 AM IST cron.
6. **Then `roadmap.md` #2** — query builders + exhibits for the payment-stage
   tables this fetch now lands.

---

## 17. Open questions — pin in Phase 1

- **Timezone.** Do the source tables store `timestamp` in UTC or IST? The week
  bounds and the `WHERE` clause depend on it. Match whatever the existing W1–W6
  exports encode (they already represent an IST day).
- **Rudder `id` (D5).** Confirm a stable per-event unique `id` / `message_id` is
  present in every event's `SELECT *` output. If not, fall back to
  replace-by-week-file (drop the row-level upsert) — still correct, just not
  idempotent for partial late merges.
- **Native-query permission.** Confirm the v1 Metabase credentials may run
  `POST /api/dataset` native queries against `database_id 8`. If not, the
  fallback is to create one saved card per event (parameterised by date range)
  and fetch via `fetch_card` — more Metabase-side setup, same module shape.
- **`view_payment_status_page` schema** — does it carry a success/fail column?
  (`data-sources.md` §3a flags this.) Needed before `roadmap.md` #2, not before
  this fetch.
- **Trailing-window size (D3).** Two weeks (current + prior) is the proposed
  default for absorbing late Rudder events. If late events routinely land >7
  days out, widen it. A question for the project owner once a few weeks of
  fetched-vs-final data exist.
- **Re-fetch cost.** A daily pull of `view_assets` + `asset_card_clicked` for
  two weeks is the heaviest part. If it proves slow, restrict the daily job to
  the search events and pull the high-volume browse/conversion tables weekly.
