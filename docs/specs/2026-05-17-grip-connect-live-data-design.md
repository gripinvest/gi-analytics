# Grip Connect — Live Data (design spec)

- **Date:** 2026-05-17
- **Status:** Approved 2026-05-17 — ready for implementation planning
- **Scope:** Make the Grip Connect dashboard show live data from Metabase.
- **Relation to prior docs:** Concretises the [`docs/ideation/data-integrations.md`](../ideation/data-integrations.md)
  thread for one project. The generic, declarative `integrations` schema in that doc
  is explicitly *deferred* (see §13).
- **Canonical data reference:** [`docs/reference/grip-connect-metrics-catalog.md`](../reference/grip-connect-metrics-catalog.md)
  is the source-of-truth for which Metabase cards feed the dashboard and what every
  column means. Where this spec and the catalog disagree on a card or column, the
  catalog wins — it is kept current; this spec is dated.

---

## 1. Goal

Today the Grip Connect dashboard reads 6 hand-exported CSVs baked into `grip.duckdb`
at deploy time. The data is frozen at whatever was last committed.

The goal: the dashboard reflects **current** Metabase numbers, with a manual
**Refresh** button — without anyone hand-exporting CSVs, and without an LLM in the
data path.

### In scope

- A deterministic Python fetch module that pulls Grip Connect data from Metabase.
- Storing the **full card output** (not just dashboard headline numbers) in DuckDB,
  accumulating history over time.
- A refresh path: scheduled (durable) + manual button (immediate).
- Frontend: instant render of the last snapshot, non-blocking background refresh,
  an "as of" marker, a Refresh button.

### Out of scope (deferred — see §13)

- Auto-updating "monitoring wall" (the dashboard does not poll while open).
- Generalising "live" into a declarative platform feature for all projects.
- A durable on-disk archive beyond what git history gives us (Render persistent disk).
- Partner-facing newsletter delivery + RBAC.
- A dedicated Metabase service-account API token (personal creds for v1).

---

## 2. Background — the cycle that already exists

Grip Connect analytics already has a working deterministic pipeline: the
**`gc-analyst`** Claude skill (repo `gripinvest/kishor-artifacts`,
`.claude/skills/gc-analyst/metabase_fetch.py`). The Grip Connect PM runs it weekly.

What it does, verified against the source:

- Logs into Metabase with **email + password** via `POST /api/session` → session token.
- Fetches **5 saved Metabase cards** by ID through the REST API
  (`POST /api/card/{id}/query`) — **no Playwright, no browser automation**; pure
  `requests` HTTP calls.
- Computes MTD/LMTD, retention, and blended metrics in Python.
- Renders weekly per-partner HTML digests, manually pasted into Gmail.

| Card ID | Metabase question | Provides | Parameterised by `gc_name`? |
|---|---|---|---|
| 3841 | GC Summary WoW CH | Week-over-week registrations, orders, AUM, AOV, FTI | Yes |
| 4499 | Overall Journey Funnel WoW v2.0 CH | Registration→KYC funnel per week | Yes |
| 3843 | GC Summary DoD CH | Day-on-day AUM (used for MTD) | Yes |
| 5042 | (D1 retention) | MTD/LMTD repeat-investor counts | No (returns all partners) |
| 5046 | (D2 retention) | MTD/LMTD unique-investor counts | No (returns all partners) |

This spec **reuses** that proven extraction logic rather than rebuilding it. The
metric SQL stays inside the Metabase cards — maintained by the data team — so there
is no second definition of "AUM" to keep in sync.

---

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | What "live" means | Current-on-open + manual Refresh button. No auto-polling. |
| 2 | On-open behaviour | Render last snapshot instantly; if it is older than **60 min**, background-refresh and update in place. Refresh button forces a pull. |
| 3 | First target | Grip Connect only. ("Grip Partners" is the same project.) Generalising to other projects is later but required. |
| 4 | Data path | Deterministic Python scripts. Claude authors & validates them; never executes extraction at runtime. |
| 5 | Snapshot durability | In-container for runtime refresh ($0); durability comes from the scheduled job committing to git (§8). Render persistent disk is deferred. |
| 6 | Reuse of `metabase_fetch.py` | Extract the core functions; drop the HTML-email rendering. |
| 7 | Credentials | Personal Metabase email/password for v1; rotate to a service-account API token later. |
| 8 | What to store | The **full card output** (raw rows), not just the dashboard's headline numbers. Two layers in DuckDB (§7). |
| 9 | History | **Accumulate** — upsert each fetch by a natural key so trend history grows beyond the window a single card returns. |

---

## 4. Architecture

```
                    ┌───────────────────────────────────────────┐
                    │  Metabase  (cards 3841/4499/3843/5042/5046) │
                    └───────────────────┬─────────────────────────┘
                                        │ REST API (requests)
                    ┌───────────────────▼─────────────────────────┐
                    │  fetch module  (deterministic Python)        │
                    │  · login · fetch cards · compute MTD/retention│
                    │  · UPSERT into canonical CSVs by natural key  │
                    └───────┬───────────────────────────┬──────────┘
            standalone CLI  │                           │  imported by
        (scheduled / manual /│                          │  refresh endpoint
              validation)    │                           │
                    ┌────────▼────────┐         ┌────────▼─────────┐
                    │ GitHub Action    │         │ POST /refresh    │
                    │ (durable: commits│         │ (in-container,   │
                    │  CSVs to git)    │         │  immediate)      │
                    └────────┬─────────┘         └────────┬─────────┘
                             │                            │
                    ┌────────▼────────────────────────────▼─────────┐
                    │ canonical CSVs ──► DuckDB                       │
                    │   layer 1: raw card snapshots                   │
                    │   layer 2: derived dashboard tables             │
                    └────────────────────┬────────────────────────────┘
                                         │ /api/projects/grip_connect/query
                    ┌────────────────────▼────────────────────────────┐
                    │ GripConnectDashboardEditorial.jsx  +  chat panel │
                    └──────────────────────────────────────────────────┘
```

**Key property:** the dashboard viewer always reads DuckDB, which is already
populated. Extraction never happens on the open path. The viewer never blocks on
Metabase.

---

## 5. Components & files

### New

| File | Role |
|---|---|
| `backend/services/integrations/__init__.py` | Package marker. |
| `backend/services/integrations/metabase.py` | Metabase REST client — `login()`, `fetch_card()` (parameterised + simple). Extracted from `metabase_fetch.py`. |
| `backend/services/integrations/grip_connect.py` | Grip Connect fetch module: per-card fetch + MTD/retention computation + upsert-by-key into canonical CSVs. |
| `backend/services/integrations/refresh.py` | Shared run logic + CLI entry point (`python -m services.integrations.refresh grip_connect`). |
| `backend/services/integrations/validate.py` | Deterministic output checks (§11). |
| `backend/routers/refresh.py` | `POST /api/projects/{id}/refresh` + `GET .../refresh/{job_id}` polling. |
| `backend/data/grip_connect/_manifest.json` | Per-table `last_refreshed_at` (drives the freshness check). |
| `.github/workflows/refresh-grip-connect.yml` | Scheduled refresh that commits updated CSVs (§8). |
| `tests/integrations/test_grip_connect_fetch.py` | Fetch + reshape unit tests (mocked Metabase). |
| `tests/integrations/test_refresh_endpoint.py` | Job lifecycle tests. |

### Modified

| File | Change |
|---|---|
| `backend/data/grip_connect/project.json` | Add `freshness` (60-min window) + `refreshable: true`. |
| `backend/main.py` | Register the refresh router. |
| `backend/.env.example` | Document `METABASE_URL`, `METABASE_EMAIL`, `METABASE_PASSWORD`. |
| `backend/build_duckdb.py` | No code change expected — it already bakes every CSV; the new layer-1/2 CSVs are picked up automatically. Confirm naming. |
| `frontend/lib/api.ts` | Add `refreshProject()` + `pollRefresh()` client methods. |
| `frontend/app/projects/[id]/page.jsx` | On-open freshness check + background refresh trigger. |
| `frontend/components/dashboards/GripConnectDashboardEditorial.jsx` | Refresh button, refresh-state chip, "as of" marker. New trend/funnel exhibits fed by layer-1 tables. |

---

## 6. The fetch module

`grip_connect.py` exposes one function per card plus a top-level `run()`:

- `metabase.login()` → session token from `POST /api/session`.
- For each card: `metabase.fetch_card(card_id, params)` → columns + rows.
  Cards 3841/4499/3843 are fetched once per partner (`gc_name` parameter);
  5042/5046 once total.
- Compute derived metrics (MTD vs LMTD AUM from card 3843's daily rows; retention
  rates from 5042/5046) — logic lifted from `compute_mtd_from_dod` and
  `compute_retention_metrics`.
- **Upsert** each result into its canonical CSV by natural key (§7), then write the
  CSV back.
- Update `_manifest.json` with `last_refreshed_at` per table.

Partners for v1: **ET Money, Paisa Bazaar, Mobikwik, Tata Digital** (the four the
current dashboard covers). The card-ID and partner lists are module-level config —
adding a partner or a card is a config edit.

Mandatory in every query path: exclude test users `3, 4, 207871, 207875, 207878,
207879` (carried from the data-team conventions; applies wherever the module does
its own filtering).

The same module is the CLI entry point and is imported by the refresh endpoint —
one source of truth, two callers.

---

## 7. Data model — two layers in DuckDB

### Layer 1 — raw card snapshots (one table per card)

The **full output** of each card, accumulated. Naming follows the existing
`{project}__{stem}` rule so `build_duckdb.py` and `duck.py` pick them up unchanged:

| Table | Grain (one row =) | Natural key for upsert |
|---|---|---|
| `grip_connect__card_3841_summary_wow` | partner × week | `(partner, week_start)` |
| `grip_connect__card_4499_kyc_funnel` | partner × week | `(partner, week_start)` |
| `grip_connect__card_3843_summary_dod` | partner × day | `(partner, date)` |
| `grip_connect__card_5042_retention_d1` | partner × month | `(partner, month)` |
| `grip_connect__card_5046_retention_d2` | partner × month | `(partner, month)` |

**Accumulation:** each fetch upserts (replace-by-key, not blind append) so that
(a) history grows past the ~8-week window a single card returns, and (b) a later
fetch correcting an earlier week's value overwrites it cleanly.

### Layer 2 — derived dashboard tables

Computed over layer 1, holding exactly what the dashboard exhibits need
(North Star MTD/LMTD/delta, retention rates, blended metrics). These map to the
current 6 CSV-backed tables, so the dashboard component changes minimally.

### Who reads what

- **Dashboard** → layer 2 (headline exhibits) + layer 1 (new trend/funnel exhibits).
- **Chat panel** → both layers; layer 1 is what makes "ET Money's AUM trend over
  8 weeks" answerable.

**Ceiling (honest):** the platform can only answer questions the cards' columns
contain. New questions that need other columns require adding a card to §6's list.

---

## 8. Refresh — durable vs immediate

Decision 5 (in-container, $0) and decision 9 (accumulate) are reconciled by giving
refresh **two mechanisms**:

### Scheduled — the durable populator

`.github/workflows/refresh-grip-connect.yml`, on a cron (**daily**):
checks out the repo → runs the fetch CLI → the module upserts into the canonical
CSVs → commits & pushes the changed CSVs. The push triggers a redeploy;
`build_duckdb.py` bakes the accumulated CSVs.

This is why accumulation survives redeploys: **the history lives in git.** It also
gives a free audit trail (git history of the CSVs) without Render persistent disk.
Secrets (`METABASE_EMAIL`/`PASSWORD`) live in GitHub Actions secrets. Commit only
when the data actually changed, to avoid empty commits.

### Manual — the immediate path

`POST /api/projects/{id}/refresh` → returns `{ job_id }` → background thread runs
the same fetch module **in the running container** → upserts onto the
last-deployed CSVs → reloads DuckDB via `db.load_csvs_for_project`.
`GET .../refresh/{job_id}` reports `{ status, progress, current, log }`; the
frontend polls every 2 s.

In-container writes are ephemeral (lost on next redeploy) — acceptable because the
daily scheduled run re-pulls and commits, reconciling the durable copy. One refresh
per project at a time (module-level lock); a second concurrent request gets
`409` with the running `job_id`. Cooldown: 60 s between manual refreshes.

### On-open background refresh

The page open never triggers a *blocking* fetch. If the snapshot is >60 min old it
fires the same `POST /refresh` in the background and updates numbers in place.
Within a warm container (UptimeRobot pings `/ping` every 14 min) snapshots persist
for days, so this rarely fires.

---

## 9. Frontend behaviour

`frontend/app/projects/[id]/page.jsx` + `GripConnectDashboardEditorial.jsx`:

1. Render the last snapshot from DuckDB immediately — never block.
2. Read `_manifest.json` `last_refreshed_at`. If >60 min → trigger background
   refresh, poll, update exhibits + "as of" in place. If ≤60 min → show
   "as of HH:MM" only.
3. **Refresh button** in the dashboard header — forces a pull anytime (60 s
   cooldown, then disabled with a tooltip).
4. Refresh-state chip: idle / `Refreshing 3/14…` / done (✓, 3 s) / error (⚠, opens
   the per-source log).
5. New exhibits fed by layer-1 tables: an AUM trend line and the full
   registration→KYC funnel.

**Mobile-first:** all new UI cleared at 375×844 per
[`docs/ideation/mobile-first.md`](../ideation/mobile-first.md) — touch targets
≥44 px, the refresh chip and button reachable, no horizontal page scroll.

---

## 10. Credentials

- v1: `METABASE_URL`, `METABASE_EMAIL`, `METABASE_PASSWORD` as env vars
  (backend `.env`, GitHub Actions secrets). Login via `POST /api/session`.
- Never committed; `.env` stays git-ignored; `.env.example` documents the keys.
- **Source of creds:** NOT available in the `kishor-artifacts` repo — its tracked
  `secrets.md` holds only an OpenAI key. `METABASE_EMAIL`/`METABASE_PASSWORD` must
  be obtained separately. Metabase URL is known: `https://metabase.gripinvest.in`.
- **Follow-up:** replace with a dedicated Metabase service-account API token
  (`X-API-Key`) once the pipeline is validated — so the platform does not depend
  on one person's personal login.

---

## 11. Validation

Claude's role is to author and periodically validate these scripts — not run
extraction. Validation has two layers:

- **Deterministic checks in code** (`validate.py`, a `--validate` CLI flag):
  expected columns present; the 4 partners all appear; percentages within 0–100;
  no nulls in key columns; row counts sane; no test-user IDs leaked.
- **Periodic eyeball:** compare fresh layer-2 output against a known-good
  reference — the `gc-analyst` digest / the data team's Metabase dashboards — when
  asked. The first run must reproduce the current 6 CSVs' numbers before cut-over.

---

## 12. Error handling

- Metabase down / card error / auth failure → the refresh job fails cleanly with a
  **per-card log line**; the dashboard keeps showing the last good snapshot.
- **Partial success** (e.g. 4 of 5 cards OK) → keep the 4 fresh, leave 1 stale,
  surface which failed. Never half-write a table.
- `401`/`403` from Metabase → a specific message ("Metabase auth failed — check
  credentials"), not a generic HTTP error.
- Upsert is transactional per table — a mid-write crash leaves the prior CSV intact.

---

## 13. Testing

- **Fetch module:** unit tests against a **mocked Metabase client** (canned card
  JSON) → assert layer-1 shape and layer-2 derivations (MTD, retention).
- **Accumulation:** test that a second fetch upserts by key — new weeks appended,
  a corrected week overwritten, unrelated rows untouched.
- **Validation checks:** tested independently with good and deliberately-bad input.
- **Refresh endpoint:** job lifecycle (queued → running → done / error), the
  409-on-concurrent case, cooldown.
- **Frontend:** the stale → background-refresh → update-in-place path; the error
  chip; mobile audit at 375 px.

---

## 14. Build sequence

1. **Phase 1** — `metabase.py` client + `grip_connect.py` fetch module + CLI.
   Run it, confirm layer-1/2 output reproduces the current 6 CSVs' numbers.
2. **Phase 2** — accumulation (upsert-by-key) + `_manifest.json` + `validate.py`.
3. **Phase 3** — `POST /refresh` endpoint (async + polling) + DuckDB reload.
4. **Phase 4** — frontend: on-open freshness, Refresh button, "as of", new
   trend/funnel exhibits. Mobile audit.
5. **Phase 5** — the scheduled GitHub Action.
6. **Later (deferred)** — generalise to a declarative `integrations` schema for
   other projects; durable archive (Render disk); service-account token;
   additional cards.

---

## 15. Trade-offs & risks

- **Many card queries per refresh.** ~14 for 4 partners (`3 × partners + 2`), each
  a live ClickHouse query — tens of seconds total. Acceptable because refresh is
  always background/scheduled, never on the open path.
- **Personal credentials.** A single person's login gates the platform until the
  service-account token lands. Accepted for v1; tracked as a follow-up.
- **Card columns bound the question space.** The chat can only answer what the
  cards expose; richer questions need more cards. Honest, documented ceiling.
- **In-container writes are ephemeral.** Mitigated by the daily git-committing
  scheduled run; intra-day manual refreshes are transient by design.
- **Scheduled commits add git noise.** Mitigated by committing only on change and a
  daily (not hourly) cadence.
- **Metabase card drift.** If the data team changes a card's columns, layer-1
  parsing can break. `validate.py` is the early-warning; the canonical CSV is the
  contract.

## 16. Resolved on review & remaining open items

Resolved 2026-05-17:
- Scheduled refresh cadence: **daily**.
- Layer-2 derived tables: computed in **Python** in the fetch module (parity with
  `metabase_fetch.py`'s existing logic), not SQL views.

Still open:
- Exact natural-key column names depend on the real card output — pinned in Phase 1
  once we see live card responses.
- **Phase 1 blocker:** Metabase credentials. The `kishor-artifacts` repo does not
  carry them; `METABASE_EMAIL` + `METABASE_PASSWORD` must be supplied before the
  fetch module can run against live Metabase.
