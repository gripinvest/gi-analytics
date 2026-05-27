# Learn (Grip Education) — architecture

How the dashboard works end-to-end: which repos emit data, which systems
move it, which file shapes it lands in, and how it gets to the reader.

> **For SQL + event payloads:** see [`data-sources.md`](./data-sources.md).
> **For the why behind the choices:** see [`decisions.md`](./decisions.md).
> **For day-to-day operation:** see [`operations.md`](./operations.md).

---

## 1. The picture

```
┌──────────────────────────────┐
│  gi-client-web (Next.js FE)  │  prod tag v22.0.26 (2026-05-27)
│                              │
│  components/learn/...        │  emits 6 Learn events + 2 cross-feature
│  events/constants.ts          │
│  utils/experimentBucketing   │
└──────────────┬───────────────┘
               │ Rudder SDK
               ▼
┌──────────────────────────────┐
│  Rudder Cloud / Postgres     │  schema: client_web
│  (Metabase database_id 8)    │  one table per event, append-only
└──────────────┬───────────────┘
               │ Metabase REST API
               │ POST /api/dataset (per query)
               ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  grip-analytics backend      │◄────────│  Metabase database_id 24    │
│  (Python, FastAPI/DuckDB)    │         │  (ClickHouse warehouse)     │
│                              │         │  prodgripdb.ur_tblorders    │
│  services/integrations/      │         │  — FTI orders, all users    │
│    learn_education.py        │         └──────────────────────────────┘
│  + GitHub Action (daily 01:00 IST)
│  outputs: weekly_ab_tracker.csv
└──────────────┬───────────────┘
               │ git commit (chore: refresh Learn Education data)
               ▼
┌──────────────────────────────┐
│  main branch / Render        │  auto-deploy on push
│  build_duckdb.py             │  CSVs → grip.duckdb image
│  table: learn_education__    │
│    weekly_ab_tracker         │
└──────────────┬───────────────┘
               │ HTTP (FastAPI /api/projects/learn_education/query)
               ▼
┌──────────────────────────────┐
│  Next.js frontend (Vercel)   │  auto-deploy on push
│                              │
│  lib/queries/                │  useLearnEducation(nonce)
│    learnEducation.js         │
│  components/dashboards/      │  LearnEducationDashboardEditorial.jsx
└──────────────────────────────┘
               │
               ▼
       Reader's browser
```

## 2. Moving parts — repo by repo

### 2.1 `gi-client-web` (separate repo)

The product itself. Source of every event.

| File | Role |
|---|---|
| `components/learn/hooks/useShowLearnPage.ts` | Gates Learn surface visibility; emits `experiment_assigned` for both arms |
| `components/learn/hooks/useLearnPageEvents.ts` | Emits `learn_page_viewed` with `entry_source` |
| `components/learn/LearnVideoSection/LearnVideoSection.tsx` | Emits `learn_category_clicked` + `learn_video_opened` |
| `components/learn/VideoReels/useVideoReels.ts` | Emits `learn_video_viewed` at view-end |
| `components/learn/VideoGrid/VideoGrid.tsx` | Emits `learn_outbound_clicked` on banner taps |
| `events/constants.ts` | Canonical event-name + typed-value constants (`LEARN_*`) |
| `events/types.ts` | Payload type unions derived from constants |
| `utils/experimentBucketing.ts` | `getExperimentAssignment()` + `trackExperimentAssignment()` — the source of truth for variant assignment |
| `utils/gtm.ts` | The actual `trackEvent()` Rudder/GTM call site |

**Shipped:** `v22.0.26` on 2026-05-27 at 13:02 IST.

### 2.2 Rudder + Metabase DB 8

Rudder writes one table per event into the `client_web` schema:

- `client_web.experiment_assigned`
- `client_web.learn_page_viewed`
- `client_web.learn_category_clicked`
- `client_web.learn_video_opened`
- `client_web.learn_video_viewed`
- `client_web.learn_outbound_clicked`

Plus cross-feature events we read from (don't fork):
- `client_web.bottom_nav_click`
- `client_web.banner_clicked`

Metabase `database_id 8` connects to this Postgres. Our cron's engagement
query (`build_engagement_sql`) runs against this DB. Per-user join keys are
`user_id::text` (stored as varchar in Rudder).

### 2.3 Metabase DB 24 (ClickHouse warehouse)

The transactions warehouse. Our FTI fetch lives here. We read
`prodgripdb.ur_tblorders` (the `unrestricted_user` role's view of
`tblorders`) using `fetch_fti_for_cohort()` — cohort-scoped + paginated.

DB 24 is the **analyst-canonical** source: business reports query the
same warehouse, so our numbers match what's published elsewhere. See
[`decisions.md`](./decisions.md) for the full reasoning.

### 2.4 `grip-analytics` backend (this repo)

| File | Role |
|---|---|
| `backend/services/integrations/learn_education.py` | The fetch module. Probes, engagement SQL, FTI fetch, Python merge, CSV write. |
| `backend/services/integrations/metabase.py` | The thin `MetabaseClient` (`run_sql`, `fetch_card`). |
| `backend/services/integrations/refresh.py` | Registry that maps `learn_education` → `learn_education.run`. |
| `backend/data/learn_education/project.json` | Project metadata: name, dashboard route, refreshable flag. |
| `backend/data/learn_education/weekly_ab_tracker.csv` | The output — committed to git on every successful cron run. |
| `backend/data/learn_education/manifest.json` | `refreshed_at` timestamp + tables list. The "as of" stamp in the UI reads from here. |
| `backend/build_duckdb.py` | At deploy time, bakes `weekly_ab_tracker.csv` into the table `learn_education__weekly_ab_tracker` in `grip.duckdb`. |
| `backend/tests/test_learn_education.py` | 25 tests covering probe states, SQL invariants, the FakeClient pattern, edge cases. |
| `.github/workflows/refresh-learn-education.yml` | The daily cron. Runs the module, commits CSV. |

**Cron schedule:** `30 19 * * *` UTC = **01:00 IST daily**.

### 2.5 `grip-analytics` frontend (this repo, `frontend/`)

| File | Role |
|---|---|
| `frontend/lib/queries/learnEducation.js` | `useLearnEducation(nonce)` hook + `COLUMNS` definition + variant helpers + lift computation |
| `frontend/lib/api.ts` | `runQuery()` POSTs SQL to FastAPI `/api/projects/<id>/query` |
| `frontend/components/dashboards/LearnEducationDashboardEditorial.jsx` | The page. Editorial broadsheet aesthetic, reads from the hook. |
| `frontend/components/RefreshControl.jsx` | Shared refresh button + `useProjectRefresh()` hook |
| `frontend/pages/projects/learn_education.js` | Route — wires the dashboard component |

**Hosted on:** Vercel at `grip-analytics-psi.vercel.app`.

## 3. The 5 data hops

Each hop is independently observable and recoverable.

| # | From → To | When | Failure recovery |
|---|---|---|---|
| 1 | User action → `trackEvent` call | Real-time in user's browser | Sentry on gi-client-web side. Not our problem. |
| 2 | `trackEvent` → Rudder table | Async, batched by Rudder SDK | Rudder retries on its side. Idempotent. |
| 3 | Rudder table → cron's engagement query | Daily 01:00 IST | Next run picks it up automatically. Whole-window recompute. |
| 4 | Cron → CSV commit on `main` | Same cron run | If commit fails, log + exit non-zero; next run re-derives. |
| 5 | `main` commit → DuckDB on prod | Render auto-deploy (~3-5 min) | Re-deploy via Render dashboard if it sticks. |
| 6 | DuckDB → dashboard render | Live on every page load | Manual refresh button bumps nonce → re-fetch. |

The system is **self-healing** across hops 3-5: a missed cron, a failed
commit, or a stuck Render deploy all resolve themselves on the next
successful run — without any backfill workflow.

## 4. The 12-week rolling window

Every cron run is a **fresh 12-week-rolling snapshot**. No incremental
state. No append-only growth.

- Engagement queries: `WHERE timestamp >= NOW() - INTERVAL '12 weeks'`.
- FTI query: same window, plus `user_id IN (<cohort ids from step 1>)`.
- Output CSV: ≤ 24 rows (12 weeks × 2 variants today; more variants in future).

This is the right shape because:
- The output is tiny (≤ 3 KB), so git growth is a non-issue.
- The cohort-scoped FTI fetch means query cost is bounded by cohort
  size, not order-table size — independent of window length.
- Whole-window recompute surfaces backfilled events automatically.

See [`decisions.md`](./decisions.md) for the alternatives we considered
and rejected (4-week window, incremental writes, twice-daily run).

## 5. Where it lives in deployments

| Environment | URL / location | What's there |
|---|---|---|
| **Source of truth** | https://github.com/purujit-grip/grip-analytics | The repo + CSVs + DuckDB |
| **Backend (live)** | https://grip-analytics-api.onrender.com | FastAPI + `grip.duckdb` baked at build time |
| **Frontend (live)** | https://grip-analytics-psi.vercel.app | Next.js, auto-deployed from `main` |
| **Dashboard** | https://grip-analytics-psi.vercel.app/projects/learn_education | The destination |
| **GitHub Actions** | https://github.com/purujit-grip/grip-analytics/actions/workflows/refresh-learn-education.yml | Daily cron + manual triggers |

## 6. What it deliberately ISN'T

To keep the architecture honest:

- **Not real-time.** The dashboard shows what the most recent cron ran. Manual refresh re-derives but doesn't reach into a streaming pipeline.
- **Not transactional.** No locks, no concurrency. The atomic CSV write + atomic git commit are the consistency boundary.
- **Not multi-tenant.** One project per file. Reader auth is a single shared cookie (the broader grip-analytics auth model).
- **Not extensible at runtime.** Adding a new event = code change + redeploy. No admin UI to configure events.

Each of those is a deliberate scope cut for V1/V2, not a defect.
