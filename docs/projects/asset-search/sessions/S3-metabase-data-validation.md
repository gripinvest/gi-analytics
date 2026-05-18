# S3 — Validate Asset Search data points against Metabase

## Goal

Validate **every data point** the Asset Search dashboard shows against Metabase
(the source of truth) — confirm the local-CSV / DuckDB numbers are correct, and
record any discrepancies.

## Context to start cold

- Metabase: `https://metabase.gripinvest.in`, `database_id 8`, schema
  `client_web`. Credentials are in `backend/.env` as `METABASE_EMAIL` /
  `METABASE_PASSWORD`. Auth: `POST /api/session` → token; query via
  `POST /api/dataset` (raw SQL) or `POST /api/card/{id}/query` (saved cards).
- The dashboard's metrics and their source computations are catalogued in
  [`../data-sources.md`](../data-sources.md) §6 — that is the checklist.
- Known data facts already established (re-confirm, don't assume):
  - `asset_search_cleared` export is 4-column for W1–W3, full ~99-column W4–W6.
  - Session-outcome funnel is computed from `asset_search_query` +
    `asset_search_result_clicked`.
  - Test users to exclude everywhere: `3, 4, 207871, 207875, 207878, 207879`.
- Data discipline: **author** a deterministic validation script; the actual run
  against live Metabase is a credentialed job (CI / the user), not interactive.

## Approach

For each metric in `data-sources.md` §6: take its source table + computation,
issue the equivalent query to Metabase, and diff against what the dashboard
(local CSV → DuckDB) produces for the same window. Write the comparison as a
deterministic script (`backend/services/integrations/validate_asset_search.py`
or similar) plus a human-readable validation report.

Cross-check especially: row counts per event table, query-level ZRR, the
session-outcome funnel totals, per-issuer numbers, and the W1–W6 vs W7 window.

## Scope

**In:** a validation script + a validation report; corrections to
`data-sources.md` (mark each metric validated / flag discrepancies).
**Out:** building the fetch cron (that is S4/S5) — though this script's Metabase
client code is reusable by S5.

## Definition of done

- Validation script committed; covers every dashboard data point.
- A validation report listing each metric as confirmed or discrepant.
- `data-sources.md` §0/§6 updated with validated status.

## Suggested branch

`feat/asset-search-data-validation`

> May be folded into S4 if you prefer validation findings to feed the spec
> directly — but it stands alone fine.
