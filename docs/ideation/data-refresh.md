# Data refresh button

## Why

Today the asset_search CSVs are dropped into `backend/data/asset_search/` by
hand (presumably exported from Metabase manually). A "refresh" button on the
dashboard should make this self-service: hit the Metabase API, pull fresh
data, write CSVs, reload DuckDB, recompute every metric. The current
6-week-ago numbers should become this-morning's numbers without anyone
touching a shell.

The backend already has `METABASE_URL` and `METABASE_API_KEY` env vars — they
were placeholder credentials, never wired up. This thread wires them up.

## Pointers

### A. Per-project refresh pipelines

Different projects pull from different Metabase questions. The right shape is:

- `backend/data/<project_id>/project.json` carries a **`refresh`** object describing the pipeline. Example for asset_search:

  ```json
  {
    "refresh": {
      "kind": "metabase",
      "sources": [
        { "card_id": 1234, "out": "W1_apr02_apr08_asset_search_initiated.csv" },
        { "card_id": 1235, "out": "W2_apr09_apr15_asset_search_initiated.csv" },
        ...
      ]
    }
  }
  ```

- A **`kind`** dispatcher in `backend/services/refresh.py` selects the implementation. `"metabase"` is the only one today; future projects might use `"postgres"`, `"s3"`, `"csv-url"`.

- For Metabase: each source maps a saved question (card) to an output filename. The fetcher hits `GET /api/card/<card_id>/query/csv` with `X-API-Key`, streams the response to disk.

- After all sources land, call `db.load_csvs_for_project(project_id, csv_dir)` (already exists) to reload tables. The function uses `CREATE OR REPLACE TABLE …` so it's safe to call repeatedly.

### B. Endpoint shape

`POST /api/projects/<id>/refresh`. Three flavours, pick one:

**B1. Synchronous, blocking**
- Request stays open until the refresh finishes.
- Frontend shows a spinner.
- Bad if the refresh takes >30s (Render's HTTP idle timeout is generous but not infinite, and the user perceives long requests as broken).

**B2. Async + polling**
- POST returns a `job_id` immediately, starts a thread.
- Frontend polls `GET /api/projects/<id>/refresh/<job_id>` every 2s for `{status: "running"|"done"|"error", progress, log}`.
- More moving parts but the UX scales to any duration.

**B3. SSE streaming**
- POST opens an SSE stream that emits progress events until completion.
- Same complexity as B2, simpler frontend (no polling), but harder to recover if the connection drops.

**Recommend B2** for two reasons: (1) we can fall back gracefully if the job fails, (2) the polling UX is identical to "Add to Reading List" patterns the user already understands. Also: easier to back off if a refresh is taking too long.

### C. Concurrency / locking

Two users hitting refresh on the same project at the same time would scramble
the CSVs mid-write and corrupt DuckDB. Need a project-level lock:

- In-memory `threading.Lock` per `project_id`, keyed in a dict at module load.
- If a refresh is already running for that project, return `409 Conflict` with the running `job_id` so the frontend can poll the existing one instead of starting a duplicate.

This works for a single-instance Render deployment. If we ever scale to multiple
instances we'd need a distributed lock (Redis / DB row lock); flag it as a
future concern, don't build it now.

### D. Frontend UI

The refresh control sits next to **"Project JSON"** and **"Ask the data"** in
the project page header. Three states:

1. **Idle** — `Refresh data` button. Tooltip on hover (or long-press on
   mobile) shows last refresh timestamp (read from `project.json.last_refreshed_at`).
2. **Running** — button is disabled, replaced with `Refreshing X / Y…` showing
   per-source progress. The page does **not** block; the user can keep
   reading current data.
3. **Done** — flash a `✓ Refreshed` chip for 3s, then return to Idle. The
   page-data hook re-fetches its queries.
4. **Error** — `⚠ Refresh failed` chip, click to expand the error log. Don't
   replace the data — the user keeps seeing the previous numbers.

**Editorial styling**: in editorial mode the button becomes a stamp-style
"PRESS RUN ↗" with an ink-on-paper treatment. The progress indicator becomes
italic mono ("setting types 4 / 12…").

### E. After a refresh succeeds

Several things invalidate:

- **Frontend query cache** (the `useDashboard` hook): just re-run all queries. Simple.
- **Service worker cache for that project** (see [pwa-offline.md](./pwa-offline.md)): the SW must drop every cached `/api/proxy/api/projects/<id>/*` entry. Options:
  - The refresh endpoint sets `Cache-Control: no-store` on its response and includes an `X-Invalidate-Project: <id>` header. The SW intercepts that header and clears matching entries.
  - Or: the frontend explicitly `postMessage`s to the SW after a successful refresh, telling it which prefix to clear.
  - The header approach is cleaner (server is authoritative); the postMessage approach is easier to debug.
- **DuckDB** is already invalidated by `db.load_csvs_for_project()` because it uses `CREATE OR REPLACE TABLE`.
- **`last_refreshed_at`**: persist the timestamp into `project.json` after a successful refresh so the timestamp survives backend restarts.

### F. The Metabase mapping

The hard part isn't the refresh button, it's **filling out the `sources` mapping**
for asset_search. Today we have 57 CSVs across 6 weeks, named like
`W4_apr23_apr29_asset_search_query.csv`. Each maps to *something* in Metabase
— a saved question, a SQL question, or a database export. That mapping needs
to be discovered (probably with the user's help) and committed to
`project.json`.

Open: are the CSVs literally exports of single Metabase questions, or are they
post-processed (filtered, dedup'd) in some way? If post-processed, the
refresh pipeline needs to do that work too — probably as a Python step
between download and DuckDB-load.

### G. Schedules (later)

Eventually the user will want this to run automatically (e.g. every Monday morning).
That's a cron + the same refresh function. Out of scope for the first slice,
but the architecture should not preclude it — the refresh function should be
callable from a cron job or an HTTP handler with the same signature.

## Trade-offs

- **The refresh pipeline becomes a load-bearing piece of the platform.** When it fails, the dashboard data ages out. Worth wiring up basic alerting (Slack? email?) on repeated failures.
- **Caching after refresh** is the trickiest cross-thread interaction. If the SW invalidation in §E is buggy, users see stale data after a refresh and think the refresh didn't work. This is the bug most likely to embarrass us in front of stakeholders. Test it explicitly.
- **Concurrency**: in-memory locking is single-instance only. If Render's free tier ever auto-scales (it doesn't, but hypothetically), the lock breaks.
- **Metabase costs**: every refresh fires N queries against Metabase. If a project has 50 sources and the user spams refresh, we'll get rate-limited or charged. Recommend: a soft cooldown ("you refreshed 2 min ago — refresh again?") and a hard cooldown (max 1 refresh / project / minute).

## Open questions

1. What's the actual Metabase → CSV mapping for asset_search? Need card IDs.
2. Are the CSVs raw exports or post-processed? Drives whether the refresh pipeline needs a transform step.
3. Should refresh be authenticated specially (only some users can refresh) or available to anyone with login? For a demo, anyone. For real, probably an `admin` role bit.
4. What's the right cooldown — 1 minute? 5? An hour? Drives the UX of the button (always available vs sometimes greyed out).
5. Should a refresh be all-or-nothing (rollback if any source fails) or partial (whatever succeeded gets loaded)? Partial is easier; all-or-nothing is safer. Recommend partial with a clear "3 of 12 sources failed" message.

## Suggested first slice

Smallest end-to-end refresh:

1. Define the mapping for **just one CSV** of asset_search — pick the smallest one. Add it to `project.json.refresh.sources`.
2. Write `services/refresh.py` with a `refresh_project(project_id) → job_id` function (B2 shape) that handles the single source.
3. Wire the endpoint (`POST /api/projects/<id>/refresh`, `GET /api/projects/<id>/refresh/<job_id>`) and the in-memory lock.
4. Add the Idle/Running/Done button in classic mode only (skip editorial for the first slice).
5. **Don't touch the SW** in the first slice. Refresh and stale cache will coexist briefly; that's fine until PWA caching ships in [pwa-offline.md](./pwa-offline.md).
6. Confirm end-to-end against Metabase staging (or prod if that's the source).
7. Once the one-CSV path works, expand to the full list of 57 sources. The pipeline shape doesn't change.

Pre-requisite: get the Metabase card IDs for at least the asset_search sources from the user, or document the discovery procedure (e.g. "open Metabase, find question, copy URL, extract ID"). Without those, the rest of the work can't land.
