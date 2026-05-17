# Data integrations + refresh

> **Status update (2026-05-13, user input):** the original thread was "wire a Metabase refresh button." The actual ambition is **pluggable data integrations** — Metabase today, but Sentry, Google Play Console, YouTube APIs, and others on the roadmap. The platform stores raw data canonically (so we don't depend on the source for historical state). This document is rewritten against that.

## Why

Today the workflow is:
1. Open Metabase.
2. Download CSVs by hand.
3. Drop them into `backend/data/asset_search/`.
4. Restart / wait for DuckDB to reload.

That doesn't scale to 30 projects with mixed sources. The end state:
1. Project owner defines integrations in `project.json` (Metabase card, Sentry issue filter, YouTube channel ID, …).
2. Hits **Refresh** in the UI (or it runs on a schedule).
3. Platform calls each integration adapter, writes raw rows to canonical CSV/Parquet in `backend/data/<project>/`, reloads DuckDB.
4. Dashboard re-renders with fresh numbers.

This makes data sourcing **a config change, not a manual operation**.

## Pointers

### A. Integration as plugin

`backend/services/integrations/` holds one adapter per source kind:

```
integrations/
  base.py           # IntegrationAdapter base class
  metabase.py       # Metabase card → CSV
  sentry.py         # Sentry issues / events → CSV
  gplay.py          # Google Play Console (reviews, installs, crashes) → CSV
  youtube.py        # YouTube Data API (videos, comments, subs) → CSV
  csv_url.py        # Plain HTTP CSV (e.g. a public dataset)
  postgres.py       # Direct DB query → CSV
```

Each adapter implements one method:

```python
class IntegrationAdapter:
    kind: str  # "metabase" | "sentry" | …
    def fetch(self, source_config: dict, out_dir: Path) -> list[Path]:
        """Pull data per source_config; write one or more files into out_dir.
        Return list of paths written. Raise on failure."""
```

The dispatcher (`integrations/__init__.py`) reads `project.json.integrations`:

```json
"integrations": [
  {
    "id": "asset_search_initiated_w6",
    "kind": "metabase",
    "card_id": 1234,
    "out": "W6_may07_may11_asset_search_initiated.csv"
  },
  {
    "id": "sentry_errors_weekly",
    "kind": "sentry",
    "project": "gi-client-web",
    "query": "is:unresolved",
    "lookback_days": 7,
    "out": "W6_sentry_errors.csv"
  }
]
```

Each item maps to one adapter. `id` is stable across refreshes (used for logging / progress).

### B. Auth per adapter

Adapters read credentials from env, not from `project.json`. Each kind reads
its own var:

| Kind | Env vars | Notes |
|---|---|---|
| `metabase` | `METABASE_URL`, `METABASE_API_KEY` | API key header. Already in `.env.example`. |
| `sentry` | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` | Bearer token. |
| `gplay` | `GPLAY_SERVICE_ACCOUNT_JSON` | Google service-account JSON (base64-encoded). Reviews, installs, crashes. |
| `appstore` | `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPSTORE_PRIVATE_KEY` | App Store Connect API — JWT signed with the private key. Ratings, downloads, crashes. |
| `newrelic` | `NEWRELIC_API_KEY`, `NEWRELIC_ACCOUNT_ID` | NerdGraph (GraphQL) — NRQL queries for app crash rate, latency, throughput. |
| `youtube` | `YOUTUBE_API_KEY` | Public API key works for read-only endpoints. Channel/video/comment stats — incl. comparing our channel against others by channel ID. |
| `csv_url` | (none) | Public URL fetch. |
| `postgres` | `PG_HOST`, `PG_USER`, … per project | Multiple projects may want different DBs; key by `${id.upper()}_PG_HOST` etc. |

Project owners never see credentials in `project.json`. Credentials are infra-team concerns.

These adapters are the new-work side of the platform: each source kind is a
file written once, reused by every project that points at it. The dashboard
that renders the result is *config*, not code — see
[config-dashboard.md](./config-dashboard.md) §E for how the two decouple
(an "app health" dashboard over `newrelic` + `appstore` + `gplay`, or a
"YouTube channel comparison" over `youtube`, is the same `GenericDashboard`
with a different `project.json`).

### C. Output canonicalization

Adapters write to `backend/data/<project_id>/<filename>.csv`. **The platform owns the raw data**, not the source. This matters because:
- Metabase mutates: a card's SQL changes, historical data shifts. Our copy is the audit trail.
- Sentry pages out old events past retention. Our weekly snapshots persist.
- YouTube view counts drift down (re-attribution). Our snapshots hold the truth at fetch time.

After a refresh succeeds, optionally also write a manifest: `backend/data/<project>/_manifest.json` with `{ refreshed_at, source_versions, files }`. Useful for diffing across refreshes and for the "as of" stale marker in offline mode (see [pwa-offline.md](./pwa-offline.md)).

### D. The refresh endpoint

`POST /api/projects/<id>/refresh`. Async + polling (still the right shape):

- POST returns `{ job_id }` immediately.
- A background thread iterates `integrations`, calling each adapter in turn.
- `GET /api/projects/<id>/refresh/<job_id>` returns `{ status, progress: {done, total}, current_source, log[] }`.
- Frontend polls every 2s while running.
- After the last source: `db.load_csvs_for_project(project_id, csv_dir)` reloads DuckDB.
- Write `project.json.last_refreshed_at`.
- Set `X-Invalidate-Project: <id>` on the final POST response so the SW clears its cache (see [pwa-offline.md](./pwa-offline.md)).

Concurrency: one refresh per project at a time. Module-level `dict[project_id, threading.Lock]`.
Second concurrent request returns `409 Conflict` with the running `job_id`.

### E. Refresh UI

- A **Refresh** action sits in the project page header, next to "Project JSON" and "Ask the data" (classic) or as **PRESS RUN ↗** (editorial).
- States: idle (with tooltip showing last-refreshed-at), running (`Refreshing 3 / 12…` with per-source name), done (✓ chip for 3s), error (⚠ chip, click for log).
- The page doesn't block; user keeps reading current data while refresh runs in background.
- After success: invalidate the `useDashboard` hook's data and re-fetch.

Cooldown: probably **60s minimum between refreshes per project**. Below that, the button stays disabled with a tooltip "*the press needs a moment to cool*."

### F. Scheduled refreshes (later)

Out of scope for the first slice, but the architecture should support it:
- Same `refresh_project(project_id)` function callable from a cron handler.
- `project.json.refresh_schedule: "0 9 * * MON"` style.
- Render's cron capabilities are limited; might want a separate scheduler (a one-line GitHub Actions workflow that POSTs to the refresh endpoint with a service token works fine for v1).

### G. Connecting integrations to queries

A subtlety: refreshing pulls *raw data*. But the dashboard renders *computed queries*. The connection:

- Each integration writes CSV files → DuckDB tables (via existing `load_csvs_for_project`).
- The dashboard's queries (e.g. `weeklyAdoption`, `funnelByWeek`) run against those tables.
- So a refresh updates the underlying tables; the queries naturally produce new numbers next time they run.

For the generic dashboard (see [multi-project-platform.md](./multi-project-platform.md) §C1), each `query_key` referenced by the dashboard config maps to a SQL statement in `project.json.queries`:

```json
"queries": {
  "by_week":     "SELECT week, COUNT(DISTINCT user_id) AS visitors FROM …",
  "top_terms":   "SELECT term, COUNT(*) AS searches FROM … GROUP BY term ORDER BY searches DESC LIMIT 20"
}
```

So the full project file is:
- `integrations` → tells the platform how to fetch raw data
- `queries` → SQL strings that compute the dashboard's numbers
- `dashboard` → which queries feed which figures

This three-part shape is the platform's core abstraction.

## Trade-offs

- **Each adapter has its own auth + rate-limit story.** Sentry has tight rate limits, YouTube has daily quotas. Each adapter must surface those failure modes cleanly — refresh job logs need to be specific ("YouTube quota exhausted; try again at 00:00 UTC") not generic ("HTTP 403").
- **Canonical raw storage costs disk.** Render free tier disk is limited. At 50 projects × monthly refreshes × per-week files, we'll need to think about retention. Mitigation: a `_manifest.json` with `retention: "90d"` or similar.
- **The query layer must tolerate schema drift.** If Sentry adds a new column to its events export, the cached SQL might break. Mitigations: the canonical CSV is the contract; project owners pin adapter versions in `project.json` if they don't want auto-upgrade.
- **Long refresh jobs and Render free.** Render free sleeps after inactivity. A 5-minute refresh job might get killed mid-flight. Mitigation: heartbeat pings from the worker, or restart-safe job state (write progress to disk after each source).

## Open questions

1. ~~What's the actual Metabase mapping?~~ → **partially answered**: today CSVs are raw downloads from Metabase. **Action item**: enumerate the Metabase card IDs (or saved-question slugs) for the 57 asset_search CSVs. This is the gating step for the first slice.
2. **Are Metabase exports today raw or post-processed?** If post-processed (filtered, dedup'd), the adapter needs to either replicate the processing or trust Metabase to do it.
3. **Priority order for non-Metabase adapters?** Sentry vs Google Play vs YouTube — the first non-Metabase adapter teaches us the most about the abstraction; pick the most-needed one.
4. **What's the cooldown UX expectation?** 1 min? 5 min? 1 hour? Drives whether the button is "almost always available" or "rare ceremony."
5. **Retention policy** for the canonical raw store — keep forever, age out at 1 year, manual purge?

## Suggested first slice

The smallest slice that proves the architecture without committing to all of it:

1. **Get one Metabase card ID** (the one corresponding to the smallest asset_search CSV) from the user.
2. **Add `backend/services/integrations/{base.py, metabase.py}`** — `MetabaseAdapter.fetch(source_config, out_dir)` hits `GET /api/card/<id>/query/csv` with `X-API-Key`, writes one file.
3. **Wire `POST /api/projects/<id>/refresh`** + the polling endpoint, with in-memory locking. Single-source only (the one CSV).
4. **Frontend**: a `Refresh` button in the project header (classic only; editorial later). Idle → Running → Done states.
5. **Skip the SW invalidation** — that comes in the PWA pass.
6. Test against the live Metabase. Confirm a refresh updates the CSV → DuckDB reloads → dashboard re-renders new numbers.
7. **Expand to all 57 sources** (just a config change in `project.json.integrations`).
8. **Add a second adapter** (recommend Sentry or whatever's the next non-Metabase need) — that test forces the `base.py` abstraction to actually generalize.

Pre-requisite: **Metabase card IDs from the user**. Without them, step 1 stalls. (How to get them: open Metabase, find the question, copy the URL — the ID is the integer in `/question/<id>`.)
