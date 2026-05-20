# Performance Grip — project

Leadership-facing weekly performance-hygiene dashboard for Grip Invest's web
surfaces, backed by a daily archive of New Relic Web Vitals data that outlives
NR's 8-day retention window.

- **Owner:** Puru
- **Dashboard route:** `/projects/performance_grip` (Editorial only in v1)
- **Status:** Brainstormed; pending implementation plan
- **Apps tracked (v1):** GI Client Static (pre-login), GI Client Web (post-login)
- **Mobile apps:** explicitly v2

## Why this project

NR Standard plan retains raw browser events for **8 days**. Leadership wants
visibility into web performance trends over **months to quarters**. Without
an archive, week-over-week and month-over-month comparisons are impossible —
the source data has already aged out.

Performance Grip persists the numbers before they expire, and presents them
as daily trendlines for weekly leadership review. The dashboard's job is
*demonstrating attention*, not forensics. Forensics stays in NR.

## Dashboard

- **Editorial** (v1) — `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx`
- **Classic** — deferred to v1.5

## Headline metrics

Per page × device × day, for each app:

- **Core Web Vitals** — LCP, INP, CLS (p75 + p95)
- **Supporting** — FCP, TTFB (p75 + p95)
- **Volume / quality denominators** — page views, JS error count

Storage: `backend/data/performance_grip/hourly_web_vitals.csv`. Raw URLs
stored; route patterns applied at the dashboard layer via
`backend/data/performance_grip/route_patterns.csv`.

## Cron

GitHub Actions, twice daily at 01:00 + 13:00 IST. Workflow:
`.github/workflows/refresh-performance-grip.yml`. Reruns and backfill within
NR's 8-day window via `workflow_dispatch` with `since=YYYY-MM-DD`.

## Key files (after implementation)

| Area | Path |
|------|------|
| Spec | [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md) |
| NR client | `backend/services/integrations/new_relic.py` |
| Fetch module | `backend/services/integrations/performance_grip.py` |
| Archive | `backend/data/performance_grip/hourly_web_vitals.csv` |
| Route patterns | `backend/data/performance_grip/route_patterns.csv` |
| Project metadata | `backend/data/performance_grip/project.json` |
| Dashboard | `frontend/components/dashboards/PerformanceGripDashboardEditorial.jsx` |
| Sub-components | `frontend/components/dashboards/performance-grip/` |
| Workflow | `.github/workflows/refresh-performance-grip.yml` |

## In this folder

- [`specs/2026-05-20-performance-grip-design.md`](./specs/2026-05-20-performance-grip-design.md) — **start here** — the design spec.
- `session-log.md`, `data-sources.md`, `roadmap.md` — to be created during implementation.
