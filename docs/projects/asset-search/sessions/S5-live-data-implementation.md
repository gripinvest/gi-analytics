# S5 — Asset Search live-data: implementation

## Goal

Build the Metabase fetch pipeline and the **daily 12 AM cron** for Asset Search,
per the S4 spec — so the dashboard always shows current data without anyone
hand-uploading CSVs.

## Depends on

- **S4** (the design spec) — required. Build against it.
- **S3** (data validation) — strongly benefits: the first fetch must reproduce
  known-good numbers, and S3's Metabase client / checks are reusable here.

## Context to start cold

- Read the S4 spec first. Then the Grip Connect reference:
  `docs/specs/2026-05-17-grip-connect-live-data-design.md` and its plan
  `docs/plans/2026-05-17-grip-connect-live-data.md` — mirror the architecture
  (deterministic Python, `integrations/` package, scheduled GitHub Action +
  manual refresh, accumulate-by-upsert), but use Asset Search's own tables and
  fetch mechanism as the S4 spec defines.
- Check if `backend/services/integrations/metabase.py` already exists (Grip
  Connect may have built it) — reuse it; only build what's missing.
- Credentials: `backend/.env` → `METABASE_EMAIL` / `METABASE_PASSWORD`; also as
  GitHub Actions secrets for the cron.
- Discipline: Claude authors & validates; the cron / CI runs extraction.

## Scope (refine against the S4 spec)

**In:**
- `backend/services/integrations/asset_search.py` — fetch module.
- Metabase client (`metabase.py`) — reuse or build.
- `refresh.py` + a `POST /api/projects/asset_search/refresh` endpoint.
- The **daily GitHub Action** on a 12 AM cron that fetches and commits CSVs.
- Onboard the new tables (`data-sources.md` §3/§5) into the fetch.
- `backend/data/asset_search/project.json` → `refreshable: true` + freshness.
- Tests against a mocked Metabase client.

**Out:** new dashboard exhibits for the new tables — that is downstream
dashboard work once the data lands (a later session).

## Definition of done

- The daily cron fetches Asset Search data from Metabase and commits refreshed
  CSVs; the dashboard reads current data.
- First run reproduces the current known-good numbers (validated via S3).
- Manual refresh endpoint works; tests pass; `next build` clean.

## Suggested branch

`feat/asset-search-live-data-impl`
