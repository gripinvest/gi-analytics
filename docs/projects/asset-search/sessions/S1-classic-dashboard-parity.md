# S1 — Classic dashboard: un-deprecate + funnel parity + mobile-first

## Goal

Make the **Classic** Asset Search dashboard a first-class, maintained dashboard
again — equal to Editorial. Users prefer Classic; it stays side-by-side.

Three things, one cohesive session (all touch `AssetSearchDashboard.jsx`):

1. **Un-deprecate** — remove the `@deprecated` JSDoc banner from
   `frontend/components/dashboards/AssetSearchDashboard.jsx`.
2. **Data parity** — rewire Classic to the **live session-outcome funnel**
   (Success / Relevance-gap / Dead-end), exactly as Editorial was in PR #42.
   Classic currently still shows the legacy reconstructed abandonment.
3. **Mobile-first pass** — audit and fix Classic at ≤375 px.

## Context to start cold

- PR #42 did this for the **Editorial** dashboard — `AssetSearchDashboardEditorial.jsx`
  is the worked example to mirror. Read its `edBuildIssuers`, the Fig 3 funnel,
  the per-issuer Fig III·b, and how it consumes `sessionOutcome` / `issuerOutcome`.
- `frontend/lib/queries/assetSearch.js` **already has** both query builders —
  `sessionOutcomeByWeek` and `sessionOutcomeByIssuerWeek`. No new SQL needed;
  just register them in Classic's query specs and consume them.
- Classic still has `buildIssuers` with `abandoned`/`relgap` from `ISSUER_MAP`,
  and a "True abandonment vs relevance gap" chart. These are the legacy
  reconstruction — replace with the funnel (overall + per-issuer), same as
  Editorial.
- `ISSUER_MAP.abandoned`/`relgap` arrays are legacy; after S1, *nothing* should
  read them — they can then be deleted from `assetSearch.js` (and the legacy
  `search_analytics/reconstruct_abandonment.py` retired).
- Mobile-first standard: `docs/ideation/mobile-first.md`.

## Scope

**In:** `AssetSearchDashboard.jsx` (the Classic file) and any of its query
registration; verifying both dashboards show matching numbers.
**Out:** the sign-out / theme-switcher overlap (that is S2 — shared components);
anything Metabase / data-fetch.

## Definition of done

- No `@deprecated` on Classic; both dashboards reachable via the design toggle.
- Classic shows the session-outcome funnel; no reconstructed-abandonment UI left.
- Classic and Editorial show identical numbers for the same metric.
- `next build` clean; Classic audited and clean at 375 px.
- If nothing else reads them, `ISSUER_MAP.abandoned`/`relgap` removed.

## Suggested branch

`feat/asset-search-classic-parity`
