# S4 — Asset Search live-data: design spec

## Goal

Write the **design spec** for making the Asset Search dashboard run on live
Metabase data — a daily auto-fetch so the dashboard always shows current
numbers, and onboarding of the new tables. Deliverable is a spec doc, not code.

## Context to start cold

- **Reference pattern:** `docs/specs/2026-05-17-grip-connect-live-data-design.md`
  — the approved Grip Connect live-data spec. **Adapt it, do not copy it.**
  Grip Connect fetches **5 saved Metabase cards by ID** (parameterised by
  partner). Asset Search is different and the spec must reflect that:
  - Asset Search has **many event tables** (6 search events + `view_assets` +
    invest tables + the new payment tables), not 5 partner cards.
  - It likely needs **raw parameterised SQL** via `POST /api/dataset`, not saved
    card IDs — unless saved cards exist. Decide this in the spec.
  - Windowing is by **feature week** (from the 2 Apr launch), not calendar.
- New tables to onboard are in [`../data-sources.md`](../data-sources.md) §3 &
  §5: `view_payment_page_loaded`, `view_payment_status_page`, `new_user_order`,
  `order_summary_clicked`, `asset_card_clicked`. The spec covers fetching these.
- Credentials: `backend/.env` → `METABASE_EMAIL` / `METABASE_PASSWORD`.
- Check whether Grip Connect already built `backend/services/integrations/`
  (`metabase.py` client) — if so, the spec reuses it; if not, S5 builds it.
- The daily cron: a **GitHub Action on a 12 AM cron** that fetches and commits
  refreshed CSVs (same durability model as the GC spec — history in git).

## What the spec must decide

- Saved cards vs raw SQL via `/api/dataset`.
- Which tables/queries, and their natural keys for upsert/accumulation.
- The DuckDB data model (layer-1 raw / layer-2 derived, per GC spec §7).
- The daily GitHub Action (12 AM) + a manual refresh endpoint.
- New-table onboarding — schema, dashboard use (ties to `roadmap.md` #2).
- Test-user exclusion, validation hooks, error handling, credentials rotation.

## Scope

**In:** one spec doc — `docs/projects/asset-search/specs/<date>-asset-search-live-data-design.md`.
**Out:** implementation (that is S5).

## Definition of done

- A reviewed-ready spec covering fetch mechanism, tables, cron, data model,
  refresh, new-table onboarding — concrete enough for S5 to build against.

## Suggested branch

`feat/asset-search-live-data-spec`
