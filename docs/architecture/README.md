# Architecture — platform-wide concerns

This folder is for decisions that affect **every** project on the Grip
Analytics platform. If a doc only matters to one project, it belongs in
`docs/projects/<project>/`, not here.

## What the platform is

`grip-analytics` is an internal, hosted analytics platform that serves
multiple independent analytics **projects** (Asset Search, Grip Connect, …)
from one Next.js frontend + FastAPI/DuckDB backend.

Shared, platform-level machinery — changes to any of this are architectural:

- **Data pipeline** — CSVs per project under `backend/data/<project>/`, baked
  into `grip.duckdb` by `backend/build_duckdb.py`; served read-only via
  `backend/services/duck.py`. Table naming: `{project}__{csv_stem}`.
- **Project routing** — `frontend/app/projects/[id]/page.jsx` renders a
  project's dashboard, picked from `components/dashboards/index.js` by the
  `dashboard_component` field in `backend/data/<project>/project.json`.
- **Integrations framework** — `backend/services/integrations/` — the
  deterministic Metabase-fetch + refresh pipeline. Designed for Grip Connect
  first (see its spec) but intended to be reused by every project.
- **Design system** — the Editorial ("The Weekly Report") and Classic
  variants, the design toggle, shared `components/ui`.
- **Auth** — `/login` cookie + middleware + `/api/proxy` credential injection.

## Cross-project references

These cross-project ideation docs currently still live under `docs/ideation/`
(migration pending — see `docs/README.md`):

- `ideation/multi-project-platform.md` — the multi-project model.
- `ideation/data-integrations.md` — the generic declarative `integrations`
  schema (the long-term generalisation of the per-project fetch modules).
- `ideation/mobile-first.md` — the platform-wide mobile-first UI standard.

## What does NOT belong here

A project's data sources, metric definitions, dashboard design, or roadmap —
even big ones — are project-level. Asset Search's abandonment metric and Grip
Connect's AUM funnel are not architecture; they live in their project folders.
